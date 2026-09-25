import { useFleetStore } from '../store/useFleetStore.js';
import { ageSeconds, displayStatus, freshnessOf } from './status.js';

export function useTruckStatus(truck) {
  const now = useFleetStore((s) => s.now);
  const clockOffsetMs = useFleetStore((s) => s.clockOffsetMs);
  const rules = useFleetStore((s) => s.freshnessRules);
  const age = ageSeconds(truck, now, clockOffsetMs);
  const freshness = freshnessOf(age, rules);
  return { age, freshness, status: displayStatus(truck, freshness) };
}
