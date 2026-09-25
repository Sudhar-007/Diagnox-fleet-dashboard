import { Router } from 'express';

const STATUS = new Set(['active', 'completed']);

// Trips detected from telemetry. Newest first; ?status=active|completed ?truck_id ?limit (max 1000).
export function tripsRouter({ trips }) {
  const r = Router();

  r.get('/trips', (req, res) => {
    const { status, truck_id } = req.query;
    if (status && !STATUS.has(status)) return res.status(400).json({ error: 'status must be active or completed' });
    const limit = /^[1-9]\d*$/.test(req.query.limit ?? '') ? Math.min(Number(req.query.limit), 1000) : 200;
    res.json({ trips: trips.list({ status, truck_id: truck_id || undefined, limit }) });
  });

  r.get('/trips/:id', (req, res) => {
    const trip = trips.get(req.params.id);
    if (!trip) return res.status(404).json({ error: `unknown trip ${req.params.id}` });
    res.json({ trip });
  });

  return r;
}
