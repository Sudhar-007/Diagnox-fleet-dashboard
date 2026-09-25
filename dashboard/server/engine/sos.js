import { parseTs } from './time.js';

// Heuristic "possible collision": speed falls from >= from_kmh to <= to_kmh within within_s.
// Pure: (current point, prior points ascending, rule) -> evidence or null.
// It is a heuristic and is labelled as one everywhere it is shown.
export function detectCollision(point, history, rule) {
  if (typeof point.speed !== 'number' || point.speed > rule.to_kmh) return null;
  const t = parseTs(point.timestamp);
  if (t == null) return null;
  for (let i = history.length - 1; i >= 0; i--) {
    const p = history[i];
    const pt = parseTs(p.timestamp);
    if (pt == null || pt >= t) continue;
    if (t - pt > rule.within_s * 1000) break;
    if (typeof p.speed === 'number' && p.speed >= rule.from_kmh) {
      return { from_speed: p.speed, to_speed: point.speed, seconds: (t - pt) / 1000 };
    }
  }
  return null;
}
