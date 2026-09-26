import { useState } from 'react';

import Button from './ui/Button.jsx';
import ProvenanceBadge from './ProvenanceBadge.jsx';
import { sendJson } from '../lib/api.js';
import { reloadRegistry } from '../hooks/useSocket.js';

const inr = (n) => `₹${n.toLocaleString('en-IN')}`;

// Maintenance entered by the fleet manager, newest first, with remove.
export default function ServiceHistory({ records, showTruck = false }) {
  const [removing, setRemoving] = useState(null);
  const [error, setError] = useState(null);

  if (!records) return <p className="text-sm text-muted">Loading service records…</p>;
  if (records.length === 0) {
    return <p className="text-sm text-muted">No service records yet. Use Add service record to log work done.</p>;
  }

  const remove = async (id) => {
    setError(null);
    try {
      await sendJson(`/api/service-records/${encodeURIComponent(id)}`, 'DELETE');
      await reloadRegistry();
    } catch (err) {
      setError(err.message);
    } finally {
      setRemoving(null);
    }
  };

  return (
    <div>
      {error && <p className="mb-2 text-sm text-crit">{error}</p>}
      <ul className="divide-y divide-line">
        {records.map((r) => (
          <li key={r.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 py-2.5">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-3 text-sm">
                <span className="text-ink">{r.type}</span>
                {showTruck && <span className="text-muted">{r.truck_id}</span>}
                <span className="text-muted">{r.date}</span>
                <ProvenanceBadge kind="MANUAL" />
              </div>
              <div className="mt-0.5 flex flex-wrap gap-x-4 text-sm text-muted">
                {r.odometer_km != null && <span>{r.odometer_km.toLocaleString('en-IN')} km</span>}
                {r.cost_inr != null && <span>{inr(r.cost_inr)}</span>}
                {r.by && <span>By {r.by}</span>}
              </div>
              {r.notes && <p className="mt-0.5 text-sm text-ink">{r.notes}</p>}
            </div>
            {removing === r.id ? (
              <div className="flex gap-2">
                <Button variant="danger" onClick={() => remove(r.id)}>
                  Remove
                </Button>
                <Button variant="quiet" onClick={() => setRemoving(null)}>
                  Keep
                </Button>
              </div>
            ) : (
              <Button variant="quiet" onClick={() => setRemoving(r.id)} aria-label={`Remove ${r.type} on ${r.date}`}>
                Remove
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
