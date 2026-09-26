import { parseTs } from '../engine/time.js';
import { pointAlong } from '../sim/simulator.js';

// Bench boards: real devices that report real sensor readings but cannot move (the board sits
// on a desk, so its GPS fix never changes). Each one is driven along a stored road loop by the
// speed it reports: distance += speed x seconds since its previous reading. Only the position is
// generated. The board's own fix is kept as device_latitude / device_longitude, and the point is
// marked position_source: "virtual_route" so no one mistakes it for measured movement.
//
// A gap between readings counts for at most maxStepS (the stale threshold, as for fuel), so a
// truck does not leap along the loop after an outage.
export function createBenchPositions({ truckIds = [], loop, maxStepS = 15, maxFutureS = 300, now = () => Date.now() }) {
  const ids = new Set(truckIds);
  const state = new Map(); // truck_id -> { dist, lastMs, offset }
  const length = loop ? loop.cum[loop.cum.length - 1] : 0;

  return {
    covers: (truck_id) => Boolean(loop) && ids.has(truck_id),
    ids: () => (loop ? [...ids] : []),

    // Rewrites the position of one normalized point in place (points arrive oldest first).
    place(point) {
      if (!loop || !ids.has(point.truck_id)) return point;
      const t = parseTs(point.timestamp);
      // The store drops points stamped too far ahead; they must not move the truck either.
      if (t - now() > maxFutureS * 1000) return point;
      let s = state.get(point.truck_id);
      if (!s) {
        // Bench trucks start spread along the loop so two boards do not sit on top of each other.
        const offset = (([...ids].indexOf(point.truck_id) * length) / Math.max(1, ids.size)) % length;
        s = { dist: offset, lastMs: null };
        state.set(point.truck_id, s);
      }
      point.device_latitude = point.latitude;
      point.device_longitude = point.longitude;
      point.position_source = 'virtual_route';
      // A reading older than one already placed arrived out of order: where the truck was then
      // is not known, so it gets no position rather than a wrong one.
      if (s.lastMs != null && t < s.lastMs) {
        point.latitude = null;
        point.longitude = null;
        return point;
      }
      if (s.lastMs != null && t > s.lastMs && typeof point.speed === 'number' && point.speed > 0) {
        const dt = Math.min(maxStepS, (t - s.lastMs) / 1000);
        s.dist = (s.dist + (point.speed / 3.6) * dt) % length;
      }
      s.lastMs = t;
      const [lat, lng] = pointAlong(loop.path, loop.cum, s.dist);
      point.latitude = Math.round(lat * 1e6) / 1e6;
      point.longitude = Math.round(lng * 1e6) / 1e6;
      return point;
    },
  };
}
