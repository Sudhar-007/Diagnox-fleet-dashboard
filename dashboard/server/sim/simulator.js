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

function segmentOf(truck) {
  const n = truck.route.length;
  const from = truck.route[truck.seg];
  const to = truck.route[(truck.seg + 1) % n];
  return { from, to, length: haversine(from.lat, from.lng, to.lat, to.lng) };
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

function readings(truck, prevSpeed, dt, timestamp) {
  const { rng } = truck;
  const noise = (amp) => (rng() * 2 - 1) * amp;
  const { from, to, length } = segmentOf(truck);
  const f = length > 0 ? Math.min(1, truck.dist / length) : 0;
  const latitude = lerp(from.lat, to.lat, f);
  const longitude = lerp(from.lng, to.lng, f);

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
        if (truck.scenario.tRel >= truck.scenario.def.duration_s) truck.scenario = null;
      }
      const sc = truck.scenario;
      const prevSpeed = advance(truck, dt);
      const point = readings(truck, prevSpeed, dt, timestamp);
      updateFuel(truck, point, dt);
      if (sc?.def.apply) sc.def.apply(sc.tRel, point);
      if (sc?.def.silent?.(sc.tRel)) continue;
      out.push(point);
    }
    return out;
  }

  return {
    truckIds: () => trucks.map((t) => t.truck_id),
    hasFuelSensor: (truck_id) => byId.get(truck_id)?.fuelPct != null,
    step,
    // Runs a scenario definition (see sim/scenarios.js) on one truck from startMs.
    inject(truck_id, def, startMs) {
      const truck = byId.get(truck_id);
      if (!truck) return false;
      truck.scenario = { def, startMs, tRel: 0 };
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
