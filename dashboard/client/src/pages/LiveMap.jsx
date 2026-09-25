import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import FleetMap from '../components/FleetMap.jsx';
import Plate from '../components/Plate.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { TRAIL_POINTS } from '../config.js';
import { useFleetStore } from '../store/useFleetStore.js';
import { useTruckStatus } from '../lib/useTruckStatus.js';
import { formatAgo, formatNumber } from '../lib/format.js';

function TruckRow({ truck, selected, onSelect }) {
  const { age, status } = useTruckStatus(truck);
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(truck.truck_id)}
        aria-pressed={selected}
        className={`w-full rounded-[4px] px-3 py-2.5 text-left ${selected ? 'bg-panel-hi' : 'hover:bg-panel-hi/60'}`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <Plate truckId={truck.truck_id} size="sm" />
            <span className="text-[15px] text-ink">{truck.driver_name}</span>
          </div>
          <StatusBadge status={status} />
        </div>
        <div className="mt-1 flex justify-between text-sm text-muted">
          <span>
            <span className="text-ink">{formatNumber(truck.speed)}</span> km/h
          </span>
          <span>{formatAgo(age)}</span>
        </div>
      </button>
    </li>
  );
}

export default function LiveMap() {
  const trucks = useFleetStore((s) => s.trucks);
  const [params, setParams] = useSearchParams();
  const [fitSignal, setFitSignal] = useState(0);
  const selectedId = params.get('truck');

  const list = useMemo(() => Object.values(trucks).sort((a, b) => a.truck_id.localeCompare(b.truck_id)), [trucks]);

  const select = (id) => setParams(id === selectedId ? {} : { truck: id }, { replace: true });

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-4 lg:h-[calc(100dvh-6.5rem)]">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <h1 className="font-cond text-2xl font-bold">Live Map</h1>
        <div className="flex items-center gap-4 text-sm text-muted">
          <span>Trails show each truck's last {TRAIL_POINTS} positions</span>
          <button
            type="button"
            onClick={() => {
              setParams({}, { replace: true });
              setFitSignal((n) => n + 1);
            }}
            className="shrink-0 whitespace-nowrap rounded-[4px] border border-line px-2.5 py-1 text-ink hover:bg-panel-hi"
          >
            Show all trucks
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        <div className="h-[60vh] min-h-80 overflow-hidden rounded-md border border-line lg:h-auto lg:flex-1">
          <FleetMap trucks={list} selectedId={selectedId} onSelect={select} fitSignal={fitSignal} />
        </div>

        <aside aria-label="Trucks" className="rounded-md border border-line bg-panel lg:w-80 lg:overflow-y-auto">
          {list.length === 0 ? (
            <p className="p-4 text-[15px] text-muted">No trucks have reported yet.</p>
          ) : (
            <ul className="space-y-0.5 p-1.5">
              {list.map((t) => (
                <TruckRow key={t.truck_id} truck={t} selected={t.truck_id === selectedId} onSelect={select} />
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}
