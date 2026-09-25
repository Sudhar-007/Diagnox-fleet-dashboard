import { InputError } from '../services/input.js';

// Wraps a manager-input route: validation errors become their status with a readable
// message, and every successful change calls onChange so it can be broadcast.
// A failed broadcast is logged, never reported as a failed save: the change is already stored.
export const inputHandler = (onChange, log = console) => (fn, status = 200) => (req, res) => {
  let out;
  try {
    out = fn(req);
  } catch (err) {
    if (err instanceof InputError) return res.status(err.status).json({ error: err.message });
    throw err;
  }
  if (req.method !== 'GET') {
    try {
      onChange(out);
    } catch (err) {
      log.error('[bff] change saved but not broadcast:', err.message);
    }
  }
  res.status(status).json(out ?? { ok: true });
};
