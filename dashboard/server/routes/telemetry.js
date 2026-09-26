import express, { Router } from 'express';

import { TRUCK_ID } from '../services/input.js';
import { MAX_BATCH, keyMatches, normalizeTelemetry } from '../services/telemetry.js';

// POST /api/telemetry: the truck device pushes one point or an array of points.
// Mounted before the app-wide JSON parser so a 4G backlog can be larger than manager forms.
//
// enabled(): false when the data source does not take device data.
// reserved(truck_id): true for ids the simulator drives; a device may not use them.
// ingest(points) -> Promise of the number of points the store kept (new, not duplicates).
//
// Every outcome is logged as one "[telemetry] ..." line, so the hosting log shows whether a
// device reaches the server and why its points are refused. Never the key or the body.
export function telemetryRouter({ apiKey, enabled, reserved = () => false, maxPastS, ingest, log = console, now = Date.now }) {
  const r = Router();
  const note = createNote(log, now);

  // Checked before the body is parsed, so unauthenticated requests cost nothing.
  const guard = (req, res, next) => {
    if (!apiKey) {
      note('off', NOISY_GAP_MS, '503 refused: TELEMETRY_API_KEY is not set on this server');
      return res.status(503).json({ error: 'device telemetry is not enabled on this server' });
    }
    if (!keyMatches(req.get('x-api-key'), apiKey)) {
      note('auth', NOISY_GAP_MS, '401 refused: missing or wrong x-api-key');
      return res.status(401).json({ error: 'missing or wrong x-api-key' });
    }
    if (!enabled()) {
      note('off', NOISY_GAP_MS, '503 refused: the data source does not take device data');
      return res.status(503).json({ error: 'device telemetry is not enabled on this server' });
    }
    next();
  };

  r.post('/telemetry', guard, express.json({ limit: '512kb' }), async (req, res) => {
    const body = req.body;
    const raw = Array.isArray(body) ? body : body && typeof body === 'object' ? [body] : null;
    if (!raw || raw.length === 0) {
      note('device', DEVICE_GAP_MS, '400 body must be a telemetry object or a non-empty array');
      return res.status(400).json({ error: 'body must be a telemetry object or a non-empty array' });
    }
    if (raw.length > MAX_BATCH) {
      note('device', DEVICE_GAP_MS, `413 ${raw.length} points in one request (max ${MAX_BATCH})`);
      return res.status(413).json({ error: `at most ${MAX_BATCH} points per request` });
    }

    const points = [];
    const rejected = [];
    const nowMs = Date.now();
    raw.forEach((item, index) => {
      const { point, error } = normalizeTelemetry(item, { nowMs, maxPastS });
      if (!point) rejected.push({ index, error });
      else if (reserved(point.truck_id)) rejected.push({ index, error: `truck_id ${point.truck_id} is a simulated truck; use another id` });
      else points.push(point);
    });

    const accepted = points.length ? await ingest(points) : 0;
    const out = { accepted, ignored: points.length - accepted, rejected };
    const status = points.length ? 200 : 400;
    note('device', DEVICE_GAP_MS, describe(status, raw, points, out));
    res.status(status).json(out);
  });

  // A body that is not JSON (or too large) never reaches the handler; log it, then let the
  // app-wide error handler answer as it does for every route.
  r.use('/telemetry', (err, req, res, next) => {
    note('device', DEVICE_GAP_MS, `${err.status ?? 500} ${err.type === 'entity.too.large' ? 'body larger than 512 kB' : 'body is not valid JSON'}`);
    next(err);
  });

  return r;
}

// Refusals anyone can trigger (no key) are logged at most once a minute; a device holding
// the key at most once a second (it normally sends every few seconds).
const NOISY_GAP_MS = 60_000;
const DEVICE_GAP_MS = 1_000;
const MAX_IDS = 8;

// "200 TN06,TN07 accepted 2 ignored 0 rejected 0 newest 2026-09-26T11:02:11; rejected #1: ..."
function describe(status, raw, points, out) {
  const ids = [...new Set(raw.map((p) => p?.truck_id).filter((id) => typeof id === 'string' && TRUCK_ID.test(id)))];
  const idText = ids.length ? ids.slice(0, MAX_IDS).join(',') + (ids.length > MAX_IDS ? `,+${ids.length - MAX_IDS}` : '') : 'no valid truck_id';
  const newest = points.reduce((a, p) => (p.timestamp > a ? p.timestamp : a), '');
  let line = `${status} ${idText} accepted ${out.accepted} ignored ${out.ignored} rejected ${out.rejected.length}`;
  if (newest) line += ` newest ${newest}`;
  if (out.rejected.length) line += `; rejected #${out.rejected[0].index}: ${out.rejected[0].error}`;
  return line;
}

// At most one line per `gapMs` for each kind; lines held back are counted into the next one.
function createNote(log, now) {
  const last = new Map(); // kind -> { at, held }
  return (kind, gapMs, line) => {
    const t = now();
    const s = last.get(kind);
    if (s && t - s.at < gapMs) {
      s.held += 1;
      return;
    }
    const held = s?.held ? ` (+${s.held} not logged since the previous line)` : '';
    last.set(kind, { at: t, held: 0 });
    log.log(`[telemetry] ${line}${held}`);
  };
}
