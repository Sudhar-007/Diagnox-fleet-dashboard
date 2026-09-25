import { test } from 'node:test';
import assert from 'node:assert/strict';

import { rules } from '../config/rules.js';
import { createServer } from '../app.js';
import { expireTrip, stepTrip, summarize } from '../engine/trips.js';
import { createRegistry } from '../services/registry.js';
import { createSource } from '../services/source.js';
import { createMemoryStorage } from '../services/storage.js';
import { createTripService } from '../services/trips.js';
import { formatTs, parseTs } from '../engine/time.js';

const T0 = parseTs('2026-09-10T08:00:00');
const quiet = { error() {}, warn() {}, log() {} };
const R = rules.trips;

// Drives north along a meridian: each second moves speed/3.6 metres.
function driver(truck_id = 'TN01') {
  let s = 0;
  let lat = 13;
  return (speed, extra = {}) => {
    s += 1;
    lat += speed / 3.6 / 111_195;
    return { truck_id, timestamp: formatTs(T0 + s * 1000), latitude: lat, longitude: 80.2, speed, ...extra };
  };
}

function feed(points) {
  let state = null;
  const started = [];
  const ended = [];
  for (const p of points) {
    const r = stepTrip(state, p, R);
    state = r.state;
    if (r.started) started.push(r.started);
    if (r.ended) ended.push(r.ended);
  }
  return { state, started, ended };
}

const repeat = (n, fn) => Array.from({ length: n }, fn);

test('a trip starts once speed has stayed above 5 km/h for 30 s (31 readings at 1 Hz), dated at the first', () => {
  const at = driver();
  const pts = [...repeat(5, () => at(0)), ...repeat(30, () => at(36))];
  assert.equal(feed(pts).started.length, 0, '29 s is not enough');
  const more = [...pts, at(36)];
  const { started } = feed(more);
  assert.equal(started.length, 1);
  assert.equal(started[0].start_at, formatTs(T0 + 6000));
});

test('a dip to walking pace resets a pending start', () => {
  const at = driver();
  const pts = [...repeat(20, () => at(30)), at(4), ...repeat(20, () => at(30))];
  assert.equal(feed(pts).started.length, 0);
});

test('a stop longer than 2 min ends the trip at the moment it stopped; shorter stops do not', () => {
  const at = driver();
  const pts = [
    ...repeat(60, () => at(36)), // 60 s at 10 m/s = 600 m
    ...repeat(60, () => at(0)), // a 60 s stop keeps the trip going
    ...repeat(60, () => at(36)),
    ...repeat(125, () => at(0)),
  ];
  const { ended, state } = feed(pts);
  assert.equal(ended.length, 1);
  const s = summarize(ended[0]);
  assert.equal(s.end_reason, 'stopped');
  assert.equal(s.end_at, formatTs(T0 + 181 * 1000), 'ends at the first zero reading');
  assert.ok(Math.abs(s.distance_km - 1.2) < 0.02, `distance ${s.distance_km}`);
  assert.equal(s.max_speed, 36);
  assert.equal(state.trip, null);
});

test('no reading for 5 min ends the trip at the last reading; late points are ignored', () => {
  const at = driver();
  const pts = repeat(40, () => at(40));
  let { state } = feed(pts);
  const late = { ...pts[10] };
  const r1 = stepTrip(state, late, R);
  assert.equal(r1.state, state, 'a late point changes nothing');
  const gap = { ...at(40), timestamp: formatTs(T0 + (40 + 301) * 1000) };
  const r2 = stepTrip(state, gap, R);
  assert.equal(summarize(r2.ended).end_reason, 'no_data');
  assert.equal(r2.ended.end_at, pts.at(-1).timestamp);
  ({ state } = feed(pts));
  assert.equal(summarize(expireTrip(state).ended).end_reason, 'no_data');
});

test('trip service: ids, alerts during the trip, path for replay, sweep', () => {
  const alertLog = [{ id: 'A1', kind: 'health', name: 'Overspeed', level: 'warning', opened_at: formatTs(T0 + 50_000) }];
  const svc = createTripService({
    rules,
    alertsFor: () => alertLog,
  });
  const at = driver('TN07');
  const changes = [];
  for (const p of repeat(100, () => at(40))) changes.push(...svc.ingest(p, { driver_name: 'Test Driver', provenance: 'SIM' }));
  assert.equal(changes[0].trip.status, 'active');
  assert.ok(changes.length >= 2 && changes.length <= 20, 'start plus throttled updates');
  const [active] = svc.list({ status: 'active' });
  assert.equal(active.driver_name, 'Test Driver');
  assert.equal(active.alerts.length, 1);
  assert.equal(svc.get(active.id).path.rows.length, 100);

  const [done] = svc.sweep(Date.now() + 10 * 60_000);
  assert.equal(done.trip.status, 'completed');
  assert.equal(done.trip.end_reason, 'no_data');
  const full = svc.get(done.trip.id);
  assert.deepEqual(full.path.fields.slice(0, 4), ['t_ms', 'latitude', 'longitude', 'speed']);
  assert.equal(full.path.rows.length, 100);
  assert.equal(svc.list({ status: 'active' }).length, 0);
});

test('trip service keeps only the newest paths', () => {
  const svc = createTripService({ rules, maxPaths: 1 });
  for (const id of ['TA', 'TB']) {
    const at = driver(id);
    for (const p of repeat(40, () => at(40))) svc.ingest(p);
    svc.sweep(Date.now() + 10 * 60_000);
  }
  const done = svc.list({ status: 'completed' });
  const newer = done.find((t) => t.truck_id === 'TB');
  const older = done.find((t) => t.truck_id === 'TA');
  assert.ok(svc.get(newer.id).path);
  assert.equal(svc.get(older.id).path, null);
  assert.equal(older.has_path, false);
});

test('trip assignments: validation and the truck driver as default', () => {
  const reg = createRegistry({ storage: createMemoryStorage(), log: quiet });
  const now = parseTs('2026-09-25T10:00:00');
  const body = { truck_id: 'TN02', from_place: 'Ambattur', to_place: 'Chennai Port', planned_start: '2026-09-25T14:30' };
  const a = reg.addAssignment(body, now);
  assert.equal(a.planned_start, '2026-09-25T14:30:00');
  assert.equal(a.driver_name, 'Suresh Babu');
  assert.throws(() => reg.addAssignment({ ...body, truck_id: 'NOPE' }, now), /unknown truck/);
  assert.throws(() => reg.addAssignment({ ...body, to_place: '' }, now), /to_place is required/);
  assert.throws(() => reg.addAssignment({ ...body, planned_start: '2026-02-30T10:00' }, now), /not a real/);
  assert.throws(() => reg.addAssignment({ ...body, planned_start: '2028-01-01T10:00' }, now), /within a year/);
  assert.throws(() => reg.addAssignment({ ...body, driver_id: 'D99' }, now), /unknown driver/);
  assert.equal(reg.listAssignments({ truck_id: 'TN02' }).length, 1);
  reg.removeAssignment(a.id);
  assert.equal(reg.listAssignments().length, 0);
});

test('warm start fills history and trips without raising alerts or broadcasting', () => {
  let emitted = 0;
  const bff = createServer({
    rules,
    allowedOrigins: [],
    log: quiet,
    makeSource: (onPoints) => createSource({ mode: 'mock', onPoints, warmStartS: 1800, log: quiet }),
  });
  bff.io.emit = () => {
    emitted += 1;
  };
  bff.source.start();
  bff.source.stop();
  assert.equal(emitted, 0);
  assert.equal(bff.fleet.snapshot().length, 5);
  assert.ok(bff.trips.list({}).length >= 5, 'every truck is on or has finished a trip');
  assert.equal(bff.alerts.list({}).length, 0);
});

test('review: readings without speed do not keep a trip open forever', () => {
  const at = driver();
  const pts = [...repeat(40, () => at(40)), ...repeat(310, () => ({ ...at(0), speed: null }))];
  const { ended, state } = feed(pts);
  assert.equal(ended.length, 1);
  assert.equal(summarize(ended[0]).end_reason, 'no_data');
  assert.equal(state.trip, null);
  // a 0 reading followed by speedless readings still ends as a stop
  const at2 = driver();
  const pts2 = [...repeat(40, () => at2(40)), at2(0), ...repeat(125, () => ({ ...at2(0), speed: null }))];
  assert.equal(summarize(feed(pts2).ended[0]).end_reason, 'stopped');
});

test('review: a clock jump back of more than 5 min is a reset, not a stream of late points', () => {
  const at = driver();
  let { state } = feed(repeat(40, () => at(40)));
  const back = { ...at(40), timestamp: formatTs(T0 - 3600 * 1000) };
  const r = stepTrip(state, back, R);
  assert.equal(summarize(r.ended).end_reason, 'no_data');
  assert.equal(r.state.last_ms, T0 - 3600 * 1000);
});

test('review: two readings far apart do not add up to a start', () => {
  const p1 = { truck_id: 'X', timestamp: formatTs(T0), speed: 40, latitude: 13, longitude: 80 };
  const p2 = { ...p1, timestamp: formatTs(T0 + 200_000) };
  assert.equal(feed([p1, p2]).started.length, 0);
});

test('review: sweep counts from the last accepted point, not from ignored late ones', () => {
  const svc = createTripService({ rules });
  const at = driver('TN08');
  const pts = repeat(40, () => at(40));
  for (const p of pts) svc.ingest(p, {}, 1000);
  // late points keep arriving (receive time moves on) but are ignored
  for (let i = 0; i < 5; i++) svc.ingest(pts[0], {}, 1000 + i * 100_000);
  assert.equal(svc.sweep(1000 + 301_000).length, 1);
});
