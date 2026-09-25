import { Router } from 'express';

import { inputHandler } from './handle.js';

// Settings: geofence zones and alert thresholds.
export function settingsRouter({ geofences, ruleSettings, alerts, onZonesChange, onRulesChange }) {
  const r = Router();
  const zones = inputHandler(onZonesChange);
  const thresholds = inputHandler(onRulesChange);

  r.get('/geofences', zones((req) => ({
    zones: geofences.list(),
    visits: alerts.visits({ limit: 100, truck_id: req.query.truck_id || undefined }),
  })));
  r.post('/geofences', zones((req) => ({ zone: geofences.add(req.body ?? {}) }), 201));
  r.put('/geofences/:id', zones((req) => ({ zone: geofences.update(req.params.id, req.body ?? {}) })));
  r.delete('/geofences/:id', zones((req) => geofences.remove(req.params.id)));

  r.get('/rules', thresholds(() => ruleSettings.view()));
  r.put('/rules', thresholds((req) => ruleSettings.update(req.body ?? {})));

  return r;
}
