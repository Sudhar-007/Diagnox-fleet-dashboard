import { randomUUID } from 'node:crypto';

import { DEFAULT_TANK_CAPACITY_L, fleet as seedFleet } from '../config/fleet.js';
import { formatTs } from '../engine/time.js';
import { InputError, TRUCK_ID, bad, number, text } from './input.js';
import { loadOrReseed } from './storage.js';

// Kept under its old name for the registry routes.
export const RegistryError = InputError;

export const SERVICE_TYPES = [
  'Oil change',
  'Coolant service',
  'Battery',
  'Brakes',
  'Tyres',
  'Filters',
  'Inspection',
  'Other',
];

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function date(value, field, nowMs) {
  if (typeof value !== 'string' || !DATE.test(value)) bad(`${field} must be a date like 2026-09-25`);
  const ms = new Date(`${value}T00:00:00`).getTime();
  if (Number.isNaN(ms) || formatTs(ms).slice(0, 10) !== value) bad(`${field} is not a real date`);
  if (ms > nowMs) bad(`${field} cannot be in the future`);
  return value;
}

const newId = (prefix) => `${prefix}-${randomUUID().slice(0, 8)}`;

// Trucks, drivers and service records entered by the fleet manager.
// Seeded from config/fleet.js when a collection does not exist yet.
// Every change is written to storage first and applied in memory only once saved,
// so memory and disk cannot disagree after a failed write.
export function createRegistry({ storage, log = console }) {
  const nowTs = () => formatTs(Date.now());

  const safeLoad = (name) => loadOrReseed(storage, name, log);

  let drivers = safeLoad('drivers');
  if (!drivers) {
    drivers = seedFleet.map((f) => ({
      driver_id: f.driver_id,
      name: f.driver_name,
      phone: null,
      licence_no: null,
      source: 'seed',
      created_at: nowTs(),
    }));
    storage.save('drivers', drivers);
  }
  let trucks = safeLoad('trucks');
  if (!trucks) {
    trucks = seedFleet.map((f) => ({
      truck_id: f.truck_id,
      registration: null,
      model: null,
      tank_capacity_l: f.tank_capacity_l,
      driver_id: drivers.some((d) => d.driver_id === f.driver_id) ? f.driver_id : null,
      source: 'seed',
      created_at: nowTs(),
    }));
    storage.save('trucks', trucks);
  }
  let services = safeLoad('service_records') ?? [];

  const commit = {
    trucks(next) {
      storage.save('trucks', next);
      trucks = next;
    },
    drivers(next) {
      storage.save('drivers', next);
      drivers = next;
    },
    services(next) {
      storage.save('service_records', next);
      services = next;
    },
  };

  const findTruck = (id) => trucks.find((t) => t.truck_id === id);
  const findDriver = (id) => drivers.find((d) => d.driver_id === id);

  function checkDriver(driver_id, forTruck) {
    if (driver_id == null || driver_id === '') return null;
    if (!findDriver(driver_id)) bad(`unknown driver ${driver_id}`);
    const holder = trucks.find((t) => t.driver_id === driver_id && t.truck_id !== forTruck);
    if (holder) throw new RegistryError(409, `${findDriver(driver_id).name} is already assigned to ${holder.truck_id}`);
    return driver_id;
  }

  function truckFields(body, forTruck) {
    return {
      registration: text(body.registration, 'registration', 20),
      model: text(body.model, 'model', 60),
      tank_capacity_l: number(body.tank_capacity_l, 'tank_capacity_l', 20, 2000, { required: true }),
      driver_id: checkDriver(body.driver_id, forTruck),
    };
  }

  const withDriver = (t) => ({ ...t, driver_name: findDriver(t.driver_id)?.name ?? null });

  return {
    storage: { kind: storage.kind, persistent: Boolean(storage.persistent) },

    // What the live pipeline needs to know about a truck_id.
    truckInfo(truck_id) {
      const t = findTruck(truck_id);
      const d = t ? findDriver(t.driver_id) : null;
      return {
        truck_id,
        in_registry: Boolean(t),
        registration: t?.registration ?? null,
        model: t?.model ?? null,
        tank_capacity_l: t?.tank_capacity_l ?? DEFAULT_TANK_CAPACITY_L,
        driver_id: d?.driver_id ?? null,
        driver_name: d?.name ?? (t ? 'No driver assigned' : 'Not in fleet list'),
      };
    },

    listTrucks: () => trucks.map(withDriver),
    listDrivers: () =>
      drivers.map((d) => ({ ...d, truck_id: trucks.find((t) => t.driver_id === d.driver_id)?.truck_id ?? null })),

    addTruck(body = {}) {
      const truck_id = typeof body.truck_id === 'string' ? body.truck_id.trim() : '';
      if (!TRUCK_ID.test(truck_id)) bad('truck_id must be 2 to 16 letters, digits or dashes, e.g. TN06');
      if (findTruck(truck_id)) throw new RegistryError(409, `${truck_id} already exists`);
      const fields = truckFields({ ...body, tank_capacity_l: body.tank_capacity_l ?? DEFAULT_TANK_CAPACITY_L }, truck_id);
      const truck = { truck_id, ...fields, source: 'manager', created_at: nowTs() };
      commit.trucks([...trucks, truck]);
      return withDriver(truck);
    },

    // Fields left out keep their value; tank_capacity_l cannot be cleared.
    updateTruck(truck_id, body = {}) {
      const existing = findTruck(truck_id);
      if (!existing) throw new RegistryError(404, `unknown truck ${truck_id}`);
      const merged = { ...existing, ...truckFields({ ...existing, ...body }, truck_id) };
      commit.trucks(trucks.map((t) => (t.truck_id === truck_id ? merged : t)));
      return withDriver(merged);
    },

    removeTruck(truck_id) {
      if (!findTruck(truck_id)) throw new RegistryError(404, `unknown truck ${truck_id}`);
      commit.trucks(trucks.filter((t) => t.truck_id !== truck_id));
    },

    addDriver(body = {}) {
      const fields = {
        name: text(body.name, 'name', 60, { required: true }),
        phone: text(body.phone, 'phone', 20),
        licence_no: text(body.licence_no, 'licence_no', 30),
      };
      const driver = { driver_id: newId('D'), ...fields, source: 'manager', created_at: nowTs() };
      commit.drivers([...drivers, driver]);
      return driver;
    },

    // Newest work first; same day ordered by when it was entered.
    listServiceRecords({ truck_id } = {}) {
      const out = truck_id ? services.filter((s) => s.truck_id === truck_id) : services;
      return [...out].sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at));
    },

    addServiceRecord(body = {}, nowMs = Date.now()) {
      const truck_id = typeof body.truck_id === 'string' ? body.truck_id.trim() : '';
      if (!findTruck(truck_id)) bad(`unknown truck ${truck_id}`.trim());
      if (!SERVICE_TYPES.includes(body.type)) bad(`type must be one of: ${SERVICE_TYPES.join(', ')}`);
      const fields = {
        truck_id,
        date: date(body.date, 'date', nowMs),
        type: body.type,
        odometer_km: number(body.odometer_km, 'odometer_km', 0, 5_000_000),
        cost_inr: number(body.cost_inr, 'cost_inr', 0, 10_000_000),
        notes: text(body.notes, 'notes', 500),
        by: text(body.by, 'by', 60),
      };
      const record = { id: newId('S'), ...fields, created_at: formatTs(nowMs) };
      commit.services([...services, record]);
      return record;
    },

    removeServiceRecord(id) {
      if (!services.some((s) => s.id === id)) throw new RegistryError(404, `unknown service record ${id}`);
      commit.services(services.filter((s) => s.id !== id));
    },
  };
}
