import dotenv from 'dotenv';
import http from 'node:http';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';

import { rules } from './config/rules.js';
import { createStore } from './services/store.js';
import { createFleet } from './services/fleet.js';
import { createSource } from './services/source.js';
import { parseOrigins, originChecker } from './services/cors.js';
import { trucksRouter } from './routes/trucks.js';
import { healthRouter } from './routes/health.js';

dotenv.config({ quiet: true });
if (!process.env.TZ) {
  console.warn('[bff] TZ is not set; contract timestamps will be read in the host timezone');
}

const PORT = Number(process.env.PORT) || 4000;
const DATA_SOURCE = process.env.DATA_SOURCE || 'mock';
const allowedOrigins = parseOrigins(process.env.CORS_ORIGINS || 'http://localhost:5173');
const checkOrigin = originChecker(allowedOrigins);

const startedAt = Date.now();
const store = createStore({ capacity: 5000, maxFutureS: rules.ingest.max_future_s });
const fleet = createFleet({ store, rules });

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: checkOrigin },
  transports: ['websocket', 'polling'],
});

const source = createSource({
  mode: DATA_SOURCE,
  onPoints(points, provenance) {
    try {
      for (const payload of fleet.ingest(points, provenance)) {
        io.emit('truck:update', { ...payload, server_time: Date.now() });
      }
    } catch (err) {
      console.error('[bff] dropped a batch of points:', err.message);
    }
  },
});

app.disable('x-powered-by');
app.use(cors({ origin: checkOrigin }));
app.use(express.json({ limit: '100kb' }));
app.use('/api', healthRouter({ source, fleet, startedAt }));
app.use('/api', trucksRouter({ fleet, store, rules }));
app.use('/api', (req, res) => res.status(404).json({ error: 'not found' }));

source.start();
server.listen(PORT, () => {
  console.log(`[bff] listening on :${PORT}, data source ${source.mode()}`);
  console.log(`[bff] CORS origins: ${allowedOrigins.map(String).join(', ')}`);
});

function shutdown() {
  source.stop();
  io.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
