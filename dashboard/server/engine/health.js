import { parseTs } from './time.js';

const LEVEL_RANK = { normal: 0, warning: 1, critical: 2 };

const isNumber = (v) => typeof v === 'number' && !Number.isNaN(v);

function breaches(value, op, threshold) {
  if (!isNumber(value)) return false;
  return op === '>' ? value > threshold : value < threshold;
}

// A sustained rule fires only if every point in the last `sustain_s` seconds breaches
// and the points cover the whole window with no gap longer than `max_gap_s`.
// Points where the rule does not apply (e.g. engine off for battery rules) break the run;
// points missing the values needed to judge them are skipped and count as a gap.
// The window is (t - sustain_s, t], so at 1 Hz it always takes sustain_s samples.
function sustainedBreach(rule, point, history) {
  const t = parseTs(point.timestamp);
  if (t == null) return false;
  const windowStart = t - rule.sustain_s * 1000;
  const maxGapMs = (rule.max_gap_s ?? Infinity) * 1000;
  let earliest = t;
  for (let i = history.length - 1; i >= 0; i--) {
    const p = history[i];
    const pt = parseTs(p.timestamp);
    if (pt == null || pt >= t) continue;
    if (pt <= windowStart) break;
    if (!isNumber(p[rule.field]) || (rule.only_when_running && !isNumber(p.rpm))) continue;
    if (!ruleApplies(rule, p)) return false;
    if (!breaches(p[rule.field], rule.op, rule.threshold)) return false;
    if (earliest - pt > maxGapMs) return false;
    earliest = pt;
  }
  return t - earliest >= (rule.sustain_s - 1) * 1000;
}

function ruleApplies(rule, point) {
  if (rule.only_when_running && !(point.rpm > 0)) return false;
  return true;
}

// Pure: (latest point, prior points ascending, rule list) -> health level + the rules that fired.
export function evaluateHealth(point, history, healthRules) {
  const byField = new Map();

  for (const rule of healthRules) {
    if (!ruleApplies(rule, point)) continue;
    const value = point[rule.field];
    if (!breaches(value, rule.op, rule.threshold)) continue;
    if (rule.sustain_s && !sustainedBreach(rule, point, history)) continue;

    const finding = {
      rule_id: rule.id,
      name: rule.name,
      field: rule.field,
      value,
      op: rule.op,
      threshold: rule.threshold,
      unit: rule.unit,
      level: rule.level,
    };
    const prev = byField.get(rule.field);
    if (!prev || LEVEL_RANK[finding.level] > LEVEL_RANK[prev.level]) byField.set(rule.field, finding);
  }

  const findings = [...byField.values()].sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level]);
  const level = findings.length ? findings[0].level : 'normal';
  return { level, findings };
}

export function freshnessOf(ageS, freshnessRules) {
  if (ageS > freshnessRules.offline_after_s) return 'offline';
  if (ageS > freshnessRules.stale_after_s) return 'stale';
  return 'live';
}

// Instant state of one field against every rule for it, ignoring sustain windows:
// 'breach' | 'within' | 'unknown' (no usable value, or the rule does not apply, e.g. engine off).
// Used to decide whether an open alert has really recovered.
export function fieldState(point, field, healthRules) {
  const fieldRules = healthRules.filter((r) => r.field === field);
  const value = point[field];
  if (fieldRules.length === 0 || !isNumber(value)) return 'unknown';
  const applicable = fieldRules.filter((r) => ruleApplies(r, point));
  if (applicable.length === 0) return 'unknown';
  return applicable.some((r) => breaches(value, r.op, r.threshold)) ? 'breach' : 'within';
}
