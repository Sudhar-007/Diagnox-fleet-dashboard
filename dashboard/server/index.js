import dotenv from 'dotenv';

import { rules } from './config/rules.js';
import { createSource } from './services/source.js';
import { parseOrigins } from './services/cors.js';
import { createServer } from './app.js';

dotenv.config({ quiet: true });
if (!process.env.TZ) {
  console.warn('[bff] TZ is not set; contract timestamps will be read in the host timezone');
}

const PORT = Number(process.env.PORT) || 4000;
const DATA_SOURCE = process.env.DATA_SOURCE || 'mock';
const allowedOrigins = parseOrigins(process.env.CORS_ORIGINS || 'http://localhost:5173');

const bff = createServer({
  rules,
  allowedOrigins,
  makeSource: (onPoints) => createSource({ mode: DATA_SOURCE, onPoints }),
});

const port = await bff.listen(PORT);
console.log(`[bff] listening on :${port}, data source ${bff.source.mode()}`);
console.log(`[bff] CORS origins: ${allowedOrigins.map(String).join(', ')}`);

function shutdown() {
  bff.close().then(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
