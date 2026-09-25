import express, { Router } from 'express';

import { MAX_BATCH, keyMatches, normalizeTelemetry } from '../services/telemetry.js';

// POST /api/telemetry: the truck device pushes one point or an array of points.
// Mounted before the app-wide JSON parser so a 4G backlog can be larger than manager forms.
//
// enabled(): false when the data source does not take device data.
// reserved(truck_id): true for ids the simulator drives; a device may not use them.
// ingest(points) -> Promise of the number of points the store kept (new, not duplicates).
export function telemetryRouter({ apiKey, enabled, reserved = () => false, maxPastS, ingest }) {
  const r = Router();

  // Checked before the body is parsed, so unauthenticated requests cost nothing.
  const guard = (req, res, next) => {
    if (!apiKey) return res.status(503).json({ error: 'device telemetry is not enabled on this server' });
    if (!keyMatches(req.get('x-api-key'), apiKey)) return res.status(401).json({ error: 'missing or wrong x-api-key' });
    if (!enabled()) return res.status(503).json({ error: 'device telemetry is not enabled on this server' });
    next();
  };

  r.post('/telemetry', guard, express.json({ limit: '512kb' }), async (req, res) => {
    const body = req.body;
    const raw = Array.isArray(body) ? body : body && typeof body === 'object' ? [body] : null;
    if (!raw || raw.length === 0) return res.status(400).json({ error: 'body must be a telemetry object or a non-empty array' });
    if (raw.length > MAX_BATCH) return res.status(413).json({ error: `at most ${MAX_BATCH} points per request` });

    const points = [];
    const rejected = [];
    const nowMs = Date.now();
    raw.forEach((item, index) => {
      const { point, error } = normalizeTelemetry(item, { nowMs, maxPastS });
      if (!point) rejected.push({ index, error });
      else if (reserved(point.truck_id)) rejected.push({ index, error: `truck_id ${point.truck_id} is a simulated truck; use another id` });
      else points.push(point);
    });

    const accepted = points.length ? await ingest(points) : 0;
    const out = { accepted, ignored: points.length - accepted, rejected };
    res.status(points.length ? 200 : 400).json(out);
  });

  return r;
}
