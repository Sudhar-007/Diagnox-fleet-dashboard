// Deterministic demo scenarios injected into the simulator. Each one ends by itself after
// duration_s. `apply(t, point)` edits the emitted reading, `speedAt(t, speed)` forces the
// speed profile, `silent(t)` suppresses the truck's points, `forceEngine` keeps the engine
// running so engine-dependent rules can be judged.
//
// Values are chosen to cross the thresholds in config/rules.js; they are demo inputs,
// not a model of a real failure.

const round = (v, dp) => Math.round(v * 10 ** dp) / 10 ** dp;
const ramp = (t, start, end) => Math.min(1, Math.max(0, (t - start) / (end - start)));

export const SCENARIOS = {
  overheat: {
    label: 'Overheat',
    default_truck: 'TN03',
    duration_s: 95,
    description: 'Coolant climbs past 100 °C, then 110 °C, holds, then cools back to normal.',
    forceEngine: true,
    apply(t, p) {
      // 0-40 s rise, 40-60 s hold, 60-90 s fall
      const shape = t < 40 ? ramp(t, 0, 40) : t < 60 ? 1 : 1 - ramp(t, 60, 90);
      p.coolant_temp = round(p.coolant_temp + (118 - p.coolant_temp) * shape, 1);
      p.oil_temp = round(p.oil_temp + 16 * shape, 1);
    },
  },

  battery_failing: {
    label: 'Battery failing',
    default_truck: 'TN02',
    duration_s: 75,
    description: 'Charging voltage drops below 13.2 V (warning), then below 12.4 V (critical), then recovers.',
    forceEngine: true,
    apply(t, p) {
      if (!(p.rpm > 0)) return;
      if (t < 35) p.battery_voltage = 12.9;
      else if (t < 65) p.battery_voltage = 12.1;
    },
  },

  sos_button: {
    label: 'SOS button',
    default_truck: 'TN02',
    duration_s: 10,
    description: 'The truck sends sos: true for 3 s, as the hardware panic button would.',
    apply(t, p) {
      if (t < 3) p.sos = true;
    },
  },

  collision: {
    label: 'Possible collision',
    default_truck: 'TN04',
    duration_s: 30,
    description: 'Speed builds to 55 km/h, then drops to 3 km/h within 2 s and the truck stays stopped.',
    speedAt(t, speed) {
      if (t < 9) return Math.min(55, speed + 4);
      if (t < 10) return 50;
      if (t < 11) return 18;
      if (t < 12) return 3;
      return 0;
    },
  },

  drop_feed: {
    label: 'Drop feed',
    default_truck: 'TN01',
    duration_s: 75,
    description: 'The truck stops reporting for 75 s: stale after 15 s, offline after 60 s, then back.',
    silent: () => true,
  },
};

export function describeScenarios() {
  return Object.entries(SCENARIOS).map(([id, s]) => ({
    id,
    label: s.label,
    description: s.description,
    default_truck: s.default_truck,
    duration_s: s.duration_s,
  }));
}
