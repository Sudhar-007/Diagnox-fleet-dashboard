import { SCENARIOS, describeScenarios } from '../sim/scenarios.js';
import { haversine } from '../engine/geo.js';
import { fetchRoadPath } from '../sim/osrm.js';

const ROUTE_TIMEOUT_MS = 3500; // the dashboard gives up on a request after 5 s

export class ScenarioError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Starts demo scenarios on the simulator and remembers which are running.
// `restrictedZoneFor(truck_id)` picks the target for scenarios that need one.
// `roadRoute(from, to)` -> Promise of [[lat, lng], ...] along roads (OSRM by default).
export function createScenarioService({
  sim,
  enabled,
  restrictedZoneFor = () => null,
  roadRoute = (from, to) => fetchRoadPath(from, to, { timeoutMs: ROUTE_TIMEOUT_MS }),
}) {
  const active = new Map(); // truck_id -> { id, scenario, truck_id, started_ms, ends_ms }

  function running(nowMs = Date.now()) {
    for (const [truck, run] of active) if (run.ends_ms <= nowMs) active.delete(truck);
    return [...active.values()];
  }

  function start({ scenario, truck_id } = {}, nowMs = Date.now(), road = null) {
    if (!enabled) throw new ScenarioError(403, 'demo scenarios are disabled on this server');
    if (!sim) throw new ScenarioError(409, 'demo scenarios need the simulator (DATA_SOURCE mock or hybrid)');
    const base = SCENARIOS[scenario];
    if (!base) throw new ScenarioError(400, `unknown scenario ${scenario}`);
    const truck = truck_id ?? base.default_truck;
    if (typeof truck !== 'string' || !sim.truckIds().includes(truck)) {
      throw new ScenarioError(400, `${truck} is not a simulated truck`);
    }
    if (base.needs === 'fuel_sensor' && !sim.hasFuelSensor?.(truck)) {
      throw new ScenarioError(409, `${truck} has no fuel sensor; fuel theft shows only on a measured level (try TN01)`);
    }
    if (sim.detouring?.(truck)) {
      throw new ScenarioError(409, `${truck} is still on its detour; start another scenario once it is back on its route`);
    }
    let def = base;
    let target = null;
    if (base.needs === 'restricted_zone') {
      target = road?.zone ?? restrictedZoneFor(truck);
      if (!target) throw new ScenarioError(409, `no restricted zone covers ${truck}; add one in Settings, Geofences`);
      if (!road || road.truck_id !== truck) {
        throw new ScenarioError(400, `${base.label} needs a road route; start it through launch()`);
      }
      def = base.build(target, road);
    }
    // A new scenario on the same truck replaces the running one.
    sim.inject(truck, def, nowMs);
    const run = {
      id: scenario,
      scenario: def.label,
      truck_id: truck,
      target: target ? target.name : null,
      note: def.note ?? null,
      started_ms: nowMs,
      ends_ms: nowMs + def.duration_s * 1000,
    };
    active.set(truck, run);
    return run;
  }

  // The simulated truck closest (straight line) to a restricted zone that covers it.
  function nearestToZone() {
    let best = null;
    for (const id of sim.truckIds()) {
      if (sim.detouring?.(id)) continue;
      const zone = restrictedZoneFor(id);
      const here = zone && sim.stateOf(id);
      if (!here) continue;
      const d = haversine(here.lat, here.lng, zone.center_lat, zone.center_lng);
      if (!best || d < best.d) best = { id, d };
    }
    return best?.id ?? null;
  }

  // Starts any scenario. One that drives somewhere new first asks the road router for the way
  // there and back, so the truck follows roads; if routing is unavailable it does not start
  // (never a straight line across the map).
  async function launch(opts = {}, nowMs = Date.now()) {
    const base = SCENARIOS[opts.scenario];
    if (!base?.road || !enabled || !sim) return start(opts, nowMs);
    const truck = opts.truck_id || nearestToZone();
    if (truck && sim.detouring?.(truck)) return start({ ...opts, truck_id: truck }, nowMs); // reports the detour
    if (!truck) throw new ScenarioError(409, 'no restricted zone covers any simulated truck; add one in Settings, Geofences');
    const target = typeof truck === 'string' && sim.truckIds().includes(truck) ? restrictedZoneFor(truck) : null;
    if (!target) return start(opts, nowMs); // start() reports what is missing
    const askedAt = Date.now();
    const here = sim.stateOf(truck);
    const zone = [target.center_lat, target.center_lng];
    let out;
    let back;
    try {
      [out, back] = await Promise.all([roadRoute([here.lat, here.lng], zone), roadRoute(zone, [here.lat, here.lng])]);
    } catch (err) {
      throw new ScenarioError(503, `road routing is unavailable (${err.message}), so the truck cannot drive to ${target.name}; try again`);
    }
    const end = out[out.length - 1];
    if (haversine(end[0], end[1], target.center_lat, target.center_lng) > target.radius_m * 0.9) {
      throw new ScenarioError(409, `no road reaches inside ${target.name}; move the zone onto a road in Settings`);
    }
    // The truck kept driving while the route was fetched: start the detour from where it is now.
    const now = sim.stateOf(truck);
    // It leaves from, and comes back to, exactly its place on its route.
    const lead = [[now.lat, now.lng], ...out];
    const home = [...back, [now.lat, now.lng]];
    return start({ ...opts, truck_id: truck }, nowMs + (Date.now() - askedAt), { truck_id: truck, zone: target, out: lead, back: home, startSpeed: now.speed });
  }

  return {
    enabled: () => Boolean(enabled && sim),
    available: describeScenarios,
    running,
    start,
    launch,
  };
}
