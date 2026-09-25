import Plate from './Plate.jsx';
import StatusBadge from './StatusBadge.jsx';
import ProvenanceBadge from './ProvenanceBadge.jsx';
import { useTruckStatus } from '../lib/useTruckStatus.js';
import { useFleetStore } from '../store/useFleetStore.js';
import { findingText, formatAgo, formatNumber } from '../lib/format.js';

function LoadBar({ value, threshold }) {
  const pct = Math.min(100, Math.max(0, value ?? 0));
  const over = threshold != null && pct > threshold;
  return (
    <div>
      <div className="flex justify-between text-sm">
        <span className="text-muted">Engine load</span>
        <span className={over ? 'font-semibold text-warn' : 'text-ink'}>{formatNumber(value)} %</span>
      </div>
      <div className="relative mt-1.5 h-1.5 rounded-sm bg-line">
        <div className={`h-full rounded-sm ${over ? 'bg-warn' : 'bg-muted'}`} style={{ width: `${pct}%` }} />
        {threshold != null && (
          <div
            className="absolute -top-1 h-3.5 w-px bg-ink/70"
            style={{ left: `${threshold}%` }}
            title={`Warning above ${threshold} % for a sustained period`}
          />
        )}
      </div>
    </div>
  );
}

export default function TruckCard({ truck }) {
  const { age, freshness, status } = useTruckStatus(truck);
  const loadRule = useFleetStore((s) => s.healthRules?.find((r) => r.field === 'engine_load'));
  const dim = freshness !== 'live';

  return (
    <article className="rounded-md border border-line bg-panel p-4">
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Plate truckId={truck.truck_id} />
          <div className="leading-tight">
            <div className="text-[15px] text-ink">{truck.driver_name}</div>
            <div className={`text-xs ${dim ? 'text-idle' : 'text-muted'}`}>Last seen {formatAgo(age)}</div>
          </div>
        </div>
        <StatusBadge status={status} />
      </header>

      <div className={dim ? 'opacity-50' : ''}>
        <div className="mt-4 flex items-end justify-between">
          <div>
            <span className="font-cond text-3xl font-bold leading-none">{formatNumber(truck.speed)}</span>
            <span className="ml-1 text-sm text-muted">km/h</span>
          </div>
          <ProvenanceBadge kind={truck.provenance} />
        </div>
        <div className="mt-3">
          <LoadBar value={truck.engine_load} threshold={loadRule?.threshold} />
        </div>
      </div>

      {truck.findings?.length > 0 && freshness === 'live' && (
        <ul className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
          {truck.findings.map((f) => (
            <li key={f.rule_id} className={f.level === 'critical' ? 'text-crit' : 'text-warn'}>
              {findingText(f)}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
