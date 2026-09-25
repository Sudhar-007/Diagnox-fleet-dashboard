import { test } from 'node:test';
import assert from 'node:assert/strict';

import { rules } from '../config/rules.js';
import { evaluateHealth, freshnessOf } from '../engine/health.js';
import { createStore } from '../services/store.js';
import { createSimulator } from '../sim/simulator.js';
import { routes } from '../sim/routes.js';
import { parseOrigins, originChecker } from '../services/cors.js';
import { formatTs, parseTs } from '../engine/time.js';

const base = {
  truck_id: 'TN01',
  timestamp: '2026-09-10T10:00:00',
  latitude: 13.0827,
  longitude: 80.2707,
  coolant_temp: 90,
  oil_temp: 88,
  battery_voltage: 13.9,
  rpm: 1800,
  engine_load: 50,
  speed: 60,
};

test('normal point has no findings', () => {
  const r = evaluateHealth(base, [], rules.health);
  assert.equal(r.level, 'normal');
  assert.deepEqual(r.findings, []);
});

test('coolant reports only the highest level per field', () => {
  const r = evaluateHealth({ ...base, coolant_temp: 112 }, [], rules.health);
  assert.equal(r.level, 'critical');
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].rule_id, 'coolant_temp_critical');
  assert.equal(r.findings[0].threshold, 110);
});

// Builds one point per second from [seconds, overrides] segments.
function run(segments) {
  const t0 = parseTs(base.timestamp);
  const pts = [];
  for (const [secs, over] of segments) {
    for (let i = 0; i < secs; i++) pts.push({ ...base, ...over, timestamp: formatTs(t0 + pts.length * 1000) });
  }
  return evaluateHealth(pts.at(-1), pts.slice(0, -1), rules.health);
}

test('battery rule ignored when engine is off', () => {
  assert.equal(run([[15, { rpm: 0, battery_voltage: 12.1 }]]).level, 'normal');
});

test('a single low battery reading while running does not fire', () => {
  assert.equal(run([[1, { battery_voltage: 12.1 }]]).level, 'normal');
});

test('cranking dip after engine-off period does not fire', () => {
  const r = run([
    [30, { rpm: 0, battery_voltage: 12.6 }],
    [2, { rpm: 400, battery_voltage: 11.5 }],
    [1, { battery_voltage: 13.9 }],
  ]);
  assert.equal(r.level, 'normal');
  // evaluated during the dip itself
  assert.equal(run([[30, { rpm: 0, battery_voltage: 12.6 }], [2, { rpm: 400, battery_voltage: 11.5 }]]).level, 'normal');
});

test('battery held low for 10 s while running fires', () => {
  const crit = run([[12, { battery_voltage: 12.0 }]]);
  assert.equal(crit.level, 'critical');
  assert.equal(crit.findings[0].rule_id, 'battery_low_critical');
  const warn = run([[12, { battery_voltage: 13.0 }]]);
  assert.equal(warn.findings[0].rule_id, 'battery_low_warning');
});

test('engine load needs a full 60 s window above threshold', () => {
  const t0 = parseTs(base.timestamp);
  const series = (n, load) =>
    Array.from({ length: n }, (_, i) => ({ ...base, engine_load: load, timestamp: formatTs(t0 + i * 1000) }));

  const short = series(30, 90);
  assert.equal(evaluateHealth(short.at(-1), short.slice(0, -1), rules.health).level, 'normal');

  const full = series(62, 90);
  const r = evaluateHealth(full.at(-1), full.slice(0, -1), rules.health);
  assert.equal(r.findings[0].rule_id, 'engine_load_sustained');

  full[40].engine_load = 70;
  assert.equal(evaluateHealth(full.at(-1), full.slice(0, -1), rules.health).level, 'normal');
});

test('freshness thresholds', () => {
  assert.equal(freshnessOf(3, rules.freshness), 'live');
  assert.equal(freshnessOf(16, rules.freshness), 'stale');
  assert.equal(freshnessOf(61, rules.freshness), 'offline');
});

test('store dedupes on truck_id + timestamp and keeps order', () => {
  const s = createStore({ capacity: 3 });
  assert.equal(s.ingest(base, { provenance: 'SIM', receivedAt: 1 }), true);
  assert.equal(s.ingest(base, { provenance: 'SIM', receivedAt: 2 }), false);
  s.ingest({ ...base, timestamp: '2026-09-10T10:00:03' }, { provenance: 'SIM', receivedAt: 3 });
  s.ingest({ ...base, timestamp: '2026-09-10T10:00:02' }, { provenance: 'SIM', receivedAt: 4 });
  assert.deepEqual(
    s.history('TN01').map((p) => p.timestamp),
    ['2026-09-10T10:00:00', '2026-09-10T10:00:02', '2026-09-10T10:00:03'],
  );
  s.ingest({ ...base, timestamp: '2026-09-10T10:00:04' }, { provenance: 'SIM', receivedAt: 5 });
  assert.equal(s.history('TN01').length, 3);
  assert.equal(s.history('TN01')[0].timestamp, '2026-09-10T10:00:02');
  // an evicted point is older than everything in the full ring, so it is not re-accepted
  assert.equal(s.ingest(base, { provenance: 'SIM', receivedAt: 6 }), false);
});

test('simulator stays plausible and never trips harsh-driving thresholds', () => {
  const sim = createSimulator({ routes });
  const start = parseTs('2026-09-10T08:00:00');
  const prev = {};
  let moving = 0;
  for (let i = 0; i < 2 * 3600; i++) {
    for (const p of sim.step(start + i * 1000)) {
      for (const k of Object.keys(base)) assert.ok(p[k] !== undefined, `missing ${k}`);
      assert.ok(p.coolant_temp < 100, `coolant ${p.coolant_temp}`);
      assert.ok(p.oil_temp < 110, `oil ${p.oil_temp}`);
      assert.ok(p.rpm <= 3000 && p.speed <= 80 && p.engine_load <= 85);
      if (p.rpm > 0) assert.ok(p.battery_voltage >= 13.2 && p.battery_voltage <= 14.8);
      assert.ok(p.latitude > 12.8 && p.latitude < 13.3 && p.longitude > 80.0 && p.longitude < 80.4);
      if (prev[p.truck_id]) {
        const dv = p.speed - prev[p.truck_id].speed;
        assert.ok(dv < 8 && dv > -10, `harsh dv ${dv} on ${p.truck_id}`);
      }
      if (p.speed > 5) moving++;
      prev[p.truck_id] = p;
    }
  }
  assert.ok(moving > 5 * 3600, 'trucks should spend most of the time moving');
});

test('cors wildcard matches one subdomain label', () => {
  const check = originChecker(parseOrigins('http://localhost:5173, https://fleet-*.vercel.app'));
  const allowed = (o) => {
    let r;
    check(o, (_, ok) => (r = ok));
    return r;
  };
  assert.equal(allowed('http://localhost:5173'), true);
  assert.equal(allowed('https://fleet-abc123.vercel.app'), true);
  assert.equal(allowed('https://evil.com'), false);
  assert.equal(allowed('https://fleet-x.vercel.app.evil.com'), false);
  assert.equal(allowed(undefined), true);
});

test('engine load rule does not fire across a data gap', () => {
  const t0 = parseTs(base.timestamp);
  const pts = [0, 1, 2, 30, 58, 59, 60, 61].map((s) => ({ ...base, engine_load: 90, timestamp: formatTs(t0 + s * 1000) }));
  assert.equal(evaluateHealth(pts.at(-1), pts.slice(0, -1), rules.health).level, 'normal');
});

test('store rejects points stamped too far in the future', () => {
  const s = createStore({ maxFutureS: 300 });
  const now = parseTs(base.timestamp);
  assert.equal(s.ingest({ ...base, timestamp: '2036-01-01T00:00:00' }, { provenance: 'LIVE_HW', receivedAt: now }), false);
  assert.equal(s.ingest({ ...base, timestamp: formatTs(now + 60_000) }, { provenance: 'LIVE_HW', receivedAt: now }), true);
  assert.equal(s.ingest(null, { provenance: 'LIVE_HW', receivedAt: now }), false);
});

test('full ring ignores points older than everything it holds', () => {
  const s = createStore({ capacity: 2 });
  const opts = { provenance: 'SIM', receivedAt: 1 };
  s.ingest({ ...base, timestamp: '2026-09-10T10:00:05' }, opts);
  s.ingest({ ...base, timestamp: '2026-09-10T10:00:06' }, opts);
  assert.equal(s.ingest({ ...base, timestamp: '2026-09-10T10:00:01' }, opts), false);
  assert.equal(s.history('TN01').length, 2);
});

test('sustained window takes exactly sustain_s samples regardless of earlier data', () => {
  assert.equal(run([[9, { battery_voltage: 12.0 }]]).level, 'normal');
  assert.equal(run([[10, { battery_voltage: 12.0 }]]).level, 'critical');
  assert.equal(run([[20, { battery_voltage: 13.9 }], [9, { battery_voltage: 12.0 }]]).level, 'normal');
  assert.equal(run([[20, { battery_voltage: 13.9 }], [10, { battery_voltage: 12.0 }]]).level, 'critical');
  assert.equal(run([[20, { rpm: 0, battery_voltage: 12.6 }], [10, { battery_voltage: 12.0 }]]).level, 'critical');
});

test('a missing value inside the window is skipped, not a reset', () => {
  assert.equal(run([[5, { battery_voltage: 12.0 }], [1, { rpm: null, battery_voltage: 12.0 }], [5, { battery_voltage: 12.0 }]]).level, 'critical');
  assert.equal(run([[4, { battery_voltage: 12.0 }], [6, { rpm: null }], [3, { battery_voltage: 12.0 }]]).level, 'normal');
});
