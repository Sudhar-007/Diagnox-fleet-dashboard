// Freshness is recomputed client-side every tick so a truck that stops reporting
// turns stale/offline without waiting for another message.
export function ageSeconds(truck, now, clockOffsetMs) {
  if (!truck?.received_at) return null;
  return Math.max(0, (now + clockOffsetMs - truck.received_at) / 1000);
}

export function freshnessOf(ageS, rules) {
  if (ageS == null || !rules) return 'live';
  if (ageS > rules.offline_after_s) return 'offline';
  if (ageS > rules.stale_after_s) return 'stale';
  return 'live';
}

// One status per truck: freshness wins over health, so old data never looks healthy.
export function displayStatus(truck, freshness) {
  return freshness === 'live' ? truck.health ?? 'normal' : freshness;
}

export const STATUS_META = {
  normal: { label: 'Normal', dot: 'bg-ok', text: 'text-ok' },
  warning: { label: 'Warning', dot: 'bg-warn', text: 'text-warn' },
  critical: { label: 'Critical', dot: 'bg-crit', text: 'text-crit' },
  stale: { label: 'Stale', dot: 'bg-idle', text: 'text-idle' },
  offline: { label: 'Offline', dot: 'bg-idle', text: 'text-idle' },
};

export const STATUS_ORDER = ['normal', 'warning', 'critical', 'stale', 'offline'];
