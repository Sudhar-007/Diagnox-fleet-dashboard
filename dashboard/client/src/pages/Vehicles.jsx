import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import Plate from '../components/Plate.jsx';
import ProvenanceBadge from '../components/ProvenanceBadge.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import TruckForm from '../components/TruckForm.jsx';
import Button from '../components/ui/Button.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import Panel, { EmptyState, LoadingState } from '../components/ui/Panel.jsx';
import SearchInput from '../components/ui/SearchInput.jsx';
import Segmented from '../components/ui/Segmented.jsx';
import { sendJson } from '../lib/api.js';
import { formatAgo, formatNumber } from '../lib/format.js';
import { locationText, useFleetRows } from '../lib/fleetView.js';
import { toast } from '../lib/toast.js';
import { reloadRegistry } from '../hooks/useSocket.js';
import { useFleetStore } from '../store/useFleetStore.js';

const STATUS_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'attention', label: 'Need attention' },
  { id: 'silent', label: 'No recent data' },
  { id: 'unlisted', label: 'Not in fleet list' },
];

function RemoveTruck({ truckId }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(null);
  const remove = async () => {
    try {
      await sendJson(`/api/registry/trucks/${encodeURIComponent(truckId)}`, 'DELETE');
      await reloadRegistry();
      toast(`${truckId} removed from the fleet list`);
    } catch (err) {
      setError(err.message);
      setConfirming(false);
    }
  };
  if (error) return <span className="text-[13px] text-crit">{error}</span>;
  if (!confirming) {
    return (
      <Button variant="quiet" onClick={() => setConfirming(true)}>
        Remove
      </Button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-[13px] text-muted">Remove from the fleet list? Its telemetry is kept.</span>
      <Button variant="danger" onClick={remove}>
        Remove {truckId}
      </Button>
      <Button variant="quiet" onClick={() => setConfirming(false)}>
        Keep
      </Button>
    </span>
  );
}

export default function Vehicles() {
  const registry = useFleetStore((s) => s.registry);
  const liveRows = useFleetRows();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(null); // 'new' | truck_id | null
  const [prefill, setPrefill] = useState('');
  const filter = STATUS_FILTERS.some((f) => f.id === params.get('status')) ? params.get('status') : 'all';
  const setFilter = (id) => setParams(id === 'all' ? {} : { status: id }, { replace: true });

  // Every truck in the fleet list, plus every truck reporting without being listed.
  const rows = useMemo(() => {
    const listedIds = new Set((registry?.trucks ?? []).map((t) => t.truck_id));
    const live = new Map(liveRows.map((r) => [r.truck.truck_id, r]));
    const listed = (registry?.trucks ?? []).map((reg) => ({ id: reg.truck_id, reg, live: live.get(reg.truck_id) ?? null }));
    const unlisted = liveRows.filter((r) => !listedIds.has(r.truck.truck_id)).map((r) => ({ id: r.truck.truck_id, reg: null, live: r }));
    return [...listed, ...unlisted].sort((a, b) => a.id.localeCompare(b.id));
  }, [registry, liveRows]);

  const counts = {
    all: rows.length,
    attention: rows.filter((r) => r.live?.attention).length,
    silent: rows.filter((r) => !r.live || r.live.silent).length,
    unlisted: rows.filter((r) => !r.reg).length,
  };

  const q = query.trim().toLowerCase();
  const shown = rows.filter((r) => {
    if (filter === 'attention' && !r.live?.attention) return false;
    if (filter === 'silent' && r.live && !r.live.silent) return false;
    if (filter === 'unlisted' && r.reg) return false;
    if (!q) return true;
    const driver = r.reg?.driver_name ?? r.live?.truck.driver_name ?? '';
    return [r.id, r.reg?.registration, r.reg?.model, driver].some((v) => v && v.toLowerCase().includes(q));
  });

  const startAdd = (id = '') => {
    setPrefill(id);
    setEditing('new');
  };

  return (
    <div className="mx-auto max-w-[1440px]">
      <PageHeader
        title="Vehicles"
        description="Every truck in the fleet list and every truck sending telemetry. Add a truck to give it a driver, registration and tank size."
        actions={
          editing !== 'new' && (
            <Button variant="primary" size="md" onClick={() => startAdd()}>
              Add truck
            </Button>
          )
        }
      />

      <div className="space-y-4">
        {editing === 'new' && (
          <Panel title="Add truck" description="The truck ID must match what the device sends, capitals included.">
            <TruckForm
              key={prefill}
              initialId={prefill}
              onDone={() => setEditing(null)}
            />
          </Panel>
        )}

        {registry && !registry.storage?.persistent && (
          <p className="text-[13px] text-muted">
            Changes are saved on the server, but its storage resets when the server restarts on the current hosting plan.
          </p>
        )}

        <Panel bodyClassName="">
          <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-2.5">
            <SearchInput value={query} onChange={setQuery} label="Search vehicles" placeholder="Truck, driver, registration" />
            <Segmented
              label="Filter by status"
              value={filter}
              onChange={setFilter}
              options={STATUS_FILTERS.map((f) => ({ ...f, count: counts[f.id] }))}
            />
            <span className="ml-auto text-[13px] text-muted">
              {shown.length} of {rows.length} shown
            </span>
          </div>
          <div className="overflow-x-auto">
            {!registry ? (
              <LoadingState>Loading the fleet list…</LoadingState>
            ) : rows.length === 0 ? (
              <EmptyState>No trucks in the fleet list and none reporting. Use Add truck to create one.</EmptyState>
            ) : shown.length === 0 ? (
              <EmptyState
                action={
                  <Button
                    onClick={() => {
                      setQuery('');
                      setFilter('all');
                    }}
                  >
                    Clear search and filter
                  </Button>
                }
              >
                No vehicles match {q ? `"${query.trim()}"` : 'this filter'}.
              </EmptyState>
            ) : (
              <table className="w-full min-w-[1100px] text-left text-sm">
                <thead className="border-b border-line">
                  <tr>
                    <th className="px-4 py-2">Vehicle</th>
                    <th className="px-3 py-2">Registration, model</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2 text-right">Speed</th>
                    <th className="px-3 py-2 text-right" title="Rule-based maintenance risk / ML model score, 0 to 100">
                      Risk rule / ML
                    </th>
                    <th className="px-3 py-2">Location</th>
                    <th className="px-3 py-2">Last seen</th>
                    <th className="px-3 py-2">Source</th>
                    <th className="px-4 py-2">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {shown.map(({ id, reg, live }) => {
                    const t = live?.truck;
                    if (editing === id && reg) {
                      return (
                        <tr key={id}>
                          <td colSpan={9} className="bg-canvas px-4 py-3">
                            <TruckForm
                              truck={reg}
                              onDone={() => setEditing(null)}
                            />
                          </td>
                        </tr>
                      );
                    }
                    const driver = reg ? reg.driver_name : t?.driver_name;
                    return (
                      <tr key={id} className={`align-middle ${live?.sos ? 'bg-crit/5' : ''}`}>
                        <td className="px-4 py-2">
                          <Link to={`/vehicles/${encodeURIComponent(id)}`} className="group inline-flex items-center gap-2.5">
                            <Plate truckId={id} size="sm" />
                            <span className={`group-hover:underline ${reg ? 'text-ink' : 'text-warn'}`}>
                              {reg ? driver ?? 'No driver' : 'Not in fleet list'}
                            </span>
                          </Link>
                        </td>
                        <td className="px-3 py-2">
                          {reg?.registration || reg?.model ? (
                            <>
                              <span className="text-ink">{reg.registration ?? ''}</span>
                              {reg.model && (
                                <span className="text-muted">
                                  {reg.registration ? ', ' : ''}
                                  {reg.model}
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="text-faint">Not entered</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {live ? <StatusBadge status={live.status} sos={Boolean(live.sos)} /> : <span className="text-[13px] text-faint">No data yet</span>}
                        </td>
                        <td className="px-3 py-2 text-right whitespace-nowrap text-ink">
                          {t && (
                            <>
                              {formatNumber(t.speed)} <span className="text-muted">km/h</span>
                            </>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          {t && (
                            <>
                              <span className="font-medium text-ink">{t.rule_risk_score ?? 0}</span>
                              <span className="text-muted"> / {typeof t.ml_risk?.score === 'number' ? t.ml_risk.score : '-'}</span>
                            </>
                          )}
                        </td>
                        <td className="max-w-56 px-3 py-2 text-muted">
                          {t && (
                            <span className="flex items-center gap-1.5">
                              <span className="truncate">{locationText(t)}</span>
                              {t.position_source === 'virtual_route' && <ProvenanceBadge kind="VIRTUAL_POSITION" />}
                            </span>
                          )}
                        </td>
                        <td className={`px-3 py-2 whitespace-nowrap ${live?.silent ? 'font-medium text-idle' : 'text-muted'}`}>
                          {live ? formatAgo(live.age) : 'Never'}
                        </td>
                        <td className="px-3 py-2">{t && <ProvenanceBadge kind={t.provenance} />}</td>
                        <td className="px-4 py-2 text-right whitespace-nowrap">
                          {reg ? (
                            <span className="inline-flex items-center gap-1">
                              <Button variant="quiet" onClick={() => setEditing(id)}>
                                Edit
                              </Button>
                              <RemoveTruck truckId={id} />
                            </span>
                          ) : (
                            <Button onClick={() => startAdd(id)}>Add to fleet list</Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}
