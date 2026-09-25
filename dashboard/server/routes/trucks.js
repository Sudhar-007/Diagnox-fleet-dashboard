import { Router } from 'express';
import { parseTs } from '../engine/time.js';

function parseBound(value) {
  if (value == null || value === '') return undefined;
  if (/^\d+$/.test(value)) return Number(value);
  return parseTs(value) ?? undefined;
}

export function trucksRouter({ fleet, store, rules }) {
  const r = Router();

  r.get('/trucks', (req, res) => {
    res.json({
      server_time: Date.now(),
      freshness: rules.freshness,
      health_rules: rules.health,
      trip_rules: rules.trips,
      trucks: fleet.snapshot(),
    });
  });

  r.get('/trucks/:truck_id/history', (req, res) => {
    const { truck_id } = req.params;
    if (!store.meta(truck_id)) return res.status(404).json({ error: `unknown truck_id ${truck_id}` });
    const limit = /^[1-9]\d*$/.test(req.query.limit ?? '') ? Math.min(Number(req.query.limit), 5000) : undefined;
    const points = store.history(truck_id, {
      fromMs: parseBound(req.query.from) ?? -Infinity,
      toMs: parseBound(req.query.to) ?? Infinity,
      limit,
    });
    res.json({ truck_id, points });
  });

  return r;
}
