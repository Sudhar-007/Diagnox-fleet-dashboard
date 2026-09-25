// Contract timestamps have no TZ suffix; the browser reads them as local time,
// which is what the dashboard shows. Returns epoch ms or null.
export function parseTsMs(timestamp) {
  if (typeof timestamp !== 'string') return null;
  const ms = new Date(timestamp).getTime();
  return Number.isNaN(ms) ? null : ms;
}
