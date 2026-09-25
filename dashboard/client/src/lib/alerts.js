import { formatClock } from './format.js';

// Canonical alert line from the spec: rule name · field · value vs threshold · truck · time.
// e.g. "Coolant critical · coolant_temp 112 °C > 110 °C · TN03 · 10:42:05"
export function alertText(a) {
  return `${a.name} · ${a.field} ${a.value} ${a.unit} ${a.op} ${a.threshold} ${a.unit} · ${a.truck_id} · ${formatClock(a.opened_at)}`;
}

export function isOpen(a) {
  return a.status !== 'RESOLVED';
}

const LEVEL_RANK = { critical: 2, warning: 1 };

// Critical first, then newest first.
export function byUrgency(a, b) {
  return (LEVEL_RANK[b.level] ?? 0) - (LEVEL_RANK[a.level] ?? 0) || b.opened_ms - a.opened_ms;
}

// Events carry the rule as it stood when they happened.
export function eventDescription(event) {
  const by = event.by ? ` by ${event.by}` : '';
  const reading = `${event.field} ${event.value} ${event.unit} ${event.op} ${event.threshold} ${event.unit}`;
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
