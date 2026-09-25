import { Router } from 'express';

import { AlertActionError, ALERT_STATUS } from '../services/alerts.js';

const VALID_FILTERS = new Set([...ALERT_STATUS, 'open']);
const VALID_KINDS = new Set(['health', 'sos', 'geofence']);

export function alertsRouter({ alerts, fleet, onChange }) {
  const r = Router();

  // ?status=ACTIVE|ACKNOWLEDGED|RESOLVED|open  ?truck_id=TN01  ?kind=health|sos|geofence
  r.get('/alerts', (req, res) => {
    const { status, truck_id, kind } = req.query;
    if (status && !VALID_FILTERS.has(status)) {
      return res.status(400).json({ error: `status must be one of ${[...VALID_FILTERS].join(', ')}` });
    }
    if (kind && !VALID_KINDS.has(kind)) {
      return res.status(400).json({ error: `kind must be one of ${[...VALID_KINDS].join(', ')}` });
    }
    res.json({ alerts: alerts.list({ status, truck_id, kind }) });
  });

  r.get('/alerts/events', (req, res) => {
    const limit = /^[1-9]\d*$/.test(req.query.limit ?? '') ? Math.min(Number(req.query.limit), 2000) : 500;
    res.json({ events: alerts.events({ limit }) });
  });

  const respond = (res, fn) => {
    try {
      const change = fn();
      onChange(change);
      res.json({ alert: change.alert, event: change.event });
    } catch (err) {
      if (err instanceof AlertActionError) return res.status(err.status).json({ error: err.message });
      throw err;
    }
  };

  // Body: { status: "ACKNOWLEDGED" | "RESOLVED", note?, by? }
  r.patch('/alerts/:id', (req, res) => {
    respond(res, () => ({ kind: 'update', ...alerts.act(req.params.id, req.body ?? {}) }));
  });

  // Manual SOS. Body: { note?, by? }
  r.post('/trucks/:truck_id/sos', (req, res) => {
    const truck = fleet.truck(req.params.truck_id);
    if (!truck) return res.status(404).json({ error: `unknown truck_id ${req.params.truck_id}` });
    respond(res, () => alerts.raiseSos(truck, req.body ?? {}));
  });

  // SOS lifecycle. Body: { status: "ACKNOWLEDGED" | "RESOLVED", note?, by? }
  r.patch('/sos/:id', (req, res) => {
    const found = alerts.get(req.params.id);
    if (!found || found.kind !== 'sos') return res.status(404).json({ error: `unknown SOS ${req.params.id}` });
    respond(res, () => ({ kind: 'update', ...alerts.act(req.params.id, req.body ?? {}) }));
  });

  return r;
}
