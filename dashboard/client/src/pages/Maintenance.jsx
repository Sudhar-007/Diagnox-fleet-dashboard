import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import Plate from '../components/Plate.jsx';
import ProvenanceBadge from '../components/ProvenanceBadge.jsx';
import ServiceRecordForm from '../components/ServiceRecordForm.jsx';
import Button from '../components/ui/Button.jsx';
import Panel, { EmptyState } from '../components/ui/Panel.jsx';
import { FIELD_LABEL } from '../lib/fields.js';
import { useServiceRecords } from '../hooks/useServiceRecords.js';
import { useFleetStore } from '../store/useFleetStore.js';

// A single-hue bar for magnitude; the number beside it carries the value.
function ScoreBar({ score }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-8 text-right font-semibold text-ink">{score}</span>
      <div className="h-1.5 w-32 rounded-sm bg-line" aria-hidden>
        <div className="h-full rounded-sm bg-muted" style={{ width: `${Math.min(100, score)}%` }} />
      </div>
    </div>
  );
}

export default function Maintenance() {
  const trucks = useFleetStore((s) => s.trucks);
  const registry = useFleetStore((s) => s.registry);
  const alerts = useFleetStore((s) => s.alerts);
  const { records } = useServiceRecords(null);
  const [adding, setAdding] = useState(false);

  const rows = useMemo(() => {
    const ids = new Set([...Object.keys(trucks), ...(registry?.trucks ?? []).map((t) => t.truck_id)]);
    return [...ids]
      .map((id) => {
        const live = trucks[id];
        const last = (records ?? []).find((r) => r.truck_id === id);
        const openAlerts = Object.values(alerts).filter((a) => a.truck_id === id && a.status !== 'RESOLVED').length;
        return { id, live, last, openAlerts };
      })
      .sort((a, b) => (b.live?.rule_risk_score ?? -1) - (a.live?.rule_risk_score ?? -1) || a.id.localeCompare(b.id));
  }, [trucks, registry, records, alerts]);

  return (
    <div className="mx-auto max-w-[1300px] space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <div>
          <h1 className="font-cond text-2xl font-bold">Maintenance</h1>
          <p className="text-sm text-muted">
            Fleet ranked by rule-based risk over the last 10 minutes. Open a truck to see how its score is made up.
          </p>
        </div>
        {!adding && (
          <Button variant="primary" size="md" onClick={() => setAdding(true)}>
            Add service record
          </Button>
        )}
      </div>

      {adding && (
        <Panel title="Add service record">
          <ServiceRecordForm onDone={() => setAdding(false)} />
        </Panel>
      )}

      <Panel bodyClassName="overflow-x-auto">
        {rows.length === 0 ? (
          <EmptyState>No trucks yet.</EmptyState>
        ) : (
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b border-line text-muted">
              <tr>
                <th className="px-4 py-2 font-normal">Truck</th>
                <th className="px-4 py-2 font-normal">
                  Rule score <ProvenanceBadge kind="RULE_BASED" />
                </th>
                <th className="px-4 py-2 font-normal">Biggest contributor</th>
                <th className="px-4 py-2 font-normal">ML score</th>
                <th className="px-4 py-2 font-normal">Last service</th>
                <th className="px-4 py-2 font-normal">Open alerts</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map(({ id, live, last, openAlerts }) => {
                const top = live?.risk_breakdown?.[0];
                const ml = live?.maintenance_risk_score;
                return (
                  <tr key={id} className="align-middle">
                    <td className="px-4 py-2.5">
                      <Link to={`/vehicles/${encodeURIComponent(id)}?tab=maintenance`} className="inline-flex items-center gap-3">
                        <Plate truckId={id} size="sm" />
                        <span className="text-ink">{live?.driver_name ?? ''}</span>
                      </Link>
                    </td>
                    <td className="px-4 py-2.5">
                      {live ? <ScoreBar score={live.rule_risk_score ?? 0} /> : <span className="text-faint">No data yet</span>}
                    </td>
                    <td className="px-4 py-2.5 text-ink">
                      {top ? (
                        <>
                          {FIELD_LABEL[top.field] ?? top.field}{' '}
                          <span className="text-muted">+{top.points} pts</span>
                        </>
                      ) : (
                        <span className="text-muted">{live ? 'Nothing past warning' : ''}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {typeof ml === 'number' ? <span className="text-ink">{ml}</span> : <span className="text-faint">Not connected</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      {last ? (
                        <>
                          <span className="text-ink">{last.type}</span> <span className="text-muted">{last.date}</span>
                        </>
                      ) : (
                        <span className="text-faint">None logged</span>
                      )}
                    </td>
                    <td className={`px-4 py-2.5 ${openAlerts ? 'text-warn' : 'text-muted'}`}>{openAlerts}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
