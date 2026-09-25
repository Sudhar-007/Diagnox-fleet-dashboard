import { planAlertChanges, worseValue } from '../engine/alerts.js';
import { appliesTo, distanceM, hasFix, isBreach, stepZone } from '../engine/geofence.js';
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
//   | 'geofence' (inside a restricted zone or outside an allowed one)
// alert.condition (health): 'firing' | 'within' (recovering) | 'unknown' (cannot judge,
//   e.g. engine off) | 'no_data' (truck stopped reporting) | 'cleared' (closed on its own)
// alert.condition (geofence): 'firing' | 'unknown' (no GPS fix) | 'no_data' | 'cleared'
//
// Zone entries and exits are also kept as visits (every zone, alerting or not) and passed
// to onVisit as they are confirmed.

const SOS_TRIGGERS = {
  manual: { name: 'SOS: manual trigger', source: 'MANUAL' },
  hardware: { name: 'SOS: panic button', source: null }, // provenance of the truck's feed
  collision: { name: 'Possible collision (heuristic)', source: 'RULE_BASED' },
};
const GEO_CLOSE_NOTE = {
  zone_removed: 'zone deleted',
  zone_changed: 'zone alerts turned off, or the zone no longer covers this truck',
};

export function createAlertService({
  rules,
  zones = () => [],
  onVisit = () => {},
  maxAlerts = 1000,
  maxEvents = 2000,
  maxVisits = 500,
}) {
  const alerts = new Map(); // id -> alert, insertion ordered (oldest first)
  const openByTruck = new Map(); // truck_id -> Map(field -> alert)
  const suppressedByTruck = new Map(); // truck_id -> Map(field -> { level, within_since_ms })
  const openSosByTruck = new Map(); // truck_id -> open SOS alert (at most one per truck)
  const lastSosFlag = new Map(); // truck_id -> last hardware sos value (raise on false -> true only)
  const lastCollisionMs = new Map(); // truck_id -> telemetry ms of the last collision trigger
  const zoneStateByTruck = new Map(); // truck_id -> Map(zone_id -> stepZone state)
  const openGeoByTruck = new Map(); // truck_id -> Map(zone_id -> alert)
  const suppressedGeoByTruck = new Map(); // truck_id -> Set(zone_id) resolved by hand mid-breach
  const events = [];
  const visits = [];
  let alertSeq = 0;
  let eventSeq = 0;
  let visitSeq = 0;

  const mapFor = (byTruck, truck_id, make) => {
    if (!byTruck.has(truck_id)) byTruck.set(truck_id, make());
    return byTruck.get(truck_id);
  };
  const zoneStatesFor = (id) => mapFor(zoneStateByTruck, id, () => new Map());
  const openGeoFor = (id) => mapFor(openGeoByTruck, id, () => new Map());
  const suppressedGeoFor = (id) => mapFor(suppressedGeoByTruck, id, () => new Set());

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
      ...(alert.kind === 'geofence'
        ? { zone_id: alert.zone_id, zone_name: alert.zone_name, zone_type: alert.zone_type, value: alert.last_value }
        : {}),
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
    else if (alert.kind === 'geofence') openGeoFor(alert.truck_id).delete(alert.zone_id);
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

  function recordVisit(truck, zone, inside, sinceMs) {
    const visit = {
      id: `V${++visitSeq}`,
      truck_id: truck.truck_id,
      driver_name: truck.driver_name ?? null,
      zone_id: zone.id,
      zone_name: zone.name,
      zone_type: zone.type,
      type: inside ? 'entered' : 'left',
      at: formatTs(sinceMs),
      at_ms: sinceMs,
    };
    visits.push(visit);
    if (visits.length > maxVisits) visits.splice(0, visits.length - maxVisits);
    onVisit(visit);
  }

  function openGeo(truck, zone, distance, nowMs) {
    const restricted = zone.type === 'restricted';
    const value = Math.round(distance);
    const alert = {
      id: `A${++alertSeq}`,
      kind: 'geofence',
      source: 'RULE_BASED',
      truck_id: truck.truck_id,
      driver_name: truck.driver_name ?? null,
      zone_id: zone.id,
      zone_name: zone.name,
      zone_type: zone.type,
      name: restricted ? 'Inside restricted zone' : 'Outside allowed zone',
      level: restricted ? 'critical' : 'warning',
      // Distance from the zone centre against its radius.
      field: null,
      op: restricted ? '<' : '>',
      threshold: zone.radius_m,
      unit: 'm',
      value,
      peak_value: value,
      last_value: value,
      latitude: truck.latitude,
      longitude: truck.longitude,
      location_at: truck.timestamp,
      condition: 'firing',
      status: 'ACTIVE',
      opened_at: truck.timestamp,
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
    openGeoFor(truck.truck_id).set(zone.id, alert);
    return { kind: 'new', ...record(alert, 'opened', nowMs, { value }) };
  }

  // Closes a truck's zone alerts whose zone was deleted, switched to no alerts, no longer
  // covers the truck, or changed type (the alert's rule no longer exists; if the truck is in
  // breach of the new type, a fresh alert opens on its next point). Forgets state for
  // deleted zones.
  function closeStaleGeo(truck_id, list, nowMs) {
    const changes = [];
    const byId = new Map(list.map((z) => [z.id, z]));
    for (const alert of [...openGeoFor(truck_id).values()]) {
      const zone = byId.get(alert.zone_id);
      if (zone && zone.alert && appliesTo(zone, truck_id) && zone.type === alert.zone_type) continue;
      const resolution = zone ? 'zone_changed' : 'zone_removed';
      close(alert, nowMs, { resolution, note: GEO_CLOSE_NOTE[resolution] });
      changes.push({ kind: 'update', ...record(alert, 'closed', nowMs, { note: GEO_CLOSE_NOTE[resolution] }) });
    }
    const states = zoneStatesFor(truck_id);
    for (const zoneId of [...states.keys()]) if (!byId.has(zoneId)) states.delete(zoneId);
    const suppressed = suppressedGeoFor(truck_id);
    for (const zoneId of [...suppressed]) if (!byId.has(zoneId)) suppressed.delete(zoneId);
    return changes;
  }

  // Zone checks for one point: confirm entries and exits, then open, update or clear the
  // truck's zone alerts. An alert follows the confirmed side, so a restart or a zone edit
  // that leaves a truck in breach still raises one.
  function evaluateZones(truck, tMs, nowMs) {
    const id = truck.truck_id;
    const list = zones();
    const states = zoneStatesFor(id);
    const open = openGeoFor(id);
    const suppressed = suppressedGeoFor(id);
    const fix = hasFix(truck);
    const changes = closeStaleGeo(id, list, nowMs);

    for (const zone of list) {
      const distance = fix ? distanceM(zone, truck.latitude, truck.longitude) : null;
      if (fix) {
        const step = stepZone(
          states.get(zone.id),
          distance <= zone.radius_m,
          tMs,
          rules.geofence.confirm_points,
          rules.freshness.stale_after_s * 1000,
        );
        states.set(zone.id, step.state);
        if (step.changed && step.from !== null) recordVisit(truck, zone, step.state.inside, step.state.since_ms);
      }
      const confirmed = states.get(zone.id)?.inside;
      if (confirmed == null) continue;
      const breach = isBreach(zone, confirmed);
      if (!breach) suppressed.delete(zone.id);
      const alert = open.get(zone.id);

      if (alert) {
        if (!breach) {
          alert.condition = 'cleared';
          if (distance != null) alert.last_value = Math.round(distance);
          close(alert, nowMs, { resolution: 'cleared' });
          changes.push({ kind: 'update', ...record(alert, 'cleared', nowMs) });
          continue;
        }
        const prevCondition = alert.condition;
        if (distance != null) {
          alert.last_value = Math.round(distance);
          alert.peak_value = worseValue(alert.op, alert.peak_value, alert.last_value);
        }
        alert.condition = fix ? 'firing' : 'unknown';
        if (alert.condition !== prevCondition) changes.push(conditionOnly(alert));
        continue;
      }

      // Opening needs a fix: the alert records where the truck is.
      if (breach && fix && zone.alert && appliesTo(zone, id) && !suppressed.has(zone.id)) {
        changes.push(openGeo(truck, zone, distance, nowMs));
      }
    }
    return changes;
  }

  // Feed one derived truck payload (from fleet.ingest) and its recent prior points.
  // Returns the changes.
  function evaluate(truck, nowMs = Date.now(), history = []) {
    const tMs = parseTs(truck.timestamp);
    if (tMs == null) return [];
    const sosChanges = evaluateSos(truck, history, nowMs);
    const zoneChanges = evaluateZones(truck, tMs, nowMs);
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
    return [...sosChanges, ...zoneChanges, ...changes];
  }

  // Marks open alerts of trucks that stopped reporting, so nobody reads a silent truck as
  // "recovering". They stay open until data returns or someone resolves them.
  function sweep(lastReceivedMs, nowMs = Date.now()) {
    const changes = [];
    const staleMs = rules.freshness.stale_after_s * 1000;
    const trucks = new Set([...openByTruck.keys(), ...openGeoByTruck.keys()]);
    for (const truck_id of trucks) {
      const received = lastReceivedMs(truck_id);
      if (received == null || nowMs - received <= staleMs) continue;
      const open = [...(openByTruck.get(truck_id)?.values() ?? []), ...(openGeoByTruck.get(truck_id)?.values() ?? [])];
      for (const alert of open) {
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
    // A zone alert is open only while in breach: stay quiet until the truck is back on the
    // right side, or every next point would reopen it.
    if (alert.kind === 'geofence') suppressedGeoFor(alert.truck_id).add(alert.zone_id);
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

  // A threshold edit changes the rule behind open health alerts on those fields: close them,
  // and the next point judges the field against the new numbers (opening a fresh alert if it
  // is still out of limits). Suppression from a manual resolve is lifted for the same reason.
  function rulesChanged(fields, nowMs = Date.now()) {
    const changes = [];
    const note = 'threshold changed in Settings';
    for (const [truck_id, open] of openByTruck) {
      for (const alert of [...open.values()]) {
        if (!fields.has(alert.field)) continue;
        close(alert, nowMs, { resolution: 'rule_changed', note });
        changes.push({ kind: 'update', ...record(alert, 'closed', nowMs, { note }) });
      }
      for (const field of fields) suppressedFor(truck_id).delete(field);
    }
    return changes;
  }

  // Applies zone edits right away instead of on each truck's next point.
  function syncZones(nowMs = Date.now()) {
    const list = zones();
    const trucks = new Set([...openGeoByTruck.keys(), ...zoneStateByTruck.keys()]);
    return [...trucks].flatMap((id) => closeStaleGeo(id, list, nowMs));
  }

  // Zones a truck is confirmed inside, for the map and vehicle views.
  function zonesInside(truck_id) {
    const states = zoneStateByTruck.get(truck_id);
    if (!states) return [];
    return zones()
      .filter((z) => states.get(z.id)?.inside === true)
      .map((z) => ({ zone_id: z.id, zone_name: z.name, zone_type: z.type, since: formatTs(states.get(z.id).since_ms) }));
  }

  return {
    evaluate,
    rulesChanged,
    syncZones,
    zonesInside,
    visits: ({ limit = 100, truck_id } = {}) =>
      (truck_id ? visits.filter((v) => v.truck_id === truck_id) : visits).slice(-limit).reverse(),
    raiseSos,
    sweep,
    act,
    list,
    events: ({ limit = 500 } = {}) => events.slice(-limit).reverse(),
    get: (id) => (alerts.has(id) ? { ...alerts.get(id) } : null),
  };
}
