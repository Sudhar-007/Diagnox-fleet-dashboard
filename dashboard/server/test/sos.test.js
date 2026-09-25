import { test } from 'node:test';
import assert from 'node:assert/strict';

import { rules } from '../config/rules.js';
import { createServer } from '../app.js';
import { detectCollision } from '../engine/sos.js';
import { createSimulator } from '../sim/simulator.js';
import { routes } from '../sim/routes.js';
import { formatTs, parseTs } from '../engine/time.js';

const T0 = parseTs('2026-09-10T08:00:00');
const quiet = { error() {}, warn() {}, log() {} };

// A server fed by the real simulator, stepped by hand in simulated time.
function simServer() {
  const sim = createSimulator({ routes });
  let push;
  const bff = createServer({
    rules,
    allowedOrigins: ['http://localhost:5173'],
    log: quiet,
    makeSource: (onPoints) => {
      push = onPoints;
      return { sim, start() {}, stop() {}, mode: () => 'mock', requestedMode: () => 'mock' };
    },
  });
  let t = T0;
  const run = (seconds) => {
    for (let i = 0; i < seconds; i++) {
      t += 1000;
      push(sim.step(t), 'SIM');
    }
  };
  // Settle the trucks first so every scenario starts from normal driving.
  run(5);
  return { bff, sim, run, now: () => t };
}

test('collision heuristic: needs a drop from >= 40 to <= 5 within 3 s', () => {
  const rule = rules.sos.collision;
  const at = (s, speed) => ({ timestamp: formatTs(T0 + s * 1000), speed });
  assert.deepEqual(detectCollision(at(3, 4), [at(0, 50), at(1, 45), at(2, 20)], rule), {
    from_speed: 45,
    to_speed: 4,
    seconds: 2,
  });
  assert.equal(detectCollision(at(5, 4), [at(0, 50), at(3, 30), at(4, 10)], rule), null, 'too slow a stop');
  assert.equal(detectCollision(at(3, 8), [at(1, 50)], rule), null, 'not stopped');
  assert.equal(detectCollision(at(3, 2), [at(1, 30)], rule), null, 'was not fast');
});

test('scenario: overheat raises a coolant alert that escalates to critical', () => {
  const { bff, run, now } = simServer();
  bff.scenarios.start({ scenario: 'overheat' }, now());
  run(60);
  const coolant = bff.alerts.list({ status: 'open' }).filter((a) => a.truck_id === 'TN03' && a.field === 'coolant_temp');
  assert.equal(coolant.length, 1);
  assert.equal(coolant[0].level, 'critical');
  // after the scenario ends the value recovers and the alert closes by itself
  run(60);
  assert.equal(bff.alerts.list({ status: 'open' }).filter((a) => a.field === 'coolant_temp').length, 0);
});

test('scenario: battery failing gives a warning, then critical, then recovers', () => {
  const { bff, run, now } = simServer();
  bff.scenarios.start({ scenario: 'battery_failing' }, now());
  run(30);
  const [warn] = bff.alerts.list({ status: 'open' }).filter((a) => a.truck_id === 'TN02');
  assert.equal(warn.name, 'Battery low');
  run(20);
  const [crit] = bff.alerts.list({ status: 'open' }).filter((a) => a.truck_id === 'TN02');
  assert.equal(crit.level, 'critical');
  run(45);
  assert.equal(bff.alerts.list({ status: 'open' }).filter((a) => a.truck_id === 'TN02').length, 0);
});

test('scenario: SOS button opens exactly one SOS with the truck position', () => {
  const { bff, run, now } = simServer();
  bff.scenarios.start({ scenario: 'sos_button' }, now());
  run(12);
  const sos = bff.alerts.list({ kind: 'sos' });
  assert.equal(sos.length, 1);
  assert.equal(sos[0].trigger, 'hardware');
  assert.equal(sos[0].truck_id, 'TN02');
  assert.equal(sos[0].driver_name, 'Suresh Babu');
  assert.ok(sos[0].latitude > 12.8 && sos[0].longitude > 80);
});

test('scenario: possible collision opens a heuristic SOS', () => {
  const { bff, run, now } = simServer();
  bff.scenarios.start({ scenario: 'collision' }, now());
  run(20);
  const [sos] = bff.alerts.list({ kind: 'sos' });
  assert.equal(sos.trigger, 'collision');
  assert.equal(sos.source, 'RULE_BASED');
  assert.equal(sos.truck_id, 'TN04');
  assert.match(sos.detail, /speed \d+(\.\d+)? to \d+(\.\d+)? km\/h in \d+(\.\d+)? s/);
});

test('scenario: drop feed silences the truck for its duration', () => {
  const { bff, sim, run, now } = simServer();
  bff.scenarios.start({ scenario: 'drop_feed' }, now());
  const before = bff.fleet.truck('TN01').timestamp;
  run(70);
  assert.equal(bff.fleet.truck('TN01').timestamp, before);
  run(10);
  assert.notEqual(bff.fleet.truck('TN01').timestamp, before);
  assert.equal(sim.step(now() + 1000).length, 5);
});

test('scenario input is validated', () => {
  const { bff, now } = simServer();
  assert.throws(() => bff.scenarios.start({ scenario: 'meteor' }, now()), /unknown scenario/);
  assert.throws(() => bff.scenarios.start({ scenario: 'overheat', truck_id: 'TN99' }, now()), /not a simulated truck/);
  assert.equal(bff.scenarios.start({ scenario: 'overheat', truck_id: 'TN01' }, now()).truck_id, 'TN01');
});

test('pipeline: simulator and BFF hops in mock mode', () => {
  const { bff, run } = simServer();
  run(1);
  const p = bff.pipeline();
  assert.deepEqual(p.hops.map((h) => h.id), ['sim', 'bff']);
  assert.equal(p.hops[0].status, 'ok');
  assert.equal(p.latency_ms, null);
});

test('HTTP: manual SOS, duplicate refused, resolved through /api/sos', async () => {
  const { bff } = simServer();
  const port = await bff.listen(0);
  const api = `http://127.0.0.1:${port}/api`;
  const post = (path, body) =>
    fetch(`${api}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const patch = (path, body) =>
    fetch(`${api}${path}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const r1 = await post('/trucks/TN02/sos', { by: 'Control room', note: 'Driver called in' });
    assert.equal(r1.status, 200);
    const { alert } = await r1.json();
    assert.equal(alert.kind, 'sos');
    assert.equal(alert.source, 'MANUAL');
    assert.equal(alert.raised_by, 'Control room');

    assert.equal((await post('/trucks/TN02/sos', {})).status, 409);
    assert.equal((await post('/trucks/TN99/sos', {})).status, 404);

    assert.equal((await patch(`/sos/${alert.id}`, { status: 'ACKNOWLEDGED' })).status, 200);
    const done = await patch(`/sos/${alert.id}`, { status: 'RESOLVED', note: 'Driver safe' });
    assert.equal((await done.json()).alert.status, 'RESOLVED');

    const scen = await (await fetch(`${api}/demo/scenarios`)).json();
    assert.equal(scen.enabled, true);
    assert.ok(scen.available.some((s) => s.id === 'collision'));
    assert.equal((await post('/demo/scenario', { scenario: 'nope' })).status, 400);

    const health = await (await fetch(`${api}/health`)).json();
    assert.ok(Array.isArray(health.pipeline.hops));
  } finally {
    await bff.close();
  }
});

test('a latching panic button raises one SOS, and again only after it is released', () => {
  const { bff, run, now } = simServer();
  const sim = bff.source.sim;
  // latch: sos stays true for 30 s
  sim.inject('TN02', { duration_s: 30, apply: (t, p) => { p.sos = true; } }, now());
  run(5);
  let [sos] = bff.alerts.list({ kind: 'sos' });
  bff.alerts.act(sos.id, { status: 'RESOLVED' });
  run(10);
  assert.equal(bff.alerts.list({ kind: 'sos', status: 'open' }).length, 0, 'held button must not reopen');
  // released, then pressed again
  sim.inject('TN02', { duration_s: 10, apply: (t, p) => { if (t >= 3) p.sos = true; } }, now());
  run(6);
  [sos] = bff.alerts.list({ kind: 'sos', status: 'open' });
  assert.equal(sos.trigger, 'hardware');
});

test('a collision triggers once even if resolved while the fast point is still in the window', () => {
  const { bff, run, now } = simServer();
  bff.scenarios.start({ scenario: 'collision' }, now());
  for (let i = 0; i < 20; i++) {
    run(1);
    for (const a of bff.alerts.list({ kind: 'sos', status: 'open' })) bff.alerts.act(a.id, { status: 'RESOLVED' });
  }
  assert.equal(bff.alerts.list({ kind: 'sos' }).length, 1);
});
