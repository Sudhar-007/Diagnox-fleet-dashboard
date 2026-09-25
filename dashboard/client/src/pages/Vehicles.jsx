import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import Plate from '../components/Plate.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import TruckForm from '../components/TruckForm.jsx';
import Button from '../components/ui/Button.jsx';
import Panel, { EmptyState } from '../components/ui/Panel.jsx';
import { sendJson } from '../lib/api.js';
import { formatAgo, formatNumber } from '../lib/format.js';
import { ageSeconds, displayStatus, freshnessOf } from '../lib/status.js';
import { reloadRegistry } from '../hooks/useSocket.js';
import { useFleetStore } from '../store/useFleetStore.js';

function RemoveTruck({ truckId }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(null);
  const remove = async () => {
    try {
      await sendJson(`/api/registry/trucks/${encodeURIComponent(truckId)}`, 'DELETE');
      await reloadRegistry();
    } catch (err) {
      setError(err.message);
      setConfirming(false);
    }
  };
  if (error) return <span className="text-sm text-crit">{error}</span>;
  if (!confirming) {
    return (
      <Button variant="quiet" onClick={() => setConfirming(true)}>
        Remove
      </Button>
    );
  }
  return (
    <span className="inline-flex gap-1.5">
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
  const trucks = useFleetStore((s) => s.trucks);
  const now = useFleetStore((s) => s.now);
  const clockOffsetMs = useFleetStore((s) => s.clockOffsetMs);
  const freshnessRules = useFleetStore((s) => s.freshnessRules);
  const [editing, setEditing] = useState(null); // 'new' | truck_id | null

  const rows = useMemo(
    () => [...(registry?.trucks ?? [])].sort((a, b) => a.truck_id.localeCompare(b.truck_id)),
    [registry],
  );
  const unlisted = Object.keys(trucks).filter((id) => !rows.some((r) => r.truck_id === id));

  return (
    <div className="mx-auto max-w-[1300px] space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <h1 className="font-cond text-2xl font-bold">Vehicles</h1>
        {editing !== 'new' && (
          <Button variant="primary" size="md" onClick={() => setEditing('new')}>
            Add truck
          </Button>
        )}
      </div>

      {editing === 'new' && (
        <Panel title="Add truck">
          <TruckForm onDone={() => setEditing(null)} />
        </Panel>
      )}

      {registry && !registry.storage?.persistent && (
        <p className="text-sm text-muted">
          Changes are saved on the server, but its storage resets when the server restarts on the current hosting
          plan. Connect the database to keep them.
        </p>
      )}

      {unlisted.length > 0 && (
        <p className="text-sm text-warn">
          Reporting but not in the fleet list: {unlisted.join(', ')}. Add them with Add truck to name the driver and tank.
        </p>
      )}

      <Panel bodyClassName="overflow-x-auto">
        {!registry ? (
          <EmptyState>Loading the fleet list…</EmptyState>
        ) : rows.length === 0 ? (
          <EmptyState>No trucks in the fleet list. Use Add truck to create one.</EmptyState>
        ) : (
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b border-line text-muted">
              <tr>
                <th className="px-4 py-2 font-normal">Truck</th>
                <th className="px-4 py-2 font-normal">Registration / model</th>
                <th className="px-4 py-2 font-normal">Driver</th>
                <th className="px-4 py-2 font-normal">Status</th>
                <th className="px-4 py-2 font-normal">Speed</th>
                <th className="px-4 py-2 font-normal">Risk</th>
                <th className="px-4 py-2 font-normal">Last seen</th>
                <th className="px-4 py-2 font-normal">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => {
                const live = trucks[r.truck_id];
                const age = live ? ageSeconds(live, now, clockOffsetMs) : null;
                const status = live ? displayStatus(live, freshnessOf(age, freshnessRules)) : null;
                if (editing === r.truck_id) {
                  return (
                    <tr key={r.truck_id}>
                      <td colSpan={8} className="px-4 py-3">
                        <TruckForm truck={r} onDone={() => setEditing(null)} />
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={r.truck_id} className="align-middle">
                    <td className="px-4 py-2.5">
                      <Link to={`/vehicles/${encodeURIComponent(r.truck_id)}`} aria-label={`Open ${r.truck_id}`}>
                        <Plate truckId={r.truck_id} size="sm" />
                      </Link>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="text-ink">{r.registration ?? <span className="text-faint">No registration</span>}</div>
                      <div className="text-muted">{r.model ?? ''}</div>
                    </td>
                    <td className="px-4 py-2.5 text-ink">{r.driver_name ?? <span className="text-faint">No driver</span>}</td>
                    <td className="px-4 py-2.5">
                      {status ? <StatusBadge status={status} /> : <span className="text-faint">No data yet</span>}
                    </td>
                    <td className="px-4 py-2.5 text-ink">{live ? `${formatNumber(live.speed)} km/h` : ''}</td>
                    <td className="px-4 py-2.5 text-ink">{live ? live.rule_risk_score : ''}</td>
                    <td className="px-4 py-2.5 text-muted">{live ? formatAgo(age) : 'never'}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right">
                      <Link
                        to={`/vehicles/${encodeURIComponent(r.truck_id)}`}
                        className="mr-2 text-sm text-ink underline decoration-line underline-offset-4 hover:decoration-ink"
                      >
                        Details
                      </Link>
                      <Button variant="quiet" onClick={() => setEditing(r.truck_id)}>
                        Edit
                      </Button>
                      <RemoveTruck truckId={r.truck_id} />
                    </td>
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
