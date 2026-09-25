import http from 'node:http';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';

import { createStore } from './services/store.js';
import { createFleet } from './services/fleet.js';
import { createAlertService } from './services/alerts.js';
import { originChecker } from './services/cors.js';
import { trucksRouter } from './routes/trucks.js';
import { healthRouter } from './routes/health.js';
import { alertsRouter } from './routes/alerts.js';

// Wires store, engines, REST and Socket.IO around a telemetry source.
// `makeSource(onPoints)` must return { start, stop, mode, requestedMode }.
export function createServer({ rules, allowedOrigins, makeSource, log = console }) {
  const checkOrigin = originChecker(allowedOrigins);
  const startedAt = Date.now();
  const store = createStore({ capacity: 5000, maxFutureS: rules.ingest.max_future_s });
  const fleet = createFleet({ store, rules });
  const alerts = createAlertService({ rules });

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
        io.emit('truck:update', { ...payload, server_time: nowMs });
        for (const change of alerts.evaluate(payload, nowMs)) emitAlertChange(change);
      } catch (err) {
        log.error(`[bff] alert evaluation failed for ${payload.truck_id}:`, err.message);
      }
    }
  });

  // Trucks that stop reporting cannot recover their alerts; mark them "no data".
  const SWEEP_MS = 2000;
  let sweepTimer = null;
  const runSweep = () => {
    try {
      for (const change of alerts.sweep((id) => store.meta(id)?.received_at ?? null)) emitAlertChange(change);
    } catch (err) {
      log.error('[bff] alert sweep failed:', err.message);
    }
  };

  app.disable('x-powered-by');
  app.use(cors({ origin: checkOrigin }));
  app.use(express.json({ limit: '100kb' }));
  app.use('/api', healthRouter({ source, fleet, startedAt }));
  app.use('/api', trucksRouter({ fleet, store, rules }));
  app.use('/api', alertsRouter({ alerts, onChange: emitAlertChange }));
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
