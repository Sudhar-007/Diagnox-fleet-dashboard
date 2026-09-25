import { parseTs } from '../engine/time.js';

// In-memory ring buffer per truck. Dedupes on (truck_id, timestamp) and keeps points ordered.
// Points stamped further ahead than maxFutureS are rejected: a device with an unset clock
// would otherwise pin "latest" to that point forever.
export function createStore({ capacity = 5000, maxFutureS = Infinity } = {}) {
  const trucks = new Map();

  function record(truck_id) {
    let r = trucks.get(truck_id);
    if (!r) {
      r = { points: [], seen: new Set(), received_at: null, provenance: null };
      trucks.set(truck_id, r);
    }
    return r;
  }

  function ingest(point, { provenance, receivedAt }) {
    if (!point || typeof point !== 'object') return false;
    const t = parseTs(point.timestamp);
    if (!point.truck_id || t == null) return false;
    if (t - receivedAt > maxFutureS * 1000) return false;
    const r = record(point.truck_id);
    if (r.seen.has(point.timestamp)) return false;
    // Full ring and older than everything held: it would be evicted immediately.
    if (r.points.length >= capacity && t < r.points[0]._t) return false;

    const entry = { ...point, _t: t };
    const last = r.points[r.points.length - 1];
    if (!last || last._t <= t) {
      r.points.push(entry);
    } else {
      const idx = r.points.findIndex((p) => p._t > t);
      r.points.splice(idx, 0, entry);
    }
    r.seen.add(point.timestamp);

    while (r.points.length > capacity) {
      const evicted = r.points.shift();
      r.seen.delete(evicted.timestamp);
    }

    r.received_at = receivedAt;
    r.provenance = provenance;
    return true;
  }

  const strip = ({ _t, ...p }) => p;

  return {
    ingest,
    truckIds: () => [...trucks.keys()].sort(),
    latest(truck_id) {
      const r = trucks.get(truck_id);
      return r && r.points.length ? strip(r.points[r.points.length - 1]) : null;
    },
    oldest(truck_id) {
      const r = trucks.get(truck_id);
      return r && r.points.length ? strip(r.points[0]) : null;
    },
    meta(truck_id) {
      const r = trucks.get(truck_id);
      return r ? { received_at: r.received_at, provenance: r.provenance, points: r.points.length } : null;
    },
    // Raw points ascending, optionally bounded by epoch ms.
    history(truck_id, { fromMs = -Infinity, toMs = Infinity, limit } = {}) {
      const r = trucks.get(truck_id);
      if (!r) return [];
      let pts = r.points.filter((p) => p._t >= fromMs && p._t <= toMs);
      if (limit && pts.length > limit) pts = pts.slice(pts.length - limit);
      return pts.map(strip);
    },
  };
}
