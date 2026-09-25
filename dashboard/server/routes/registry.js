import { Router } from 'express';

import { RegistryError, SERVICE_TYPES } from '../services/registry.js';

// Fleet manager input: trucks, drivers, service records.
export function registryRouter({ registry, onChange }) {
  const r = Router();

  const handle = (fn, status = 200) => (req, res) => {
    try {
      const out = fn(req);
      if (req.method !== 'GET') onChange();
      res.status(status).json(out ?? { ok: true });
    } catch (err) {
      if (err instanceof RegistryError) return res.status(err.status).json({ error: err.message });
      throw err;
    }
  };

  r.get('/registry', handle(() => ({
    trucks: registry.listTrucks(),
    drivers: registry.listDrivers(),
    service_types: SERVICE_TYPES,
    storage: registry.storage,
  })));

  r.post('/registry/trucks', handle((req) => ({ truck: registry.addTruck(req.body ?? {}) }), 201));
  r.put('/registry/trucks/:truck_id', handle((req) => ({ truck: registry.updateTruck(req.params.truck_id, req.body ?? {}) })));
  r.delete('/registry/trucks/:truck_id', handle((req) => registry.removeTruck(req.params.truck_id)));

  r.post('/registry/drivers', handle((req) => ({ driver: registry.addDriver(req.body ?? {}) }), 201));

  r.get('/service-records', handle((req) => ({ records: registry.listServiceRecords({ truck_id: req.query.truck_id }) })));
  r.post('/service-records', handle((req) => ({ record: registry.addServiceRecord(req.body ?? {}) }), 201));
  r.delete('/service-records/:id', handle((req) => registry.removeServiceRecord(req.params.id)));

  return r;
}
