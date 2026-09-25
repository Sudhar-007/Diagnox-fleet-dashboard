export function formatAgo(seconds) {
  if (seconds == null) return 'never';
  const s = Math.round(seconds);
  if (s < 60) return `${s} s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  return `${Math.floor(m / 60)} h ${m % 60} min ago`;
}

// Contract timestamps are local time without a TZ suffix; show the clock part.
export function formatClock(timestamp) {
  return typeof timestamp === 'string' && timestamp.length >= 19 ? timestamp.slice(11, 19) : '';
}

export function formatNumber(value, digits = 0) {
  return typeof value === 'number' ? value.toFixed(digits) : '';
}

// Canonical alert line: rule name, field value vs threshold (truck and time added by callers).
export function findingText(f) {
  return `${f.name} · ${f.field} ${f.value} ${f.unit} ${f.op} ${f.threshold} ${f.unit}`;
}
