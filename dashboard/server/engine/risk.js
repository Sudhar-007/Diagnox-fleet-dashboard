import { parseTs } from './time.js';

const MAX_STEP_S = 5; // a gap in the data counts for at most this long

// Rule-based maintenance risk, 0-100, from the last `window_s` of telemetry.
//
// For every field with a warning rule:
//   exposure  = share of the judged time (at least min_judged_s) the value sat past its
//               warning threshold; time a rule does not apply to (engine off) is not judged
//   intensity = how far past, as a share of the gap to the critical threshold
//               (or of 10 % of the warning threshold when there is no critical rule)
//   points    = weight x exposure x (0.5 + 0.5 x average intensity)
// score = sum of points. Weights (summing to 100) are in rules.risk.weights.
//
// Pure: (points ascending, health rules, risk rules) -> { score, breakdown, covered_s }.
export function riskScore(points, healthRules, riskRules) {
  const covered = [];
  for (let i = 0; i < points.length; i++) {
    const t = parseTs(points[i].timestamp);
    const next = i + 1 < points.length ? parseTs(points[i + 1].timestamp) : t + 1000;
    if (t == null || next == null) continue;
    covered.push({ p: points[i], dt: Math.min(MAX_STEP_S, Math.max(0, (next - t) / 1000)) });
  }
  const coveredS = covered.reduce((s, c) => s + c.dt, 0);
  if (coveredS === 0) return { score: 0, breakdown: [], covered_s: 0 };

  const breakdown = [];
  for (const [field, weight] of Object.entries(riskRules.weights)) {
    const warns = healthRules.filter((r) => r.field === field && r.level === 'warning');
    if (warns.length === 0) continue;

    let breachS = 0;
    let intensityS = 0;
    let judgedS = 0;
    let worst = null;
    for (const { p, dt } of covered) {
      const v = p[field];
      if (typeof v !== 'number' || Number.isNaN(v)) continue;
      const applicable = warns.filter((r) => !r.only_when_running || p.rpm > 0);
      if (applicable.length === 0) continue;
      judgedS += dt;
      const rule = applicable.find((r) => (r.op === '>' ? v > r.threshold : v < r.threshold));
      if (!rule) continue;
      const crit = healthRules.find((r) => r.field === field && r.level === 'critical' && r.op === rule.op);
      const span = crit ? Math.abs(crit.threshold - rule.threshold) : Math.abs(rule.threshold) * 0.1;
      const intensity = Math.min(1, Math.abs(v - rule.threshold) / span);
      breachS += dt;
      intensityS += intensity * dt;
      // "Worst" is the furthest reading past the threshold (intensity itself caps at 1).
      const excess = Math.abs(v - rule.threshold) / Math.abs(rule.threshold || 1);
      if (!worst || excess > worst.excess) worst = { rule, value: v, excess };
    }
    if (breachS === 0 || judgedS === 0) continue;

    const exposure = breachS / Math.max(judgedS, riskRules.min_judged_s ?? 0);
    const intensity = intensityS / breachS;
    const pts = weight * exposure * (0.5 + 0.5 * intensity);
    breakdown.push({
      field,
      rule_name: worst.rule.name,
      op: worst.rule.op,
      threshold: worst.rule.threshold,
      unit: worst.rule.unit,
      weight,
      exposure: Math.round(exposure * 1000) / 1000,
      intensity: Math.round(intensity * 1000) / 1000,
      breach_s: Math.round(breachS),
      worst_value: worst.value,
      points: Math.round(pts * 10) / 10,
    });
  }

  breakdown.sort((a, b) => b.points - a.points);
  const score = Math.min(100, Math.round(breakdown.reduce((s, b) => s + b.points, 0)));
  return { score, breakdown, covered_s: Math.round(coveredS) };
}
