import { distanceM } from '../engine/geofence.js';
import { PATH_FIELDS, expireTrip, stepTrip, summarize } from '../engine/trips.js';
import { parseTs } from '../engine/time.js';

// Trips detected from telemetry, in memory (like the ring buffer, they reset on restart).
// Completed trips keep their path for replay; only the newest `maxPaths` paths are kept.
//
// Changes are returned as { trip } (summary, no path) for broadcasting: when a trip starts,
// when it ends, and every `emitEveryMs` of telemetry while it runs.
export function createTripService({
  rules,
  zones = () => [],
  // truck_id -> that truck's alerts [{ id, kind, name, level, opened_at }], oldest first
  alertsFor = () => [],
  maxTrips = 500,
  maxPaths = 100,
  emitEveryMs = 5000,
}) {
  const states = new Map(); // truck_id -> engine state
  const meta = new Map(); // truck_id -> { id, truck_id, driver_name, provenance, from_zone } of the active trip
  const lastEmitMs = new Map(); // truck_id -> telemetry ms of the last broadcast for the active trip
  const judgedAt = new Map(); // truck_id -> receive ms of the last point the engine accepted
  const completed = []; // oldest first
  const paths = new Map(); // trip id -> path rows, insertion ordered
  let seq = 0;

  // Name of the first zone containing a position, for "from / to".
  const zoneAt = (pos) => (pos ? zones().find((z) => distanceM(z, pos.latitude, pos.longitude) <= z.radius_m)?.name ?? null : null);

  // Alerts opened during the trip (telemetry time). `cache` shares one lookup per truck.
  const withAlerts = (trip, cache = null) => {
    let own = cache?.get(trip.truck_id);
    if (!own) {
      own = alertsFor(trip.truck_id);
      cache?.set(trip.truck_id, own);
    }
    const alerts = own.filter((a) => a.opened_at >= trip.start_at && (!trip.end_at || a.opened_at <= trip.end_at));
    return { ...trip, alerts };
  };
  // Broadcast copy: a trip that just started, ran or ended always has its path.
  const change = (trip) => ({ trip: { ...withAlerts(trip), has_path: true } });

  function activeTrip(truck_id) {
    const s = states.get(truck_id);
    if (!s?.trip || !meta.has(truck_id)) return null;
    return { ...meta.get(truck_id), status: 'active', ...summarize(s.trip), to_zone: null };
  }

  function complete(truck_id, ended) {
    // Meta is missing only if recording the start failed; keep the trip anyway.
    const m = meta.get(truck_id) ?? { id: `T${++seq}`, truck_id, driver_name: null, provenance: null, from_zone: null };
    meta.delete(truck_id);
    lastEmitMs.delete(truck_id);
    const summary = summarize(ended);
    const trip = { ...m, status: 'completed', ...summary, to_zone: zoneAt(summary.end_position) };
    completed.push(trip);
    paths.set(trip.id, ended.path);
    while (completed.length > maxTrips) paths.delete(completed.shift().id);
    while (paths.size > maxPaths) paths.delete(paths.keys().next().value);
    return trip;
  }

  function start(truck_id, started, info) {
    const summary = summarize(started);
    meta.set(truck_id, {
      id: `T${++seq}`,
      truck_id,
      driver_name: info.driver_name ?? null,
      provenance: info.provenance ?? null,
      from_zone: zoneAt(summary.start_position),
    });
    lastEmitMs.set(truck_id, started.start_ms);
  }

  return {
    // One point for one truck. `info`: { driver_name, provenance }. Returns changes to broadcast.
    ingest(point, info = {}, receivedMs = Date.now()) {
      const id = point.truck_id;
      const before = states.get(id);
      const r = stepTrip(before, point, rules.trips);
      if (r.state === before) return [];
      states.set(id, r.state);
      judgedAt.set(id, receivedMs);
      const changes = [];
      if (r.ended) changes.push(change(complete(id, r.ended)));
      if (r.started) {
        start(id, r.started, info);
        changes.push(change(activeTrip(id)));
      } else if (r.state.trip && meta.has(id)) {
        const t = parseTs(point.timestamp);
        if (t - (lastEmitMs.get(id) ?? -Infinity) >= emitEveryMs) {
          lastEmitMs.set(id, t);
          changes.push(change(activeTrip(id)));
        }
      }
      return changes;
    },

    // Ends trips of trucks that have sent nothing usable for no_data_end_s: measured from when
    // the last point the engine accepted was received, so ignored (late) points do not count.
    sweep(nowMs = Date.now()) {
      const changes = [];
      for (const [id, s] of states) {
        if (!s.trip) continue;
        const received = judgedAt.get(id);
        if (received == null || nowMs - received <= rules.trips.no_data_end_s * 1000) continue;
        const r = expireTrip(s);
        states.set(id, r.state);
        changes.push(change(complete(id, r.ended)));
      }
      return changes;
    },

    // Newest first. status: 'active' | 'completed' | undefined (both).
    list({ truck_id, status, limit = 200 } = {}) {
      let out = [];
      if (status !== 'completed') out.push(...[...meta.keys()].map(activeTrip).filter(Boolean));
      if (status !== 'active') out.push(...completed);
      if (truck_id) out = out.filter((t) => t.truck_id === truck_id);
      out.sort((a, b) => b.start_ms - a.start_ms);
      const cache = new Map();
      return out.slice(0, limit).map((t) => ({ ...withAlerts(t, cache), has_path: t.status === 'active' || paths.has(t.id) }));
    },

    // One trip with its path ({ fields, rows }), or null for an unknown id. path is null when
    // it is no longer kept.
    get(id) {
      const active = [...meta.values()].find((m) => m.id === id);
      if (active) {
        const s = states.get(active.truck_id);
        return { ...withAlerts(activeTrip(active.truck_id)), path: { fields: PATH_FIELDS, rows: s.trip.path } };
      }
      const trip = completed.find((t) => t.id === id);
      if (!trip) return null;
      const rows = paths.get(id);
      return { ...withAlerts(trip), path: rows ? { fields: PATH_FIELDS, rows } : null };
    },
  };
}
