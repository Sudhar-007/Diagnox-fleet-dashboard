import { STATUS_META, STATUS_ORDER } from '../lib/status.js';

// Proportional bar of trucks by status, with the counts written out underneath.
export default function FleetStatusBar({ counts, total }) {
  return (
    <div>
      <div className="flex h-2 overflow-hidden rounded-sm bg-line" role="img" aria-label="Trucks by status">
        {STATUS_ORDER.map((s) =>
          counts[s] ? (
            <div
              key={s}
              className={`${STATUS_META[s].dot} border-r border-asphalt last:border-r-0`}
              style={{ width: `${(counts[s] / total) * 100}%` }}
            />
          ) : null,
        )}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
        {STATUS_ORDER.map((s) => (
          <li key={s} className={counts[s] ? 'text-ink' : 'text-faint'}>
            <span aria-hidden className={`mr-1.5 inline-block size-2 rounded-full ${STATUS_META[s].dot}`} />
            <span className="font-semibold">{counts[s] ?? 0}</span> {STATUS_META[s].label.toLowerCase()}
          </li>
        ))}
      </ul>
    </div>
  );
}
