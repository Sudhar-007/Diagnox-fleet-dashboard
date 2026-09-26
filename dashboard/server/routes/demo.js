import { Router } from 'express';

import { ScenarioError } from '../services/scenarios.js';

export function demoRouter({ scenarios }) {
  const r = Router();

  r.get('/demo/scenarios', (req, res) => {
    res.json({ enabled: scenarios.enabled(), available: scenarios.available(), running: scenarios.running() });
  });

  // Body: { scenario, truck_id? }
  r.post('/demo/scenario', async (req, res) => {
    try {
      res.json({ run: await scenarios.launch(req.body ?? {}), running: scenarios.running() });
    } catch (err) {
      if (err instanceof ScenarioError) return res.status(err.status).json({ error: err.message });
      throw err;
    }
  });

  return r;
}
