// Every threshold the dashboard uses lives here. Values are demo-tuned, not validated.

export const rules = {
  freshness: {
    stale_after_s: 15,
    offline_after_s: 60,
  },

  alerts: {
    // An alert closes only after its field has been back within limits this long.
    clear_after_s: 10,
  },

  sos: {
    // Possible collision (heuristic): speed falls from >= from_kmh to <= to_kmh within within_s.
    collision: { from_kmh: 40, to_kmh: 5, within_s: 3 },
  },

  risk: {
    // Rule-based maintenance risk looks back over this window.
    window_s: 600,
    // Exposure is measured against at least this much judged time, so a few seconds
    // right after an engine start (e.g. a cranking dip) cannot count as "all the time".
    min_judged_s: 60,
    // Most points each field can add to the 0-100 score (they sum to 100).
    weights: { coolant_temp: 30, oil_temp: 20, battery_voltage: 20, engine_load: 15, rpm: 10, speed: 5 },
  },

  geofence: {
    // Consecutive points on the same side of a zone edge needed to confirm an entry or exit,
    // so GPS jitter near the edge does not flap.
    confirm_points: 2,
  },

  trips: {
    // A trip starts when speed stays above start_speed_kmh for start_hold_s (it begins at the
    // first of those readings) and ends when speed stays at 0 for longer than stop_hold_s, or
    // when no reading arrives for no_data_end_s.
    start_speed_kmh: 5,
    start_hold_s: 30,
    stop_hold_s: 120,
    no_data_end_s: 300,
    // "Stopped" means speed at or below this. The spec says exactly 0; if speed comes from GPS,
    // a parked truck may read a little above 0 (confirm with the hardware team before changing).
    stop_speed_kmh: 0,
    // A planned trip assignment is linked to the truck's first detected trip that starts no
    // earlier than this long before the planned start.
    assignment_early_s: 1800,
  },

  // Bounds for thresholds edited in Settings. Input sanity limits only, not engineering limits.
  threshold_limits: {
    coolant_temp: [40, 150],
    oil_temp: [40, 170],
    battery_voltage: [9, 18],
    engine_load: [10, 100],
    rpm: [500, 6000],
    speed: [10, 150],
  },

  ingest: {
    // Points stamped this far ahead of the BFF clock are dropped (device clock not set yet).
    max_future_s: 300,
  },

  health: [
    {
      id: 'coolant_temp_critical',
      name: 'Coolant critical',
      field: 'coolant_temp',
      op: '>',
      threshold: 110,
      level: 'critical',
      unit: '°C',
      description: 'Coolant well above normal operating range; risk of overheating.',
    },
    {
      id: 'coolant_temp_warning',
      name: 'Coolant high',
      field: 'coolant_temp',
      op: '>',
      threshold: 100,
      level: 'warning',
      unit: '°C',
      description: 'Coolant above normal operating range.',
    },
    {
      id: 'oil_temp_critical',
      name: 'Oil temp critical',
      field: 'oil_temp',
      op: '>',
      threshold: 125,
      level: 'critical',
      unit: '°C',
      description: 'Oil temperature high enough to break down lubrication.',
    },
    {
      id: 'oil_temp_warning',
      name: 'Oil temp high',
      field: 'oil_temp',
      op: '>',
      threshold: 110,
      level: 'warning',
      unit: '°C',
      description: 'Oil temperature above normal range.',
    },
    {
      id: 'battery_low_critical',
      name: 'Battery critical low',
      field: 'battery_voltage',
      op: '<',
      threshold: 12.4,
      level: 'critical',
      unit: 'V',
      only_when_running: true,
      sustain_s: 10,
      max_gap_s: 5,
      description: 'Charging system not keeping up while the engine runs (held 10 s, so a cranking dip is ignored).',
    },
    {
      id: 'battery_high_critical',
      name: 'Battery critical high',
      field: 'battery_voltage',
      op: '>',
      threshold: 15.2,
      level: 'critical',
      unit: 'V',
      only_when_running: true,
      sustain_s: 10,
      max_gap_s: 5,
      description: 'Overcharging for 10 s while the engine runs; likely regulator fault.',
    },
    {
      id: 'battery_low_warning',
      name: 'Battery low',
      field: 'battery_voltage',
      op: '<',
      threshold: 13.2,
      level: 'warning',
      unit: 'V',
      only_when_running: true,
      sustain_s: 10,
      max_gap_s: 5,
      description: 'Below the normal charging range for 10 s while the engine runs.',
    },
    {
      id: 'battery_high_warning',
      name: 'Battery high',
      field: 'battery_voltage',
      op: '>',
      threshold: 14.8,
      level: 'warning',
      unit: 'V',
      only_when_running: true,
      sustain_s: 10,
      max_gap_s: 5,
      description: 'Above the normal charging range for 10 s while the engine runs.',
    },
    {
      id: 'engine_load_sustained',
      name: 'Engine load sustained',
      field: 'engine_load',
      op: '>',
      threshold: 85,
      level: 'warning',
      unit: '%',
      sustain_s: 60,
      max_gap_s: 5,
      description: 'Engine load stayed above threshold for the whole window.',
    },
    {
      id: 'rpm_high',
      name: 'RPM high',
      field: 'rpm',
      op: '>',
      threshold: 3000,
      level: 'warning',
      unit: 'rpm',
      description: 'Engine revving above normal goods-vehicle range.',
    },
    {
      id: 'overspeed',
      name: 'Overspeed',
      field: 'speed',
      op: '>',
      threshold: 80,
      level: 'warning',
      unit: 'km/h',
      description: 'Above goods-vehicle speed-limiter level.',
    },
  ],
};
