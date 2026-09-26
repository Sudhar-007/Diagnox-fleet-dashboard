import http from 'node:http';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';

import { createStore } from './services/store.js';
import { createFleet } from './services/fleet.js';
import { createRegistry } from './services/registry.js';
import { createGeofences } from './services/geofences.js';
import { createRuleSettings } from './services/ruleSettings.js';
import { createTripService } from './services/trips.js';
import { createDrivingService } from './services/driving.js';
import { createFuelService } from './services/fuel.js';
import { createAnalytics } from './services/analytics.js';
import { createMemoryStorage } from './services/storage.js';
import { createAlertService } from './services/alerts.js';
import { createScenarioService } from './services/scenarios.js';
import { computePipeline } from './services/pipeline.js';
import { originChecker } from './services/cors.js';
import { parseTs } from './engine/time.js';
import { loadForest } from './engine/mlRisk.js';
import { appliesTo, distanceM, hasFix } from './engine/geofence.js';
import { trucksRouter } from './routes/trucks.js';
import { healthRouter } from './routes/health.js';
import { alertsRouter } from './routes/alerts.js';
import { demoRouter } from './routes/demo.js';
import { registryRouter } from './routes/registry.js';
import { settingsRouter } from './routes/settings.js';
import { tripsRouter } from './routes/trips.js';
import { drivingRouter } from './routes/driving.js';
import { fuelRouter } from './routes/fuel.js';
import { analyticsRouter } from './routes/analytics.js';
import { telemetryRouter } from './routes/telemetry.js';
import { PROVENANCE } from './services/source.js';
import { createBenchPositions } from './services/bench.js';
import { benchLoop } from './sim/routes.js';

// Wires store, engines, REST and Socket.IO around a telemetry source.
// `makeSource(onPoints)` must return { start, stop, mode, requestedMode } and, when it runs
// the simulator, `sim` (used by demo scenarios). `onPoints(points, provenance, { backfill })`:
// backfilled points (warm start history) are stored and fed to the timeline engines only (trips,
// driver events, risk sampling, fuel); they raise no alerts and are not broadcast.
// Read once; every server instance shares the same read-only model.
const maintenanceForest = loadForest();

export function createServer({
  rules: baseRules,
  allowedOrigins,
  makeSource,
  storage = createMemoryStorage(),
  demoEnabled = true,
  forest = maintenanceForest,
  // Road router for demo detours ((from, to) -> Promise of [[lat, lng], ...]); OSRM when omitted.
  roadRoute,
  // Key the truck device must send in x-api-key to POST /api/telemetry; no key, no device data.
  telemetryKey = null,
  // Device trucks that cannot move (bench boards): placed along a road loop by their speed.
  benchTrucks = [],
  log = console,
}) {
  // Thresholds are edited at runtime (Settings), so each server works on its own copy.
  const rules = structuredClone(baseRules);
  const checkOrigin = originChecker(allowedOrigins);
  const startedAt = Date.now();
  const store = createStore({ capacity: 5000, maxFutureS: rules.ingest.max_future_s });
  const registry = createRegistry({ storage, log });
  const geofences = createGeofences({ storage, log });
  const ruleSettings = createRuleSettings({ rules, storage, log });
  const alerts = createAlertService({
    rules,
    zones: geofences.list,
    onVisit: (visit) => io.emit('zone:visit', visit),
  });
  const fuel = createFuelService({ rules, capacityOf: (id) => registry.truckInfo(id).tank_capacity_l });
  const fleet = createFleet({ store, rules, registry, zonesInside: alerts.zonesInside, fuelOf: fuel.of, forest });
  const trips = createTripService({
    rules,
    zones: geofences.list,
    alertsFor: (truck_id) =>
      alerts
        .list({ truck_id })
        .map((a) => ({ id: a.id, kind: a.kind, name: a.name, level: a.level, opened_at: a.opened_at }))
        .reverse(),
  });
  const analytics = createAnalytics({ store, rules, alerts, trips, fuel, registry });
  const driving = createDrivingService({ rules, onRecord: (event) => trips.recordEvent(event) });
  // Trip changes may carry driver events a starting trip claimed; a driver event goes out
  // with the trip whose score it changed.
  const emitTrip = ({ trip, event }) => {
    if (trip) io.emit('trip:update', { trip });
    if (event) io.emit('driver:event', { event });
  };
  const emitDriving = ({ event, trip }) => {
    io.emit('driver:event', { event });
    if (trip) emitTrip(trip);
  };
  const emitFuel = ({ event }) => io.emit('fuel:event', { event });
  const driverInfo = (truck_id) => {
    const { driver_id, driver_name } = registry.truckInfo(truck_id);
    return { driver_id, driver_name };
  };

  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: { origin: checkOrigin },
    transports: ['websocket', 'polling'],
  });

  const emitAlertChange = ({ kind, alert, event }) => {
    io.emit(kind === 'new' ? 'alert:new' : 'alert:update', { alert, event });
  };

  // Returns how many points the store kept.
  const handlePoints = (points, provenance, { backfill = false } = {}) => {
    const nowMs = Date.now();
    // Trip and driver event detection judge every stored point, in time order (not only the
    // newest per truck). Events are judged after the trip, so a trip that starts on this point
    // exists when its score changes.
    const feedTrips = (accepted, broadcast) => {
      accepted.sort((a, b) => parseTs(a.timestamp) - parseTs(b.timestamp));
      for (const p of accepted) {
        const info = { ...driverInfo(p.truck_id), provenance };
        try {
          const changes = trips.ingest(p, info, nowMs);
          if (broadcast) for (const change of changes) emitTrip(change);
        } catch (err) {
          log.error(`[bff] trip detection failed for ${p.truck_id}:`, err.message);
        }
        try {
          const changes = driving.ingest(p, info, nowMs);
          if (broadcast) for (const change of changes) emitDriving(change);
        } catch (err) {
          log.error(`[bff] driver event detection failed for ${p.truck_id}:`, err.message);
        }
        try {
          analytics.observe(p);
        } catch (err) {
          log.error(`[bff] risk sample failed for ${p.truck_id}:`, err.message);
        }
        try {
          const changes = fuel.ingest(p, info, nowMs);
          if (broadcast) for (const change of changes) emitFuel(change);
        } catch (err) {
          log.error(`[bff] fuel tracking failed for ${p.truck_id}:`, err.message);
        }
      }
    };
    if (backfill) {
      try {
        const accepted = [];
        fleet.backfill(points, provenance, nowMs, (p) => accepted.push(p));
        feedTrips(accepted, false);
        return accepted.length;
      } catch (err) {
        log.error('[bff] dropped a batch of history points:', err.message);
        return 0;
      }
    }
    let payloads;
    const accepted = [];
    try {
      payloads = fleet.ingest(points, provenance, nowMs, (p) => accepted.push(p));
    } catch (err) {
      log.error('[bff] dropped a batch of points:', err.message);
      return 0;
    }
    // Timeline engines first, so the fuel level sent with truck:update includes this batch. A
    // failure here must not hold back alerts or positions.
    try {
      feedTrips(accepted, true);
    } catch (err) {
      log.error('[bff] timeline engines failed for a batch:', err.message);
    }
    // One truck failing must not stop the others in the same batch.
    for (const payload of payloads) {
      try {
        const tMs = parseTs(payload.timestamp);
        // Recent prior points for the collision heuristic.
        const recent = store.history(payload.truck_id, {
          fromMs: tMs - (rules.sos.collision.within_s + 2) * 1000,
          toMs: tMs - 1,
        });
        for (const change of alerts.evaluate(payload, nowMs, recent)) emitAlertChange(change);
      } catch (err) {
        log.error(`[bff] alert evaluation failed for ${payload.truck_id}:`, err.message);
      }
      // The live position goes out even if evaluation failed. Zone membership is as confirmed
      // by this very point, so it is read after evaluation.
      let zones_inside = [];
      try {
        zones_inside = alerts.zonesInside(payload.truck_id);
      } catch (err) {
        log.error(`[bff] zone lookup failed for ${payload.truck_id}:`, err.message);
      }
      let fuelNow = payload.fuel;
      try {
        fuelNow = fuel.of(payload.truck_id);
      } catch (err) {
        log.error(`[bff] fuel lookup failed for ${payload.truck_id}:`, err.message);
      }
      io.emit('truck:update', { ...payload, zones_inside, fuel: fuelNow, server_time: nowMs });
    }
    return accepted.length;
  };
  const source = makeSource(handlePoints);

  // Ids the simulator drives. A device may not push these: mixing simulated and real readings
  // on one truck would fake collisions, harsh braking and trip jumps.
  const simIds = new Set(source.sim?.truckIds?.() ?? []);
  const bench = createBenchPositions({
    truckIds: benchTrucks,
    loop: benchLoop,
    maxStepS: rules.freshness.stale_after_s,
    maxFutureS: rules.ingest.max_future_s,
  });
  if (benchTrucks.length && !benchLoop) log.error('[bff] BENCH_TRUCKS is set but the bench road loop is missing');

  // Device pushes go in one point at a time, oldest first, so every point of a backlog sent
  // after a 4G outage is judged for alerts, SOS and collisions, not only the newest.
  // A backlog yields to the event loop every YIELD_EVERY points so the simulator and other
  // requests keep running; requests are queued so two pushes never interleave.
  const YIELD_EVERY = 25;
  let deviceQueue = Promise.resolve();
  const ingestDevice = (points) => {
    const run = async () => {
      const sorted = [...points].sort((a, b) => parseTs(a.timestamp) - parseTs(b.timestamp));
      let kept = 0;
      for (let i = 0; i < sorted.length; i++) {
        if (i > 0 && i % YIELD_EVERY === 0) await new Promise((resolve) => setImmediate(resolve));
        kept += handlePoints([bench.place(sorted[i])], PROVENANCE.LIVE_HW);
      }
      return kept;
    };
    const result = deviceQueue.then(run);
    deviceQueue = result.catch(() => {});
    return result;
  };

  // Geofence breach demo: the nearest restricted zone that covers the truck, preferring
  // zones that raise alerts.
  const restrictedZoneFor = (truck_id) => {
    const p = store.latest(truck_id);
    const dist = (z) => (p && hasFix(p) ? distanceM(z, p.latitude, p.longitude) : 0);
    const candidates = geofences.list().filter((z) => z.type === 'restricted' && appliesTo(z, truck_id));
    return candidates.sort((a, b) => Number(b.alert) - Number(a.alert) || dist(a) - dist(b))[0] ?? null;
  };
  const scenarios = createScenarioService({
    sim: source.sim ?? null,
    enabled: demoEnabled,
    restrictedZoneFor,
    ...(roadRoute ? { roadRoute } : {}),
  });
  const pipeline = () =>
    computePipeline({ mode: source.mode(), trucks: fleet.snapshot(), nowMs: Date.now(), startedAt });

  // Every 2 s: trucks that stopped reporting cannot recover their alerts, so mark them
  // "no data"; and push the pipeline status for the header strip.
  const SWEEP_MS = 2000;
  let sweepTimer = null;
  const runSweep = () => {
    try {
      const lastReceived = (id) => store.meta(id)?.received_at ?? null;
      for (const change of alerts.sweep(lastReceived)) emitAlertChange(change);
      for (const change of trips.sweep()) emitTrip(change);
      for (const change of driving.sweep(Date.now(), driverInfo)) emitDriving(change);
      for (const change of fuel.sweep(Date.now(), driverInfo)) emitFuel(change);
      io.emit('pipeline:status', pipeline());
    } catch (err) {
      log.error('[bff] periodic sweep failed:', err.message);
    }
  };

  app.disable('x-powered-by');
  app.use(cors({ origin: checkOrigin }));
  app.use(
    '/api',
    telemetryRouter({
      apiKey: telemetryKey,
      enabled: () => Boolean(source.acceptsDevice?.()),
      reserved: (id) => simIds.has(id),
      maxPastS: rules.ingest.max_past_s,
      ingest: ingestDevice,
      log,
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.use('/api', healthRouter({ source, fleet, startedAt, pipeline, benchTrucks: bench.ids }));
  app.use('/api', trucksRouter({ fleet, store, rules }));
  app.use('/api', alertsRouter({ alerts, fleet, onChange: emitAlertChange }));
  app.use('/api', demoRouter({ scenarios }));
  app.use('/api', tripsRouter({ trips }));
  app.use('/api', drivingRouter({ driving }));
  app.use('/api', fuelRouter({ fuel, rules }));
  app.use('/api', analyticsRouter({ analytics }));
  app.use(
    '/api',
    registryRouter({
      registry,
      onChange: () => io.emit('registry:update'),
      // A manager refuel raises the fuel estimate; the new level goes out at once.
      onRefuel: (refuel) => {
        try {
          const applied = fuel.refuel(refuel.truck_id, refuel.litres, refuel.at);
          if (applied) io.emit('fuel:level', { truck_id: refuel.truck_id, fuel: fuel.of(refuel.truck_id) });
          return applied;
        } catch (err) {
          log.error('[bff] refuel saved but not applied to the estimate:', err.message);
          return false;
        }
      },
    }),
  );
  app.use(
    '/api',
    settingsRouter({
      geofences,
      ruleSettings,
      alerts,
      onZonesChange: () => {
        io.emit('geofences:update');
        for (const change of alerts.syncZones()) emitAlertChange(change);
      },
      onRulesChange: (out) => {
        io.emit('rules:update');
        for (const change of alerts.rulesChanged(new Set(out?.changed_fields ?? []))) emitAlertChange(change);
      },
    }),
  );
  app.use('/api', (req, res) => res.status(404).json({ error: 'not found' }));
  // Malformed JSON bodies and other request errors: answer with JSON, not an HTML stack.
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = err.status && err.status < 500 ? err.status : 500;
    if (status === 500) log.error('[bff] request failed:', err.message);
    res.status(status).json({ error: status === 500 ? 'internal error' : err.message });
  });

  return {
    app,
    server,
    io,
    source,
    alerts,
    fleet,
    scenarios,
    pipeline,
    registry,
    geofences,
    ruleSettings,
    trips,
    driving,
    fuel,
    analytics,
    rules,
    runSweep,
    listen(port) {
      source.start();
      sweepTimer = setInterval(runSweep, SWEEP_MS);
      return new Promise((resolve) => server.listen(port, () => resolve(server.address().port)));
    },
    close() {
      clearInterval(sweepTimer);
      source.stop();
      io.close();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}
