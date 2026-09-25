import { create } from 'zustand';

// Socket updates are buffered and merged on a fixed 500 ms tick, so the UI
// re-renders at most twice per second regardless of how many trucks report.
const FLUSH_MS = 500;
const pending = new Map();
let pendingOffsetMs = null;
let ticker = null;

export const useFleetStore = create((set) => ({
  trucks: {},
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
    set({
      trucks: snapshot,
      freshnessRules: freshness,
      healthRules: health_rules,
      clockOffsetMs: server_time - (requestedAt + now) / 2,
      syncError: null,
      now,
    });
  },
  setConnection: (connection) => set({ connection }),
  setSyncError: (syncError) => set({ syncError }),
}));

export function queueTruckUpdate(payload) {
  pending.set(payload.truck_id, payload);
  if (payload.server_time) pendingOffsetMs = payload.server_time - Date.now();
}

function flush() {
  const now = Date.now();
  if (pending.size === 0) {
    useFleetStore.setState({ now });
    return;
  }
  const batch = Object.fromEntries(pending);
  pending.clear();
  const offset = pendingOffsetMs;
  pendingOffsetMs = null;
  useFleetStore.setState((s) => ({
    trucks: { ...s.trucks, ...batch },
    clockOffsetMs: offset ?? s.clockOffsetMs,
    now,
  }));
}

export function startFlushing() {
  if (!ticker) ticker = setInterval(flush, FLUSH_MS);
  return () => {
    clearInterval(ticker);
    ticker = null;
  };
}
