import { test } from 'node:test';
import assert from 'node:assert/strict';

import { rules } from '../config/rules.js';
import { createServer } from '../app.js';
import { haversine } from '../engine/geo.js';
import { formatTs } from '../engine/time.js';
import { createBenchPositions } from '../services/bench.js';
import { pathLengths } from '../sim/simulator.js';
import { benchLoop } from '../sim/routes.js';

const quiet = { log() {}, warn() {}, error() {} };
const KEY = 'bench-key';
const DESK = { latitude: 13.0827, longitude: 80.2707 }; // where the board sits, never changes

// A straight 1 km test loop: 13.000 -> 13.009 latitude and back.
const line = [
  [13, 80],
  [13.009, 80],
  [13, 80],
];
const loop = { path: line, cum: pathLengths(line) };

const reading = (s, speed, over = {}) => ({
  truck_id: 'TN06',
  timestamp: formatTs(Date.parse('2026-09-26T10:00:00') + s * 1000),
  ...DESK,
  coolant_temp: 90,
  oil_temp: 88,
  battery_voltage: 13.9,
  rpm: 1800,
  engine_load: 40,
  speed,
  ...over,
});

test('bench truck moves along the loop by its reported speed; the board fix is kept', () => {
  const bench = createBenchPositions({ truckIds: ['TN06'], loop, now: () => Date.parse('2026-09-26T10:00:10') });
  const a = bench.place(reading(0, 36));
  assert.deepEqual([a.latitude, a.longitude], [13, 80]);
  assert.deepEqual([a.device_latitude, a.device_longitude], [DESK.latitude, DESK.longitude]);
  assert.equal(a.position_source, 'virtual_route');
  const b = bench.place(reading(1, 36)); // 36 km/h = 10 m in 1 s
  assert.ok(Math.abs(haversine(13, 80, b.latitude, b.longitude) - 10) < 0.5);
  const c = bench.place(reading(3, 72)); // 20 m/s for 2 s
  assert.ok(Math.abs(haversine(13, 80, c.latitude, c.longitude) - 50) < 0.5);
});

test('bench truck: a gap counts for at most the stale limit, a stop does not move it, an old reading gets no position', () => {
  const bench = createBenchPositions({ truckIds: ['TN06'], loop, maxStepS: 5, now: () => Date.parse('2026-09-26T10:30:00') });
  bench.place(reading(0, 36));
  const afterGap = bench.place(reading(600, 36)); // 10 min without data: 5 s x 10 m/s
  assert.ok(Math.abs(haversine(13, 80, afterGap.latitude, afterGap.longitude) - 50) < 0.5);
  const stopped = bench.place(reading(601, 0));
  assert.deepEqual([stopped.latitude, stopped.longitude], [afterGap.latitude, afterGap.longitude]);
  const old = bench.place(reading(300, 80));
  assert.deepEqual([old.latitude, old.longitude], [null, null]);
  assert.equal(old.position_source, 'virtual_route');
  const next = bench.place(reading(602, 0));
  assert.deepEqual([next.latitude, next.longitude], [afterGap.latitude, afterGap.longitude], 'old reading did not move it');
});

test('bench truck: a reading stamped too far ahead is left alone and does not freeze the truck', () => {
  const nowMs = Date.parse('2026-09-26T10:00:10');
  const bench = createBenchPositions({ truckIds: ['TN06'], loop, maxFutureS: 300, now: () => nowMs });
  bench.place(reading(0, 36));
  const future = bench.place(reading(3600, 36));
  assert.equal(future.position_source, undefined);
  const b = bench.place(reading(1, 36));
  assert.ok(Math.abs(haversine(13, 80, b.latitude, b.longitude) - 10) < 0.5);
});

test('trucks not on the bench list keep their own GPS', () => {
  const bench = createBenchPositions({ truckIds: ['TN06'], loop, now: () => Date.parse('2026-09-26T10:00:10') });
  const p = bench.place(reading(0, 40, { truck_id: 'TN07' }));
  assert.deepEqual([p.latitude, p.longitude], [DESK.latitude, DESK.longitude]);
  assert.equal(p.position_source, undefined);
});

test('the stored bench loop is a closed road path', () => {
  assert.ok(benchLoop && benchLoop.path.length > 100);
  const [first, last] = [benchLoop.path[0], benchLoop.path.at(-1)];
  assert.ok(haversine(first[0], first[1], last[0], last[1]) < 1);
});

test('HTTP: a static bench board drives the road loop and keeps its readings', async () => {
  const bff = createServer({
    rules,
    allowedOrigins: [],
    log: quiet,
    telemetryKey: KEY,
    benchTrucks: ['TN06'],
    makeSource: () => ({ sim: null, start() {}, stop() {}, mode: () => 'device', requestedMode: () => 'device', acceptsDevice: () => true }),
  });
  const port = await bff.listen(0);
  try {
    const now = Date.now();
    const points = [0, 1, 2, 3, 4].map((i) => ({ ...reading(0, 54), timestamp: formatTs(now - (5 - i) * 1000) }));
    const res = await fetch(`http://127.0.0.1:${port}/api/telemetry`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': KEY },
      body: JSON.stringify(points),
    });
    assert.equal((await res.json()).accepted, 5);
    const t = bff.fleet.truck('TN06');
    assert.equal(t.position_source, 'virtual_route');
    assert.equal(t.speed, 54);
    assert.equal(t.device_latitude, DESK.latitude);
    // 4 s at 54 km/h = 60 m along the loop from its start, on the road, away from the desk.
    const start = benchLoop.path[0];
    assert.ok(Math.abs(haversine(start[0], start[1], t.latitude, t.longitude) - 60) < 5);
    assert.ok(haversine(DESK.latitude, DESK.longitude, t.latitude, t.longitude) > 1000);
  } finally {
    await bff.close();
  }
});
