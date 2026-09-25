import { formatClock } from './format.js';

// Canonical alert line from the spec: rule name · field · value vs threshold · truck · time.
// e.g. "Coolant critical · coolant_temp 112 °C > 110 °C · TN03 · 10:42:05"
export function alertText(a) {
  if (a.kind === 'sos') {
    return `${a.name}${a.detail ? ` · ${a.detail}` : ''} · ${a.truck_id} · ${formatClock(a.opened_at)}`;
  }
  return `${a.name} · ${a.field} ${a.value} ${a.unit} ${a.op} ${a.threshold} ${a.unit} · ${a.truck_id} · ${formatClock(a.opened_at)}`;
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
  const reading = `${event.field} ${event.value} ${event.unit} ${event.op} ${event.threshold} ${event.unit}`;
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
      return 'Cleared: back within limits';
    default:
      return event.type;
  }
}
