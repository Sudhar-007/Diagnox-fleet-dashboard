import { hasFix } from './geofence.js';
import { parseTs } from './time.js';

// Pure driver behaviour events for one truck, one point at a time (rules.driver). Only
// consecutive readings no more than max_gap_s apart, both with a numeric speed, are judged:
//   harsh_accel / harsh_brake: speed change per second above harsh_accel_kmh_s / below
//                              -harsh_brake_kmh_s; consecutive qualifying pairs are one event
//   overspeed: speed above overspeed_kmh, until the first reading back at or under it
//   idling:    speed 0 with rpm > 0 for longer than idle_min_s, until the first other reading
// A gap closes every open event at its last reading. Points not newer than the last one are
// ignored, unless the clock jumped back by more than resetBackMs (a reset).
//
// state: { last_ms, last, open: { [type]: episode } }
// Returns { state, events } where events are public event objects that are new or changed:
// harsh events once they end; overspeed and idling when they start counting, after every
// further full minute, and when they end.

export const EVENT_TYPES = ['harsh_brake', 'harsh_accel', 'overspeed', 'idling'];

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const round1 = (v) => Math.round(v * 10) / 10;

// Points a harsh event costs. Overspeed and idling are charged per trip on their total time
// (see scoreTrip), so a truck hovering around the limit is not charged a minute per crossing.
export function costOf(type, rules) {
  if (type === 'harsh_brake') return rules.points.harsh_brake;
  if (type === 'harsh_accel') return rules.points.harsh_accel;
  return null;
}

// Whole minutes charged for a total time, at least one when there is any.
export const chargedMinutes = (seconds) => (seconds > 0 ? Math.max(1, Math.floor(seconds / 60)) : 0);

function publicEvent(ep, final, rules) {
  const duration_s = Math.round((ep.end_ms - ep.start_ms) / 1000);
  return {
    type: ep.type,
    start_at: ep.start.timestamp,
    start_ms: ep.start_ms,
    end_at: ep.end.timestamp,
    end_ms: ep.end_ms,
    duration_s,
    ongoing: !final,
    // km/h per second for harsh events, highest speed for overspeed, null for idling.
    peak: ep.peak == null ? null : round1(ep.peak),
    speed_from: isNum(ep.start.speed) ? ep.start.speed : null,
    speed_to: isNum(ep.end.speed) ? ep.end.speed : null,
    latitude: hasFix(ep.start) ? ep.start.latitude : null,
    longitude: hasFix(ep.start) ? ep.start.longitude : null,
    points: costOf(ep.type, rules),
  };
}

// Whether an open episode counts yet (is worth showing).
function counts(ep, rules) {
  if (ep.type === 'idling') return ep.end_ms - ep.start_ms > rules.idle_min_s * 1000;
  if (ep.type === 'overspeed') return ep.end_ms > ep.start_ms;
  return true;
}

export function stepDriving(state, p, rules, resetBackMs = 300_000) {
  const s = state ?? { last_ms: null, last: null, open: {} };
  const t = parseTs(p.timestamp);
  if (t == null || (s.last_ms != null && t <= s.last_ms && s.last_ms - t <= resetBackMs)) return { state: s, events: [] };

  const open = { ...s.open };
  const events = [];
  const close = (type, end) => {
    const ep = open[type];
    if (!ep) return;
    delete open[type];
    if (end) ep.end = end;
    ep.end_ms = parseTs(ep.end.timestamp);
    if (counts(ep, rules)) events.push(publicEvent(ep, true, rules));
  };

  const prev = s.last;
  const dt = prev && t > s.last_ms ? (t - s.last_ms) / 1000 : null;
  const paired = dt != null && dt <= rules.max_gap_s && isNum(prev.speed) && isNum(p.speed);

  if (!paired) {
    // No evidence across a gap (or a reset): everything open ends at its last reading.
    for (const type of Object.keys(open)) close(type, null);
  } else {
    const rate = (p.speed - prev.speed) / dt;
    for (const [type, hit] of [
      ['harsh_accel', rate > rules.harsh_accel_kmh_s],
      ['harsh_brake', rate < -rules.harsh_brake_kmh_s],
    ]) {
      if (hit) {
        const ep = open[type] ?? { type, start: prev, start_ms: s.last_ms, peak: 0 };
        open[type] = { ...ep, end: p, end_ms: t, peak: Math.max(ep.peak, Math.abs(rate)) };
      } else {
        close(type, null);
      }
    }
  }

  // Overspeed and idling hold across paired readings; the first reading out of the state ends
  // them (and counts toward their duration).
  const moving = isNum(p.speed);
  const over = moving && p.speed > rules.overspeed_kmh;
  const idle = moving && p.speed === 0 && isNum(p.rpm) && p.rpm > 0;
  for (const [type, hit, peak] of [
    ['overspeed', over, over ? p.speed : null],
    ['idling', idle, null],
  ]) {
    const ep = open[type];
    if (hit) {
      const next = ep
        ? { ...ep, end: p, end_ms: t, peak: peak == null ? null : Math.max(ep.peak, peak) }
        : { type, start: p, start_ms: t, end: p, end_ms: t, peak, notified: false, sent_min: 0 };
      const minutes = Math.floor((next.end_ms - next.start_ms) / 60_000);
      if (counts(next, rules) && (!next.notified || minutes > next.sent_min)) {
        next.notified = true;
        next.sent_min = minutes;
        events.push(publicEvent(next, false, rules));
      }
      open[type] = next;
    } else if (ep) {
      close(type, paired ? p : null);
    }
  }

  return { state: { last_ms: t, last: p, open }, events };
}

// Ends every open event of a truck that stopped reporting (called on a timer). The next
// reading is not paired with the last one, so a resumption starts new events.
export function closeDriving(state, rules) {
  if (!state || Object.keys(state.open).length === 0) return { state, events: [] };
  const events = [];
  for (const ep of Object.values(state.open)) {
    const done = { ...ep, end_ms: parseTs(ep.end.timestamp) };
    if (counts(done, rules)) events.push(publicEvent(done, true, rules));
  }
  return { state: { ...state, last: null, open: {} }, events };
}

// Score of one trip from the events attributed to it: harsh events at their fixed cost,
// overspeed and idling per whole minute of their total time in the trip (at least one).
// rated is false when the readings are on average further apart than max_gap_s: events
// cannot be detected, so no score is given rather than a perfect one.
export function scoreTrip(trip, own, rules) {
  const spanS = ((trip.end_ms ?? parseTs(trip.last_at)) - trip.start_ms) / 1000;
  const rated = trip.points < 2 || spanS / (trip.points - 1) <= rules.max_gap_s;
  const deductions = EVENT_TYPES.map((type) => {
    const list = own.filter((e) => e.type === type);
    const timed = type === 'overspeed' || type === 'idling';
    const seconds = list.reduce((sum, e) => sum + e.duration_s, 0);
    const minutes = timed ? chargedMinutes(seconds) : null;
    const perMin = type === 'overspeed' ? rules.points.overspeed_per_min : rules.points.idle_per_min;
    return {
      type,
      count: list.length,
      seconds: timed ? seconds : null,
      minutes,
      points: timed ? minutes * perMin : list.reduce((sum, e) => sum + e.points, 0),
    };
  }).filter((d) => d.count > 0);
  const lost = deductions.reduce((sum, d) => sum + d.points, 0);
  return {
    score: rated ? Math.max(0, rules.start_score - lost) : null,
    rated,
    events: own.length,
    deductions,
  };
}
