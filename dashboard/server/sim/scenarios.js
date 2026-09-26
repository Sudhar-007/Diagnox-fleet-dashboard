// Deterministic demo scenarios injected into the simulator. Each one ends by itself after
// duration_s. `apply(t, point)` edits the emitted reading, `speedAt(t, speed)` forces the
// speed profile, `silent(t)` suppresses the truck's points, `forceEngine` keeps the engine
// running so engine-dependent rules can be judged.
//
// Values are chosen to cross the thresholds in config/rules.js; they are demo inputs,
// not a model of a real failure.

import { detourDuration, legDuration, pathLengths } from './simulator.js';

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

  harsh_braking: {
    label: 'Harsh braking',
    default_truck: 'TN04',
    duration_s: 30,
    description: 'The truck settles at 50 km/h, then brakes hard twice (about 15 km/h per second), never below 20 km/h.',
    // Changes of 4 km/h per second stay under the harsh acceleration limit, and the truck
    // never drops near a stop, so the braking is not read as a collision.
    speedAt(t, speed) {
      const toward = (target) => (speed < target ? Math.min(target, speed + 4) : Math.max(target, speed - 4));
      if (t < 14) return toward(50);
      // Steps of 14 to 16 km/h stay harsh even if a reading arrives a little late.
      if (t < 15) return 34;
      if (t < 16) return 20;
      if (t < 25) return toward(50);
      if (t < 26) return Math.max(20, speed - 16);
      if (t < 27) return Math.max(20, speed - 16);
      return undefined;
    },
  },

  // Needs a truck with a fuel sensor (sim FUEL_SENSOR_TRUCKS): an estimate cannot show a theft.
  fuel_theft: {
    label: 'Fuel theft',
    default_truck: 'TN01',
    duration_s: 90,
    needs: 'fuel_sensor',
    description: 'The truck pulls over and stops; about 36 L (12 % of a 300 L tank) is drained over 30 s, then it drives on.',
    // Slows at 3 km/h per second (not a collision), switches the engine off while parked (so
    // the stop is not idling), then drives on.
    speedAt(t, speed) {
      if (t < 30) return Math.max(0, speed - 3);
      if (t < 80) return 0;
      return undefined;
    },
    engineOff: (t) => t >= 32 && t < 78,
    fuelLossPct: (t) => (t >= 40 && t < 70 ? 0.4 : 0),
  },

  // Needs a target and a road route: the scenario service passes the nearest restricted zone
  // and the road paths there and back (from OSRM) to build().
  // default_truck null: the scenario service picks the simulated truck closest to a restricted
  // zone, so the demo does not wait on a long drive.
  geofence_breach: {
    label: 'Geofence breach',
    default_truck: null,
    duration_s: 120,
    needs: 'restricted_zone',
    road: true,
    description:
      'The truck closest to a restricted zone leaves its route, drives there by road, stops for about 25 s inside, then drives back and carries on.',
    build(zone, { out, back, startSpeed }) {
      const detour = { out, back, park_s: 25, cruise: 50 };
      const km = pathLengths(out).at(-1) / 1000;
      const enterMin = Math.max(1, Math.round(legDuration(out, startSpeed, detour.cruise) / 60));
      return {
        ...this,
        description: `The truck drives by road into ${zone.name}, stops for about 25 s, then drives back to its route.`,
        note: `Enters ${zone.name} in about ${enterMin} min (${km.toFixed(1)} km by road)`,
        detour,
        duration_s: detourDuration(detour, startSpeed) + 2,
      };
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
    needs: s.needs ?? null,
  }));
}
