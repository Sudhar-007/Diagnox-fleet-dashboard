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
      trucks: fleet.snapshot(),
    });
  });

  r.get('/trucks/:truck_id/history', (req, res) => {
    const { truck_id } = req.params;
    if (!store.meta(truck_id)) return res.status(404).json({ error: `unknown truck_id ${truck_id}` });
    const points = store.history(truck_id, {
      fromMs: parseBound(req.query.from) ?? -Infinity,
      toMs: parseBound(req.query.to) ?? Infinity,
    });
    res.json({ truck_id, points });
  });

  return r;
}
