import { parseTsMs } from './time.js';

// Trips newest first, optionally for one truck and/or status.
export function sortedTrips(trips, { truck_id, status } = {}) {
  return Object.values(trips ?? {})
    .filter((t) => (!truck_id || t.truck_id === truck_id) && (!status || t.status === status))
    .sort((a, b) => b.start_ms - a.start_ms);
}

// Where a trip started or ended: the zone name, or the coordinates.
export function placeText(zone, position) {
  if (zone) return zone;
  if (!position) return 'Unknown';
  return `${position.latitude.toFixed(4)}, ${position.longitude.toFixed(4)}`;
}

// "20:28" for today, "24 Sep 20:28" otherwise.
export function startText(timestamp, nowMs) {
  const ms = parseTsMs(timestamp);
  if (ms == null) return '';
  const d = new Date(ms);
  const time = timestamp.slice(11, 16);
  if (new Date(nowMs).toDateString() === d.toDateString()) return time;
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${time}`;
}

// Links each planned assignment to the truck's first detected trip that starts no earlier
// than `earlyS` before the planned start (each trip used once, earliest plans first).
// Returns Map(assignment id -> { trip, state }) with state:
//   'on_road' | 'done' (linked trip running / finished), 'upcoming' (planned start ahead),
//   'late' (planned start passed, no trip yet).
export function linkAssignments(assignments, trips, earlyS, nowMs) {
  const used = new Set();
  const out = new Map();
  const byPlan = [...assignments].sort((a, b) => a.planned_start.localeCompare(b.planned_start));
  for (const a of byPlan) {
    const planned = parseTsMs(a.planned_start);
    const trip = Object.values(trips ?? {})
      .filter((t) => t.truck_id === a.truck_id && !used.has(t.id) && t.start_ms >= planned - earlyS * 1000)
      .sort((x, y) => x.start_ms - y.start_ms)[0];
    if (trip) {
      used.add(trip.id);
      out.set(a.id, { trip, state: trip.status === 'active' ? 'on_road' : 'done' });
    } else {
      out.set(a.id, { trip: null, state: planned > nowMs ? 'upcoming' : 'late', late_s: Math.max(0, (nowMs - planned) / 1000) });
    }
  }
  return out;
}
