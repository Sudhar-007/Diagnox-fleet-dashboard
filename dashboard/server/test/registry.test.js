import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { rules } from '../config/rules.js';
import { riskScore } from '../engine/risk.js';
import { createRegistry } from '../services/registry.js';
import { createJsonStorage, createMemoryStorage } from '../services/storage.js';
import { createServer } from '../app.js';
import { formatTs, parseTs } from '../engine/time.js';

const T0 = parseTs('2026-09-10T10:00:00');
const base = {
  truck_id: 'TN03',
  latitude: 13.0,
  longitude: 80.2,
  coolant_temp: 90,
  oil_temp: 88,
  battery_voltage: 13.9,
  rpm: 1800,
  engine_load: 50,
  speed: 40,
};
const series = (segments) => {
  const out = [];
  for (const [n, over] of segments) {
    for (let i = 0; i < n; i++) out.push({ ...base, ...over, timestamp: formatTs(T0 + out.length * 1000) });
  }
  return out;
};

test('risk: healthy truck scores 0', () => {
  const r = riskScore(series([[600, {}]]), rules.health, rules.risk);
  assert.equal(r.score, 0);
  assert.deepEqual(r.breakdown, []);
});

test('risk: coolant at the critical line for half the window gives half the coolant weight', () => {
  const r = riskScore(series([[300, {}], [300, { coolant_temp: 110 }]]), rules.health, rules.risk);
  const coolant = r.breakdown.find((b) => b.field === 'coolant_temp');
  assert.equal(coolant.exposure, 0.5);
  assert.equal(coolant.intensity, 1);
  assert.equal(coolant.points, rules.risk.weights.coolant_temp * 0.5);
  assert.equal(r.score, Math.round(coolant.points));
});

test('risk: engine-off time is not counted for battery', () => {
  const r = riskScore(
    series([
      [300, { rpm: 0, battery_voltage: 12.5 }],
      [300, { battery_voltage: 13.0 }],
    ]),
    rules.health,
    rules.risk,
  );
  const batt = r.breakdown.find((b) => b.field === 'battery_voltage');
  assert.equal(batt.exposure, 1, 'all running time was low');
  assert.ok(r.score <= 100);
});

test('registry: seeds five trucks and validates manager input', () => {
  const reg = createRegistry({ storage: createMemoryStorage() });
  assert.equal(reg.listTrucks().length, 5);
  assert.equal(reg.truckInfo('TN01').driver_name, 'Ravi Kumar');
  assert.equal(reg.truckInfo('XX9').driver_name, 'Not in fleet list');

  const t = reg.addTruck({ truck_id: 'TN06', registration: 'TN 09 AB 1234', model: 'Tata Signa 4825', tank_capacity_l: 350 });
  assert.equal(t.truck_id, 'TN06');
  // kept exactly as entered, because it must match what the device sends
  assert.equal(reg.addTruck({ truck_id: 'tn09' }).truck_id, 'tn09');
  assert.equal(reg.truckInfo('tn09').in_registry, true);
  assert.equal(reg.truckInfo('TN09').in_registry, false);
  assert.throws(() => reg.addTruck({ truck_id: 'TN10', tank_capacity_l: true }), /tank_capacity_l must be/);
  assert.throws(() => reg.updateTruck('TN06', { tank_capacity_l: null }), /tank_capacity_l is required/);
  assert.equal(reg.updateTruck('TN06', { model: 'Tata Prima' }).tank_capacity_l, 350, 'fields left out keep their value');
  assert.throws(() => reg.addTruck({ truck_id: 'TN06' }), /already exists/);
  assert.throws(() => reg.addTruck({ truck_id: 'bad id!' }), /truck_id must be/);
  assert.throws(() => reg.addTruck({ truck_id: 'TN07', tank_capacity_l: 5 }), /tank_capacity_l must be/);
  assert.throws(() => reg.updateTruck('TN06', { driver_id: 'D01' }), /already assigned to TN01/);

  const d = reg.addDriver({ name: 'Priya Devi', phone: '98400 12345' });
  reg.updateTruck('TN06', { driver_id: d.driver_id });
  assert.equal(reg.truckInfo('TN06').driver_name, 'Priya Devi');
  assert.throws(() => reg.addDriver({ name: '  ' }), /name is required/);
});

test('registry: service records are validated and newest first', () => {
  const reg = createRegistry({ storage: createMemoryStorage() });
  const now = parseTs('2026-09-25T12:00:00');
  reg.addServiceRecord({ truck_id: 'TN03', date: '2026-08-01', type: 'Oil change', odometer_km: 120500, cost_inr: 4200 }, now);
  reg.addServiceRecord({ truck_id: 'TN03', date: '2026-09-20', type: 'Coolant service', notes: 'Hose replaced' }, now);
  assert.deepEqual(
    reg.listServiceRecords({ truck_id: 'TN03' }).map((s) => s.date),
    ['2026-09-20', '2026-08-01'],
  );
  assert.throws(() => reg.addServiceRecord({ truck_id: 'TN03', date: '2026-09-01', type: 'Brakes', odometer_km: true }, now), /odometer_km/);
  assert.throws(() => reg.addServiceRecord({ truck_id: 'TN03', date: '2026-10-01', type: 'Brakes' }, now), /future/);
  assert.throws(() => reg.addServiceRecord({ truck_id: 'TN03', date: '2026-02-30', type: 'Brakes' }, now), /not a real date/);
  assert.throws(() => reg.addServiceRecord({ truck_id: 'TN03', date: '2026-09-01', type: 'Paint' }, now), /type must be/);
  assert.throws(() => reg.addServiceRecord({ truck_id: 'TN99', date: '2026-09-01', type: 'Brakes' }, now), /unknown truck/);
  assert.throws(
    () => reg.addServiceRecord({ truck_id: 'TN03', date: '2026-09-01', type: 'Brakes', cost_inr: -5 }, now),
    /cost_inr/,
  );
});

test('json storage: manager data survives a restart', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-'));
  try {
    const first = createRegistry({ storage: createJsonStorage({ dir }) });
    first.addTruck({ truck_id: 'TN08', model: 'Ashok Leyland 2820' });
    const second = createRegistry({ storage: createJsonStorage({ dir }) });
    assert.equal(second.listTrucks().find((t) => t.truck_id === 'TN08').model, 'Ashok Leyland 2820');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('HTTP: registry endpoints and risk score on truck payloads', async () => {
  let push;
  const bff = createServer({
    rules,
    allowedOrigins: ['http://localhost:5173'],
    log: { error() {}, warn() {}, log() {} },
    makeSource: (onPoints) => {
      push = onPoints;
      return { start() {}, stop() {}, mode: () => 'test', requestedMode: () => 'test' };
    },
  });
  const port = await bff.listen(0);
  const api = `http://127.0.0.1:${port}/api`;
  const send = (method, p, body) =>
    fetch(`${api}${p}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body && JSON.stringify(body),
    });
  try {
    const reg = await (await fetch(`${api}/registry`)).json();
    assert.equal(reg.trucks.length, 5);
    assert.ok(reg.service_types.includes('Brakes'));

    assert.equal((await send('POST', '/registry/trucks', { truck_id: 'TN06' })).status, 201);
    assert.equal((await send('POST', '/registry/trucks', { truck_id: 'TN06' })).status, 409);
    assert.equal((await send('PUT', '/registry/trucks/TN99', {})).status, 404);
    assert.equal((await send('DELETE', '/registry/trucks/TN06')).status, 200);

    const today = formatTs(Date.now()).slice(0, 10);
    assert.equal((await send('POST', '/service-records', { truck_id: 'TN01', date: today, type: 'Inspection' })).status, 201);
    assert.equal((await send('POST', '/service-records', { truck_id: 'TN01', date: today, type: 'x' })).status, 400);
    const recs = await (await fetch(`${api}/service-records?truck_id=TN01`)).json();
    assert.equal(recs.records.length, 1);

    push([{ ...base, truck_id: 'TN01', coolant_temp: 112, timestamp: formatTs(Date.now()) }], 'SIM');
    const trucks = await (await fetch(`${api}/trucks`)).json();
    const tn01 = trucks.trucks.find((t) => t.truck_id === 'TN01');
    assert.equal(typeof tn01.rule_risk_score, 'number');
    assert.ok(tn01.risk_breakdown.some((b) => b.field === 'coolant_temp'));
    assert.equal(tn01.driver_name, 'Ravi Kumar');
  } finally {
    await bff.close();
  }
});

test('risk: worst value is the furthest reading, not the first one at the cap', () => {
  const r = riskScore(series([[100, { coolant_temp: 110.5 }], [100, { coolant_temp: 118 }]]), rules.health, rules.risk);
  assert.equal(r.breakdown.find((b) => b.field === 'coolant_temp').worst_value, 118);
});

test('json storage: a corrupt file is kept aside, never silently overwritten', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-'));
  const quiet = { error() {} };
  try {
    const first = createRegistry({ storage: createJsonStorage({ dir }), log: quiet });
    first.addTruck({ truck_id: 'TN08' });
    first.addServiceRecord({ truck_id: 'TN08', date: '2026-09-01', type: 'Brakes' });
    fs.writeFileSync(path.join(dir, 'trucks.json'), '[{"truck_id": "TN08"'); // truncated
    fs.writeFileSync(path.join(dir, 'service_records.json'), '{}'); // not a list
    const errors = [];
    const second = createRegistry({ storage: createJsonStorage({ dir }), log: { error: (m) => errors.push(m) } });
    assert.equal(errors.length, 2);
    assert.equal(second.listTrucks().length, 5, 're-seeded trucks');
    const kept = fs.readdirSync(dir).filter((n) => n.includes('.corrupt-'));
    assert.equal(kept.length, 2, 'both unreadable files kept on disk');
    assert.ok(fs.readFileSync(path.join(dir, kept.find((n) => n.startsWith('trucks'))), 'utf8').includes('TN08'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('registry: a failed save changes nothing in memory', () => {
  const mem = createMemoryStorage();
  const reg = createRegistry({ storage: mem });
  mem.save = () => {
    throw new Error('disk full');
  };
  assert.throws(() => reg.addTruck({ truck_id: 'TN06' }), /disk full/);
  assert.equal(reg.listTrucks().some((t) => t.truck_id === 'TN06'), false);
});

test('risk: a short cranking dip right after start does not look like all-the-time low battery', () => {
  const r = riskScore(series([[300, { rpm: 0, battery_voltage: 12.6 }], [5, { battery_voltage: 12.0 }]]), rules.health, rules.risk);
  const batt = r.breakdown.find((b) => b.field === 'battery_voltage');
  assert.ok(batt.exposure <= 5 / rules.risk.min_judged_s + 0.001);
  assert.ok(r.score < 5);
});

test('drivers: add onto a truck, move, edit, remove', () => {
  const reg = createRegistry({ storage: createMemoryStorage(), log: { error() {}, warn() {} } });
  const before = reg.listTrucks().find((t) => t.truck_id === 'TN01').driver_id;
  const d = reg.addDriver({ name: 'Kavya', truck_id: 'TN01' });
  assert.equal(d.truck_id, 'TN01');
  assert.equal(reg.truckInfo('TN01').driver_name, 'Kavya');
  assert.equal(reg.listDrivers().find((x) => x.driver_id === before).truck_id, null, 'previous driver is off the truck');
  const moved = reg.updateDriver(d.driver_id, { truck_id: 'TN02', phone: '99999 00000' });
  assert.equal(moved.truck_id, 'TN02');
  assert.equal(moved.name, 'Kavya', 'fields left out keep their value');
  assert.equal(reg.listTrucks().find((t) => t.truck_id === 'TN01').driver_id, null);
  assert.throws(() => reg.updateDriver(d.driver_id, { truck_id: 'NOPE' }), /unknown truck NOPE/);
  assert.equal(reg.updateDriver(d.driver_id, { truck_id: '' }).truck_id, null);
  reg.updateDriver(d.driver_id, { truck_id: 'TN03' });
  reg.removeDriver(d.driver_id);
  assert.equal(reg.listTrucks().find((t) => t.truck_id === 'TN03').driver_id, null);
  assert.throws(() => reg.removeDriver(d.driver_id), /unknown driver/);
});

test('refuels: validated against the truck, newest first, removable', () => {
  const reg = createRegistry({ storage: createMemoryStorage(), log: { error() {}, warn() {} } });
  const now = parseTs('2026-09-10T12:00:00');
  const a = reg.addRefuel({ truck_id: 'TN01', litres: 120, cost_inr: 11_000, at: '2026-09-10T09:30' }, now);
  assert.equal(a.at, '2026-09-10T09:30:00');
  const b = reg.addRefuel({ truck_id: 'TN01', litres: '40' }, now);
  assert.equal(b.at, '2026-09-10T12:00:00', 'defaults to now');
  assert.deepEqual(reg.listRefuels({ truck_id: 'TN01' }).map((r) => r.id), [b.id, a.id]);
  assert.throws(() => reg.addRefuel({ truck_id: 'TN01', litres: 301 }, now), /litres/);
  assert.throws(() => reg.addRefuel({ truck_id: 'NOPE', litres: 10 }, now), /unknown truck/);
  assert.throws(() => reg.addRefuel({ truck_id: 'TN01', litres: 10, at: '2026-09-10T13:00' }, now), /future/);
  reg.removeRefuel(a.id);
  assert.equal(reg.listRefuels().length, 1);
});
