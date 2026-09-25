// Human labels for contract fields. Only labels are friendly; keys stay verbatim.
export const HEALTH_FIELDS = [
  { field: 'coolant_temp', label: 'Coolant temperature', unit: '°C', digits: 1 },
  { field: 'oil_temp', label: 'Oil temperature', unit: '°C', digits: 1 },
  { field: 'battery_voltage', label: 'Battery voltage', unit: 'V', digits: 2 },
  { field: 'engine_load', label: 'Engine load', unit: '%', digits: 0 },
  { field: 'rpm', label: 'Engine speed', unit: 'rpm', digits: 0 },
  { field: 'speed', label: 'Vehicle speed', unit: 'km/h', digits: 0 },
];

export const FIELD_LABEL = Object.fromEntries(HEALTH_FIELDS.map((f) => [f.field, f.label]));

// "Warning above 100 °C, critical above 110 °C" from the live rule list, with conditions
// shared by every rule (hold time, engine running) stated once at the end.
export function thresholdSummary(rules, field) {
  const own = (rules ?? []).filter((r) => r.field === field);
  if (own.length === 0) return 'No rule for this value';
  const cond = (r) =>
    [r.sustain_s ? `held ${r.sustain_s} s` : null, r.only_when_running ? 'engine running' : null].filter(Boolean).join(', ');
  const shared = own.every((r) => cond(r) === cond(own[0])) ? cond(own[0]) : null;
  const levels = ['warning', 'critical']
    .map((level) => {
      const parts = own
        .filter((r) => r.level === level)
        .sort((a, b) => (a.op === b.op ? 0 : a.op === '<' ? -1 : 1))
        .map((r) => `${r.op === '>' ? 'above' : 'below'} ${r.threshold} ${r.unit}${!shared && cond(r) ? ` (${cond(r)})` : ''}`);
      return parts.length ? `${level} ${parts.join(' or ')}` : null;
    })
    .filter(Boolean);
  const text = levels.join(', ') + (shared ? ` (${shared})` : '');
  return text.charAt(0).toUpperCase() + text.slice(1);
}
