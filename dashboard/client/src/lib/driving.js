import { formatDuration } from './format.js';

export const EVENT_LABEL = {
  harsh_brake: 'Harsh braking',
  harsh_accel: 'Harsh acceleration',
  overspeed: 'Overspeed',
  idling: 'Idling',
};

// What happened, in numbers the reader can check against the rule.
export function eventDetail(e) {
  const took = formatDuration(e.duration_s);
  if (e.type === 'harsh_brake' || e.type === 'harsh_accel') {
    return `${e.speed_from} to ${e.speed_to} km/h in ${took}, up to ${e.peak} km/h per second`;
  }
  if (e.type === 'overspeed') return `Up to ${e.peak} km/h for ${took}${e.ongoing ? ' so far' : ''}`;
  return `Stood at 0 km/h with the engine running for ${took}${e.ongoing ? ' so far' : ''}`;
}

// "2 harsh braking, 10 pts" / "overspeed 1 min 20 s in 3 events, 2 pts" for a trip's deductions.
export function deductionText(d) {
  const name = EVENT_LABEL[d.type].toLowerCase();
  if (d.minutes == null) return `${d.count} ${name}, ${d.points} pts`;
  const times = d.count > 1 ? ` in ${d.count} events` : '';
  return `${name} ${formatDuration(d.seconds)}${times}, ${d.points} ${d.points === 1 ? 'pt' : 'pts'}`;
}

const mean = (xs) => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : null);

// One row per registry driver: average score over their completed trips that could be rated,
// the score of the trip they are on, and event counts by type.
export function driverRows(drivers, trips, events) {
  const all = Object.values(trips ?? {});
  return (drivers ?? []).map((d) => {
    const own = all.filter((t) => t.driver_id === d.driver_id);
    const rated = own.filter((t) => t.status === 'completed' && t.driving?.score != null);
    const active = own.find((t) => t.status === 'active') ?? null;
    const mine = (events ?? []).filter((e) => e.driver_id === d.driver_id);
    const counts = {};
    for (const e of mine) counts[e.type] = (counts[e.type] ?? 0) + 1;
    return {
      driver: d,
      score: mean(rated.map((t) => t.driving.score)),
      ratedTrips: rated.length,
      active,
      counts,
      events: mine.length,
    };
  });
}

// Score colour: the same bands everywhere a score is shown.
export function scoreTone(score) {
  if (score == null) return 'text-muted';
  if (score >= 90) return 'text-ok';
  if (score >= 70) return 'text-warn';
  return 'text-crit';
}
