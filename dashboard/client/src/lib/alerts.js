import { formatClock } from './format.js';

// Canonical alert line from the spec: rule name · field · value vs threshold · truck · time.
// e.g. "Coolant critical · coolant_temp 112 °C > 110 °C · TN03 · 10:42:05"
export function alertText(a) {
  if (a.kind === 'sos') {
    return `${a.name}${a.detail ? ` · ${a.detail}` : ''} · ${a.truck_id} · ${formatClock(a.opened_at)}`;
  }
  return `${a.name} · ${ruleReading(a)} · ${a.truck_id} · ${formatClock(a.opened_at)}`;
}

// "coolant_temp 112 °C > 110 °C", or for a zone "Kodungaiyur dump yard, 120 m from centre < 500 m radius".
export function ruleReading(a, value = a.value) {
  if (a.kind === 'geofence' || a.zone_id) {
    return `${a.zone_name}, ${value} m from centre ${a.op} ${a.threshold} m radius`;
  }
  return `${a.field} ${value} ${a.unit} ${a.op} ${a.threshold} ${a.unit}`;
}

// How a closed alert ended, in words.
export function resolutionText(a) {
  switch (a.resolution) {
    case 'cleared':
      return a.kind === 'geofence'
        ? a.zone_type === 'restricted'
          ? 'Cleared when the truck left the zone'
          : 'Cleared when the truck came back inside'
        : 'Cleared on its own';
    case 'zone_removed':
      return 'Closed: zone deleted';
    case 'zone_changed':
      return 'Closed: zone changed, alerts turned off or truck no longer covered';
    case 'rule_changed':
      return 'Closed: threshold changed in Settings';
    default:
      return `Resolved by ${a.resolved_by ?? 'hand'}`;
  }
}

export function formatPosition(lat, lng) {
  return typeof lat === 'number' && typeof lng === 'number' ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : 'position unknown';
}

// Open SOS first (most urgent), newest first.
export function openSos(alerts) {
  return Object.values(alerts)
    .filter((a) => a.kind === 'sos' && a.status !== 'RESOLVED')
    .sort((a, b) => b.opened_ms - a.opened_ms);
}

// SOS alert name for lists: the server's names mostly start with "SOS" already.
export function sosLabel(a) {
  return /^SOS\b/.test(a.name) ? a.name : `SOS: ${a.name}`;
}

export function isOpen(a) {
  return a.status !== 'RESOLVED';
}

const LEVEL_RANK = { critical: 2, warning: 1 };

const rank = (a) => (a.kind === 'sos' ? 3 : LEVEL_RANK[a.level] ?? 0);

// SOS first, then critical, then newest first.
export function byUrgency(a, b) {
  return rank(b) - rank(a) || b.opened_ms - a.opened_ms;
}

// Events carry the rule as it stood when they happened.
export function eventDescription(event) {
  const by = event.by ? ` by ${event.by}` : '';
  const reading = ruleReading(event);
  if (event.type === 'opened' && event.trigger) {
    return `${event.name}${event.detail ? `: ${event.detail}` : ''}${by ? `, raised${by}` : ''}`;
  }
  switch (event.type) {
    case 'opened':
      return `Opened: ${event.name}, ${reading}`;
    case 'escalated':
      return `Escalated to ${event.level}: ${event.name}, ${reading}${event.reopened ? ' (acknowledgement cleared, needs attention again)' : ''}`;
    case 'acknowledged':
      return `Acknowledged${by}`;
    case 'resolved':
      return `Resolved${by}`;
    case 'cleared':
      if (event.zone_id) return event.zone_type === 'restricted' ? 'Cleared: left the zone' : 'Cleared: back inside the zone';
      return 'Cleared: back within limits';
    case 'closed':
      return `Closed: ${event.note ?? 'zone changed'}`;
    default:
      return event.type;
  }
}
