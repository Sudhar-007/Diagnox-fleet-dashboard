import { randomUUID } from 'node:crypto';

import { geofences as seedZones } from '../config/geofences.js';
import { formatTs } from '../engine/time.js';
import { InputError, TRUCK_ID, bad, number, text } from './input.js';
import { loadOrReseed } from './storage.js';

export const ZONE_TYPES = ['allowed', 'restricted'];
const MAX_TRUCKS = 50;
const MAX_ZONES = 100;

function truckIds(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) bad('truck_ids must be a list of truck IDs');
  if (value.length > MAX_TRUCKS) bad(`truck_ids can list at most ${MAX_TRUCKS} trucks`);
  const ids = value.map((v) => (typeof v === 'string' ? v.trim() : v));
  for (const id of ids) if (typeof id !== 'string' || !TRUCK_ID.test(id)) bad(`${id} is not a valid truck ID`);
  return [...new Set(ids)].sort();
}

function zoneFields(body) {
  if (!ZONE_TYPES.includes(body.type)) bad('type must be allowed or restricted');
  if (body.alert != null && typeof body.alert !== 'boolean') bad('alert must be true or false');
  const fields = {
    name: text(body.name, 'name', 60, { required: true }),
    center_lat: number(body.center_lat, 'center_lat', -90, 90, { required: true }),
    center_lng: number(body.center_lng, 'center_lng', -180, 180, { required: true }),
    radius_m: number(body.radius_m, 'radius_m', 50, 50_000, { required: true }),
    type: body.type,
    alert: body.alert ?? true,
    truck_ids: truckIds(body.truck_ids),
  };
  if (fields.center_lat === 0 && fields.center_lng === 0) bad('the centre cannot be 0, 0');
  return fields;
}

// Circular zones entered by the fleet manager. Same pattern as the registry: saved first,
// applied in memory only once the save succeeded. Seeded from config/geofences.js.
export function createGeofences({ storage, log = console }) {
  const nowTs = () => formatTs(Date.now());
  let zones = loadOrReseed(storage, 'geofences', log);
  // A hand-edited or older file may hold zones the engine cannot judge; keep only valid ones.
  if (zones) {
    zones = zones.flatMap((z) => {
      try {
        if (typeof z?.id !== 'string' || !z.id) bad('id is missing');
        return [{ ...z, ...zoneFields(z) }];
      } catch (err) {
        log.error(`[geofences] skipped a saved zone (${z?.name ?? z?.id ?? 'unnamed'}): ${err.message}`);
        return [];
      }
    });
  }
  if (!zones) {
    zones = seedZones.map((z) => ({ ...z, source: 'seed', updated_at: nowTs() }));
    storage.save('geofences', zones);
  }

  const commit = (next) => {
    storage.save('geofences', next);
    zones = next;
  };
  const find = (id) => zones.find((z) => z.id === id);
  const checkName = (name, exceptId) => {
    const clash = zones.find((z) => z.id !== exceptId && z.name.toLowerCase() === name.toLowerCase());
    if (clash) throw new InputError(409, `a zone named ${clash.name} already exists`);
  };

  return {
    list: () => zones.map((z) => ({ ...z, truck_ids: [...z.truck_ids] })),
    get: (id) => (find(id) ? { ...find(id) } : null),

    add(body = {}) {
      if (zones.length >= MAX_ZONES) throw new InputError(409, `at most ${MAX_ZONES} zones; remove one first`);
      const fields = zoneFields(body);
      checkName(fields.name);
      const zone = { id: `Z-${randomUUID().slice(0, 8)}`, ...fields, source: 'manager', updated_at: nowTs() };
      commit([...zones, zone]);
      return zone;
    },

    // Fields left out keep their value.
    update(id, body = {}) {
      const existing = find(id);
      if (!existing) throw new InputError(404, `unknown zone ${id}`);
      const given = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== null));
      const fields = zoneFields({ ...existing, ...given });
      checkName(fields.name, id);
      const zone = { ...existing, ...fields, source: 'manager', updated_at: nowTs() };
      commit(zones.map((z) => (z.id === id ? zone : z)));
      return zone;
    },

    remove(id) {
      if (!find(id)) throw new InputError(404, `unknown zone ${id}`);
      commit(zones.filter((z) => z.id !== id));
    },
  };
}
