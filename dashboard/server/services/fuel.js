import { addRefuel, closeFuel, fuelSummary, stepFuel } from '../engine/fuel.js';
import { parseTs } from '../engine/time.js';

// Fuel level, consumption and anomalies per truck (rules.fuel), in memory: they restart with
// the server (the estimate starts from a full tank again). `capacityOf(truck_id)` gives the
// registry tank size in litres. Changes are returned as { event } for broadcasting.
export function createFuelService({ rules, capacityOf, maxEvents = 500, maxSamples = 480 }) {
  const states = new Map(); // truck_id -> engine state
  const judgedAt = new Map(); // truck_id -> receive ms of the last point the engine accepted
  const samples = new Map(); // truck_id -> [[t_ms, level_pct, source, used_l, distance_km]] oldest first
  const openIds = new Map(); // `${truck_id}|${type}|${start_ms}` -> id of an open anomaly
  const events = []; // oldest first
  const byId = new Map();
  let seq = 0;

  const ctx = (truck_id) => ({
    capacityL: capacityOf(truck_id),
    rules: rules.fuel,
    // Readings further apart than the stale time are not integrated.
    maxGapS: rules.freshness.stale_after_s,
    resetBackMs: rules.trips.no_data_end_s * 1000,
  });

  function record(truck_id, info, e) {
    const key = `${truck_id}|${e.type}|${e.start_ms}`;
    const id = openIds.get(key);
    if (!e.ongoing) openIds.delete(key);
    if (id && byId.has(id)) return { event: { ...Object.assign(byId.get(id), e) } };
    const event = {
      id: `F${++seq}`,
      truck_id,
      driver_id: info.driver_id ?? null,
      driver_name: info.driver_name ?? null,
      source: 'RULE_BASED',
      ...e,
    };
    if (e.ongoing) openIds.set(key, event.id);
    events.push(event);
    byId.set(event.id, event);
    while (events.length > maxEvents) byId.delete(events.shift().id);
    return { event: { ...event } };
  }

  function sample(truck_id, state) {
    const list = samples.get(truck_id) ?? [];
    const last = list[list.length - 1];
    // After a device clock reset the trend starts again rather than running backwards.
    if (last && state.last_ms < last[0]) list.length = 0;
    else if (last && state.last_ms - last[0] < rules.fuel.sample_every_s * 1000) return;
    const s = fuelSummary(state, capacityOf(truck_id));
    // The trend keeps 0.01 % so a slow burn draws a line, not 0.1 % steps.
    const cap = capacityOf(truck_id);
    const pct = cap > 0 ? Math.round((Math.min(state.est_l, cap) / cap) * 10000) / 100 : null;
    list.push([state.last_ms, pct, s.source, s.used_l, s.distance_km]);
    while (list.length > maxSamples) list.shift();
    samples.set(truck_id, list);
  }

  return {
    // One point for one truck. `info`: { driver_id, driver_name }. Returns changes to broadcast.
    ingest(point, info = {}, receivedMs = Date.now()) {
      const id = point.truck_id;
      const before = states.get(id);
      const r = stepFuel(before, point, ctx(id));
      if (r.state === before) return [];
      states.set(id, r.state);
      judgedAt.set(id, receivedMs);
      sample(id, r.state);
      return r.events.map((e) => record(id, info, e));
    },

    // Ends open anomalies of trucks that have sent nothing for no_data_end_s (receive time).
    sweep(nowMs = Date.now(), infoFor = () => ({})) {
      const changes = [];
      for (const [id, s] of states) {
        if (!s.open || nowMs - (judgedAt.get(id) ?? nowMs) <= rules.trips.no_data_end_s * 1000) continue;
        const r = closeFuel(s, capacityOf(id));
        states.set(id, r.state);
        for (const e of r.events) changes.push(record(id, infoFor(id), e));
      }
      return changes;
    },

    // A manager refuel: raises the estimate if it happened after tracking began (a refuel from
    // before then is already in the full tank the estimate started from), up to a full tank now.
    // A measured level is left alone. Returns true if applied.
    refuel(truck_id, litres, at) {
      const s = states.get(truck_id);
      const atMs = parseTs(at);
      if (!s || atMs == null || atMs < s.first_ms) return false;
      if (fuelSummary(s, capacityOf(truck_id)).source === 'sensor') return false;
      states.set(truck_id, addRefuel(s, litres, capacityOf(truck_id)));
      return true;
    },

    of: (truck_id) => fuelSummary(states.get(truck_id), capacityOf(truck_id)),
    list: () => [...states.keys()].sort().map((id) => ({ truck_id: id, ...fuelSummary(states.get(id), capacityOf(id)) })),
    history: (truck_id) => (states.has(truck_id) ? samples.get(truck_id) ?? [] : null),

    // Newest first by when they were first recorded.
    events({ truck_id, limit = 200 } = {}) {
      const out = [];
      for (let i = events.length - 1; i >= 0 && out.length < limit; i--) {
        if (!truck_id || events[i].truck_id === truck_id) out.push({ ...events[i] });
      }
      return out;
    },
  };
}
