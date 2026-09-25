import { create } from 'zustand';

import { TRAIL_POINTS } from '../config.js';
import { isValidPosition } from '../lib/position.js';

// Socket updates are buffered and merged on a fixed 500 ms tick, so the UI
// re-renders at most twice per second regardless of how many trucks report.
const FLUSH_MS = 500;
const pending = new Map();
// Every position received is kept for trails, even when two updates for a truck land in one flush.
const pendingTrail = new Map();
let pendingOffsetMs = null;

const toTrailPoint = (p) => ({ lat: p.latitude, lng: p.longitude, timestamp: p.timestamp });

// Merge points into a trail, ordered by timestamp, deduped, capped to the last TRAIL_POINTS.
function mergeTrail(existing = [], incoming = []) {
  const byTs = new Map(existing.map((p) => [p.timestamp, p]));
  for (const p of incoming) {
    if (isValidPosition(p.lat, p.lng)) byTs.set(p.timestamp, p);
  }
  const merged = [...byTs.values()].sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1));
  return merged.slice(-TRAIL_POINTS);
}
let ticker = null;

export const useFleetStore = create((set) => ({
  trucks: {},
  trails: {},
  freshnessRules: null,
  healthRules: null,
  clockOffsetMs: 0,
  connection: 'connecting',
  syncError: null,
  now: Date.now(),

  // `requestedAt` is the client time the snapshot request was sent; the server
  // time is assumed to be halfway through the round trip.
  applySnapshot({ server_time, freshness, health_rules, trucks }, requestedAt = Date.now()) {
    const now = Date.now();
    const snapshot = Object.fromEntries(trucks.map((t) => [t.truck_id, t]));
    // Socket updates that arrived while the request was in flight may be newer than the snapshot.
    for (const [id, p] of pending) {
      if (!snapshot[id] || p.received_at > snapshot[id].received_at) snapshot[id] = p;
    }
    pending.clear();
    // Trails are rebuilt from history after every resync, so a restarted server
    // cannot leave stale points joined to new ones.
    pendingTrail.clear();
    set({
      trucks: snapshot,
      trails: {},
      freshnessRules: freshness,
      healthRules: health_rules,
      clockOffsetMs: server_time - (requestedAt + now) / 2,
      syncError: null,
      now,
    });
  },
  // History fetched after a (re)connect, so trails are not empty on first load.
  seedTrail(truck_id, points) {
    set((s) => ({ trails: { ...s.trails, [truck_id]: mergeTrail(s.trails[truck_id], points.map(toTrailPoint)) } }));
  },
  setConnection: (connection) => set({ connection }),
  setSyncError: (syncError) => set({ syncError }),
}));

export function queueTruckUpdate(payload) {
  pending.set(payload.truck_id, payload);
  const trail = pendingTrail.get(payload.truck_id) ?? [];
  trail.push(toTrailPoint(payload));
  pendingTrail.set(payload.truck_id, trail);
  if (payload.server_time) pendingOffsetMs = payload.server_time - Date.now();
}

function flush() {
  const now = Date.now();
  if (pending.size === 0 && pendingTrail.size === 0) {
    useFleetStore.setState({ now });
    return;
  }
  const batch = Object.fromEntries(pending);
  const trailBatch = [...pendingTrail];
  pending.clear();
  pendingTrail.clear();
  const offset = pendingOffsetMs;
  pendingOffsetMs = null;
  useFleetStore.setState((s) => {
    const trails = { ...s.trails };
    for (const [id, pts] of trailBatch) trails[id] = mergeTrail(trails[id], pts);
    return {
      trucks: { ...s.trucks, ...batch },
      trails,
      clockOffsetMs: offset ?? s.clockOffsetMs,
      now,
    };
  });
}

export function startFlushing() {
  if (!ticker) ticker = setInterval(flush, FLUSH_MS);
  return () => {
    clearInterval(ticker);
    ticker = null;
  };
}
