import { test } from 'node:test';
import assert from 'node:assert/strict';

import { rules } from '../config/rules.js';
import { createServer } from '../app.js';
import { formatTs } from '../engine/time.js';
import { MAX_BATCH, keyMatches, normalizeTelemetry } from '../services/telemetry.js';

const quiet = { log() {}, warn() {}, error() {} };
const KEY = 'test-key-123';

const reading = (over = {}) => ({
  truck_id: 'HW01',
  timestamp: '2026-09-26T10:00:00',
  latitude: 13.0827,
  longitude: 80.2707,
  coolant_temp: 90,
  oil_temp: 88,
  battery_voltage: 13.9,
  rpm: 1800,
  engine_load: 45,
  speed: 60,
  ...over,
});

test('valid point passes through unchanged', () => {
  assert.deepEqual(normalizeTelemetry(reading()).point, reading());
});

test('positions out of range or at 0, 0 are stored as no fix', () => {
  for (const [latitude, longitude] of [[999, 80], [13, -200], [0, 0], [13, null]]) {
    const { point } = normalizeTelemetry(reading({ latitude, longitude }));
    assert.deepEqual([point.latitude, point.longitude], [null, null]);
  }
});

test('timestamps older than the limit are refused (device clock not set)', () => {
  const nowMs = Date.parse('2026-09-26T10:00:00');
  assert.match(normalizeTelemetry(reading({ timestamp: '1970-01-01T05:30:00' }), { nowMs, maxPastS: 86400 }).error, /clock/);
  assert.ok(normalizeTelemetry(reading({ timestamp: '2026-09-25T12:00:00' }), { nowMs, maxPastS: 86400 }).point);
});

test('numeric strings are read as numbers, no GPS fix is null', () => {
  const { point } = normalizeTelemetry(reading({ coolant_temp: '91.5', rpm: '1800', latitude: null, longitude: undefined }));
  assert.equal(point.coolant_temp, 91.5);
  assert.equal(point.rpm, 1800);
  assert.equal(point.latitude, null);
  assert.equal(point.longitude, null);
});

test('only contract fields are kept, so derived fields cannot be overwritten', () => {
  const { point } = normalizeTelemetry(reading({ status: 'normal', provenance: 'SIM', ml_risk: {}, extra: 1 }));
  assert.equal(point.status, undefined);
  assert.equal(point.provenance, undefined);
  assert.equal(point.ml_risk, undefined);
  assert.equal(point.extra, undefined);
});

test('optional fields: sos becomes a real boolean, unreadable values are dropped', () => {
  assert.equal(normalizeTelemetry(reading({ sos: 'true' })).point.sos, true);
  assert.equal(normalizeTelemetry(reading({ sos: 1 })).point.sos, true);
  assert.equal(normalizeTelemetry(reading({ sos: '0' })).point.sos, false);
  assert.equal('sos' in normalizeTelemetry(reading({ sos: 'yes' })).point, false);
  assert.equal(normalizeTelemetry(reading({ fuel_level: '72.5' })).point.fuel_level, 72.5);
  assert.equal('fuel_level' in normalizeTelemetry(reading({ fuel_level: 'n/a' })).point, false);
  assert.equal(normalizeTelemetry(reading({ maintenance_risk_score: 12 })).point.maintenance_risk_score, 12);
});

test('bad points are rejected with a reason', () => {
  assert.match(normalizeTelemetry(reading({ truck_id: 'x' })).error, /truck_id/);
  assert.match(normalizeTelemetry(reading({ timestamp: 'yesterday' })).error, /timestamp/);
  assert.match(normalizeTelemetry(reading({ timestamp: '2026-09-26T10:00:00Z' })).error, /timestamp/);
  assert.match(normalizeTelemetry(reading({ timestamp: '2026-09-26' })).error, /timestamp/);
  assert.match(normalizeTelemetry(reading({ timestamp: '2026-13-45T10:00:00' })).error, /timestamp/);
  assert.match(normalizeTelemetry(reading({ oil_temp: undefined })).error, /oil_temp is required/);
  assert.match(normalizeTelemetry(reading({ rpm: 'fast' })).error, /rpm/);
  assert.match(normalizeTelemetry(reading({ engine_load: 140 })).error, /engine_load must be from 0 to 100/);
  assert.match(normalizeTelemetry(reading({ latitude: 'north' })).error, /latitude/);
  assert.match(normalizeTelemetry([]).error, /object/);
});

test('api key comparison', () => {
  assert.equal(keyMatches(KEY, KEY), true);
  assert.equal(keyMatches('wrong', KEY), false);
  assert.equal(keyMatches(undefined, KEY), false);
  assert.equal(keyMatches('', ''), false);
  assert.equal(keyMatches(KEY, null), false);
});

// Server with a simulator source that never ticks on its own; `sim(points)` feeds it by hand.
async function server({ key = KEY, accepts = true, simIds = [] } = {}) {
  let feed;
  const bff = createServer({
    rules,
    allowedOrigins: ['http://localhost:5173'],
    log: quiet,
    telemetryKey: key,
    makeSource: (onPoints) => {
      feed = onPoints;
      const sim = { truckIds: () => simIds };
      return { sim, start() {}, stop() {}, mode: () => 'hybrid', requestedMode: () => 'hybrid', acceptsDevice: () => accepts };
    },
  });
  const port = await bff.listen(0);
  const api = `http://127.0.0.1:${port}/api`;
  const post = (body, headers = { 'x-api-key': KEY }) =>
    fetch(`${api}/telemetry`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  const get = async (path) => (await fetch(`${api}${path}`)).json();
  return { bff, post, get, sim: (points) => feed(points, 'SIM') };
}

const ago = (s) => formatTs(Date.now() - s * 1000);

test('HTTP: key and mode are enforced', async () => {
  const s = await server();
  try {
    assert.equal((await s.post(reading(), {})).status, 401);
    assert.equal((await s.post(reading(), { 'x-api-key': 'nope' })).status, 401);
  } finally {
    await s.bff.close();
  }
  // No key configured: off. Mode off: only a caller holding the key learns that.
  const noKey = await server({ key: null });
  const mockMode = await server({ accepts: false });
  try {
    assert.equal((await noKey.post(reading())).status, 503);
    assert.equal((await mockMode.post(reading(), {})).status, 401);
    assert.equal((await mockMode.post(reading())).status, 503);
  } finally {
    await noKey.bff.close();
    await mockMode.bff.close();
  }
});

test('HTTP: accepted points show up as live hardware trucks', async () => {
  const s = await server();
  try {
    const ts = ago(2);
    const res = await s.post(reading({ timestamp: ts }));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { accepted: 1, ignored: 0, rejected: [] });

    const truck = (await s.get('/trucks')).trucks.find((t) => t.truck_id === 'HW01');
    assert.equal(truck.provenance, 'LIVE_HW');
    assert.equal(truck.freshness, 'live');

    // Same timestamp again: ignored, not an error.
    assert.deepEqual(await (await s.post(reading({ timestamp: ts }))).json(), { accepted: 0, ignored: 1, rejected: [] });
  } finally {
    await s.bff.close();
  }
});

test('HTTP: a batch keeps the good points and names the bad ones', async () => {
  const s = await server();
  try {
    const res = await s.post([reading({ timestamp: ago(3) }), reading({ timestamp: ago(2), speed: 'x' }), reading({ timestamp: ago(1) })]);
    assert.equal(res.status, 200);
    const out = await res.json();
    assert.equal(out.accepted, 2);
    assert.deepEqual(out.rejected, [{ index: 1, error: 'speed is required and must be a number' }]);

    const bad = await s.post([{ truck_id: 'HW01' }]);
    assert.equal(bad.status, 400);
    assert.equal((await s.post([])).status, 400);
    assert.equal((await s.post('{not json')).status, 400);
    const big = Array.from({ length: MAX_BATCH + 1 }, (_, i) => reading({ timestamp: ago(i + 1) }));
    assert.equal((await s.post(big)).status, 413);
  } finally {
    await s.bff.close();
  }
});

test('HTTP: a 4G backlog is judged point by point, so an SOS in the middle still opens', async () => {
  const s = await server();
  try {
    // Sent newest first on purpose; the server orders them.
    const backlog = [
      reading({ timestamp: ago(10), sos: false }),
      reading({ timestamp: ago(30), sos: false }),
      reading({ timestamp: ago(20), sos: true }),
    ];
    assert.equal((await (await s.post(backlog)).json()).accepted, 3);
    const { alerts } = await s.get('/alerts?kind=sos&truck_id=HW01');
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].opened_at, backlog[2].timestamp);
  } finally {
    await s.bff.close();
  }
});

test('HTTP: a device may not use a simulated truck id', async () => {
  const s = await server({ simIds: ['TN01'] });
  try {
    const res = await s.post([reading({ truck_id: 'TN01', timestamp: ago(5) }), reading({ truck_id: 'TN06', timestamp: ago(5) })]);
    const out = await res.json();
    assert.equal(out.accepted, 1);
    assert.deepEqual(out.rejected, [{ index: 0, error: 'truck_id TN01 is a simulated truck; use another id' }]);
    const { trucks } = await s.get('/trucks');
    assert.deepEqual(trucks.map((t) => t.truck_id), ['TN06']);
  } finally {
    await s.bff.close();
  }
});
