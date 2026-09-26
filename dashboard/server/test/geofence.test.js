import { test } from 'node:test';
import assert from 'node:assert/strict';

import { rules } from '../config/rules.js';
import { createServer } from '../app.js';
import { createScenarioService } from '../services/scenarios.js';
import { stepZone } from '../engine/geofence.js';
import { createAlertService } from '../services/alerts.js';
import { createGeofences } from '../services/geofences.js';
import { createRuleSettings } from '../services/ruleSettings.js';
import { createMemoryStorage } from '../services/storage.js';
import { createSimulator } from '../sim/simulator.js';
import { routes } from '../sim/routes.js';
import { formatTs, parseTs } from '../engine/time.js';

const T0 = parseTs('2026-09-10T08:00:00');
const quiet = { error() {}, warn() {}, log() {} };

// A 500 m restricted circle; IN is at its centre, OUT about 1.1 km north of it.
const ZONE = {
  id: 'Z1',
  name: 'Test yard',
  center_lat: 13.1,
  center_lng: 80.2,
  radius_m: 500,
  type: 'restricted',
  alert: true,
  truck_ids: [],
};
const IN = { latitude: 13.1, longitude: 80.2 };
const OUT = { latitude: 13.11, longitude: 80.2 };

function harness(zoneList = [ZONE]) {
  let zones = zoneList;
  const visits = [];
  const svc = createAlertService({ rules, zones: () => zones, onVisit: (v) => visits.push(v) });
  let s = 0;
  const feed = (truck_id, pos, extra = {}) => {
    s += 1;
    const point = { truck_id, timestamp: formatTs(T0 + s * 1000), rpm: 800, ...pos, ...extra };
    return svc.evaluate(point, T0 + s * 1000, []);
  };
  return { svc, feed, visits, setZones: (z) => (zones = z), geo: (id) => svc.list({ kind: 'geofence', truck_id: id }) };
}

test('stepZone: a change of side needs two points in a row, dated at the first', () => {
  let r = stepZone(null, false, 1000, 2);
  assert.equal(r.state.inside, null);
  r = stepZone(r.state, false, 2000, 2);
  assert.equal(r.state.inside, false);
  // jitter: one point inside, then back outside, never confirms an entry
  r = stepZone(r.state, true, 3000, 2);
  assert.equal(r.changed, false);
  r = stepZone(r.state, false, 4000, 2);
  assert.equal(r.state.inside, false);
  assert.equal(r.state.candidate, null);
  r = stepZone(r.state, true, 5000, 2);
  r = stepZone(r.state, true, 6000, 2);
  assert.equal(r.changed, true);
  assert.equal(r.from, false);
  assert.equal(r.state.since_ms, 5000);
});

test('restricted zone: entry alerts after two points, exit clears it, visits are logged', () => {
  const h = harness();
  h.feed('TN05', OUT);
  h.feed('TN05', OUT);
  assert.equal(h.feed('TN05', IN).length, 0, 'one point inside is not enough');
  const changes = h.feed('TN05', IN);
  assert.equal(changes.length, 1);
  const [alert] = h.geo('TN05');
  assert.equal(alert.name, 'Inside restricted zone');
  assert.equal(alert.level, 'critical');
  assert.equal(alert.zone_name, 'Test yard');
  assert.equal(alert.value, 0);
  assert.deepEqual(h.svc.zonesInside('TN05').map((z) => z.zone_id), ['Z1']);

  h.feed('TN05', OUT);
  assert.equal(h.geo('TN05')[0].status, 'ACTIVE', 'still open after one point outside');
  h.feed('TN05', OUT);
  const closed = h.geo('TN05')[0];
  assert.equal(closed.status, 'RESOLVED');
  assert.equal(closed.resolution, 'cleared');
  assert.deepEqual(h.visits.map((v) => v.type), ['entered', 'left']);
  assert.equal(h.visits[0].at, formatTs(T0 + 3000), 'entry dated at the first point inside');
});

test('zones with alerts off, or not covering the truck, only log visits', () => {
  const h = harness([
    { ...ZONE, id: 'Zoff', name: 'Quiet', alert: false },
    { ...ZONE, id: 'Zscoped', name: 'Only TN01', truck_ids: ['TN01'] },
  ]);
  for (const pos of [OUT, OUT, IN, IN]) h.feed('TN05', pos);
  assert.equal(h.geo('TN05').length, 0);
  assert.equal(h.visits.filter((v) => v.type === 'entered').length, 2);
});

test('allowed zone scoped to a truck: leaving it raises a warning', () => {
  const h = harness([{ ...ZONE, type: 'allowed', truck_ids: ['TN05'] }]);
  for (const pos of [IN, IN, OUT, OUT]) h.feed('TN05', pos);
  const [alert] = h.geo('TN05');
  assert.equal(alert.name, 'Outside allowed zone');
  assert.equal(alert.level, 'warning');
  assert.ok(alert.value > 500);
});

test('resolved by hand while inside: stays quiet until the truck leaves and comes back', () => {
  const h = harness();
  for (const pos of [OUT, OUT, IN, IN]) h.feed('TN05', pos);
  h.svc.act(h.geo('TN05')[0].id, { status: 'RESOLVED', by: 'Ops' });
  for (let i = 0; i < 5; i++) h.feed('TN05', IN);
  assert.equal(h.svc.list({ kind: 'geofence', status: 'open' }).length, 0);
  for (const pos of [OUT, OUT, IN, IN]) h.feed('TN05', pos);
  assert.equal(h.svc.list({ kind: 'geofence', status: 'open' }).length, 1, 'a new entry alerts again');
});

test('deleting a zone or turning its alerts off closes its open alerts', () => {
  const h = harness();
  for (const pos of [OUT, OUT, IN, IN]) h.feed('TN05', pos);
  h.setZones([{ ...ZONE, alert: false }]);
  const [change] = h.svc.syncZones(T0 + 60_000);
  assert.equal(change.alert.resolution, 'zone_changed');
  assert.equal(change.event.type, 'closed');

  h.setZones([ZONE]);
  h.feed('TN05', IN);
  assert.equal(h.svc.list({ kind: 'geofence', status: 'open' }).length, 1, 'turned back on while inside');
  // flipping the type closes the old alert; inside an allowed zone is no breach
  h.setZones([{ ...ZONE, type: 'allowed' }]);
  const [flipped] = h.svc.syncZones(T0 + 80_000);
  assert.equal(flipped.alert.resolution, 'zone_changed');
  h.feed('TN05', IN);
  assert.equal(h.svc.list({ kind: 'geofence', status: 'open' }).length, 0);

  h.setZones([ZONE]);
  h.feed('TN05', IN);
  h.setZones([]);
  const [removed] = h.svc.syncZones(T0 + 90_000);
  assert.equal(removed.alert.resolution, 'zone_removed');
  assert.deepEqual(h.svc.zonesInside('TN05'), []);
});

test('no GPS fix: a point at 0,0 neither enters nor leaves a zone', () => {
  const h = harness();
  for (const pos of [OUT, OUT, IN, IN]) h.feed('TN05', pos);
  h.feed('TN05', { latitude: 0, longitude: 0 });
  h.feed('TN05', { latitude: 0, longitude: 0 });
  const [alert] = h.geo('TN05');
  assert.equal(alert.status, 'ACTIVE');
  assert.equal(alert.condition, 'unknown');
});

test('geofence store: validation, unique names, saved before applied', () => {
  const storage = createMemoryStorage();
  const zones = createGeofences({ storage, log: quiet });
  assert.equal(zones.list().length, 3, 'seeded');
  const body = { name: 'Yard 2', center_lat: 13.2, center_lng: 80.1, radius_m: 300, type: 'restricted' };
  const added = zones.add(body);
  assert.equal(added.alert, true, 'alerts on by default');
  assert.deepEqual(added.truck_ids, []);
  assert.throws(() => zones.add(body), /already exists/);
  assert.throws(() => zones.add({ ...body, name: 'X', type: 'nope' }), /allowed or restricted/);
  assert.throws(() => zones.add({ ...body, name: 'X', radius_m: 10 }), /radius_m/);
  assert.throws(() => zones.add({ ...body, name: 'X', truck_ids: ['bad id!'] }), /not a valid truck ID/);
  assert.throws(() => zones.add({ ...body, name: 'X', center_lat: 0, center_lng: 0 }), /0, 0/);
  const updated = zones.update(added.id, { radius_m: 800, truck_ids: ['TN02', 'TN01', 'TN02'] });
  assert.equal(updated.name, 'Yard 2', 'fields left out keep their value');
  assert.deepEqual(updated.truck_ids, ['TN01', 'TN02']);
  assert.equal(storage.load('geofences').find((z) => z.id === added.id).radius_m, 800);

  const failing = { ...storage, save() { throw new Error('disk full'); } };
  const zones2 = createGeofences({ storage: failing, log: quiet });
  assert.throws(() => zones2.remove(added.id), /disk full/);
  assert.ok(zones2.get(added.id), 'memory unchanged after a failed save');
});

test('thresholds: order and limits are enforced, only overrides are saved', () => {
  const storage = createMemoryStorage();
  const own = structuredClone(rules);
  const settings = createRuleSettings({ rules: own, storage, log: quiet });
  assert.throws(() => settings.update({ thresholds: { coolant_temp_warning: 115 } }), /must be below Coolant critical/);
  assert.throws(() => settings.update({ thresholds: { battery_low_warning: 15 } }), /must be below/);
  assert.throws(() => settings.update({ thresholds: { rpm_high: 90000 } }), /from 500 to 6000/);
  assert.throws(() => settings.update({ thresholds: { nope: 1 } }), /unknown rule/);
  assert.throws(() => settings.update({ thresholds: { overspeed: '70' } }), /must be a number/);
  const view = settings.update({ thresholds: { overspeed: 70 } });
  assert.equal(view.health.find((r) => r.id === 'overspeed').threshold, 70);
  assert.equal(view.health.find((r) => r.id === 'overspeed').default_threshold, 80);
  assert.deepEqual(storage.load('rule_overrides'), [{ id: 'overspeed', threshold: 70 }]);
  assert.equal(rules.health.find((r) => r.id === 'overspeed').threshold, 80, 'config object untouched');

  // a restart picks the saved value up again
  const again = createRuleSettings({ rules: structuredClone(rules), storage, log: quiet });
  assert.equal(again.view().health.find((r) => r.id === 'overspeed').threshold, 70);
});

test('an edited threshold changes what raises alerts', () => {
  const bff = createServer({
    rules,
    allowedOrigins: [],
    log: quiet,
    makeSource: (onPoints) => ({ start() {}, stop() {}, mode: () => 'mock', requestedMode: () => 'mock', push: onPoints }),
  });
  bff.ruleSettings.update({ thresholds: { overspeed: 50 } });
  const point = {
    truck_id: 'TN09',
    timestamp: formatTs(T0),
    latitude: 13.05,
    longitude: 80.24,
    coolant_temp: 90,
    oil_temp: 90,
    battery_voltage: 14,
    rpm: 1500,
    engine_load: 40,
    speed: 60,
  };
  bff.source.push([point], 'SIM');
  const open = bff.alerts.list({ status: 'open', truck_id: 'TN09' });
  assert.equal(open.length, 1);
  assert.equal(open[0].rule_id, 'overspeed');
  assert.equal(open[0].threshold, 50);
});

// A server fed by the real simulator, stepped by hand in simulated time.
// Stand-in for OSRM in tests: five evenly spaced points from `from` to `to`.
let roadCalls = 0;
const fakeRoad = async (from, to) => {
  roadCalls += 1;
  return [0, 0.25, 0.5, 0.75, 1].map((f) => [from[0] + (to[0] - from[0]) * f, from[1] + (to[1] - from[1]) * f]);
};

function simServer() {
  const sim = createSimulator({ routes });
  let push;
  const bff = createServer({
    rules,
    allowedOrigins: [],
    log: quiet,
    roadRoute: fakeRoad,
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
  run(5);
  return { bff, run, now: () => t };
}

test('scenario: geofence breach drives TN05 along its road route into the zone and back out', async () => {
  const { bff, run, now } = simServer();
  const before = bff.fleet.truck('TN05');
  const started = await bff.scenarios.launch({ scenario: 'geofence_breach', truck_id: 'TN05' }, now());
  assert.equal(started.target, 'Kodungaiyur dump yard');
  assert.match(started.note, /^Enters Kodungaiyur dump yard in about \d+ min \([\d.]+ km by road\)$/);
  assert.ok(roadCalls >= 2, 'asked the road router for the way there and back');
  let waited = 0;
  while (bff.alerts.list({ kind: 'geofence', status: 'open' }).length === 0 && waited < 900) {
    run(5);
    waited += 5;
  }
  const open = bff.alerts.list({ kind: 'geofence', status: 'open' });
  assert.equal(open.length, 1);
  assert.equal(open[0].truck_id, 'TN05');
  assert.equal(open[0].zone_name, 'Kodungaiyur dump yard');
  assert.equal(bff.fleet.truck('TN05').zones_inside[0].zone_name, 'Kodungaiyur dump yard');
  run(Math.ceil((started.ends_ms - now()) / 1000) + 30);
  // Back on its route where it left it, and moving on from there.
  const after = bff.fleet.truck('TN05');
  assert.ok(Math.abs(after.latitude - before.latitude) < 0.05 && Math.abs(after.longitude - before.longitude) < 0.05);
  const [closed] = bff.alerts.list({ kind: 'geofence' });
  assert.equal(closed.status, 'RESOLVED');
  assert.equal(closed.resolution, 'cleared');
  assert.equal(bff.alerts.list({ kind: 'sos' }).length, 0, 'the stop is gentle, not a collision');
  const types = bff.alerts.visits({ truck_id: 'TN05' }).filter((v) => v.zone_name === 'Kodungaiyur dump yard').map((v) => v.type);
  assert.deepEqual(types, ['left', 'entered']);
});

test('scenario: geofence breach needs a restricted zone covering the truck', async () => {
  const { bff, now } = simServer();
  bff.geofences.remove('Z-kodungaiyur');
  await assert.rejects(bff.scenarios.launch({ scenario: 'geofence_breach', truck_id: 'TN05' }, now()), /no restricted zone covers TN05/);
  await assert.rejects(bff.scenarios.launch({ scenario: 'geofence_breach' }, now()), /no restricted zone covers any simulated truck/);
});

test('scenario: geofence breach without a truck picks the one closest to the zone', async () => {
  const { bff, now } = simServer();
  const zone = bff.geofences.list().find((z) => z.id === 'Z-kodungaiyur');
  const dist = (id) => {
    const t = bff.fleet.truck(id);
    return Math.hypot(t.latitude - zone.center_lat, (t.longitude - zone.center_lng) * Math.cos((zone.center_lat * Math.PI) / 180));
  };
  const closest = ['TN01', 'TN02', 'TN03', 'TN04', 'TN05'].sort((a, b) => dist(a) - dist(b))[0];
  const started = await bff.scenarios.launch({ scenario: 'geofence_breach' }, now());
  assert.equal(started.truck_id, closest);
});

test('scenario: a detouring truck takes no other scenario, and a stalled detour still finishes by road', async () => {
  const { bff, run, now } = simServer();
  const started = await bff.scenarios.launch({ scenario: 'geofence_breach', truck_id: 'TN05' }, now());
  run(20);
  assert.throws(() => bff.scenarios.start({ scenario: 'overheat', truck_id: 'TN05' }, now()), /still on its detour/);
  await assert.rejects(bff.scenarios.launch({ scenario: 'geofence_breach', truck_id: 'TN05' }, now()), /still on its detour/);
  // Wall clock far past the planned end (a stalled server): the detour is not cut short.
  const plannedS = Math.ceil((started.ends_ms - started.started_ms) / 1000);
  let prev = bff.fleet.truck('TN05');
  let worstJump = 0;
  for (let i = 0; i < plannedS + 120; i++) {
    run(1);
    const t = bff.fleet.truck('TN05');
    worstJump = Math.max(worstJump, Math.hypot(t.latitude - prev.latitude, t.longitude - prev.longitude) * 111320);
    prev = t;
  }
  assert.ok(worstJump < 30, `truck jumped ${worstJump.toFixed(0)} m in one second`);
  const harsh = (bff.driving.list?.() ?? []).filter((e) => e.truck_id === 'TN05' && e.type === 'harsh_brake');
  assert.equal(harsh.length, 0, 'arriving and leaving the zone is not harsh braking');
});

test('scenario: geofence breach does not start when road routing is unavailable', async () => {
  const { bff, now } = simServer();
  const failing = createScenarioService({
    sim: bff.source.sim,
    enabled: true,
    restrictedZoneFor: () => bff.geofences.list().find((z) => z.type === 'restricted'),
    roadRoute: async () => {
      throw new Error('timed out');
    },
  });
  await assert.rejects(failing.launch({ scenario: 'geofence_breach', truck_id: 'TN05' }, now()), /road routing is unavailable/);
  assert.equal(failing.running().length, 0);
});

test('normal driving for 40 minutes raises no zone alerts with the seeded zones', () => {
  const { bff, run } = simServer();
  run(2400);
  assert.equal(bff.alerts.list({ kind: 'geofence' }).length, 0);
  assert.ok(bff.alerts.visits({ limit: 500 }).length > 0, 'depot and port visits are still logged');
});

test('review: a late or repeated point is not a second reading, and old candidates lapse', () => {
  let r = stepZone(null, false, 1000, 2);
  r = stepZone(r.state, false, 2000, 2);
  r = stepZone(r.state, true, 3000, 2);
  // a late point from 2.5 s, and the 3 s point again, must not confirm the entry
  r = stepZone(r.state, true, 2500, 2);
  r = stepZone(r.state, true, 3000, 2);
  assert.equal(r.state.inside, false);
  // a second inside reading long after the first starts over instead of confirming
  r = stepZone(r.state, true, 3000 + 20 * 60_000, 2, 15_000);
  assert.equal(r.changed, false);
  assert.equal(r.state.candidate_ms, 3000 + 20 * 60_000);
});

test('review: zone edits ignore null fields; bad saved zones are skipped', () => {
  const storage = createMemoryStorage();
  const zones = createGeofences({ storage, log: quiet });
  const z = zones.update('Z-depot', { alert: null, truck_ids: null, radius_m: 700 });
  assert.equal(z.alert, false);
  assert.deepEqual(z.truck_ids, []);
  assert.equal(z.radius_m, 700);
  storage.save('geofences', [...storage.load('geofences'), { id: 'Z-bad', name: 'Bad', radius_m: 'x' }]);
  const errors = [];
  const reloaded = createGeofences({ storage, log: { error: (m) => errors.push(m) } });
  assert.equal(reloaded.list().length, 3);
  assert.match(errors[0], /skipped a saved zone \(Bad\)/);
});

test('review: null thresholds are refused; an edit closes open alerts on that field', () => {
  const settings = createRuleSettings({ rules: structuredClone(rules), storage: createMemoryStorage(), log: quiet });
  assert.throws(() => settings.update({ thresholds: { overspeed: null } }), /must be a number/);

  const bff = createServer({
    rules,
    allowedOrigins: [],
    log: quiet,
    makeSource: (onPoints) => ({ start() {}, stop() {}, mode: () => 'mock', requestedMode: () => 'mock', push: onPoints }),
  });
  const point = (s, speed) => ({
    truck_id: 'TN09', timestamp: formatTs(T0 + s * 1000), latitude: 13.05, longitude: 80.24,
    coolant_temp: 90, oil_temp: 90, battery_voltage: 14, rpm: 1500, engine_load: 40, speed,
  });
  bff.source.push([point(0, 90)], 'SIM');
  assert.equal(bff.alerts.list({ status: 'open' })[0].threshold, 80);
  const out = bff.ruleSettings.update({ thresholds: { overspeed: 85 } });
  assert.deepEqual(out.changed_fields, ['speed']);
  const [closed] = bff.alerts.rulesChanged(new Set(out.changed_fields));
  assert.equal(closed.alert.resolution, 'rule_changed');
  bff.source.push([point(1, 90)], 'SIM');
  const [reopened] = bff.alerts.list({ status: 'open' });
  assert.equal(reopened.threshold, 85, 'judged again against the new number');
});
