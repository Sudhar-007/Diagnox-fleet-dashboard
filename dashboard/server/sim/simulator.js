import { DEFAULT_TANK_CAPACITY_L } from '../config/fleet.js';
import { rules } from '../config/rules.js';
import { burnRateLph } from '../engine/fuel.js';
import { haversine, lerp } from '../engine/geo.js';
import { formatTs } from '../engine/time.js';

// Deterministic PRNG so a restart replays the same behaviour.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round = (v, dp) => Math.round(v * 10 ** dp) / 10 ** dp;

// Kept well inside the harsh-event thresholds so normal driving never trips them.
const ACCEL_KMH_S = 2;
const DECEL_KMH_S = 3;
const STOP_DECEL_MS2 = 0.8;
const CORNER_KMH = 20;
const CREEP_KMH = 5;
const ARRIVE_KMH = 8;
const IDLE_RPM = 750;
const ENGINE_OFF_AFTER_S = 20;
const ENGINE_OFF_DWELL_S = 120;

// Simulated trucks fitted with a fuel level sensor: they send fuel_level, burning at the same
// rate as the dashboard's estimate. The others send none, so the dashboard estimates theirs.
export const FUEL_SENSOR_TRUCKS = ['TN01'];
// Demo values: a sensor truck starts full and, below REFILL_BELOW_PCT, is refilled during a long
// depot stop at REFILL_PCT_S (about 1.5 L/s on a 300 L tank).
const REFILL_BELOW_PCT = 25;
const REFILL_PCT_S = 0.5;

// The leg the truck is on. A stop with a road `path` (see sim/routes.js) is driven along that
// path; a bare stop (hand-made routes in tests) is a straight line to the next stop.
function segmentOf(truck) {
  const n = truck.route.length;
  const from = truck.route[truck.seg];
  const to = truck.route[(truck.seg + 1) % n];
  if (from.path) return { from, to, length: from.cum[from.cum.length - 1], path: from.path, cum: from.cum };
  return { from, to, length: haversine(from.lat, from.lng, to.lat, to.lng), path: null, cum: null };
}

// Cumulative metres along a path of [lat, lng] points.
export function pathLengths(path) {
  const cum = [0];
  for (let k = 1; k < path.length; k++) cum.push(cum[k - 1] + haversine(path[k - 1][0], path[k - 1][1], path[k][0], path[k][1]));
  return cum;
}

// Position `dist` metres along a road path: the two road points either side of it, and the
// share of the way between them. Both points are on the road, so the result is too.
export function pointAlong(path, cum, dist) {
  if (dist <= 0) return path[0];
  const last = cum.length - 1;
  if (dist >= cum[last]) return path[last];
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= dist) lo = mid;
    else hi = mid;
  }
  const f = cum[hi] > cum[lo] ? (dist - cum[lo]) / (cum[hi] - cum[lo]) : 0;
  return [lerp(path[lo][0], path[hi][0], f), lerp(path[lo][1], path[hi][1], f)];
}

function initTruck(truck_id, route, index) {
  const rng = mulberry32(0x9e3779b9 ^ ((index + 1) * 7919));
  const truck = {
    truck_id,
    route,
    rng,
    seg: (index * 2 + 1) % route.length,
    dist: 0,
    speed: 30,
    phase: 'drive',
    dwellLeft: 0,
    dwellElapsed: 0,
    engineOn: true,
    coolant: 88 + rng() * 2,
    oil: 86 + rng() * 2,
    t: 0,
    wobble: rng() * Math.PI * 2,
  };
  truck.dist = segmentOf(truck).length * 0.3;
  return truck;
}

// A running demo scenario may force the speed profile (e.g. a crash stop).
function advanceForced(truck, dt, speed) {
  const prevSpeed = truck.speed;
  truck.phase = 'drive';
  // A scenario may park the truck with the engine off.
  truck.engineOn = !truck.scenario?.def.engineOff?.(truck.scenario.tRel);
  truck.speed = clamp(speed, 0, 120);
  truck.dist += (truck.speed / 3.6) * dt;
  let { length } = segmentOf(truck);
  while (length > 0 && truck.dist >= length) {
    truck.dist -= length;
    truck.seg = (truck.seg + 1) % truck.route.length;
    ({ length } = segmentOf(truck));
  }
  return prevSpeed;
}

function advance(truck, dt) {
  truck.t += dt;
  const sc = truck.scenario;
  const forced = sc?.def.speedAt?.(sc.tRel, truck.speed);
  if (forced !== undefined && forced !== null) return advanceForced(truck, dt, forced);
  const prevSpeed = truck.speed;

  if (truck.phase === 'dwell') {
    truck.speed = 0;
    truck.dwellLeft -= dt;
    truck.dwellElapsed += dt;
    const wp = truck.route[truck.seg];
    if (wp.dwell_s >= ENGINE_OFF_DWELL_S && truck.dwellElapsed >= ENGINE_OFF_AFTER_S) truck.engineOn = false;
    if (sc?.def.forceEngine) truck.engineOn = true;
    if (truck.dwellLeft <= 0) {
      truck.phase = 'drive';
      truck.engineOn = true;
    }
    return prevSpeed;
  }

  const { from, to, length } = segmentOf(truck);
  const remaining = Math.max(0, length - truck.dist);

  const traffic = 6 * Math.sin(truck.t / 40 + truck.wobble) + 3 * Math.sin(truck.t / 13 + truck.wobble * 2);
  let desired = from.cruise + traffic;
  if (to.dwell_s) {
    desired = Math.min(desired, Math.sqrt(2 * STOP_DECEL_MS2 * remaining) * 3.6);
    if (remaining > 0) desired = Math.max(desired, CREEP_KMH);
  } else {
    const cornerMs = CORNER_KMH / 3.6;
    desired = Math.min(desired, Math.sqrt(cornerMs ** 2 + 2 * STOP_DECEL_MS2 * remaining) * 3.6);
  }

  truck.speed = clamp(truck.speed + clamp(desired - truck.speed, -DECEL_KMH_S * dt, ACCEL_KMH_S * dt), 0, 120);
  truck.engineOn = true;

  const step = (truck.speed / 3.6) * dt;
  if (to.dwell_s && remaining <= Math.max(step, 3)) {
    // Hold at the stop line until slow enough that the final stop is not a harsh brake.
    truck.dist = length;
    if (truck.speed > ARRIVE_KMH) return prevSpeed;
    truck.seg = (truck.seg + 1) % truck.route.length;
    truck.dist = 0;
    // Speed reaches 0 on the first dwell tick, keeping the last step under the braking threshold.
    truck.phase = 'dwell';
    truck.dwellLeft = to.dwell_s;
    truck.dwellElapsed = 0;
    return prevSpeed;
  }

  truck.dist += step;
  if (truck.dist >= length) {
    truck.dist -= length;
    truck.seg = (truck.seg + 1) % truck.route.length;
  }
  return prevSpeed;
}

// One second of driving toward a stop `remaining` metres ahead: accelerate to `cruise`, brake at
// a normal rate so the truck comes to rest at the stop. Same limits as route driving, so a
// detour never reads as harsh driving or a collision.
function driveToStop(speed, remaining, cruise, dt) {
  let desired = Math.min(cruise, Math.sqrt(2 * STOP_DECEL_MS2 * remaining) * 3.6);
  if (remaining > 0) desired = Math.max(desired, CREEP_KMH);
  const v = clamp(speed + clamp(desired - speed, -DECEL_KMH_S * dt, ACCEL_KMH_S * dt), 0, 120);
  const step = (v / 3.6) * dt;
  // Arrive at crawl speed (<= ARRIVE_KMH); the next tick (parked) reads 0, so the stop is never
  // read as harsh braking.
  if (remaining <= Math.max(step, 3) && v <= ARRIVE_KMH) return { speed: v, moved: remaining, arrived: true };
  return { speed: v, moved: Math.min(step, remaining), arrived: false };
}

// A scenario detour: drive `out` (road path) to its end, park `park_s`, drive `back` to where
// the truck left its route. The truck's place on its route is frozen meanwhile.
function createDetourRun(detour, startSpeed) {
  const legs = [
    { path: detour.out, cum: pathLengths(detour.out) },
    { path: detour.back, cum: pathLengths(detour.back) },
  ];
  const state = { leg: 0, dist: 0, parkLeft: detour.park_s, speed: startSpeed, done: false };
  return {
    state,
    tick(dt) {
      if (state.done) return;
      if (state.leg === 1 && state.parkLeft > 0) {
        state.speed = 0;
        state.parkLeft -= dt;
        return;
      }
      if (state.arrivedBack) {
        state.speed = 0;
        state.done = true;
        return;
      }
      const leg = legs[state.leg === 0 ? 0 : 1];
      const length = leg.cum[leg.cum.length - 1];
      const r = driveToStop(state.speed, length - state.dist, detour.cruise, dt);
      state.speed = r.speed;
      state.dist += r.moved;
      if (!r.arrived) return;
      if (state.leg === 0) {
        state.leg = 1;
        state.dist = 0;
      } else {
        state.arrivedBack = true; // one more tick at the end, reading 0 km/h
      }
    },
    position() {
      const leg = legs[state.leg];
      return pointAlong(leg.path, leg.cum, state.dist);
    },
  };
}

// Upper bound for planning a detour (a detour itself only ends when the truck is back).
const MAX_PLAN_S = 6 * 3600;

// Seconds to drive a road path from `startSpeed` to a stop at its end.
export function legDuration(path, startSpeed, cruise) {
  const cum = pathLengths(path);
  const length = cum[cum.length - 1];
  let speed = startSpeed;
  let dist = 0;
  let t = 0;
  while (t < MAX_PLAN_S) {
    const r = driveToStop(speed, length - dist, cruise, 1);
    speed = r.speed;
    dist += r.moved;
    t += 1;
    if (r.arrived) break;
  }
  return t;
}

// Seconds a detour takes from `startSpeed`, by running it: the scenario's length.
export function detourDuration(detour, startSpeed = 0) {
  const run = createDetourRun(detour, startSpeed);
  let t = 0;
  while (!run.state.done && t < MAX_PLAN_S) {
    run.tick(1);
    t += 1;
  }
  return t;
}

// Where the truck is now: on its leg's road path, or on a scenario detour when one is running.
function positionOf(truck) {
  if (truck.scenario?.detour) return truck.scenario.detour.position();
  const { from, to, length, path, cum } = segmentOf(truck);
  if (path) return pointAlong(path, cum, truck.dist);
  const f = length > 0 ? Math.min(1, truck.dist / length) : 0;
  return [lerp(from.lat, to.lat, f), lerp(from.lng, to.lng, f)];
}

function readings(truck, prevSpeed, dt, timestamp) {
  const { rng } = truck;
  const noise = (amp) => (rng() * 2 - 1) * amp;
  const [latitude, longitude] = positionOf(truck);

  const accel = (truck.speed - prevSpeed) / dt;
  let engine_load = 0;
  let rpm = 0;
  let battery_voltage = 12.6 + noise(0.03);

  if (truck.engineOn) {
    engine_load = clamp(12 + truck.speed * 0.45 + Math.max(0, accel) * 6 + noise(3), 5, 100);
    rpm = truck.speed < 1 ? IDLE_RPM + noise(20) : 700 + truck.speed * 22 + engine_load * 4 + noise(25);
    battery_voltage = 13.9 + noise(0.08);
  }

  const coolantTarget = truck.engineOn ? 86 + engine_load * 0.08 : 45;
  truck.coolant += ((coolantTarget - truck.coolant) * dt) / (truck.engineOn ? 90 : 600);
  const oilTarget = truck.engineOn ? truck.coolant - 3 + engine_load * 0.06 : truck.coolant - 2;
  truck.oil += ((oilTarget - truck.oil) * dt) / 120;

  return {
    truck_id: truck.truck_id,
    timestamp,
    latitude: round(latitude, 6),
    longitude: round(longitude, 6),
    coolant_temp: round(truck.coolant + noise(0.3), 1),
    oil_temp: round(truck.oil + noise(0.3), 1),
    battery_voltage: round(battery_voltage, 2),
    rpm: Math.round(rpm),
    engine_load: Math.round(engine_load),
    speed: round(truck.speed, 1),
  };
}

// Fuel sensor reading of a truck that has one: burns like the dashboard's estimate, loses what a
// running scenario drains, and refills during a long depot stop when low.
function updateFuel(truck, point, dt) {
  if (truck.fuelPct == null) return;
  const capacity = DEFAULT_TANK_CAPACITY_L;
  truck.fuelPct -= ((burnRateLph(point, rules.fuel) * dt) / 3600 / capacity) * 100;
  const sc = truck.scenario;
  if (sc?.def.fuelLossPct) truck.fuelPct -= sc.def.fuelLossPct(sc.tRel) * dt;
  const depotStop = truck.phase === 'dwell' && truck.route[truck.seg].dwell_s >= ENGINE_OFF_DWELL_S;
  if (!depotStop) truck.refilling = false;
  else if (truck.fuelPct < REFILL_BELOW_PCT) truck.refilling = true;
  if (truck.refilling) {
    truck.fuelPct += REFILL_PCT_S * dt;
    if (truck.fuelPct >= 100) truck.refilling = false;
  }
  truck.fuelPct = clamp(truck.fuelPct, 0, 100);
  point.fuel_level = round(truck.fuelPct, 1);
}

export function createSimulator({ routes, truckIds = Object.keys(routes), fuelSensors = FUEL_SENSOR_TRUCKS }) {
  const trucks = truckIds.map((id, i) => ({ ...initTruck(id, routes[id], i), fuelPct: fuelSensors.includes(id) ? 100 : null, refilling: false }));
  const byId = new Map(trucks.map((t) => [t.truck_id, t]));
  let timer = null;

  function step(nowMs, dt = 1) {
    const timestamp = formatTs(nowMs);
    const out = [];
    for (const truck of trucks) {
      if (truck.scenario) {
        truck.scenario.tRel = (nowMs - truck.scenario.startMs) / 1000;
        // A detour ends only when the truck is back on its route (below), never on the clock,
        // so a stalled event loop or a long drive cannot cut it short and teleport the truck.
        if (!truck.scenario.detour && truck.scenario.tRel >= truck.scenario.def.duration_s) truck.scenario = null;
      }
      const sc = truck.scenario;
      let prevSpeed;
      if (sc?.detour) {
        prevSpeed = truck.speed;
        sc.detour.tick(dt);
        truck.speed = sc.detour.state.speed;
        truck.phase = 'drive';
        truck.engineOn = true;
        truck.t += dt;
      } else {
        prevSpeed = advance(truck, dt);
      }
      const point = readings(truck, prevSpeed, dt, timestamp);
      updateFuel(truck, point, dt);
      if (sc?.def.apply) sc.def.apply(sc.tRel, point);
      if (sc?.def.silent?.(sc.tRel)) continue;
      out.push(point);
      // A detour ends when the truck is back where it left its route.
      if (sc?.detour?.state.done) truck.scenario = null;
    }
    return out;
  }

  return {
    truckIds: () => trucks.map((t) => t.truck_id),
    hasFuelSensor: (truck_id) => byId.get(truck_id)?.fuelPct != null,
    // True while the truck is away from its route on a scenario detour.
    detouring: (truck_id) => Boolean(byId.get(truck_id)?.scenario?.detour),
    // Current position and speed, for scenarios that plan a detour from here.
    stateOf(truck_id) {
      const truck = byId.get(truck_id);
      if (!truck) return null;
      const [lat, lng] = positionOf(truck);
      return { lat, lng, speed: truck.speed };
    },
    step,
    // Runs a scenario definition (see sim/scenarios.js) on one truck from startMs.
    inject(truck_id, def, startMs) {
      const truck = byId.get(truck_id);
      if (!truck) return false;
      truck.scenario = { def, startMs, tRel: 0, detour: def.detour ? createDetourRun(def.detour, truck.speed) : null };
      return true;
    },
    start(onPoints, intervalMs = 1000) {
      if (timer) return;
      // Never step backwards: if the wall clock is moved back, keep time moving forward so
      // points are not dropped as duplicates after the trucks have already advanced.
      let lastMs = 0;
      timer = setInterval(() => {
        lastMs = Math.max(Date.now(), lastMs + intervalMs);
        onPoints(step(lastMs, intervalMs / 1000));
      }, intervalMs);
    },
    stop() {
      clearInterval(timer);
      timer = null;
    },
  };
}
