import http from 'node:http';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';

import { createStore } from './services/store.js';
import { createFleet } from './services/fleet.js';
import { createRegistry } from './services/registry.js';
import { createGeofences } from './services/geofences.js';
import { createRuleSettings } from './services/ruleSettings.js';
import { createMemoryStorage } from './services/storage.js';
import { createAlertService } from './services/alerts.js';
import { createScenarioService } from './services/scenarios.js';
import { computePipeline } from './services/pipeline.js';
import { originChecker } from './services/cors.js';
import { parseTs } from './engine/time.js';
import { appliesTo, distanceM, hasFix } from './engine/geofence.js';
import { trucksRouter } from './routes/trucks.js';
import { healthRouter } from './routes/health.js';
import { alertsRouter } from './routes/alerts.js';
import { demoRouter } from './routes/demo.js';
import { registryRouter } from './routes/registry.js';
import { settingsRouter } from './routes/settings.js';

// Wires store, engines, REST and Socket.IO around a telemetry source.
// `makeSource(onPoints)` must return { start, stop, mode, requestedMode } and, when it runs
// the simulator, `sim` (used by demo scenarios).
export function createServer({
  rules: baseRules,
  allowedOrigins,
  makeSource,
  storage = createMemoryStorage(),
  demoEnabled = true,
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
  const fleet = createFleet({ store, rules, registry, zonesInside: alerts.zonesInside });

  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: { origin: checkOrigin },
    transports: ['websocket', 'polling'],
  });

  const emitAlertChange = ({ kind, alert, event }) => {
    io.emit(kind === 'new' ? 'alert:new' : 'alert:update', { alert, event });
  };

  const source = makeSource((points, provenance) => {
    const nowMs = Date.now();
    let payloads;
    try {
      payloads = fleet.ingest(points, provenance, nowMs);
    } catch (err) {
      log.error('[bff] dropped a batch of points:', err.message);
      return;
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
      io.emit('truck:update', { ...payload, zones_inside, server_time: nowMs });
    }
  });

  // Geofence breach demo: the nearest restricted zone that covers the truck, preferring
  // zones that raise alerts.
  const restrictedZoneFor = (truck_id) => {
    const p = store.latest(truck_id);
    const dist = (z) => (p && hasFix(p) ? distanceM(z, p.latitude, p.longitude) : 0);
    const candidates = geofences.list().filter((z) => z.type === 'restricted' && appliesTo(z, truck_id));
    return candidates.sort((a, b) => Number(b.alert) - Number(a.alert) || dist(a) - dist(b))[0] ?? null;
  };
  const scenarios = createScenarioService({ sim: source.sim ?? null, enabled: demoEnabled, restrictedZoneFor });
  const pipeline = () =>
    computePipeline({ mode: source.mode(), trucks: fleet.snapshot(), nowMs: Date.now(), startedAt });

  // Every 2 s: trucks that stopped reporting cannot recover their alerts, so mark them
  // "no data"; and push the pipeline status for the header strip.
  const SWEEP_MS = 2000;
  let sweepTimer = null;
  const runSweep = () => {
    try {
      for (const change of alerts.sweep((id) => store.meta(id)?.received_at ?? null)) emitAlertChange(change);
      io.emit('pipeline:status', pipeline());
    } catch (err) {
      log.error('[bff] periodic sweep failed:', err.message);
    }
  };

  app.disable('x-powered-by');
  app.use(cors({ origin: checkOrigin }));
  app.use(express.json({ limit: '100kb' }));
  app.use('/api', healthRouter({ source, fleet, startedAt, pipeline }));
  app.use('/api', trucksRouter({ fleet, store, rules }));
  app.use('/api', alertsRouter({ alerts, fleet, onChange: emitAlertChange }));
  app.use('/api', demoRouter({ scenarios }));
  app.use('/api', registryRouter({ registry, onChange: () => io.emit('registry:update') }));
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
