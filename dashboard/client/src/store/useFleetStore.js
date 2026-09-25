import { create } from 'zustand';

import { TRAIL_POINTS } from '../config.js';
import { isValidPosition } from '../lib/position.js';

// Socket updates are buffered and merged on a fixed 500 ms tick, so the UI
// re-renders at most twice per second regardless of how many trucks report.
const FLUSH_MS = 500;
const pending = new Map();
// Every position received is kept for trails, even when two updates for a truck land in one flush.
const pendingTrail = new Map();
// Alert changes: latest copy per alert id, plus every event in arrival order.
const pendingAlerts = new Map();
const pendingEvents = [];
let pendingOffsetMs = null;

const EVENT_LIMIT = 500;
const RESOLVED_LIMIT = 1000;

// Every live alert change seen since the current resync started. The REST snapshot may
// have been built before some of them, and the flush may already have applied (and
// forgotten) them, so they are replayed on top of the snapshot.
let resyncLive = null;

export function beginAlertResync() {
  pendingAlerts.clear();
  pendingEvents.length = 0;
  resyncLive = { alerts: new Map(), events: [] };
}

// Open alerts are always kept; resolved ones are capped like on the server.
function capAlerts(byId) {
  const resolved = Object.values(byId).filter((a) => a.status === 'RESOLVED');
  if (resolved.length <= RESOLVED_LIMIT) return byId;
  resolved.sort((a, b) => a.resolved_ms - b.resolved_ms);
  const out = { ...byId };
  for (const a of resolved.slice(0, resolved.length - RESOLVED_LIMIT)) delete out[a.id];
  return out;
}

// Keep the newer copy of an alert; `version` increases on every server-side change.
function newer(existing, incoming) {
  return !existing || (incoming.version ?? 0) > (existing.version ?? 0);
}

// Newest first, one entry per event id. The same event can arrive twice
// (the PATCH response and the socket broadcast), even within one batch.
function mergeEvents(existing, incoming) {
  if (incoming.length === 0) return existing;
  const byId = new Map(existing.map((e) => [e.id, e]));
  let added = false;
  for (const e of incoming) {
    if (!byId.has(e.id)) {
      byId.set(e.id, e);
      added = true;
    }
  }
  if (!added) return existing;
  return [...byId.values()].sort((a, b) => b.at_ms - a.at_ms).slice(0, EVENT_LIMIT);
}

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
  alerts: {},
  alertEvents: [],
  alertsLoaded: false,
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
  // Full alert list + recent events after a (re)connect. Live changes still
  // queued win when they are newer.
  applyAlerts({ alerts, events }) {
    const byId = Object.fromEntries(alerts.map((a) => [a.id, a]));
    const live = resyncLive ?? { alerts: new Map(), events: [] };
    resyncLive = null;
    for (const [id, a] of live.alerts) if (newer(byId[id], a)) byId[id] = a;
    for (const [id, a] of pendingAlerts) if (newer(byId[id], a)) byId[id] = a;
    pendingAlerts.clear();
    const merged = mergeEvents([], [...events, ...live.events, ...pendingEvents]);
    pendingEvents.length = 0;
    set({ alerts: capAlerts(byId), alertEvents: merged, alertsLoaded: true });
  },
  setConnection: (connection) => set({ connection }),
  setSyncError: (syncError) => set({ syncError }),
}));

export function queueAlertChange({ alert, event }) {
  if (alert && newer(pendingAlerts.get(alert.id), alert)) pendingAlerts.set(alert.id, alert);
  if (event) pendingEvents.push(event);
  if (resyncLive) {
    if (alert && newer(resyncLive.alerts.get(alert.id), alert)) resyncLive.alerts.set(alert.id, alert);
    if (event) resyncLive.events.push(event);
  }
}

export function queueTruckUpdate(payload) {
  pending.set(payload.truck_id, payload);
  const trail = pendingTrail.get(payload.truck_id) ?? [];
  trail.push(toTrailPoint(payload));
  pendingTrail.set(payload.truck_id, trail);
  if (payload.server_time) pendingOffsetMs = payload.server_time - Date.now();
}

function flush() {
  const now = Date.now();
  if (pending.size === 0 && pendingTrail.size === 0 && pendingAlerts.size === 0 && pendingEvents.length === 0) {
    useFleetStore.setState({ now });
    return;
  }
  const batch = Object.fromEntries(pending);
  const trailBatch = [...pendingTrail];
  const alertBatch = [...pendingAlerts.values()];
  const eventBatch = pendingEvents.splice(0);
  pending.clear();
  pendingTrail.clear();
  pendingAlerts.clear();
  const offset = pendingOffsetMs;
  pendingOffsetMs = null;
  useFleetStore.setState((s) => {
    const trails = { ...s.trails };
    for (const [id, pts] of trailBatch) trails[id] = mergeTrail(trails[id], pts);
    let alerts = s.alerts;
    if (alertBatch.length) {
      alerts = { ...s.alerts };
      for (const a of alertBatch) if (newer(alerts[a.id], a)) alerts[a.id] = a;
      alerts = capAlerts(alerts);
    }
    return {
      alerts,
      alertEvents: mergeEvents(s.alertEvents, eventBatch),
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
