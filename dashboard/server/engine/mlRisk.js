import { readFileSync } from 'node:fs';
import { parseTs } from './time.js';

// Maintenance model: a random forest trained in ml/train_model.py, exported to JSON by
// ml/export_model.py. Each tree is flat arrays: f (feature index, -1 at a leaf), t (threshold),
// l / r (child indexes), p (breakdown probability at a leaf).
export function loadForest(url = new URL('../ml/maintenance_forest.json', import.meta.url)) {
  const forest = JSON.parse(readFileSync(url, 'utf8'));
  if (!Array.isArray(forest.features) || !Array.isArray(forest.trees) || forest.trees.length === 0) {
    throw new Error('maintenance model file is malformed');
  }
  return forest;
}

// Breakdown probability 0-1 for one reading, or null if any model input is missing.
// sklearn compares float32 inputs against the thresholds, so inputs are rounded the same way.
export function forestProba(forest, point) {
  const x = new Array(forest.features.length);
  for (let i = 0; i < x.length; i++) {
    const v = point[forest.features[i]];
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    x[i] = Math.fround(v);
  }
  let sum = 0;
  for (const tree of forest.trees) {
    let n = 0;
    while (tree.f[n] !== -1) n = x[tree.f[n]] <= tree.t[n] ? tree.l[n] : tree.r[n];
    sum += tree.p[n];
  }
  return sum / forest.trees.length;
}

// Model score 0-100: mean breakdown probability over the readings in the last `window_s`
// (ending at the newest point) with the engine running. The model never saw rpm 0, so
// engine-off readings are not scored.
//
// Pure: (points ascending, forest, ml rules) -> { score, state, readings, window_s }
//   state: 'ok' | 'engine_off' (readings, none running) | 'no_data' (none, or inputs missing)
export function mlRiskScore(points, forest, mlRules) {
  const windowS = mlRules.window_s;
  const out = (score, state, readings) => ({ score, state, readings, window_s: windowS });
  if (points.length === 0) return out(null, 'no_data', 0);

  const end = parseTs(points[points.length - 1].timestamp);
  let sum = 0;
  let scored = 0;
  let seen = 0;
  let running = 0;
  for (const p of points) {
    const t = parseTs(p.timestamp);
    if (t == null || end - t >= windowS * 1000) continue;
    seen++;
    if (!(typeof p.rpm === 'number' && p.rpm > 0)) continue;
    running++;
    const prob = forestProba(forest, p);
    if (prob == null) continue;
    sum += prob;
    scored++;
  }
  if (scored > 0) return out(Math.round((sum / scored) * 100), 'ok', scored);
  return out(null, seen > 0 && running === 0 ? 'engine_off' : 'no_data', 0);
}
