import { planAlertChanges, worseValue } from '../engine/alerts.js';
import { fieldState } from '../engine/health.js';
import { detectCollision } from '../engine/sos.js';
import { formatTs, parseTs } from '../engine/time.js';

export const ALERT_STATUS = ['ACTIVE', 'ACKNOWLEDGED', 'RESOLVED'];
const NOTE_MAX = 500;
const BY_MAX = 60;

export class AlertActionError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Alert records and their event log, in memory. Every change is returned as
// { kind: 'new' | 'update', alert, event } (event is null for condition-only changes)
// so the caller can broadcast it.
//
// alert.kind: 'health' (threshold rules) | 'sos' (emergency; only ever closed by a person)
// alert.condition (health): 'firing' | 'within' (recovering) | 'unknown' (cannot judge,
//   e.g. engine off) | 'no_data' (truck stopped reporting) | 'cleared' (closed on its own)

const SOS_TRIGGERS = {
  manual: { name: 'SOS: manual trigger', source: 'MANUAL' },
  hardware: { name: 'SOS: panic button', source: null }, // provenance of the truck's feed
  collision: { name: 'Possible collision (heuristic)', source: 'RULE_BASED' },
};
export function createAlertService({ rules, maxAlerts = 1000, maxEvents = 2000 }) {
  const alerts = new Map(); // id -> alert, insertion ordered (oldest first)
  const openByTruck = new Map(); // truck_id -> Map(field -> alert)
  const suppressedByTruck = new Map(); // truck_id -> Map(field -> { level, within_since_ms })
  const openSosByTruck = new Map(); // truck_id -> open SOS alert (at most one per truck)
  const lastSosFlag = new Map(); // truck_id -> last hardware sos value (raise on false -> true only)
  const lastCollisionMs = new Map(); // truck_id -> telemetry ms of the last collision trigger
  const events = [];
  let alertSeq = 0;
  let eventSeq = 0;

  const openFor = (truck_id) => {
    if (!openByTruck.has(truck_id)) openByTruck.set(truck_id, new Map());
    return openByTruck.get(truck_id);
  };
  const suppressedFor = (truck_id) => {
    if (!suppressedByTruck.has(truck_id)) suppressedByTruck.set(truck_id, new Map());
    return suppressedByTruck.get(truck_id);
  };

  // Bumped on every broadcast change so clients can drop out-of-order copies.
  const bump = (alert) => {
    alert.version = (alert.version ?? 0) + 1;
  };

  function record(alert, type, nowMs, extra = {}) {
    bump(alert);
    const event = {
      id: `E${++eventSeq}`,
      alert_id: alert.id,
      truck_id: alert.truck_id,
      type,
      // Rule as it stood at this moment, so the log stays accurate after escalation.
      name: alert.name,
      level: alert.level,
      field: alert.field,
      op: alert.op,
      threshold: alert.threshold,
      unit: alert.unit,
      ...(alert.kind === 'sos' ? { trigger: alert.trigger, detail: alert.detail } : {}),
      at: formatTs(nowMs),
      at_ms: nowMs,
      ...extra,
    };
    events.push(event);
    if (events.length > maxEvents) events.splice(0, events.length - maxEvents);
    return { alert: { ...alert }, event };
  }

  function conditionOnly(alert) {
    bump(alert);
    return { kind: 'update', alert: { ...alert }, event: null };
  }

  function prune() {
    if (alerts.size <= maxAlerts) return;
    for (const [id, a] of alerts) {
      if (alerts.size <= maxAlerts) break;
      if (a.status === 'RESOLVED') alerts.delete(id);
    }
  }

  function close(alert, nowMs, { resolution, by = null, note = null }) {
    alert.status = 'RESOLVED';
    alert.resolved_at = formatTs(nowMs);
    alert.resolved_ms = nowMs;
    alert.resolution = resolution;
    alert.resolved_by = by;
    alert.resolve_note = note;
    if (alert.kind === 'sos') openSosByTruck.delete(alert.truck_id);
    else openFor(alert.truck_id).delete(alert.field);
  }

  // Opens an SOS for a truck, capturing its last known position, time and driver.
  // Returns null when the truck already has an open SOS.
  function openSos(truck, { trigger, detail = null, by = null, note = null, evidence = null }, nowMs) {
    if (openSosByTruck.has(truck.truck_id)) return null;
    const t = SOS_TRIGGERS[trigger];
    const alert = {
      id: `A${++alertSeq}`,
      kind: 'sos',
      source: t.source ?? truck.provenance ?? 'SIM',
      trigger,
      truck_id: truck.truck_id,
      driver_name: truck.driver_name ?? null,
      name: t.name,
      level: 'critical',
      detail,
      evidence,
      field: trigger === 'collision' ? 'speed' : null,
      op: null,
      threshold: null,
      unit: trigger === 'collision' ? 'km/h' : null,
      latitude: truck.latitude ?? null,
      longitude: truck.longitude ?? null,
      location_at: truck.timestamp ?? null,
      raised_by: by,
      raise_note: note,
      condition: null,
      status: 'ACTIVE',
      opened_at: trigger === 'manual' ? formatTs(nowMs) : truck.timestamp,
      opened_ms: nowMs,
      acknowledged_at: null,
      acknowledged_ms: null,
      acknowledged_by: null,
      ack_note: null,
      resolved_at: null,
      resolved_ms: null,
      resolved_by: null,
      resolve_note: null,
      resolution: null,
    };
    alerts.set(alert.id, alert);
    openSosByTruck.set(truck.truck_id, alert);
    return { kind: 'new', ...record(alert, 'opened', nowMs, { by, note }) };
  }

  // Automatic SOS triggers: the hardware panic flag and the collision heuristic.
  function evaluateSos(truck, history, nowMs) {
    const id = truck.truck_id;
    // Only a change to true raises an SOS, so a latching button that keeps sending
    // true does not reopen it every time someone resolves it.
    const flag = truck.sos === true;
    const wasSet = lastSosFlag.get(id) === true;
    lastSosFlag.set(id, flag);
    if (flag) {
      if (wasSet) return [];
      const change = openSos(truck, { trigger: 'hardware', detail: 'sos flag from the truck' }, nowMs);
      return change ? [change] : [];
    }
    // Each fast point can trigger at most once, even if it is still inside the window.
    const since = lastCollisionMs.get(id) ?? -Infinity;
    const window = history.filter((p) => (parseTs(p.timestamp) ?? -Infinity) > since);
    const hit = detectCollision(truck, window, rules.sos.collision);
    if (!hit) return [];
    lastCollisionMs.set(id, parseTs(truck.timestamp));
    const detail = `speed ${hit.from_speed} to ${hit.to_speed} km/h in ${hit.seconds} s`;
    const change = openSos(truck, { trigger: 'collision', detail, evidence: hit }, nowMs);
    return change ? [change] : [];
  }

  // Feed one derived truck payload (from fleet.ingest) and its recent prior points.
  // Returns the changes.
  function evaluate(truck, nowMs = Date.now(), history = []) {
    const tMs = parseTs(truck.timestamp);
    if (tMs == null) return [];
    const sosChanges = evaluateSos(truck, history, nowMs);
    const open = openFor(truck.truck_id);
    const suppressed = suppressedFor(truck.truck_id);
    const plan = planAlertChanges({
      open,
      suppressed,
      findings: truck.findings ?? [],
      stateOf: (field) => fieldState(truck, field, rules.health),
      tMs,
      clearAfterMs: rules.alerts.clear_after_s * 1000,
    });
    const changes = [];

    for (const u of plan.suppressedUpdates) {
      if (u.lift) suppressed.delete(u.field);
      else if (suppressed.has(u.field)) suppressed.get(u.field).within_since_ms = u.within_since_ms;
    }

    for (const f of plan.toOpen) {
      const alert = {
        id: `A${++alertSeq}`,
        kind: 'health',
        source: 'RULE_BASED',
        truck_id: truck.truck_id,
        driver_name: truck.driver_name ?? null,
        field: f.field,
        rule_id: f.rule_id,
        name: f.name,
        level: f.level,
        op: f.op,
        threshold: f.threshold,
        unit: f.unit,
        value: f.value,
        peak_value: f.value,
        last_value: f.value,
        condition: 'firing',
        within_since_ms: null,
        status: 'ACTIVE',
        opened_at: truck.timestamp,
        opened_ms: nowMs,
        last_firing_at: truck.timestamp,
        acknowledged_at: null,
        acknowledged_ms: null,
        acknowledged_by: null,
        ack_note: null,
        resolved_at: null,
        resolved_ms: null,
        resolved_by: null,
        resolve_note: null,
        resolution: null,
      };
      alerts.set(alert.id, alert);
      open.set(f.field, alert);
      changes.push({ kind: 'new', ...record(alert, 'opened', nowMs, { value: f.value }) });
    }

    for (const u of plan.alertUpdates) {
      const { alert } = u;
      const prevCondition = alert.condition;
      const value = u.finding?.value ?? truck[alert.field];
      alert.within_since_ms = u.within_since_ms;

      if (u.action === 'escalate') {
        const f = u.finding;
        const wasAcknowledged = alert.status === 'ACKNOWLEDGED';
        Object.assign(alert, {
          rule_id: f.rule_id,
          name: f.name,
          level: f.level,
          op: f.op,
          threshold: f.threshold,
          value: f.value,
          peak_value: worseValue(f.op, alert.peak_value, f.value),
          last_value: f.value,
          condition: 'firing',
          last_firing_at: truck.timestamp,
          // A worse condition needs attention again, even if the milder one was acknowledged.
          status: 'ACTIVE',
        });
        changes.push({
          kind: 'update',
          ...record(alert, 'escalated', nowMs, { value: f.value, reopened: wasAcknowledged }),
        });
        continue;
      }

      if (u.action === 'clear') {
        alert.condition = 'cleared';
        if (typeof value === 'number') alert.last_value = value;
        close(alert, nowMs, { resolution: 'cleared' });
        changes.push({ kind: 'update', ...record(alert, 'cleared', nowMs) });
        continue;
      }

      // touch / hold: keep live fields current; broadcast only when the condition changes
      // (the live value itself already reaches clients in truck:update).
      if (typeof value === 'number') {
        alert.last_value = value;
        if (u.condition === 'firing') {
          alert.peak_value = worseValue(alert.op, alert.peak_value, value);
          alert.last_firing_at = truck.timestamp;
        }
      }
      alert.condition = u.condition;
      if (u.condition !== prevCondition) changes.push(conditionOnly(alert));
    }

    prune();
    return [...sosChanges, ...changes];
  }

  // Marks open alerts of trucks that stopped reporting, so nobody reads a silent truck as
  // "recovering". They stay open until data returns or someone resolves them.
  function sweep(lastReceivedMs, nowMs = Date.now()) {
    const changes = [];
    const staleMs = rules.freshness.stale_after_s * 1000;
    for (const [truck_id, open] of openByTruck) {
      const received = lastReceivedMs(truck_id);
      if (received == null || nowMs - received <= staleMs) continue;
      for (const alert of open.values()) {
        if (alert.condition === 'no_data') continue;
        alert.condition = 'no_data';
        alert.within_since_ms = null;
        changes.push(conditionOnly(alert));
      }
    }
    return changes;
  }

  // Manager action: ACKNOWLEDGED or RESOLVED, with an optional note and name.
  function act(id, { status, note, by }, nowMs = Date.now()) {
    const alert = alerts.get(id);
    if (!alert) throw new AlertActionError(404, `unknown alert ${id}`);
    if (status !== 'ACKNOWLEDGED' && status !== 'RESOLVED') {
      throw new AlertActionError(400, 'status must be ACKNOWLEDGED or RESOLVED');
    }
    if (note != null && (typeof note !== 'string' || note.length > NOTE_MAX)) {
      throw new AlertActionError(400, `note must be text up to ${NOTE_MAX} characters`);
    }
    if (by != null && (typeof by !== 'string' || by.length > BY_MAX)) {
      throw new AlertActionError(400, `by must be text up to ${BY_MAX} characters`);
    }
    if (alert.status === 'RESOLVED') throw new AlertActionError(409, 'alert is already resolved');
    if (status === 'ACKNOWLEDGED' && alert.status === 'ACKNOWLEDGED') {
      throw new AlertActionError(409, 'alert is already acknowledged');
    }

    const cleanNote = note?.trim() || null;
    const cleanBy = by?.trim() || null;

    if (status === 'ACKNOWLEDGED') {
      alert.status = 'ACKNOWLEDGED';
      alert.acknowledged_at = formatTs(nowMs);
      alert.acknowledged_ms = nowMs;
      alert.acknowledged_by = cleanBy;
      alert.ack_note = cleanNote;
      return record(alert, 'acknowledged', nowMs, { by: cleanBy, note: cleanNote });
    }

    // Resolving while the value is still out of limits: stay quiet until it recovers,
    // otherwise the next point would reopen it immediately.
    if (alert.kind === 'health' && alert.condition === 'firing') {
      suppressedFor(alert.truck_id).set(alert.field, { level: alert.level, within_since_ms: null });
    }
    close(alert, nowMs, { resolution: 'manual', by: cleanBy, note: cleanNote });
    return record(alert, 'resolved', nowMs, { by: cleanBy, note: cleanNote });
  }

  function list({ status, truck_id, kind } = {}) {
    let out = [...alerts.values()];
    if (kind) out = out.filter((a) => a.kind === kind);
    if (status === 'open') out = out.filter((a) => a.status !== 'RESOLVED');
    else if (status) out = out.filter((a) => a.status === status);
    if (truck_id) out = out.filter((a) => a.truck_id === truck_id);
    return out.map((a) => ({ ...a })).reverse();
  }

  // Manual SOS from the dashboard. Throws when the truck already has one open.
  function raiseSos(truck, { by, note } = {}, nowMs = Date.now()) {
    if (note != null && (typeof note !== 'string' || note.length > NOTE_MAX)) {
      throw new AlertActionError(400, `note must be text up to ${NOTE_MAX} characters`);
    }
    if (by != null && (typeof by !== 'string' || by.length > BY_MAX)) {
      throw new AlertActionError(400, `by must be text up to ${BY_MAX} characters`);
    }
    const change = openSos(truck, { trigger: 'manual', by: by?.trim() || null, note: note?.trim() || null }, nowMs);
    if (!change) throw new AlertActionError(409, `${truck.truck_id} already has an open SOS`);
    return change;
  }

  return {
    evaluate,
    raiseSos,
    sweep,
    act,
    list,
    events: ({ limit = 500 } = {}) => events.slice(-limit).reverse(),
    get: (id) => (alerts.has(id) ? { ...alerts.get(id) } : null),
  };
}
