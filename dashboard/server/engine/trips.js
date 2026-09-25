import { haversine } from './geo.js';
import { hasFix } from './geofence.js';
import { parseTs } from './time.js';

// Pure trip detection for one truck, one point at a time (rules.trips):
//   start: speed > start_speed_kmh on every reading for start_hold_s; the trip begins at the
//          first of those readings
//   end:   speed <= stop_speed_kmh (0) for longer than stop_hold_s (the trip ends when the truck
//          stopped), or no reading, or no reading with a speed, for no_data_end_s (it ends at
//          the last reading, or where it had stopped)
// A reading without a speed breaks a pending start but not a pending stop. Readings further
// apart than start_hold_s do not add up to a start. Points not newer than the last one judged
// are ignored, unless the clock jumped back by more than no_data_end_s (treated as a reset).
// Distance is the haversine sum between consecutive fixes.
//
// state: { last_ms, last, run, trip, stop }
// Returns { state, started: trip|null, ended: trip|null, updated: boolean }.

// Path rows kept per trip for replay; the order is part of the API.
export const PATH_FIELDS = ['t_ms', 'latitude', 'longitude', 'speed', 'rpm', 'engine_load', 'coolant_temp'];

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function newTrip(first, fromFirstReading) {
  return {
    // The truck was already moving when its history begins (server start): the real start is earlier.
    from_first_reading: fromFirstReading,
    start_ms: parseTs(first.timestamp),
    start_at: first.timestamp,
    start: first,
    last: null,
    last_fix: null,
    distance_m: 0,
    max_speed: 0,
    speed_sum: 0,
    samples: 0,
    path: [],
  };
}

function addPoint(trip, p) {
  if (hasFix(p)) {
    if (trip.last_fix) trip.distance_m += haversine(trip.last_fix.latitude, trip.last_fix.longitude, p.latitude, p.longitude);
    trip.last_fix = p;
  }
  if (isNum(p.speed)) {
    trip.max_speed = Math.max(trip.max_speed, p.speed);
    trip.speed_sum += p.speed;
    trip.samples += 1;
  }
  trip.last = p;
  trip.path.push(PATH_FIELDS.map((f) => (f === 't_ms' ? parseTs(p.timestamp) : isNum(p[f]) ? p[f] : null)));
}

// Everything needed to roll a trip back to the moment it stopped.
const snapshot = (trip) => ({
  last: trip.last,
  last_fix: trip.last_fix,
  distance_m: trip.distance_m,
  max_speed: trip.max_speed,
  speed_sum: trip.speed_sum,
  samples: trip.samples,
  path_len: trip.path.length,
});

function finish(trip, reason, stop) {
  const t = stop ? { ...trip, ...stop.snapshot, path: trip.path.slice(0, stop.snapshot.path_len) } : trip;
  return { ...t, end_ms: parseTs(t.last.timestamp), end_at: t.last.timestamp, end_reason: reason };
}

export function stepTrip(state, p, rules) {
  const s = state ?? { last_ms: null, last: null, run: null, trip: null, stop: null, speed_ms: null };
  const t = parseTs(p.timestamp);
  const unchanged = { state: s, started: null, ended: null, updated: false };
  if (t == null) return unchanged;

  const noDataMs = rules.no_data_end_s * 1000;
  let { run, trip, stop } = s;
  let speedMs = s.speed_ms ?? null;
  let ended = null;
  let started = null;
  let fresh = s.last_ms == null;

  if (s.last_ms != null && t <= s.last_ms) {
    // A late or repeated point is ignored. A clock that jumped back further than the
    // no-data limit is a reset: close the trip and judge from this point on.
    if (s.last_ms - t <= noDataMs) return unchanged;
    if (trip) ended = finish(trip, 'no_data', stop);
    trip = stop = run = speedMs = null;
    fresh = true;
  } else if (s.last_ms != null && t - s.last_ms > noDataMs) {
    // A long silence ends the trip at the last reading (or where it had stopped).
    if (trip) ended = finish(trip, 'no_data', stop);
    trip = stop = run = null;
  }

  const speed = isNum(p.speed) ? p.speed : null;
  if (speed != null) speedMs = t;

  if (!trip) {
    if (speed != null && speed > rules.start_speed_kmh) {
      // Readings further apart than the hold time are no evidence of continuous driving.
      if (run && t - run.last_ms > rules.start_hold_s * 1000) run = null;
      run = run
        ? { ...run, points: [...run.points, p], last_ms: t }
        : { start_ms: t, last_ms: t, points: [p], first: fresh };
      if (t - run.start_ms >= rules.start_hold_s * 1000) {
        trip = newTrip(run.points[0], run.first);
        for (const q of run.points) addPoint(trip, q);
        started = trip;
        run = null;
      }
    } else {
      run = null;
    }
  } else {
    addPoint(trip, p);
    // Only a moving reading cancels a pending stop; a reading without a speed leaves it running.
    if (speed != null && speed <= (rules.stop_speed_kmh ?? 0)) {
      if (!stop) stop = { since_ms: t, snapshot: snapshot(trip) };
    } else if (speed != null) {
      stop = null;
    }
    if (stop && t - stop.since_ms > rules.stop_hold_s * 1000) {
      ended = finish(trip, 'stopped', stop);
      trip = stop = null;
    } else if (speedMs == null || t - speedMs > noDataMs) {
      // Readings keep coming but none has a speed (e.g. ignition off, OBD silent).
      ended = finish(trip, 'no_data', stop);
      trip = stop = null;
    }
  }

  return { state: { last_ms: t, last: p, run, trip, stop, speed_ms: speedMs }, started, ended, updated: Boolean(trip) };
}

// Ends an active trip because the truck has gone silent (called on a timer).
export function expireTrip(state) {
  if (!state?.trip) return { state, ended: null };
  const ended = finish(state.trip, 'no_data', state.stop);
  return { state: { ...state, trip: null, stop: null, run: null }, ended };
}

// Public summary of an engine trip (no path).
export function summarize(trip) {
  const end_ms = trip.end_ms ?? parseTs(trip.last.timestamp);
  return {
    start_at: trip.start_at,
    start_ms: trip.start_ms,
    from_first_reading: trip.from_first_reading,
    end_at: trip.end_at ?? null,
    end_ms: trip.end_ms ?? null,
    end_reason: trip.end_reason ?? null,
    last_at: trip.last.timestamp,
    duration_s: Math.round((end_ms - trip.start_ms) / 1000),
    distance_km: Math.round(trip.distance_m / 10) / 100,
    max_speed: Math.round(trip.max_speed * 10) / 10,
    avg_speed: trip.samples ? Math.round((trip.speed_sum / trip.samples) * 10) / 10 : null,
    points: trip.path.length,
    start_position: hasFix(trip.start) ? { latitude: trip.start.latitude, longitude: trip.start.longitude } : null,
    end_position: trip.last_fix ? { latitude: trip.last_fix.latitude, longitude: trip.last_fix.longitude } : null,
  };
}
