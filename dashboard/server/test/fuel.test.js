import { test } from 'node:test';
import assert from 'node:assert/strict';

import { rules } from '../config/rules.js';
import { createServer } from '../app.js';
import { burnRateLph, fuelSummary, stepFuel } from '../engine/fuel.js';
import { createFuelService } from '../services/fuel.js';
import { createSimulator } from '../sim/simulator.js';
import { routes } from '../sim/routes.js';
import { formatTs, parseTs } from '../engine/time.js';

const T0 = parseTs('2026-09-10T08:00:00');
const F = rules.fuel;
const quiet = { error() {}, warn() {}, log() {} };
const ctx = { capacityL: 300, rules: F, maxGapS: 15 };

const point = (i, extra = {}) => ({
  truck_id: 'TN01',
  timestamp: formatTs(T0 + i * 1000),
  latitude: 13 + i * 1e-4,
  longitude: 80.2,
  speed: 40,
  rpm: 2000,
  engine_load: 40,
  ...extra,
});

function run(points, c = ctx) {
  let state = null;
  const events = [];
  for (const p of points) {
    const r = stepFuel(state, p, c);
    state = r.state;
    events.push(...r.events);
  }
  return { state, events };
}

test('burn rate follows the spec formula and is 0 with the engine off', () => {
  assert.equal(burnRateLph({ rpm: 2000, engine_load: 40 }, F), 2 + 0.25 * 40 * 1);
  assert.equal(burnRateLph({ rpm: 1000, engine_load: 80 }, F), 2 + 0.25 * 80 * 0.5);
  assert.equal(burnRateLph({ rpm: 0, engine_load: 0 }, F), 0);
});

test('estimate: starts full, integrates between close readings, skips gaps, counts idling', () => {
  // One hour at 12 L/h.
  const hour = Array.from({ length: 3601 }, (_, i) => point(i));
  let { state } = run(hour);
  let s = fuelSummary(state, 300);
  assert.equal(s.source, 'estimate');
  assert.equal(s.used_l, 12);
  assert.equal(s.level_l, 288);
  assert.equal(s.level_pct, 96);
  assert.ok(s.km_per_l > 0);
  // A 20 s gap is not integrated.
  const r = stepFuel(state, point(3621), ctx);
  assert.equal(fuelSummary(r.state, 300).used_l, 12);
  // Idling: speed 0 with the engine running.
  ({ state } = run(Array.from({ length: 601 }, (_, i) => point(i, { speed: 0, rpm: 800, engine_load: 10 }))));
  s = fuelSummary(state, 300);
  assert.equal(s.idle_l, s.used_l);
  assert.ok(s.idle_l > 0);
});

test('sensor level replaces the estimate, and the estimate carries on from it', () => {
  let { state } = run([point(0, { fuel_level: 50 }), point(1, { fuel_level: 50 })]);
  assert.deepEqual([fuelSummary(state, 300).source, fuelSummary(state, 300).level_pct], ['sensor', 50]);
  state = stepFuel(state, point(2), ctx).state;
  const s = fuelSummary(state, 300);
  assert.equal(s.source, 'estimate');
  assert.ok(s.level_pct <= 50 && s.level_pct > 49.9);
});

test('theft: a drop of more than 5 % within 60 s while stopped; one event that grows, then ends', () => {
  const stopped = { speed: 0, rpm: 0, engine_load: 0 };
  const pts = [];
  let level = 80;
  for (let i = 0; i < 10; i++) pts.push(point(i, { ...stopped, fuel_level: level }));
  for (let i = 10; i < 40; i++) pts.push(point(i, { ...stopped, fuel_level: (level -= 0.4) }));
  for (let i = 40; i < 45; i++) pts.push(point(i, { fuel_level: level }));
  const { events } = run(pts);
  assert.equal(events.length, 2, 'opened, then ended when the truck moved');
  assert.equal(events[0].type, 'theft');
  assert.equal(events[0].ongoing, true);
  const done = events[1];
  assert.equal(done.ongoing, false);
  assert.equal(done.from_pct, 80);
  assert.equal(Math.round(done.to_pct * 10) / 10, 68);
  assert.equal(done.litres, 36);
});

test('no theft while driving, or for a slow drop; a rise of more than 5 % is a refuel', () => {
  const moving = Array.from({ length: 30 }, (_, i) => point(i, { fuel_level: 80 - i * 0.3 }));
  assert.equal(run(moving).events.length, 0, 'drop while moving');
  const slow = Array.from({ length: 200 }, (_, i) => point(i, { speed: 0, fuel_level: 80 - i * 0.05 }));
  assert.equal(run(slow).events.length, 0, '10 % over 200 s is never 5 % within 60 s');
  const fill = Array.from({ length: 250 }, (_, i) => point(i, { speed: 0, fuel_level: Math.min(90, 20 + i * 0.5) }));
  const { events } = run(fill);
  assert.deepEqual(
    events.map((e) => [e.type, e.ongoing]),
    [
      ['refuel', true],
      ['refuel', false],
    ],
  );
  assert.equal(events[1].from_pct, 20);
  assert.equal(events[1].to_pct, 90);
  assert.equal(events[1].litres, 210);
});

test('service: manager refuel raises the estimate once tracking has begun', () => {
  const svc = createFuelService({ rules, capacityOf: () => 300 });
  for (let i = 0; i < 3601; i++) svc.ingest(point(i), {}, 0);
  assert.equal(svc.of('TN01').level_l, 288);
  assert.equal(svc.refuel('TN01', 50, formatTs(T0 - 60_000)), false, 'before tracking began');
  assert.equal(svc.refuel('TN01', 50, formatTs(T0 + 3000_000)), true);
  assert.equal(svc.of('TN01').level_l, 300, 'capped at a full tank');
  const rows = svc.history('TN01');
  assert.ok(rows.length >= 120, 'a sample every 30 s');
  const last = rows.at(-1);
  assert.equal(last.length, 5);
  assert.equal(last[4], svc.of('TN01').distance_km, 'rows carry the cumulative distance');
  assert.equal(svc.history('NOPE'), null);
});

test('scenario: fuel theft on TN01 raises one possible theft, no collision SOS', () => {
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
  const step = (n) => {
    for (let i = 0; i < n; i++) push(sim.step((t += 1000)), 'SIM');
  };
  step(60);
  assert.equal(bff.fuel.of('TN01').source, 'sensor');
  assert.equal(bff.fuel.of('TN02').source, 'estimate');
  assert.throws(() => bff.scenarios.start({ scenario: 'fuel_theft', truck_id: 'TN02' }, t), /no fuel sensor/);
  bff.scenarios.start({ scenario: 'fuel_theft' }, t);
  step(100);
  const events = bff.fuel.events({ truck_id: 'TN01' });
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'theft');
  assert.equal(events[0].ongoing, false);
  assert.ok(events[0].litres > 30 && events[0].litres < 40, `litres ${events[0].litres}`);
  assert.equal(bff.alerts.list({ kind: 'sos' }).length, 0);
  assert.equal(bff.driving.list({ truck_id: 'TN01' }).length, 0, 'the stop is gentle and the engine is off while parked');
});

const stop = { speed: 0, rpm: 0, engine_load: 0 };

test('an open theft ends when the truck drives off, even if the sensor went silent', () => {
  const pts = [];
  for (let i = 0; i < 5; i++) pts.push(point(i, { ...stop, fuel_level: 50 }));
  for (let i = 5; i < 20; i++) pts.push(point(i, { ...stop, fuel_level: 50 - (i - 4) * 0.5 }));
  for (let i = 20; i < 25; i++) pts.push(point(i, { speed: 40 }));
  const { events, state } = run(pts);
  assert.deepEqual(events.map((e) => e.ongoing), [true, false]);
  assert.equal(state.open, null);
});

test('a device clock reset closes what was open and never compares across the jump', () => {
  const pts = [];
  for (let i = 1000; i < 1010; i++) pts.push(point(i, { ...stop, fuel_level: 90 }));
  // Backlog from 10 min earlier at a much lower level.
  for (let i = 400; i < 410; i++) pts.push(point(i, { ...stop, fuel_level: 30 }));
  const { events } = run(pts);
  assert.equal(events.length, 0);
});

test('a single glitch reading opens nothing; two in a row do', () => {
  const glitch = [80, 80, 80, 0, 80, 80].map((v, i) => point(i, { ...stop, fuel_level: v }));
  assert.equal(run(glitch).events.length, 0);
  const real = [80, 80, 80, 70, 70, 70].map((v, i) => point(i, { ...stop, fuel_level: v }));
  const { events } = run(real);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'theft');
  assert.equal(events[0].from_pct, 80);
});

test('a theft right after a refuel is still caught', () => {
  const levels = [30, 30, 50, 70, 80, 80, 80, 75, 70, 70, 70];
  const { events } = run(levels.map((v, i) => point(i, { ...stop, fuel_level: v })));
  assert.deepEqual(
    events.map((e) => [e.type, e.ongoing]),
    [
      ['refuel', true],
      ['refuel', false],
      ['theft', true],
    ],
  );
  assert.equal(events[1].to_pct, 80);
  assert.equal(events[2].from_pct, 80);
});

test('a manager refuel leaves a measured level alone', () => {
  const svc = createFuelService({ rules, capacityOf: () => 300 });
  for (let i = 0; i < 5; i++) svc.ingest(point(i, { fuel_level: 40 }), {}, 0);
  assert.equal(svc.refuel('TN01', 50, formatTs(T0 + 3000)), false);
  assert.equal(svc.of('TN01').level_pct, 40);
});
