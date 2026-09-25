import { test } from 'node:test';
import assert from 'node:assert/strict';

import { rules } from '../config/rules.js';
import { createServer } from '../app.js';
import { chargedMinutes, closeDriving, costOf, scoreTrip, stepDriving } from '../engine/driving.js';
import { createTripService } from '../services/trips.js';
import { createDrivingService } from '../services/driving.js';
import { createSimulator } from '../sim/simulator.js';
import { routes } from '../sim/routes.js';
import { formatTs, parseTs } from '../engine/time.js';

const T0 = parseTs('2026-09-10T08:00:00');
const R = rules.driver;
const quiet = { error() {}, warn() {}, log() {} };

// speeds[i] is sent at T0 + i * stepS seconds.
function run(speeds, { stepS = 1, rpm = 1500 } = {}) {
  let state = null;
  const events = [];
  speeds.forEach((speed, i) => {
    const p = { truck_id: 'TN01', timestamp: formatTs(T0 + i * stepS * 1000), latitude: 13, longitude: 80.2, speed, rpm };
    const r = stepDriving(state, p, R);
    state = r.state;
    events.push(...r.events);
  });
  return { state, events, final: events.filter((e) => !e.ongoing) };
}

test('harsh braking: consecutive hard pairs are one event with the peak rate', () => {
  const { final } = run([50, 50, 36, 24, 22, 22]);
  assert.equal(final.length, 1);
  const [e] = final;
  assert.equal(e.type, 'harsh_brake');
  assert.equal(e.peak, 14);
  assert.equal(e.speed_from, 50);
  assert.equal(e.speed_to, 24);
  assert.equal(e.duration_s, 2);
  assert.equal(e.points, R.points.harsh_brake);
});

test('harsh thresholds are strict and need readings at most max_gap_s apart', () => {
  assert.deepEqual(
    run([40, 50, 40]).final.map((e) => e.type),
    ['harsh_accel'],
    '+10 km/h/s is harsh acceleration; -10 is not harsh braking (the limit is strict)',
  );
  assert.equal(run([60, 20], { stepS: 4 }).events.length, 0, 'a 4 s gap is no evidence');
  assert.equal(run([60, 20, 20], { stepS: 3 }).final.length, 1, '-13 km/h/s over 3 s is harsh');
});

test('overspeed lasts until the first reading back under the limit; sent again every full minute', () => {
  const speeds = [78, ...Array(90).fill(85), 78, 78];
  const { events } = run(speeds);
  assert.equal(events[0].type, 'overspeed');
  assert.equal(events[0].ongoing, true);
  assert.deepEqual(
    events.filter((e) => e.ongoing).map((e) => e.duration_s),
    [1, 60],
    'when it starts counting, then after a full minute',
  );
  const done = events.filter((e) => !e.ongoing);
  assert.equal(done.length, 1);
  assert.equal(done[0].duration_s, 90);
  assert.equal(done[0].peak, 85);
  assert.equal(done[0].points, null, 'charged per trip on total time');
  assert.equal(costOf('harsh_brake', R), R.points.harsh_brake);
  assert.deepEqual([chargedMinutes(0), chargedMinutes(1), chargedMinutes(125)], [0, 1, 2]);
});

test('idling counts only after idle_min_s and ends when the truck moves or the engine stops', () => {
  const short = run([...Array(50).fill(0), 5, 5]);
  assert.equal(short.events.length, 0, '50 s of idling is allowed');
  const long = run([...Array(130).fill(0), 5, 5]);
  assert.equal(long.events[0].type, 'idling');
  assert.equal(long.events[0].ongoing, true);
  const [done] = long.final;
  assert.equal(done.duration_s, 130);
  assert.equal(done.points, null);
  const engineOff = run(Array(100).fill(0), { rpm: 0 });
  assert.equal(engineOff.events.length, 0, 'engine off is not idling');
});

test('a gap closes open events at their last reading; late points are ignored', () => {
  let { state, events } = run([...Array(10).fill(90)]);
  assert.equal(events.length, 1);
  const late = { truck_id: 'TN01', timestamp: formatTs(T0 + 3000), speed: 0, rpm: 800 };
  assert.equal(stepDriving(state, late, R).state, state, 'late point ignored');
  const after = { truck_id: 'TN01', timestamp: formatTs(T0 + 20_000), speed: 90, rpm: 1500 };
  const r = stepDriving(state, after, R);
  const [closed] = r.events.filter((e) => !e.ongoing);
  assert.equal(closed.duration_s, 9);
  assert.equal(closed.end_at, formatTs(T0 + 9000));
  ({ events } = closeDriving(r.state, R));
  assert.equal(events.length, 0, 'a single reading after the gap is no overspeed yet');
});

test('trip score: harsh events each, overspeed and idling per whole minute of their total', () => {
  const trip = { start_ms: T0, end_ms: T0 + 600_000, last_at: formatTs(T0 + 600_000), points: 601 };
  const ev = (type, at, duration_s = 0) => ({ type, start_ms: T0 + at * 1000, duration_s, points: costOf(type, R) });
  // 20 one-second crossings of the limit add up to 20 s: one minute, not twenty.
  const hover = Array.from({ length: 20 }, (_, i) => ev('overspeed', 100 + 2 * i, 1));
  const events = [ev('harsh_brake', 10), ev('harsh_brake', 20), ev('harsh_accel', 30), ev('overspeed', 40, 130), ...hover, ev('idling', 500, 70)];
  const s = scoreTrip(trip, events, R);
  assert.equal(s.score, 100 - 10 - 3 - 2 * 2 - 1);
  assert.deepEqual(
    s.deductions.map((d) => [d.type, d.count, d.minutes, d.points]),
    [
      ['harsh_brake', 2, null, 10],
      ['harsh_accel', 1, null, 3],
      ['overspeed', 21, 2, 4],
      ['idling', 1, 1, 1],
    ],
  );
  const many = Array.from({ length: 30 }, (_, i) => ev('harsh_brake', i));
  assert.equal(scoreTrip(trip, many, R).score, 0);
  const sparse = { ...trip, points: 61 };
  assert.deepEqual([scoreTrip(sparse, [], R).score, scoreTrip(sparse, [], R).rated], [null, false]);
});

test('service tags events with the driver and closes them for a silent truck', () => {
  const svc = createDrivingService({ rules });
  const info = { driver_id: 'D1', driver_name: 'Ravi' };
  for (let i = 0; i < 5; i++) {
    svc.ingest({ truck_id: 'TN01', timestamp: formatTs(T0 + i * 1000), speed: 90, rpm: 1500 }, info, 1000 + i);
  }
  assert.equal(svc.list().length, 1);
  assert.equal(svc.list()[0].ongoing, true);
  assert.equal(svc.sweep(1000 + 5 + rules.freshness.stale_after_s * 1000 + 1).length, 0, 'a backlog may still continue it');
  assert.equal(svc.sweep(1000 + 5 + rules.trips.no_data_end_s * 1000 + 1).length, 1);
  const [e] = svc.list({ driver_id: 'D1' });
  assert.equal(e.ongoing, false, 'same event, now ended');
  assert.equal(e.driver_name, 'Ravi');
  assert.equal(e.duration_s, 4);
  assert.equal(svc.list({ driver_id: 'D2' }).length, 0);
});

test('scenario: harsh braking costs TN04 two harsh brakes without a collision SOS', () => {
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
  step(120);
  assert.equal(bff.driving.list().length, 0, 'normal simulated driving raises no events');
  bff.scenarios.start({ scenario: 'harsh_braking' }, t);
  step(40);
  const events = bff.driving.list({ truck_id: 'TN04' });
  assert.deepEqual(
    events.map((e) => e.type),
    ['harsh_brake', 'harsh_brake'],
  );
  assert.equal(bff.alerts.list({ kind: 'sos' }).length, 0);
  const [trip] = bff.trips.list({ truck_id: 'TN04', status: 'active' });
  assert.equal(trip.driving.score, 90);
  assert.equal(trip.driver_id, bff.registry.truckInfo('TN04').driver_id);
});

// A trip service fed the same readings as the driving service, the way the server wires them.
function pair() {
  const trips = createTripService({ rules });
  const svc = createDrivingService({ rules, onRecord: (e) => trips.recordEvent(e) });
  const info = { driver_id: 'D1', driver_name: 'Ravi' };
  let i = 0;
  const send = (speed, rpm = 1500) => {
    const p = { truck_id: 'TN01', timestamp: formatTs(T0 + i++ * 1000), latitude: 13 + i / 1e4, longitude: 80.2, speed, rpm };
    const out = [...trips.ingest(p, info, 0), ...svc.ingest(p, info, 0)];
    return out;
  };
  return { trips, svc, send };
}

test('a harsh start from standstill counts in the trip it starts, with the trip driver', () => {
  const { trips, svc, send } = pair();
  for (let k = 0; k < 3; k++) send(0);
  send(12);
  send(20);
  assert.equal(svc.list()[0].trip_id, null, 'no trip yet when the event is recorded');
  let claimed = [];
  for (let k = 0; k < 40; k++) claimed.push(...send(25).filter((c) => c.event));
  const [trip] = trips.list({ status: 'active' });
  assert.equal(trip.driving.score, 100 - R.points.harsh_accel);
  assert.equal(claimed.length, 1, 'the claimed event is sent again with its trip');
  assert.equal(claimed[0].event.trip_id, trip.id);
  assert.equal(svc.list()[0].trip_id, trip.id);
});

test('a completed trip keeps its score after its events leave the buffer', () => {
  const trips = createTripService({ rules });
  const svc = createDrivingService({ rules, maxEvents: 1, onRecord: (e) => trips.recordEvent(e) });
  let i = 0;
  const send = (speed) => {
    const p = { truck_id: 'TN01', timestamp: formatTs(T0 + i++ * 1000), latitude: 13, longitude: 80.2, speed, rpm: 1500 };
    trips.ingest(p, {}, 0);
    svc.ingest(p, {}, 0);
  };
  for (let k = 0; k < 40; k++) send(40);
  send(26); // harsh brake
  for (const v of [30, 34, 38, 40]) send(v);
  send(26); // second harsh brake pushes the first out of the one-event buffer
  for (const v of [22, 18, 14, 10, 6, 2]) send(v);
  for (let k = 0; k < 130; k++) send(0);
  const [trip] = trips.list({ status: 'completed' });
  assert.equal(svc.list().length, 1);
  assert.equal(trip.driving.score, 100 - 2 * R.points.harsh_brake - 2 * R.points.idle_per_min, 'two brakes and 130 s idling at the end');
});
