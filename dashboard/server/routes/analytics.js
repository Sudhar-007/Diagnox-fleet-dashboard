import { Router } from 'express';

import { RANGES } from '../services/analytics.js';

// Charts for the Analytics page. ?range=15m|1h|session (default 1h).
export function analyticsRouter({ analytics }) {
  const r = Router();
  r.get('/analytics', (req, res) => {
    const range = req.query.range ?? '1h';
    if (!Object.hasOwn(RANGES, range)) return res.status(400).json({ error: 'range must be 15m, 1h or session' });
    res.json(analytics.get(range));
  });
  return r;
}
