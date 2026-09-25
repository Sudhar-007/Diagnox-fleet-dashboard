// Validation shared by every manager-input service. Errors carry an HTTP status and a
// message that is safe to show in the dashboard.
export class InputError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const NUMERIC = /^-?\d+(\.\d+)?$/;

// truck_id is kept exactly as entered: it must match what the device sends.
export const TRUCK_ID = /^[A-Za-z0-9-]{2,16}$/;

export const bad = (msg) => {
  throw new InputError(400, msg);
};

export function text(value, field, max, { required = false } = {}) {
  if (value == null || value === '') {
    if (required) bad(`${field} is required`);
    return null;
  }
  if (typeof value !== 'string') bad(`${field} must be text`);
  const v = value.trim();
  if (required && !v) bad(`${field} is required`);
  if (v.length > max) bad(`${field} must be at most ${max} characters`);
  return v || null;
}

export function number(value, field, min, max, { required = false } = {}) {
  if (value == null || value === '') {
    if (required) bad(`${field} is required`);
    return null;
  }
  const ok = typeof value === 'number' || (typeof value === 'string' && NUMERIC.test(value.trim()));
  const n = ok ? Number(value) : NaN;
  if (!Number.isFinite(n) || n < min || n > max) bad(`${field} must be a number from ${min} to ${max}`);
  return n;
}
