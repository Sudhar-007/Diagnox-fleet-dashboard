import { Router } from 'express';

// Driver behaviour events (RULE-BASED). Newest first; ?truck_id ?driver_id ?limit (max 2000).
export function drivingRouter({ driving }) {
  const r = Router();

  r.get('/driver-events', (req, res) => {
    const { truck_id, driver_id } = req.query;
    const limit = /^[1-9]\d*$/.test(req.query.limit ?? '') ? Math.min(Number(req.query.limit), 2000) : 500;
    res.json({ events: driving.list({ truck_id: truck_id || undefined, driver_id: driver_id || undefined, limit }) });
  });

  return r;
}
