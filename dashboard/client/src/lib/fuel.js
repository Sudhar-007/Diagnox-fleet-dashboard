// Level provenance: a sensor reading shows where the reading came from (SIM or LIVE HW); an
// estimate is ESTIMATED.
export function levelBadge(fuel, truckProvenance) {
  if (!fuel) return null;
  return fuel.source === 'sensor' ? truckProvenance : 'ESTIMATED';
}

export const ANOMALY_LABEL = { theft: 'Possible fuel theft', refuel: 'Refuel detected' };

// "80.0 to 68.0 %, about 36 L" for a theft or refuel.
export function anomalyDetail(e) {
  const took = Math.max(1, Math.round((e.end_ms - e.start_ms) / 1000));
  return `${e.from_pct.toFixed(1)} to ${e.to_pct.toFixed(1)} % in ${took} s, about ${Math.round(e.litres)} L${e.ongoing ? ' so far' : ''}`;
}

// Level colour: low fuel is worth noticing, not an alarm.
export function levelTone(pct) {
  if (pct == null) return 'bg-faint';
  if (pct < 15) return 'bg-crit';
  if (pct < 30) return 'bg-warn';
  return 'bg-idle';
}
