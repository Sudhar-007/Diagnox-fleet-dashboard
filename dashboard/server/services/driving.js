import { closeDriving, stepDriving } from '../engine/driving.js';

// Driver behaviour events (rules.driver), RULE-BASED, in memory like trips: the newest
// `maxEvents` are kept. `onRecord(event)` is called with the stored event every time it is
// recorded or changes; the trip service attributes it to a trip (setting trip_id and that
// trip's driver) and returns the trip change to broadcast, or null.
// Changes are returned as { event, trip }.
export function createDrivingService({ rules, maxEvents = 2000, onRecord = () => null }) {
  const states = new Map(); // truck_id -> engine state
  const judgedAt = new Map(); // truck_id -> receive ms of the last point the engine accepted
  const openIds = new Map(); // `${truck_id}|${type}|${start_ms}` -> id of an event already shown
  const events = []; // oldest first
  const byId = new Map();
  let seq = 0;

  function record(truck_id, info, e) {
    const key = `${truck_id}|${e.type}|${e.start_ms}`;
    const id = openIds.get(key);
    if (!e.ongoing) openIds.delete(key);
    if (id && byId.has(id)) return Object.assign(byId.get(id), e);
    const event = {
      id: `E${++seq}`,
      truck_id,
      trip_id: null,
      // The registry driver now; replaced by the trip's driver when the event joins a trip.
      driver_id: info.driver_id ?? null,
      driver_name: info.driver_name ?? null,
      source: 'RULE_BASED',
      ...e,
    };
    if (e.ongoing) openIds.set(key, event.id);
    events.push(event);
    byId.set(event.id, event);
    while (events.length > maxEvents) byId.delete(events.shift().id);
    return event;
  }

  const change = (truck_id, info, e) => {
    const event = record(truck_id, info, e);
    const trip = onRecord(event);
    return { event: { ...event }, trip: trip ?? null };
  };

  return {
    // One point for one truck. `info`: { driver_id, driver_name }. Returns changes to broadcast.
    ingest(point, info = {}, receivedMs = Date.now()) {
      const id = point.truck_id;
      const before = states.get(id);
      const r = stepDriving(before, point, rules.driver, rules.trips.no_data_end_s * 1000);
      if (r.state === before) return [];
      states.set(id, r.state);
      judgedAt.set(id, receivedMs);
      return r.events.map((e) => change(id, info, e));
    },

    // Ends open events of trucks that have sent nothing usable for no_data_end_s (receive
    // time), long enough for a store-and-forward backlog to arrive and continue them.
    sweep(nowMs = Date.now(), infoFor = () => ({})) {
      const changes = [];
      for (const [id, s] of states) {
        if (Object.keys(s.open).length === 0) continue;
        if (nowMs - (judgedAt.get(id) ?? nowMs) <= rules.trips.no_data_end_s * 1000) continue;
        const r = closeDriving(s, rules.driver);
        states.set(id, r.state);
        for (const e of r.events) changes.push(change(id, infoFor(id), e));
      }
      return changes;
    },

    // Newest first by when they were first recorded.
    list({ truck_id, driver_id, limit = 500 } = {}) {
      const out = [];
      for (let i = events.length - 1; i >= 0 && out.length < limit; i--) {
        const e = events[i];
        if (truck_id && e.truck_id !== truck_id) continue;
        if (driver_id && e.driver_id !== driver_id) continue;
        out.push({ ...e });
      }
      return out;
    },
  };
}
