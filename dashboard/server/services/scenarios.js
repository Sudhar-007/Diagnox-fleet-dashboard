import { SCENARIOS, describeScenarios } from '../sim/scenarios.js';

export class ScenarioError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Starts demo scenarios on the simulator and remembers which are running.
// `restrictedZoneFor(truck_id)` picks the target for scenarios that need one.
export function createScenarioService({ sim, enabled, restrictedZoneFor = () => null }) {
  const active = new Map(); // truck_id -> { id, scenario, truck_id, started_ms, ends_ms }

  function running(nowMs = Date.now()) {
    for (const [truck, run] of active) if (run.ends_ms <= nowMs) active.delete(truck);
    return [...active.values()];
  }

  function start({ scenario, truck_id } = {}, nowMs = Date.now()) {
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
    let def = base;
    let target = null;
    if (base.needs === 'restricted_zone') {
      target = restrictedZoneFor(truck);
      if (!target) throw new ScenarioError(409, `no restricted zone covers ${truck}; add one in Settings, Geofences`);
      def = base.build(target);
    }
    // A new scenario on the same truck replaces the running one.
    sim.inject(truck, def, nowMs);
    const run = {
      id: scenario,
      scenario: def.label,
      truck_id: truck,
      target: target ? target.name : null,
      started_ms: nowMs,
      ends_ms: nowMs + def.duration_s * 1000,
    };
    active.set(truck, run);
    return run;
  }

  return {
    enabled: () => Boolean(enabled && sim),
    available: describeScenarios,
    running,
    start,
  };
}
