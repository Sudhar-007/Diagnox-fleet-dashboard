import { test } from 'node:test';
import assert from 'node:assert/strict';

import { rules } from '../config/rules.js';
import { createAlertService } from '../services/alerts.js';
import { evaluateHealth } from '../engine/health.js';
import { createServer } from '../app.js';
import { formatTs, parseTs } from '../engine/time.js';

const T0 = parseTs('2026-09-10T10:00:00');
const CLEAR_S = rules.alerts.clear_after_s;

const base = {
  truck_id: 'TN03',
  driver_name: 'Arun Prakash',
  latitude: 13.0,
  longitude: 80.2,
  coolant_temp: 90,
  oil_temp: 88,
  battery_voltage: 13.9,
  rpm: 1800,
  engine_load: 50,
  speed: 40,
};

// Runs a sequence of per-second overrides through the real health engine + alert service.
function drive(svc, steps, startS = 0) {
  const history = [];
  const changes = [];
  steps.forEach((over, i) => {
    const s = startS + i;
    const point = { ...base, ...over, timestamp: formatTs(T0 + s * 1000) };
    const { findings } = evaluateHealth(point, history, rules.health);
    history.push(point);
    changes.push(...svc.evaluate({ ...point, findings }, T0 + s * 1000));
  });
  return changes;
}
const repeat = (n, over) => Array.from({ length: n }, () => over);

test('opens once, escalates, clears only after being within limits for the clear delay', () => {
  const svc = createAlertService({ rules });
  const c1 = drive(svc, [{ coolant_temp: 104 }]);
  assert.equal(c1.length, 1);
  assert.equal(c1[0].kind, 'new');
  assert.equal(c1[0].alert.level, 'warning');

  assert.equal(drive(svc, [{ coolant_temp: 105 }], 1).length, 0);

  const c3 = drive(svc, [{ coolant_temp: 112 }], 2);
  assert.equal(c3[0].event.type, 'escalated');
  assert.equal(c3[0].alert.level, 'critical');

  // 105 is below critical but still above the warning threshold: stays open, still firing
  drive(svc, repeat(20, { coolant_temp: 105 }), 3);
  assert.equal(svc.list({ status: 'open' })[0].condition, 'firing');

  // back to normal: condition flips to "within", then closes after the delay
  const c4 = drive(svc, repeat(CLEAR_S, { coolant_temp: 90 }), 23);
  assert.equal(svc.list({ status: 'open' }).length, 1);
  assert.equal(c4[0].alert.condition, 'within');
  const c5 = drive(svc, [{ coolant_temp: 90 }], 23 + CLEAR_S);
  assert.equal(c5[0].event.type, 'cleared');
  assert.equal(c5[0].alert.resolution, 'cleared');
  assert.equal(svc.list({ status: 'open' }).length, 0);
});

test('a value flapping on the threshold does not open repeated alerts', () => {
  const svc = createAlertService({ rules });
  const steps = Array.from({ length: 40 }, (_, s) => ({ coolant_temp: s % 2 ? 99 : 101 }));
  const opened = drive(svc, steps).filter((c) => c.kind === 'new').length;
  assert.equal(opened, 1);
});

test('one low sample inside a sustained engine-load breach does not close the alert', () => {
  const svc = createAlertService({ rules });
  drive(svc, repeat(61, { engine_load: 90 }));
  assert.equal(svc.list({ status: 'open' }).length, 1);
  // a single dip resets the 60 s rule window, but the raw value is back above 85 at once
  drive(svc, [{ engine_load: 80 }, ...repeat(30, { engine_load: 90 })], 61);
  const open = svc.list({ status: 'open' });
  assert.equal(open.length, 1);
  assert.equal(open[0].condition, 'firing');
});

test('engine off does not count as battery recovery', () => {
  const svc = createAlertService({ rules });
  drive(svc, repeat(11, { battery_voltage: 12.9 }));
  assert.equal(svc.list({ status: 'open' })[0].field, 'battery_voltage');
  // ignition off, voltage still low: the rule cannot be judged, the alert must stay open
  const changes = drive(svc, repeat(30, { rpm: 0, speed: 0, battery_voltage: 12.5 }), 11);
  const open = svc.list({ status: 'open' });
  assert.equal(open.length, 1);
  assert.equal(open[0].condition, 'unknown');
  assert.ok(changes.every((c) => c.event?.type !== 'cleared'));
});

test('acknowledged alert becomes ACTIVE again when it escalates', () => {
  const svc = createAlertService({ rules });
  const [{ alert }] = drive(svc, [{ coolant_temp: 104 }]);
  svc.act(alert.id, { status: 'ACKNOWLEDGED', by: 'Priya' }, T0 + 5000);
  const [esc] = drive(svc, [{ coolant_temp: 113 }], 6);
  assert.equal(esc.alert.status, 'ACTIVE');
  assert.equal(esc.event.reopened, true);
  assert.equal(esc.alert.acknowledged_by, 'Priya');
});

test('manual resolve while firing stays quiet until the value has recovered for the delay', () => {
  const svc = createAlertService({ rules });
  const [{ alert }] = drive(svc, [{ coolant_temp: 104 }]);
  const res = svc.act(alert.id, { status: 'RESOLVED', note: 'Coolant topped up' }, T0 + 90_000);
  assert.equal(res.alert.resolution, 'manual');
  assert.equal(res.alert.resolved_ms - res.alert.opened_ms, 90_000);
  assert.throws(() => svc.act(alert.id, { status: 'RESOLVED' }), /already resolved/);

  // still hot, and one brief dip below: suppression holds
  assert.equal(drive(svc, [{ coolant_temp: 104 }, { coolant_temp: 99 }, { coolant_temp: 104 }], 91).length, 0);
  // recovers for the full delay, then overheats again: a fresh alert opens
  drive(svc, repeat(CLEAR_S + 1, { coolant_temp: 90 }), 94);
  const again = drive(svc, [{ coolant_temp: 106 }], 95 + CLEAR_S);
  assert.equal(again[0].kind, 'new');
  assert.notEqual(again[0].alert.id, alert.id);
});

test('resolving an alert that is not firing does not suppress the field', () => {
  const svc = createAlertService({ rules });
  const [{ alert }] = drive(svc, [{ coolant_temp: 104 }]);
  drive(svc, [{ coolant_temp: 90 }], 1); // recovering, not yet closed
  svc.act(alert.id, { status: 'RESOLVED' }, T0 + 2000);
  const again = drive(svc, [{ coolant_temp: 104 }], 3);
  assert.equal(again[0].kind, 'new');
});

test('a truck that stops reporting marks its open alerts as no data', () => {
  const svc = createAlertService({ rules });
  drive(svc, [{ coolant_temp: 112 }, { coolant_temp: 90 }]);
  const lastSeen = T0 + 1000;
  assert.equal(svc.sweep(() => lastSeen, lastSeen + 5000).length, 0);
  const swept = svc.sweep(() => lastSeen, lastSeen + (rules.freshness.stale_after_s + 1) * 1000);
  assert.equal(swept.length, 1);
  assert.equal(swept[0].alert.condition, 'no_data');
  assert.equal(swept[0].event, null);
  assert.equal(svc.list({ status: 'open' }).length, 1);
  // sweeping again does not re-broadcast
  assert.equal(svc.sweep(() => lastSeen, lastSeen + 60_000).length, 0);
});

test('manager input is validated', () => {
  const svc = createAlertService({ rules });
  const [{ alert }] = drive(svc, [{ coolant_temp: 104 }]);
  assert.throws(() => svc.act('A999', { status: 'RESOLVED' }), /unknown alert/);
  assert.throws(() => svc.act(alert.id, { status: 'DONE' }), /status must be/);
  assert.throws(() => svc.act(alert.id, { status: 'RESOLVED', note: 'x'.repeat(501) }), /note must be/);
  assert.throws(() => svc.act(alert.id, { status: 'RESOLVED', by: 42 }), /by must be/);
  svc.act(alert.id, { status: 'ACKNOWLEDGED' });
  assert.throws(() => svc.act(alert.id, { status: 'ACKNOWLEDGED' }), /already acknowledged/);
});

test('events keep the rule that applied when they happened', () => {
  const svc = createAlertService({ rules });
  drive(svc, [{ coolant_temp: 104 }, { coolant_temp: 112 }]);
  const [escalated, opened] = svc.events();
  assert.equal(opened.type, 'opened');
  assert.equal(opened.name, 'Coolant high');
  assert.equal(opened.threshold, 100);
  assert.equal(escalated.name, 'Coolant critical');
  assert.equal(escalated.threshold, 110);
});

test('HTTP: overheating truck produces an alert that can be acknowledged', async () => {
  let push;
  const bff = createServer({
    rules,
    allowedOrigins: ['http://localhost:5173'],
    log: { error() {}, warn() {}, log() {} },
    makeSource: (onPoints) => {
      push = onPoints;
      return { start() {}, stop() {}, mode: () => 'test', requestedMode: () => 'test' };
    },
  });
  const port = await bff.listen(0);
  const api = `http://127.0.0.1:${port}/api`;
  try {
    push([{ ...base, coolant_temp: 113, timestamp: formatTs(Date.now()) }], 'SIM');

    const open = await (await fetch(`${api}/alerts?status=open`)).json();
    assert.equal(open.alerts.length, 1);
    const a = open.alerts[0];
    assert.equal(a.name, 'Coolant critical');
    assert.equal(a.value, 113);
    assert.equal(a.threshold, 110);

    assert.equal((await fetch(`${api}/alerts?status=nope`)).status, 400);

    const patch = await fetch(`${api}/alerts/${a.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'ACKNOWLEDGED', by: 'Control room' }),
    });
    assert.equal(patch.status, 200);
    assert.equal((await patch.json()).alert.status, 'ACKNOWLEDGED');

    const malformed = await fetch(`${api}/alerts/${a.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    assert.equal(malformed.status, 400);

    const events = await (await fetch(`${api}/alerts/events`)).json();
    assert.deepEqual(
      events.events.map((e) => e.type),
      ['acknowledged', 'opened'],
    );
  } finally {
    await bff.close();
  }
});

test('an unjudgeable gap restarts recovery instead of counting toward it', () => {
  const svc = createAlertService({ rules });
  drive(svc, repeat(11, { battery_voltage: 12.9 }));
  // one good reading, then a long engine-off gap, then one good reading after restart
  drive(svc, [{ battery_voltage: 13.5 }, ...repeat(120, { rpm: 0, speed: 0, battery_voltage: 12.0 }), { battery_voltage: 13.5 }], 11);
  assert.equal(svc.list({ status: 'open' }).length, 1, 'must not clear after two in-limit samples');
  // a missing coolant reading behaves the same way
  const svc2 = createAlertService({ rules });
  drive(svc2, [{ coolant_temp: 104 }, { coolant_temp: 95 }, ...repeat(12, { coolant_temp: null }), { coolant_temp: 95 }]);
  assert.equal(svc2.list({ status: 'open' }).length, 1);
});

test('a warning resolved by hand does not hide a later critical on the same field', () => {
  const svc = createAlertService({ rules });
  const [{ alert }] = drive(svc, [{ coolant_temp: 104 }]);
  svc.act(alert.id, { status: 'RESOLVED', note: 'Driver heading to depot' }, T0 + 2000);
  assert.equal(drive(svc, repeat(3, { coolant_temp: 106 }), 2).length, 0, 'same level stays quiet');
  const worse = drive(svc, [{ coolant_temp: 125 }], 5);
  assert.equal(worse[0].kind, 'new');
  assert.equal(worse[0].alert.level, 'critical');
});
