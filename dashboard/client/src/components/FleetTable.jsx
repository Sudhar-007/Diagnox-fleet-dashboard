import { Link } from 'react-router-dom';

import Plate from './Plate.jsx';
import ProvenanceBadge from './ProvenanceBadge.jsx';
import StatusBadge from './StatusBadge.jsx';
import { EmptyState } from './ui/Panel.jsx';
import { sosLabel } from '../lib/alerts.js';
import { formatAgo, formatNumber } from '../lib/format.js';
import { locationText } from '../lib/fleetView.js';
import { useFleetStore } from '../store/useFleetStore.js';

// The most important thing about a truck's health right now, in one line.
function HealthCell({ row }) {
  const { truck, sos, silent, age } = row;
  if (sos) return <span className="font-medium text-crit">{sosLabel(sos)}</span>;
  if (silent) return <span className="text-muted">No data for {formatAgo(age).replace(' ago', '')}</span>;
  const findings = truck.findings ?? [];
  if (findings.length === 0) return <span className="text-muted">Within limits</span>;
  const f = [...findings].sort((a, b) => (a.level === 'critical' ? -1 : 1) - (b.level === 'critical' ? -1 : 1))[0];
  return (
    <span className={f.level === 'critical' ? 'text-crit' : 'text-warn'}>
      {f.name} {f.value} {f.unit}
      {findings.length > 1 && <span className="text-muted"> +{findings.length - 1} more</span>}
    </span>
  );
}

function RiskCell({ truck }) {
  const rule = truck.rule_risk_score ?? 0;
  const ml = truck.ml_risk?.score;
  const tone = rule >= 50 ? 'text-crit' : rule >= 20 ? 'text-warn' : 'text-ink';
  return (
    <span className="whitespace-nowrap">
      <span className={`font-medium ${tone}`}>{rule}</span>
      <span className="text-muted"> / {typeof ml === 'number' ? ml : '-'}</span>
    </span>
  );
}

// Live trucks, one dense row each. `rows` come from useFleetRows().
export default function FleetTable({ rows, empty = 'No trucks match.' }) {
  const loadRule = useFleetStore((s) => s.healthRules?.find((r) => r.field === 'engine_load'));
  if (rows.length === 0) return <EmptyState>{empty}</EmptyState>;

  return (
    <table className="w-full min-w-[1040px] text-left text-sm">
      <thead className="border-b border-line">
        <tr>
          <th className="px-4 py-2">Vehicle</th>
          <th className="px-3 py-2">Status</th>
          <th className="px-3 py-2 text-right">Speed</th>
          <th className="px-3 py-2 text-right">Load</th>
          <th className="px-3 py-2">Health</th>
          <th className="px-3 py-2 text-right" title="Rule-based maintenance risk / ML model score, 0 to 100">
            Risk rule / ML
          </th>
          <th className="px-3 py-2">Location</th>
          <th className="px-3 py-2">Last seen</th>
          <th className="px-4 py-2">Source</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {rows.map((row) => {
          const { truck: t, status, silent, age } = row;
          const overLoad = loadRule && typeof t.engine_load === 'number' && t.engine_load > loadRule.threshold;
          return (
            <tr key={t.truck_id} className={`align-middle ${row.sos ? 'bg-crit/5' : ''}`}>
              <td className="px-4 py-2">
                <Link
                  to={`/vehicles/${encodeURIComponent(t.truck_id)}`}
                  className="group inline-flex items-center gap-2.5"
                  aria-label={`Open ${t.truck_id}, ${t.driver_name}`}
                >
                  <Plate truckId={t.truck_id} size="sm" />
                  <span className={`group-hover:underline ${t.in_registry === false ? 'text-warn' : 'text-ink'}`}>{t.driver_name}</span>
                </Link>
              </td>
              <td className="px-3 py-2">
                <StatusBadge status={status} sos={Boolean(row.sos)} />
              </td>
              <td className={`px-3 py-2 text-right whitespace-nowrap ${silent ? 'text-muted' : 'text-ink'}`}>
                {formatNumber(t.speed)} <span className="text-muted">km/h</span>
              </td>
              <td className={`px-3 py-2 text-right whitespace-nowrap ${overLoad ? 'font-medium text-warn' : silent ? 'text-muted' : 'text-ink'}`}>
                {formatNumber(t.engine_load)} <span className="font-normal text-muted">%</span>
              </td>
              <td className="px-3 py-2">
                <HealthCell row={row} />
              </td>
              <td className="px-3 py-2 text-right">
                <RiskCell truck={t} />
              </td>
              <td className="max-w-60 px-3 py-2 text-muted" title={locationText(t)}>
                <span className="flex items-center gap-1.5">
                  <span className="truncate">{locationText(t)}</span>
                  {t.position_source === 'virtual_route' && <ProvenanceBadge kind="VIRTUAL_POSITION" />}
                </span>
              </td>
              <td className={`px-3 py-2 whitespace-nowrap ${silent ? 'font-medium text-idle' : 'text-muted'}`}>{formatAgo(age)}</td>
              <td className="px-4 py-2">
                <ProvenanceBadge kind={t.provenance} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
