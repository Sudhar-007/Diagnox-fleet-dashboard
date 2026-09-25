import { Router } from 'express';

import { AlertActionError, ALERT_STATUS } from '../services/alerts.js';

const VALID_FILTERS = new Set([...ALERT_STATUS, 'open']);

export function alertsRouter({ alerts, onChange }) {
  const r = Router();

  // ?status=ACTIVE|ACKNOWLEDGED|RESOLVED|open  ?truck_id=TN01
  r.get('/alerts', (req, res) => {
    const { status, truck_id } = req.query;
    if (status && !VALID_FILTERS.has(status)) {
      return res.status(400).json({ error: `status must be one of ${[...VALID_FILTERS].join(', ')}` });
    }
    res.json({ alerts: alerts.list({ status, truck_id }) });
  });

  r.get('/alerts/events', (req, res) => {
    const limit = /^[1-9]\d*$/.test(req.query.limit ?? '') ? Math.min(Number(req.query.limit), 2000) : 500;
    res.json({ events: alerts.events({ limit }) });
  });

  // Body: { status: "ACKNOWLEDGED" | "RESOLVED", note?, by? }
  r.patch('/alerts/:id', (req, res) => {
    try {
      const change = alerts.act(req.params.id, req.body ?? {});
      onChange({ kind: 'update', ...change });
      res.json(change);
    } catch (err) {
      if (err instanceof AlertActionError) return res.status(err.status).json({ error: err.message });
      throw err;
    }
  });

  return r;
}
