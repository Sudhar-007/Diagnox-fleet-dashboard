import { haversine } from './geo.js';

// Pure geofence logic for circular zones.

export const appliesTo = (zone, truck_id) => zone.truck_ids.length === 0 || zone.truck_ids.includes(truck_id);

export const distanceM = (zone, lat, lng) => haversine(lat, lng, zone.center_lat, zone.center_lng);

// A breach is being inside a restricted zone or outside an allowed one.
export const isBreach = (zone, inside) => (zone.type === 'restricted' ? inside : !inside);

// A usable GPS fix: numbers in range, and not the 0,0 a receiver reports without a fix.
export function hasFix(point) {
  const { latitude: lat, longitude: lng } = point;
  return (
    Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)
  );
}

// One truck against one zone. `state.inside` is the confirmed side (null until the first
// confirmation); a change of side needs `confirmPoints` consecutive points on the new side,
// so jitter across the edge does not flap. The change is dated at the first of those points.
// Only points newer than the last one judged count (a late or repeated point is not a second
// reading), and a candidate older than `maxGapMs` is dropped rather than confirmed.
//   state: { inside: boolean|null, since_ms, candidate: boolean|null, candidate_ms, count, last_ms }
// Returns { state, changed, from } where `from` is the previous confirmed side.
export function stepZone(state, inside, tMs, confirmPoints, maxGapMs = Infinity) {
  const s = state ?? { inside: null, since_ms: null, candidate: null, candidate_ms: null, count: 0, last_ms: null };
  if (s.last_ms != null && tMs <= s.last_ms) return { state: s, changed: false, from: s.inside };
  if (inside === s.inside) {
    return { state: { ...s, candidate: null, candidate_ms: null, count: 0, last_ms: tMs }, changed: false, from: s.inside };
  }
  const continuing = s.candidate === inside && s.last_ms != null && tMs - s.last_ms <= maxGapMs;
  const count = continuing ? s.count + 1 : 1;
  const firstMs = continuing ? s.candidate_ms : tMs;
  if (count >= confirmPoints) {
    return {
      state: { inside, since_ms: firstMs, candidate: null, candidate_ms: null, count: 0, last_ms: tMs },
      changed: true,
      from: s.inside,
    };
  }
  return { state: { ...s, candidate: inside, candidate_ms: firstMs, count, last_ms: tMs }, changed: false, from: s.inside };
}
