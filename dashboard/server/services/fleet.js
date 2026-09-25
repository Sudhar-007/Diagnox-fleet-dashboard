import { fleetEntry } from '../config/fleet.js';
import { evaluateHealth, freshnessOf } from '../engine/health.js';
import { parseTs } from '../engine/time.js';

const OPTIONAL_FIELDS = ['fuel_level', 'sos', 'maintenance_risk_score'];

// Joins the raw store with engine outputs to produce what the UI renders.
export function createFleet({ store, rules }) {
  function maxSustainS() {
    return Math.max(0, ...rules.health.map((r) => r.sustain_s ?? 0));
  }

  function derive(truck_id, nowMs) {
    const latest = store.latest(truck_id);
    const meta = store.meta(truck_id);
    if (!latest || !meta) return null;

    const t = parseTs(latest.timestamp);
    const history = store.history(truck_id, { fromMs: t - (maxSustainS() + 5) * 1000, toMs: t });
    const health = evaluateHealth(latest, history, rules.health);
    const last_seen_s = Math.max(0, (nowMs - meta.received_at) / 1000);
    const freshness = freshnessOf(last_seen_s, rules.freshness);
    const driver = fleetEntry(truck_id);

    return {
      ...latest,
      status: freshness === 'live' ? health.level : freshness,
      health: health.level,
      findings: health.findings,
      freshness,
      provenance: meta.provenance,
      driver_id: driver.driver_id,
      driver_name: driver.driver_name,
      received_at: meta.received_at,
      last_seen_s: Math.round(last_seen_s),
      optional_fields: OPTIONAL_FIELDS.filter((f) => latest[f] !== undefined),
    };
  }

  return {
    // Returns derived payloads only for points that were new (not duplicates).
    ingest(points, provenance, nowMs = Date.now()) {
      const updated = new Set();
      for (const p of points) {
        if (store.ingest(p, { provenance, receivedAt: nowMs })) updated.add(p.truck_id);
      }
      return [...updated].map((id) => derive(id, nowMs)).filter(Boolean);
    },
    snapshot(nowMs = Date.now()) {
      return store.truckIds().map((id) => derive(id, nowMs)).filter(Boolean);
    },
    truck(truck_id, nowMs = Date.now()) {
      return derive(truck_id, nowMs);
    },
  };
}
