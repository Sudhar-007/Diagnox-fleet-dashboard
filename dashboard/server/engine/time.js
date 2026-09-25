// Contract timestamps are ISO 8601 without a TZ suffix and are treated as local time.
// `new Date("YYYY-MM-DDTHH:mm:ss")` already parses that form as local time.

export function parseTs(timestamp) {
  const ms = new Date(timestamp).getTime();
  return Number.isNaN(ms) ? null : ms;
}

const pad = (n) => String(n).padStart(2, '0');

export function formatTs(ms) {
  const d = new Date(ms);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}
