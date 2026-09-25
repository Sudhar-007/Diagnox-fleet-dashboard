import { riskScore } from '../engine/risk.js';
import { parseTs } from '../engine/time.js';

export const RANGES = { '15m': 15 * 60, '1h': 3600, session: null };
const CACHE_MS = 10_000;
// Risk is recorded once per RISK_EVERY_S of telemetry per truck (like the fuel trend) and at most
// MAX_RISK_POINTS per truck are returned for a chart.
const RISK_EVERY_S = 30;
const MAX_RISK_KEPT = 480;
const MAX_RISK_POINTS = 120;

// Analytics for one time range, computed from what the server holds: the ring buffer, the alert
// log, detected trips, fuel tracking and fleet manager records. Nothing is made up: a chart with
// no data comes back empty. A range ends now on the BFF clock; items are matched on their own
// times (telemetry time for readings, trips and events; BFF time for a manual SOS and manager
// entries), and readings up to ingest.max_future_s ahead of the clock still count. "session" is
// everything still held (trips, risk samples, alerts, the ring buffer); from_ms is its earliest
// item. Results are cached for CACHE_MS per range.
export function createAnalytics({ store, rules, alerts, trips, fuel, registry }) {
  const cache = new Map(); // range -> { at, body }
  const risk = new Map(); // truck_id -> [[t_ms, score]] oldest first

  // Earliest thing held, for the session range's from_ms.
  function earliestHeld() {
    let first = Infinity;
    for (const id of store.truckIds()) {
      const o = parseTs(store.oldest(id)?.timestamp);
      if (o != null) first = Math.min(first, o);
    }
    for (const rows of risk.values()) if (rows.length) first = Math.min(first, rows[0][0]);
    for (const t of trips.list({ status: 'completed', limit: 1000 })) first = Math.min(first, t.start_ms);
    return first === Infinity ? null : first;
  }

  function bounds(range, nowMs) {
    if (store.truckIds().length === 0) return null;
    const span = RANGES[range];
    const ahead = (rules.ingest?.max_future_s ?? 0) * 1000;
    if (span == null) return { from: -Infinity, to: nowMs, until: nowMs + ahead, shownFrom: earliestHeld() ?? nowMs };
    return { from: nowMs - span * 1000, to: nowMs, until: nowMs + ahead, shownFrom: nowMs - span * 1000 };
  }

  const inRange = (ms, b) => ms != null && ms >= b.from && ms <= b.until;

  function alertCounts(b) {
    const byTruck = new Map();
    const ruleTotals = new Map();
    for (const a of alerts.list()) {
      if (!inRange(parseTs(a.opened_at), b)) continue;
      const row = byTruck.get(a.truck_id) ?? { truck_id: a.truck_id, total: 0, by_rule: {} };
      row.by_rule[a.name] = (row.by_rule[a.name] ?? 0) + 1;
      row.total += 1;
      byTruck.set(a.truck_id, row);
      ruleTotals.set(a.name, (ruleTotals.get(a.name) ?? 0) + 1);
    }
    const rulesByCount = [...ruleTotals].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).map(([name]) => name);
    const trucks = [...byTruck.values()].sort((x, y) => x.truck_id.localeCompare(y.truck_id));
    return { rules: rulesByCount, trucks, total: trucks.reduce((s, t) => s + t.total, 0) };
  }

  // Rule risk score per truck over the range, from the recorded samples (thinned evenly when
  // there are more than a chart needs).
  // Thinned on one time grid for every truck (so a chart can line the trucks up): one sample per
  // step, the step chosen so no truck has more than about MAX_RISK_POINTS.
  function riskSeries(b) {
    const own = [...risk]
      .sort((x, y) => x[0].localeCompare(y[0]))
      .map(([truck_id, rows]) => ({ truck_id, rows: rows.filter((r) => inRange(r[0], b)) }))
      .filter((x) => x.rows.length > 0);
    const most = Math.max(0, ...own.map((x) => x.rows.length));
    const stepMs = RISK_EVERY_S * 1000 * Math.max(1, Math.ceil(most / MAX_RISK_POINTS));
    const series = own.map(({ truck_id, rows }) => {
      const seen = new Set();
      const points = rows.filter((r) => {
        const slot = Math.floor(r[0] / stepMs);
        if (seen.has(slot)) return false;
        seen.add(slot);
        return true;
      });
      return { truck_id, points };
    });
    return { every_s: stepMs / 1000, window_s: rules.risk.window_s, series };
  }

  function tripRows(b) {
    return trips
      .list({ status: 'completed', limit: 1000 })
      .filter((t) => inRange(t.end_ms, b))
      .sort((x, y) => x.start_ms - y.start_ms)
      .map((t) => ({
        id: t.id,
        truck_id: t.truck_id,
        driver_id: t.driver_id,
        driver_name: t.driver_name,
        start_at: t.start_at,
        end_ms: t.end_ms,
        distance_km: t.distance_km,
        duration_s: t.duration_s,
        score: t.driving?.score ?? null,
      }));
  }

  // Average score of each driver's completed, rated trips that ended in the range.
  function driverScores(tripList) {
    const by = new Map();
    for (const t of tripList) {
      if (!t.driver_id || t.score == null) continue;
      const d = by.get(t.driver_id) ?? { driver_id: t.driver_id, driver_name: t.driver_name, sum: 0, trips: 0 };
      d.sum += t.score;
      d.trips += 1;
      by.set(t.driver_id, d);
    }
    return [...by.values()]
      .map(({ sum, ...d }) => ({ ...d, score: Math.round(sum / d.trips) }))
      .sort((x, y) => y.score - x.score || x.driver_name.localeCompare(y.driver_name));
  }

  // Estimated litres burnt in the range: cumulative use now minus at the last sample before it.
  function fuelUsed(b) {
    return fuel
      .list()
      .map((f) => {
        const rows = fuel.history(f.truck_id) ?? [];
        const i = rows.findIndex((r) => r[0] > b.from);
        const before = i === -1 ? rows[rows.length - 1] : i > 0 ? rows[i - 1] : null;
        const after = i === -1 ? null : rows[i];
        const began = parseTs(f.since);
        let base;
        if (before && after) {
          // Between two samples: interpolate the cumulative litres at the start of the range.
          base = before[3] + ((after[3] - before[3]) * (b.from - before[0])) / (after[0] - before[0]);
        } else if (before) {
          base = before[3];
        } else {
          // No sample before the range: tracking began inside it (count from 0), or the samples
          // restarted after a device clock reset (count from the first one kept).
          base = began != null && began >= b.from ? 0 : (rows[0]?.[3] ?? 0);
        }
        const used = f.used_l - base;
        return { truck_id: f.truck_id, used_l: Math.max(0, Math.round(used * 10) / 10), level_source: f.source };
      })
      .filter((f) => f.used_l > 0);
  }

  // Manager-entered costs whose date falls in the range (service records by day).
  function costs(b) {
    const by = new Map();
    const row = (id) => by.get(id) ?? { truck_id: id, service_inr: 0, refuel_inr: 0, refuel_l: 0, entries: 0 };
    for (const s of registry.listServiceRecords()) {
      const dayStart = parseTs(`${s.date}T00:00:00`);
      if (dayStart == null || dayStart + 86_400_000 <= b.from || dayStart > b.to || s.cost_inr == null) continue;
      const r = row(s.truck_id);
      r.service_inr += s.cost_inr;
      r.entries += 1;
      by.set(s.truck_id, r);
    }
    for (const f of registry.listRefuels()) {
      if (!inRange(parseTs(f.at), b)) continue;
      const r = row(f.truck_id);
      r.refuel_inr += f.cost_inr ?? 0;
      r.refuel_l += f.litres;
      r.entries += 1;
      by.set(f.truck_id, r);
    }
    return [...by.values()].sort((x, y) => x.truck_id.localeCompare(y.truck_id));
  }

  function compute(range, nowMs) {
    const b = bounds(range, nowMs);
    if (!b) return { range, from_ms: null, to_ms: null, alerts: { rules: [], trucks: [], total: 0 }, risk: null, trips: [], drivers: [], fuel: [], costs: [] };
    const tripList = tripRows(b);
    return {
      range,
      from_ms: b.shownFrom,
      to_ms: b.to,
      alerts: alertCounts(b),
      risk: riskSeries(b),
      trips: tripList,
      drivers: driverScores(tripList),
      fuel: fuelUsed(b),
      costs: costs(b),
    };
  }

  return {
    // Called for every stored point in time order (live and warm start): records the truck's
    // rule risk score once per RISK_EVERY_S of telemetry, over the risk window up to that point.
    observe(point) {
      const t = parseTs(point.timestamp);
      if (t == null) return;
      const rows = risk.get(point.truck_id) ?? [];
      const last = rows[rows.length - 1];
      // A late reading is skipped; one far behind (as the other engines judge it) is a device
      // clock reset, so the series starts again.
      if (last && t < last[0] && last[0] - t <= rules.trips.no_data_end_s * 1000) return;
      if (last && t < last[0]) rows.length = 0;
      else if (last && t - last[0] < RISK_EVERY_S * 1000) return;
      const window = store.history(point.truck_id, { fromMs: t - rules.risk.window_s * 1000, toMs: t });
      rows.push([t, riskScore(window, rules.health, rules.risk).score]);
      while (rows.length > MAX_RISK_KEPT) rows.shift();
      risk.set(point.truck_id, rows);
    },

    get(range, nowMs = Date.now()) {
      const hit = cache.get(range);
      if (hit && nowMs - hit.at < CACHE_MS) return hit.body;
      const body = { ...compute(range, nowMs), generated_at: nowMs };
      cache.set(range, { at: nowMs, body });
      return body;
    },
  };
}
