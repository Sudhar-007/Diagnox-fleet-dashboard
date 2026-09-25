import { createHash, timingSafeEqual } from 'node:crypto';

import { parseTs } from '../engine/time.js';
import { TRUCK_ID } from './input.js';

// Checks telemetry the device POSTs to /api/telemetry and turns it into contract points.
// Only contract fields are kept, so a device can never overwrite a derived field.

export const MAX_BATCH = 300;

const NUMERIC = /^\s*-?\d+(\.\d+)?\s*$/;
// Contract format only: local time, no zone suffix. A "Z" or offset would shift the reading
// by hours under the server's TZ, so it is refused rather than guessed.
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;

// Sensor fields every point must carry, with sanity bounds (garbage filter, not engineering limits).
const SENSORS = {
  coolant_temp: [-40, 200],
  oil_temp: [-40, 200],
  battery_voltage: [0, 40],
  rpm: [0, 10000],
  engine_load: [0, 100],
  speed: [0, 300],
};

const toNumber = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && NUMERIC.test(v)) return Number(v);
  return null;
};

const SOS_TRUE = new Set([true, 1, '1', 'true']);
const SOS_FALSE = new Set([false, 0, '0', 'false']);

// raw -> { point } or { error } (error text is safe to send back to the device).
// maxPastS: timestamps older than this before nowMs are refused (device clock not set).
export function normalizeTelemetry(raw, { nowMs = Date.now(), maxPastS = Infinity } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'point must be a JSON object' };

  const { truck_id, timestamp } = raw;
  if (typeof truck_id !== 'string' || !TRUCK_ID.test(truck_id)) {
    return { error: 'truck_id must be 2 to 16 letters, digits or dashes' };
  }
  if (typeof timestamp !== 'string' || !TIMESTAMP.test(timestamp) || parseTs(timestamp) == null) {
    return { error: 'timestamp must be local time YYYY-MM-DDTHH:MM:SS, e.g. 2026-09-26T10:00:00' };
  }
  if (nowMs - parseTs(timestamp) > maxPastS * 1000) {
    return { error: `timestamp is more than ${Math.round(maxPastS / 3600)} h old; is the device clock set?` };
  }

  const point = { truck_id, timestamp };

  // No GPS fix: null or missing. Out-of-range values and exactly 0, 0 (the usual "no fix"
  // placeholder) are stored as null too, so they never reach the map or trip paths.
  for (const f of ['latitude', 'longitude']) {
    const v = raw[f];
    const n = v == null ? null : toNumber(v);
    if (v != null && n == null) return { error: `${f} must be a number or null` };
    point[f] = n;
  }
  const { latitude: lat, longitude: lng } = point;
  if (lat == null || lng == null || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) {
    point.latitude = null;
    point.longitude = null;
  }

  for (const [f, [min, max]] of Object.entries(SENSORS)) {
    const n = toNumber(raw[f]);
    if (n == null) return { error: `${f} is required and must be a number` };
    if (n < min || n > max) return { error: `${f} must be from ${min} to ${max}` };
    point[f] = n;
  }

  // Optional fields: kept only when readable.
  for (const f of ['fuel_level', 'maintenance_risk_score']) {
    const n = raw[f] == null ? null : toNumber(raw[f]);
    if (n != null) point[f] = n;
  }
  if (SOS_TRUE.has(raw.sos)) point.sos = true;
  else if (SOS_FALSE.has(raw.sos)) point.sos = false;

  return { point };
}

// Constant-time comparison of the x-api-key header with the configured key.
export function keyMatches(given, expected) {
  if (typeof given !== 'string' || !given || !expected) return false;
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}
