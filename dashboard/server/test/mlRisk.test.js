import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { rules } from '../config/rules.js';
import { loadForest, forestProba, mlRiskScore } from '../engine/mlRisk.js';
import { formatTs } from '../engine/time.js';
import { createStore } from '../services/store.js';
import { createFleet } from '../services/fleet.js';

const forest = loadForest();
const fixture = JSON.parse(readFileSync(new URL('./fixtures/maintenance_forest_cases.json', import.meta.url), 'utf8'));

const normal = { coolant_temp: 88, oil_temp: 95, battery_voltage: 13.8, rpm: 1500, engine_load: 50, speed: 60 };
const start = Date.parse('2026-09-10T10:00:00');

// One point per second from [seconds, overrides] segments.
function run(segments) {
  const pts = [];
  let s = 0;
  for (const [n, over] of segments) {
    for (let i = 0; i < n; i++, s++) {
      pts.push({ truck_id: 'TN01', timestamp: formatTs(start + s * 1000), latitude: 13, longitude: 80, ...normal, ...over });
    }
  }
  return pts;
}

test('forest matches sklearn predict_proba on every exported case', () => {
  assert.deepEqual(forest.features, fixture.features);
  let worst = 0;
  for (const { x, p } of fixture.cases) {
    const point = Object.fromEntries(fixture.features.map((f, i) => [f, x[i]]));
    worst = Math.max(worst, Math.abs(forestProba(forest, point) - p));
  }
  assert.ok(worst < 1e-9, `max difference ${worst}`);
});

test('missing or non-numeric input gives no probability', () => {
  assert.equal(forestProba(forest, { ...normal, oil_temp: undefined }), null);
  assert.equal(forestProba(forest, { ...normal, coolant_temp: '90' }), null);
  assert.equal(forestProba(forest, { ...normal, battery_voltage: NaN }), null);
});

test('normal running readings score low, a hot engine scores high', () => {
  assert.ok(mlRiskScore(run([[60, {}]]), forest, rules.ml).score <= 5);
  const hot = mlRiskScore(run([[60, { coolant_temp: 115 }]]), forest, rules.ml);
  assert.equal(hot.state, 'ok');
  assert.ok(hot.score >= 90);
});

test('score averages the window, so one odd reading barely moves it', () => {
  const r = mlRiskScore(run([[59, {}], [1, { oil_temp: 135 }]]), forest, rules.ml);
  assert.equal(r.readings, 60);
  assert.ok(r.score <= 5, `score ${r.score}`);
});

test('readings older than the window are ignored', () => {
  const r = mlRiskScore(run([[120, { coolant_temp: 115 }], [60, {}]]), forest, rules.ml);
  assert.ok(r.score <= 5);
  assert.equal(r.readings, 60);
});

test('engine off is not scored', () => {
  const r = mlRiskScore(run([[60, { rpm: 0, speed: 0, engine_load: 0, coolant_temp: 30, oil_temp: 30 }]]), forest, rules.ml);
  assert.deepEqual(r, { score: null, state: 'engine_off', readings: 0, window_s: rules.ml.window_s });
  assert.equal(mlRiskScore([], forest, rules.ml).state, 'no_data');
  assert.equal(mlRiskScore(run([[10, { rpm: '1500' }]]), forest, rules.ml).state, 'engine_off');
  assert.equal(mlRiskScore(run([[10, { oil_temp: null }]]), forest, rules.ml).state, 'no_data');
});

function fleetWith(points, withForest = forest) {
  const store = createStore({ capacity: 1000, maxFutureS: 1e9 });
  const registry = { truckInfo: () => ({ in_registry: false }) };
  const fleet = createFleet({ store, rules, registry, forest: withForest });
  fleet.ingest(points, 'SIM', start + points.length * 1000);
  return fleet.truck('TN01', start + points.length * 1000);
}

test('fleet adds the model score to each truck', () => {
  const t = fleetWith(run([[30, { coolant_temp: 115 }]]));
  assert.equal(t.ml_risk.source, 'model');
  assert.ok(t.ml_risk.score >= 90);
  assert.equal(t.maintenance_risk_score, undefined);
});

test('a score sent by the device wins over the model', () => {
  const t = fleetWith(run([[30, { coolant_temp: 115, maintenance_risk_score: 12.4 }]]));
  assert.deepEqual(t.ml_risk, { score: 12, source: 'device', state: 'ok', readings: 1, window_s: 0 });
  const bad = fleetWith(run([[30, { maintenance_risk_score: 140 }]]));
  assert.equal(bad.ml_risk.source, 'model');
});

test('no model loaded is reported, not scored', () => {
  assert.equal(fleetWith(run([[5, {}]]), null).ml_risk.state, 'no_model');
});
