import { haversine } from './geo.js';
import { hasFix } from './geofence.js';
import { parseTs } from './time.js';

// Pure fuel tracking for one truck, one point at a time (rules.fuel).
//
// Level: a `fuel_level` reading (0 to 100 %) is used as is (source "sensor"). Without one, the
// level is ESTIMATED: it starts from a full tank at the first reading and burns
//   L/h = base_lph + load_factor x engine_load x (rpm / rpm_ref)
// while the engine runs (rpm > 0), integrated between readings at most maxGapS apart (a longer
// gap is not integrated: nothing is known about it). A sensor reading also resets the estimate,
// so a truck whose sensor drops out continues from its last known level.
// Consumption (used, idle, km/L) always comes from the burn model, so it is ESTIMATED for
// every truck.
//
// Anomalies, on sensor readings only (an estimate cannot drop or jump):
//   theft:  level drops by more than theft_drop_pct within anomaly_window_s while speed stays 0
//   refuel: level rises by more than refuel_rise_pct within anomaly_window_s while speed stays 0
// Both are judged on consecutive readings at 0 km/h and need 2 readings in a row past the limit
// (one could be a sensor glitch). An anomaly stays open while the level keeps moving the same
// way (and, for theft, the truck stays stopped); it ends after a window without further change,
// when the truck moves (theft), or when the opposite anomaly starts.
//
// Returns { state, events }: events are new or ended anomalies.

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export function burnRateLph(p, r) {
  if (!isNum(p.rpm) || p.rpm <= 0 || !isNum(p.engine_load)) return 0;
  return r.base_lph + r.load_factor * p.engine_load * (p.rpm / r.rpm_ref);
}

const sensorPct = (p) => (isNum(p.fuel_level) && p.fuel_level >= 0 && p.fuel_level <= 100 ? p.fuel_level : null);

function publicEvent(a, final, capacityL) {
  return {
    type: a.type,
    start_at: a.start.timestamp,
    start_ms: a.start_ms,
    end_at: a.end.timestamp,
    end_ms: a.end_ms,
    ongoing: !final,
    from_pct: a.from_pct,
    to_pct: a.to_pct,
    litres: Math.round((Math.abs(a.from_pct - a.to_pct) / 100) * capacityL * 10) / 10,
    latitude: hasFix(a.start) ? a.start.latitude : null,
    longitude: hasFix(a.start) ? a.start.longitude : null,
  };
}

export function stepFuel(state, p, { capacityL, rules, maxGapS, resetBackMs = 300_000 }) {
  const t = parseTs(p.timestamp);
  if (t == null) return { state, events: [] };
  if (state && t <= state.last_ms && state.last_ms - t <= resetBackMs) return { state, events: [] };

  const s = state
    ? { ...state }
    : { first_ms: t, first_at: p.timestamp, last_ms: null, last: null, est_l: capacityL, used_l: 0, idle_l: 0, dist_m: 0, sensor_ms: null, window: [], open: null, pending: null };
  const events = [];
  const windowMs = rules.anomaly_window_s * 1000;
  const closeOpen = () => {
    if (!s.open) return;
    events.push(publicEvent(s.open, true, capacityL));
    s.open = null;
  };

  if (state && t <= state.last_ms) {
    // The device clock jumped back (a reset): end what was open at its last reading and judge
    // from this point on, never across the jump.
    closeOpen();
    s.window = [];
    s.pending = null;
    s.last = null;
    s.last_ms = null;
    s.sensor_ms = null;
  }

  const prev = s.last;
  const dt = prev && t > s.last_ms ? (t - s.last_ms) / 1000 : null;
  if (dt != null && dt <= maxGapS) {
    const burn = (burnRateLph(prev, rules) * dt) / 3600;
    s.est_l = Math.max(0, s.est_l - burn);
    s.used_l += burn;
    if (prev.speed === 0) s.idle_l += burn;
    if (hasFix(prev) && hasFix(p)) s.dist_m += haversine(prev.latitude, prev.longitude, p.latitude, p.longitude);
  }
  s.est_l = Math.min(s.est_l, capacityL);

  // An open anomaly ends on any reading, with or without a level: a theft once the truck moves,
  // either kind after a window without further change.
  if (s.open && ((s.open.type === 'theft' && isNum(p.speed) && p.speed > 0) || t - s.open.moved_ms > windowMs)) closeOpen();

  const pct = sensorPct(p);
  if (pct == null) {
    s.pending = null;
  } else {
    s.est_l = (pct / 100) * capacityL;
    s.sensor_ms = t;
    const stopped = p.speed === 0;
    const reading = { t, pct, stopped, p };
    if (s.open) {
      const a = s.open;
      const further = a.type === 'theft' ? pct < a.to_pct && stopped : pct > a.to_pct;
      if (further) s.open = { ...a, to_pct: pct, end: p, end_ms: t, moved_ms: t };
    }

    s.window = [...s.window.filter((w) => t - w.t <= windowMs), reading];
    // Both anomalies happen standing still: judge the run of stopped readings up to now.
    const judge = () => {
      const run = [];
      for (let i = s.window.length - 1; i >= 0 && s.window[i].stopped; i--) run.push(s.window[i]);
      if (!run.length) return null;
      const high = run.reduce((m, w) => (w.pct >= m.pct ? w : m));
      const low = run.reduce((m, w) => (w.pct <= m.pct ? w : m));
      if (high.pct - pct > rules.theft_drop_pct) return { type: 'theft', from: high };
      if (pct - low.pct > rules.refuel_rise_pct) return { type: 'refuel', from: low };
      return null;
    };
    let candidate = judge();
    if (s.pending && candidate?.type !== s.pending.type) {
      // The previous reading was past the limit but this one does not agree: it was a glitch,
      // so it is dropped rather than judged against.
      const glitch = s.pending.t;
      s.window = s.window.filter((w) => w.t !== glitch);
      s.pending = null;
      candidate = judge();
    }

    if (!candidate || candidate.type === s.open?.type) {
      s.pending = null;
    } else if (!s.pending) {
      // One reading past the limit could be a sensor glitch: wait for the next to agree.
      s.pending = { type: candidate.type, t };
    } else {
      closeOpen();
      s.open = {
        type: candidate.type,
        start: candidate.from.p,
        start_ms: candidate.from.t,
        from_pct: candidate.from.pct,
        to_pct: pct,
        end: p,
        end_ms: t,
        moved_ms: t,
      };
      s.pending = null;
      // Later changes are judged from here, so the same change does not open twice.
      s.window = [reading];
      events.push(publicEvent(s.open, false, capacityL));
    }
  }

  s.last_ms = t;
  s.last = p;
  return { state: s, events };
}

// Ends an open anomaly of a truck that stopped reporting (called on a timer).
export function closeFuel(state, capacityL) {
  if (!state?.open) return { state, events: [] };
  return { state: { ...state, open: null, window: [] }, events: [publicEvent(state.open, true, capacityL)] };
}

// A refuel entered by the fleet manager: the estimate rises by the litres, up to a full tank.
export function addRefuel(state, litres, capacityL) {
  if (!state) return state;
  return { ...state, est_l: Math.min(capacityL, state.est_l + litres) };
}

// Public fuel summary of a truck. `sensor` is true when the newest reading carried fuel_level.
export function fuelSummary(state, capacityL) {
  if (!state) return null;
  const sensor = state.sensor_ms != null && state.sensor_ms === state.last_ms;
  const level_l = Math.min(state.est_l, capacityL);
  const round1 = (v) => Math.round(v * 10) / 10;
  return {
    source: sensor ? 'sensor' : 'estimate',
    level_pct: capacityL > 0 ? round1((level_l / capacityL) * 100) : null,
    level_l: round1(level_l),
    capacity_l: capacityL,
    used_l: round1(state.used_l),
    idle_l: round1(state.idle_l),
    distance_km: Math.round(state.dist_m / 10) / 100,
    km_per_l: state.used_l >= 1 ? Math.round((state.dist_m / 1000 / state.used_l) * 100) / 100 : null,
    since: state.first_at,
    updated_at: state.last?.timestamp ?? null,
  };
}
