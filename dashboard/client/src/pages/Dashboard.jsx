import { useMemo } from 'react';

import FleetStatusBar from '../components/FleetStatusBar.jsx';
import TruckCard from '../components/TruckCard.jsx';
import { API_URL } from '../config.js';
import { useFleetStore } from '../store/useFleetStore.js';
import { ageSeconds, displayStatus, freshnessOf } from '../lib/status.js';

function EmptyState({ connection, syncError }) {
  if (connection !== 'connected' || syncError) {
    return (
      <div className="rounded-md border border-line bg-panel p-5 text-[15px]">
        <p className="font-medium text-ink">Can't reach the fleet server at {API_URL}.</p>
        <p className="mt-1 text-muted">
          {syncError ? `${syncError}. ` : ''}Start it with <code className="text-ink">npm run dev</code> in{' '}
          <code className="text-ink">dashboard/server</code>, or check <code className="text-ink">VITE_API_URL</code>.
          This page reconnects on its own.
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-md border border-line bg-panel p-5 text-[15px] text-muted">
      No trucks have reported yet. They appear here as soon as the first telemetry point arrives.
    </div>
  );
}

export default function Dashboard() {
  const trucks = useFleetStore((s) => s.trucks);
  const now = useFleetStore((s) => s.now);
  const clockOffsetMs = useFleetStore((s) => s.clockOffsetMs);
  const freshnessRules = useFleetStore((s) => s.freshnessRules);
  const connection = useFleetStore((s) => s.connection);
  const syncError = useFleetStore((s) => s.syncError);

  const list = useMemo(() => Object.values(trucks).sort((a, b) => a.truck_id.localeCompare(b.truck_id)), [trucks]);

  const counts = {};
  for (const t of list) {
    const status = displayStatus(t, freshnessOf(ageSeconds(t, now, clockOffsetMs), freshnessRules));
    counts[status] = (counts[status] ?? 0) + 1;
  }
  const reporting = (counts.normal ?? 0) + (counts.warning ?? 0) + (counts.critical ?? 0);

  return (
    <div className="mx-auto max-w-[1400px]">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h1 className="font-cond text-2xl font-bold">Dashboard</h1>
        {list.length > 0 && (
          <p className="text-[15px] text-muted">
            {reporting} of {list.length} trucks reporting
          </p>
        )}
      </div>

      {list.length === 0 ? (
        <div className="mt-5">
          <EmptyState connection={connection} syncError={syncError} />
        </div>
      ) : (
        <>
          <section aria-label="Fleet status" className="mt-5 rounded-md border border-line bg-panel px-4 py-3.5">
            <FleetStatusBar counts={counts} total={list.length} />
          </section>
          <section aria-label="Trucks" className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {list.map((t) => (
              <TruckCard key={t.truck_id} truck={t} />
            ))}
          </section>
        </>
      )}
    </div>
  );
}
