import { Router } from 'express';

// Fuel levels, consumption and anomalies (rules.fuel).
export function fuelRouter({ fuel, rules }) {
  const r = Router();

  r.get('/fuel', (req, res) => {
    res.json({ rules: rules.fuel, trucks: fuel.list(), events: fuel.events({ limit: 200 }) });
  });

  // Level samples, oldest first: { fields: ["t_ms", "level_pct", "source", "used_l", "distance_km"], rows }
  // (used_l and distance_km cumulative).
  r.get('/fuel/:truck_id/history', (req, res) => {
    const rows = fuel.history(req.params.truck_id);
    if (!rows) return res.status(404).json({ error: `no fuel data for ${req.params.truck_id}` });
    res.json({ truck_id: req.params.truck_id, fields: ['t_ms', 'level_pct', 'source', 'used_l', 'distance_km'], rows });
  });

  return r;
}
