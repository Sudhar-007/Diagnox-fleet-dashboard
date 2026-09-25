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
const allowedOrigins = parseOrigins(process.env.CORS_ORIGINS || 'http://localhost:5173');
// Demo scenario panel. Set DEMO_ENABLED=false to stop anyone triggering scenarios.
const DEMO_ENABLED = (process.env.DEMO_ENABLED ?? 'true') !== 'false';
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
  makeSource: (onPoints) => createSource({ mode: DATA_SOURCE, onPoints }),
});

const port = await bff.listen(PORT);
console.log(`[bff] listening on :${port}, data source ${bff.source.mode()}`);
console.log(`[bff] CORS origins: ${allowedOrigins.map(String).join(', ')}`);
console.log(`[bff] manager data stored as ${storage.kind} in ${process.env.DATA_DIR || 'data'}`);

function shutdown() {
  bff.close().then(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
