import { InputError, bad } from './input.js';
import { loadOrReseed } from './storage.js';

const describe = (r) => `${r.name} (${r.threshold} ${r.unit})`;

// Every rule stays consistent after an edit: for each field, a warning fires before its
// critical rule, and a "below" limit sits under an "above" limit.
function checkOrder(healthRules) {
  const byField = new Map();
  for (const r of healthRules) {
    if (!byField.has(r.field)) byField.set(r.field, []);
    byField.get(r.field).push(r);
  }
  for (const own of byField.values()) {
    for (const op of ['>', '<']) {
      const warn = own.filter((r) => r.op === op && r.level === 'warning');
      const crit = own.filter((r) => r.op === op && r.level === 'critical');
      for (const w of warn) {
        for (const c of crit) {
          const ok = op === '>' ? w.threshold < c.threshold : w.threshold > c.threshold;
          if (!ok) bad(`${describe(w)} must be ${op === '>' ? 'below' : 'above'} ${describe(c)}`);
        }
      }
    }
    const below = own.filter((r) => r.op === '<');
    const above = own.filter((r) => r.op === '>');
    for (const b of below) {
      for (const a of above) {
        if (!(b.threshold < a.threshold)) bad(`${describe(b)} must be below ${describe(a)}`);
      }
    }
  }
}

// Alert thresholds edited in Settings. Defaults come from config/rules.js; only values that
// differ from the default are saved, so a changed default in code still applies elsewhere.
// Edits change `rules.health` in place, which every engine reads on each point.
export function createRuleSettings({ rules, storage, log = console }) {
  const defaults = new Map(rules.health.map((r) => [r.id, r.threshold]));

  // Validates a full set of thresholds { rule_id: number } against the limits and order.
  function validate(thresholds) {
    const candidate = rules.health.map((r) => ({ ...r, threshold: thresholds[r.id] ?? r.threshold }));
    for (const r of candidate) {
      const [min, max] = rules.threshold_limits[r.field] ?? [-Infinity, Infinity];
      if (typeof r.threshold !== 'number' || !Number.isFinite(r.threshold) || r.threshold < min || r.threshold > max) {
        bad(`${r.name} must be a number from ${min} to ${max} ${r.unit}`);
      }
    }
    checkOrder(candidate);
    return candidate;
  }

  function apply(candidate) {
    const byId = new Map(candidate.map((r) => [r.id, r.threshold]));
    for (const r of rules.health) r.threshold = byId.get(r.id);
  }

  const saved = loadOrReseed(storage, 'rule_overrides', log) ?? [];
  try {
    const known = saved.filter((o) => defaults.has(o?.id));
    apply(validate(Object.fromEntries(known.map((o) => [o.id, o.threshold]))));
  } catch (err) {
    log.error(`[rules] saved thresholds ignored, using the defaults: ${err.message}`);
  }

  function view() {
    return {
      demo_tuned: true,
      health: rules.health.map((r) => ({
        ...r,
        default_threshold: defaults.get(r.id),
        limits: rules.threshold_limits[r.field] ?? null,
      })),
      freshness: rules.freshness,
      alerts: rules.alerts,
      sos: rules.sos,
      risk: rules.risk,
      geofence: rules.geofence,
      trips: rules.trips,
      driver: rules.driver,
    };
  }

  return {
    view,
    // Body: { thresholds: { rule_id: number, ... } }. Rules left out keep their value.
    update(body = {}) {
      const { thresholds } = body;
      if (!thresholds || typeof thresholds !== 'object' || Array.isArray(thresholds)) {
        bad('thresholds must be an object of rule id to number');
      }
      for (const [id, value] of Object.entries(thresholds)) {
        if (!defaults.has(id)) throw new InputError(400, `unknown rule ${id}`);
        if (typeof value !== 'number' || !Number.isFinite(value)) bad(`${id} must be a number`);
      }
      const candidate = validate(thresholds);
      const before = new Map(rules.health.map((r) => [r.id, r.threshold]));
      const changedFields = new Set(candidate.filter((r) => r.threshold !== before.get(r.id)).map((r) => r.field));
      const overrides = candidate
        .filter((r) => r.threshold !== defaults.get(r.id))
        .map((r) => ({ id: r.id, threshold: r.threshold }));
      storage.save('rule_overrides', overrides);
      apply(candidate);
      return { ...view(), changed_fields: [...changedFields] };
    },
  };
}
