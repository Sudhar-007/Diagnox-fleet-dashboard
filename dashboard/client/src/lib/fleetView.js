import { useMemo } from 'react';

import { useFleetStore } from '../store/useFleetStore.js';
import { ageSeconds, displayStatus, freshnessOf } from './status.js';

// One row per reporting truck with everything the fleet views judge it by, so Overview and
// Vehicles agree on who needs attention.
//   attention: open SOS, or live and warning / critical
//   silent:    stale or offline (no recent data)
const ORDER = { sos: 0, critical: 1, warning: 2, offline: 3, stale: 4, normal: 5 };

export function useFleetRows() {
  const trucks = useFleetStore((s) => s.trucks);
  const alerts = useFleetStore((s) => s.alerts);
  const now = useFleetStore((s) => s.now);
  const clockOffsetMs = useFleetStore((s) => s.clockOffsetMs);
  const rules = useFleetStore((s) => s.freshnessRules);

  const sosByTruck = useMemo(() => {
    const m = new Map();
    for (const a of Object.values(alerts)) if (a.kind === 'sos' && a.status !== 'RESOLVED') m.set(a.truck_id, a);
    return m;
  }, [alerts]);

  return useMemo(
    () =>
      Object.values(trucks)
        .map((truck) => {
          const age = ageSeconds(truck, now, clockOffsetMs);
          const freshness = freshnessOf(age, rules);
          const status = displayStatus(truck, freshness);
          const sos = sosByTruck.get(truck.truck_id) ?? null;
          return {
            truck,
            age,
            freshness,
            status,
            sos,
            attention: Boolean(sos) || status === 'warning' || status === 'critical',
            silent: status === 'stale' || status === 'offline',
          };
        })
        .sort((a, b) => a.truck.truck_id.localeCompare(b.truck.truck_id)),
    [trucks, now, clockOffsetMs, rules, sosByTruck],
  );
}

// Most urgent first: SOS, critical, warning, offline, stale.
export function byUrgency(a, b) {
  const ra = a.sos ? ORDER.sos : ORDER[a.status];
  const rb = b.sos ? ORDER.sos : ORDER[b.status];
  return ra - rb || a.truck.truck_id.localeCompare(b.truck.truck_id);
}

// Where the truck is, in words: the zone it is inside, else coordinates, else no fix.
export function locationText(truck) {
  if (truck.zones_inside?.length) return truck.zones_inside.map((z) => z.zone_name).join(', ');
  const { latitude: lat, longitude: lng } = truck;
  if (typeof lat === 'number' && typeof lng === 'number' && !(lat === 0 && lng === 0)) {
    return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  }
  return 'No GPS fix';
}

export function engineText(truck) {
  if (typeof truck.rpm !== 'number') return 'Unknown';
  return truck.rpm > 0 ? 'Running' : 'Off';
}
