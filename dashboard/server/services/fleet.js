import { evaluateHealth, freshnessOf } from '../engine/health.js';
import { riskScore } from '../engine/risk.js';
import { mlRiskScore } from '../engine/mlRisk.js';
import { parseTs } from '../engine/time.js';

const OPTIONAL_FIELDS = ['fuel_level', 'sos', 'maintenance_risk_score'];

// Joins the raw store, the fleet registry and engine outputs into what the UI renders.
export function createFleet({ store, rules, registry, zonesInside = () => [], fuelOf = () => null, forest = null }) {
  function maxSustainS() {
    return Math.max(0, ...rules.health.map((r) => r.sustain_s ?? 0));
  }

  // A score sent by the device (0-100) wins over the server-side model.
  function mlRiskOf(latest, riskPoints, t) {
    const sent = latest.maintenance_risk_score;
    if (typeof sent === 'number' && sent >= 0 && sent <= 100) {
      return { score: Math.round(sent), source: 'device', state: 'ok', readings: 1, window_s: 0 };
    }
    if (!forest) return { score: null, source: 'model', state: 'no_model', readings: 0, window_s: rules.ml.window_s };
    const points =
      rules.ml.window_s <= rules.risk.window_s
        ? riskPoints
        : store.history(latest.truck_id, { fromMs: t - rules.ml.window_s * 1000, toMs: t });
    return { ...mlRiskScore(points, forest, rules.ml), source: 'model' };
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
    const info = registry.truckInfo(truck_id);
    const riskPoints = store.history(truck_id, { fromMs: t - rules.risk.window_s * 1000, toMs: t });
    const risk = riskScore(riskPoints, rules.health, rules.risk);
    const ml = mlRiskOf(latest, riskPoints, t);

    return {
      ...latest,
      status: freshness === 'live' ? health.level : freshness,
      health: health.level,
      findings: health.findings,
      freshness,
      provenance: meta.provenance,
      driver_id: info.driver_id,
      driver_name: info.driver_name,
      registration: info.registration,
      model: info.model,
      tank_capacity_l: info.tank_capacity_l,
      in_registry: info.in_registry,
      zones_inside: zonesInside(truck_id),
      fuel: fuelOf(truck_id),
      rule_risk_score: risk.score,
      risk_breakdown: risk.breakdown,
      ml_risk: ml,
      received_at: meta.received_at,
      last_seen_s: Math.round(last_seen_s),
      optional_fields: OPTIONAL_FIELDS.filter((f) => latest[f] !== undefined),
    };
  }

  return {
    // Returns derived payloads only for points that were new (not duplicates).
    // `onAccepted(point)` is called for every point the store kept.
    ingest(points, provenance, nowMs = Date.now(), onAccepted = () => {}) {
      const updated = new Set();
      for (const p of points) {
        if (store.ingest(p, { provenance, receivedAt: nowMs })) {
          updated.add(p.truck_id);
          onAccepted(p);
        }
      }
      return [...updated].map((id) => derive(id, nowMs)).filter(Boolean);
    },
    // History only (warm start): stored, nothing derived or evaluated.
    backfill(points, provenance, nowMs = Date.now(), onAccepted = () => {}) {
      for (const p of points) if (store.ingest(p, { provenance, receivedAt: nowMs })) onAccepted(p);
    },
    snapshot(nowMs = Date.now()) {
      return store.truckIds().map((id) => derive(id, nowMs)).filter(Boolean);
    },
    truck(truck_id, nowMs = Date.now()) {
      return derive(truck_id, nowMs);
    },
  };
}
