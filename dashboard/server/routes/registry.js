import { Router } from 'express';

import { SERVICE_TYPES } from '../services/registry.js';
import { inputHandler } from './handle.js';

// Fleet manager input: trucks, drivers, service records, trip assignments.
export function registryRouter({ registry, onChange }) {
  const r = Router();

  const handle = inputHandler(onChange);

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

  r.get('/trip-assignments', handle((req) => ({ assignments: registry.listAssignments({ truck_id: req.query.truck_id }) })));
  r.post('/trip-assignments', handle((req) => ({ assignment: registry.addAssignment(req.body ?? {}) }), 201));
  r.delete('/trip-assignments/:id', handle((req) => registry.removeAssignment(req.params.id)));

  return r;
}
