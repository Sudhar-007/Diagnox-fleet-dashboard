import { test } from 'node:test';
import assert from 'node:assert/strict';

import { rules } from '../config/rules.js';
import { createServer } from '../app.js';
import { createSimulator } from '../sim/simulator.js';
import { routes } from '../sim/routes.js';
import { formatTs, parseTs } from '../engine/time.js';

const T0 = parseTs('2026-09-10T08:00:00');
const quiet = { error() {}, warn() {}, log() {} };

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
  const run = (n) => {
    for (let i = 0; i < n; i++) push(sim.step((t += 1000)), 'SIM');
  };
  return { bff, run, now: () => t, push: (pts) => push(pts, 'SIM') };
}

test('analytics: empty before any data, never made-up numbers', () => {
  const { bff } = simServer();
  const a = bff.analytics.get('1h');
  assert.equal(a.to_ms, null);
  assert.deepEqual([a.alerts.total, a.trips.length, a.drivers.length, a.fuel.length, a.costs.length], [0, 0, 0, 0, 0]);
});

test('analytics: every chart from held data, ranges bound it, fast enough on a full buffer', () => {
  const { bff, run, now } = simServer();
  run(4800);
  bff.scenarios.start({ scenario: 'overheat' }, now());
  run(120);
  const started = performance.now();
  const hour = bff.analytics.get('1h', now());
  const took = performance.now() - started;
  assert.ok(took < 100, `took ${Math.round(took)} ms`);
  assert.equal(hour.to_ms, now());
  assert.equal(hour.from_ms, now() - 3600_000);

  const tn03 = hour.alerts.trucks.find((r) => r.truck_id === 'TN03');
  assert.ok(tn03.by_rule['Coolant critical'] >= 1);
  assert.equal(hour.alerts.total, hour.alerts.trucks.reduce((s, r) => s + r.total, 0));

  assert.equal(hour.risk.series.length, 5);
  const tn03Risk = hour.risk.series.find((s) => s.truck_id === 'TN03').points;
  assert.ok(tn03Risk.length >= 110 && tn03Risk.length <= 121, `${tn03Risk.length} samples`);
  const counts = hour.risk.series.map((x) => x.points.length);
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, 'every truck on the same time grid');
  assert.ok(tn03Risk[tn03Risk.length - 1][1] > 0, 'overheat shows in the latest risk');
  assert.equal(tn03Risk[0][1], 0, 'normal driving an hour earlier');

  assert.ok(hour.trips.length > 0);
  for (const t of hour.trips) assert.ok(t.end_ms >= hour.from_ms && t.end_ms <= hour.to_ms);
  assert.ok(hour.drivers.length > 0);
  assert.equal(hour.fuel.length, 5);
  for (const f of hour.fuel) assert.ok(f.used_l > 5 && f.used_l < 20, `${f.truck_id} ${f.used_l}`);

  const quarter = bff.analytics.get('15m', now());
  assert.ok(quarter.trips.length <= hour.trips.length);
  for (const f of quarter.fuel) assert.ok(f.used_l < hour.fuel.find((h) => h.truck_id === f.truck_id).used_l);
  const session = bff.analytics.get('session', now());
  assert.ok(session.from_ms < hour.from_ms, 'session covers everything held');
});

test('analytics: manager costs in the range; cached briefly', () => {
  const { bff, run, now } = simServer();
  run(60);
  const at = new Date(now() - 10 * 60_000);
  const pad = (n) => String(n).padStart(2, '0');
  const local = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
  bff.registry.addRefuel({ truck_id: 'TN02', litres: 80, cost_inr: 7600, at: local }, now());
  const a = bff.analytics.get('1h', now());
  assert.deepEqual(
    a.costs.map((c) => [c.truck_id, c.refuel_inr, c.refuel_l]),
    [['TN02', 7600, 80]],
  );
  assert.equal(bff.analytics.get('1h', now() + 5000), a, 'same object within the cache time');
});

test('analytics: a late reading keeps the risk series; a manual SOS after the last reading counts', () => {
  const { bff, run, now, push } = simServer();
  run(600);
  const count = (a) => a.risk.series.find((x) => x.truck_id === 'TN01').points.length;
  const before = count(bff.analytics.get('1h', now()));
  const latest = bff.fleet.truck('TN01', now());
  const late = { truck_id: 'TN01', timestamp: formatTs(now() - 45_000), latitude: latest.latitude, longitude: latest.longitude };
  for (const k of ['coolant_temp', 'oil_temp', 'battery_voltage', 'rpm', 'engine_load', 'speed']) late[k] = latest[k];
  push([late]);
  bff.alerts.raiseSos(bff.fleet.truck('TN02', now()), {}, now() + 20_000);
  const later = bff.analytics.get('1h', now() + 30_000);
  assert.ok(count(later) >= before, 'the late reading did not wipe the series');
  assert.equal(later.alerts.trucks.find((r) => r.truck_id === 'TN02')?.by_rule['SOS: manual trigger'], 1);
});
