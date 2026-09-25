import dotenv from 'dotenv';

import { rules } from './config/rules.js';
import { createSource } from './services/source.js';
import { parseOrigins } from './services/cors.js';
import { createServer } from './app.js';
import { createJsonStorage } from './services/storage.js';

dotenv.config({ quiet: true });
if (!process.env.TZ) {
  console.warn('[bff] TZ is not set; contract timestamps will be read in the host timezone');
}

const PORT = Number(process.env.PORT) || 4000;
const DATA_SOURCE = process.env.DATA_SOURCE || 'mock';
// Shared secret the truck device sends in x-api-key to POST /api/telemetry.
const TELEMETRY_API_KEY = process.env.TELEMETRY_API_KEY?.trim() || null;
const allowedOrigins = parseOrigins(process.env.CORS_ORIGINS || 'http://localhost:5173');
// Demo scenario panel. Set DEMO_ENABLED=false to stop anyone triggering scenarios.
const DEMO_ENABLED = (process.env.DEMO_ENABLED ?? 'true') !== 'false';
// Seconds of simulated history replayed at boot (0 turns it off). 4800 s = 80 min, just under
// the 5000-point ring buffer at 1 Hz.
const WARM_START_S = Math.max(0, Math.min(4800, Number(process.env.WARM_START_S ?? 4800) || 0));
// Manager-entered data (trucks, drivers, service records). A Postgres backend selected by
// DATABASE_URL is planned; until then it is JSON files in DATA_DIR.
// Set DATA_PERSISTENT=true only when DATA_DIR is on a disk that survives restarts.
const storage = createJsonStorage({
  dir: process.env.DATA_DIR || 'data',
  persistent: process.env.DATA_PERSISTENT === 'true',
});

const bff = createServer({
  rules,
  allowedOrigins,
  demoEnabled: DEMO_ENABLED,
  storage,
  telemetryKey: TELEMETRY_API_KEY,
  makeSource: (onPoints) => createSource({ mode: DATA_SOURCE, onPoints, warmStartS: WARM_START_S }),
});

const port = await bff.listen(PORT);
console.log(`[bff] listening on :${port}, data source ${bff.source.mode()}`);
if (bff.source.acceptsDevice() && !TELEMETRY_API_KEY) {
  console.warn('[bff] TELEMETRY_API_KEY is not set; POST /api/telemetry is refused');
}
console.log(`[bff] CORS origins: ${allowedOrigins.map(String).join(', ')}`);
console.log(`[bff] manager data stored as ${storage.kind} in ${process.env.DATA_DIR || 'data'}`);

function shutdown() {
  bff.close().then(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
