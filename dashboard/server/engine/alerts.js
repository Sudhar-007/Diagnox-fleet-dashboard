const LEVEL_RANK = { warning: 1, critical: 2 };

// Pure: given the open alerts for one truck and its current point, decide what changes.
//
// One alert per (truck, field). It opens when a rule for the field fires (sustain windows
// respected), escalates in place if a higher-level rule fires, and closes only once the
// raw value has been within every threshold for the field for `clearAfterMs`. A point
// where the field cannot be judged (missing value, engine off for battery rules) restarts
// that recovery window, so "engine off" is never read as "recovered": recovery needs an
// unbroken run of in-limit readings.
//
// A field resolved by hand while firing stays suppressed until it has likewise been
// within limits for `clearAfterMs`. Suppression covers only the level that was resolved;
// a worse level on the same field opens a new alert.
//
// open:        Map(field -> alert)                         alert.within_since_ms: telemetry ms or null
// suppressed:  Map(field -> { level, within_since_ms })    within_since_ms null while breaching
// findings:    rules firing now (highest level per field)
// stateOf:     field -> 'breach' | 'within' | 'unknown'
// tMs:         telemetry time of the current point, epoch ms
export function planAlertChanges({ open, suppressed, findings, stateOf, tMs, clearAfterMs }) {
  const toOpen = [];
  const alertUpdates = []; // { alert, action: 'escalate'|'touch'|'clear'|'hold', finding, condition, within_since_ms }
  const suppressedUpdates = []; // { field, within_since_ms, lift }  (lift also when a worse level fires)
  const findingByField = new Map(findings.map((f) => [f.field, f]));

  for (const f of findings) {
    if (open.has(f.field)) continue;
    const s = suppressed.get(f.field);
    if (s && LEVEL_RANK[f.level] <= LEVEL_RANK[s.level]) {
      suppressedUpdates.push({ field: f.field, within_since_ms: null, lift: false });
    } else {
      if (s) suppressedUpdates.push({ field: f.field, within_since_ms: null, lift: true });
      toOpen.push(f);
    }
  }

  for (const [field, alert] of open) {
    const finding = findingByField.get(field);
    if (finding) {
      const action = LEVEL_RANK[finding.level] > LEVEL_RANK[alert.level] ? 'escalate' : 'touch';
      alertUpdates.push({ alert, action, finding, condition: 'firing', within_since_ms: null });
      continue;
    }
    const state = stateOf(field);
    if (state === 'breach') {
      alertUpdates.push({ alert, action: 'touch', finding: null, condition: 'firing', within_since_ms: null });
    } else if (state === 'within') {
      const since = alert.within_since_ms ?? tMs;
      const action = tMs - since >= clearAfterMs ? 'clear' : 'hold';
      alertUpdates.push({ alert, action, finding: null, condition: 'within', within_since_ms: since });
    } else {
      alertUpdates.push({ alert, action: 'hold', finding: null, condition: 'unknown', within_since_ms: null });
    }
  }

  for (const [field, s] of suppressed) {
    if (findingByField.has(field)) continue;
    const state = stateOf(field);
    if (state === 'within') {
      const since = s.within_since_ms ?? tMs;
      suppressedUpdates.push({ field, within_since_ms: since, lift: tMs - since >= clearAfterMs });
    } else {
      // breaching, or cannot be judged: the in-limit run starts over
      suppressedUpdates.push({ field, within_since_ms: null, lift: false });
    }
  }

  return { toOpen, alertUpdates, suppressedUpdates };
}

const more = (op, a, b) => (op === '<' ? a < b : a > b);

// The worse of two readings for a rule direction ("worse" = further past the threshold).
export function worseValue(op, current, candidate) {
  if (typeof current !== 'number') return candidate;
  if (typeof candidate !== 'number') return current;
  return more(op, candidate, current) ? candidate : current;
}
