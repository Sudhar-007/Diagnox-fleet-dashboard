import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import FleetMap from '../components/FleetMap.jsx';
import Plate from '../components/Plate.jsx';
import ProvenanceBadge from '../components/ProvenanceBadge.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import Button from '../components/ui/Button.jsx';
import SearchInput from '../components/ui/SearchInput.jsx';
import { TRAIL_POINTS } from '../config.js';
import { useFleetStore } from '../store/useFleetStore.js';
import { sosLabel } from '../lib/alerts.js';
import { byUrgency, locationText, useFleetRows } from '../lib/fleetView.js';
import { formatAgo, formatNumber } from '../lib/format.js';

function ZoneLegend() {
  const zones = useFleetStore((s) => s.zones);
  if (!zones) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted">
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className="size-3 rounded-full border-2 border-crit bg-crit/15" />
        Restricted zone
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className="size-3 rounded-full border-[1.5px] border-dashed border-ink" />
        Allowed zone
      </span>
      <Link to="/settings" className="font-medium text-accent hover:underline">
        {zones.length === 0 ? 'Add a zone' : 'Edit zones'}
      </Link>
    </div>
  );
}

function TruckRow({ row, selected, onSelect }) {
  const { truck, status, age, silent, sos } = row;
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(truck.truck_id)}
        aria-pressed={selected}
        className={`w-full border-l-[3px] px-3 py-2.5 text-left transition-colors ${
          selected ? 'border-accent bg-accent/5' : sos ? 'border-crit bg-crit/5 hover:bg-crit/10' : 'border-transparent hover:bg-subtle'
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <Plate truckId={truck.truck_id} size="sm" />
            <span className="truncate text-ink">{truck.driver_name}</span>
          </div>
          <StatusBadge status={status} sos={Boolean(sos)} />
        </div>
        <div className="mt-1 flex justify-between gap-3 text-[13px] text-muted">
          <span className="truncate">
            <span className={silent ? '' : 'text-ink'}>{formatNumber(truck.speed)}</span> km/h, {locationText(truck)}
          </span>
          <span className={`shrink-0 ${silent ? 'font-medium text-idle' : ''}`}>{formatAgo(age)}</span>
        </div>
        {truck.position_source === 'virtual_route' && (
          <p className="mt-1">
            <ProvenanceBadge kind="VIRTUAL_POSITION" />
          </p>
        )}
        {sos && <p className="mt-1 text-[13px] font-medium text-crit">{sosLabel(sos)}</p>}
      </button>
    </li>
  );
}

export default function LiveMap() {
  const rows = useFleetRows();
  const [params, setParams] = useSearchParams();
  const [fitSignal, setFitSignal] = useState(0);
  const [query, setQuery] = useState('');
  const selectedId = params.get('truck');

  const trucks = useMemo(() => rows.map((r) => r.truck), [rows]);
  // Most urgent first, so a truck in trouble is at the top of the list.
  const q = query.trim().toLowerCase();
  const list = useMemo(
    () =>
      [...rows]
        .sort(byUrgency)
        .filter((r) => !q || r.truck.truck_id.toLowerCase().includes(q) || (r.truck.driver_name ?? '').toLowerCase().includes(q)),
    [rows, q],
  );

  const select = (id) => setParams(id === selectedId ? {} : { truck: id }, { replace: true });

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-3 lg:h-[calc(100dvh-7.75rem)]">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <h1 className="font-display text-[22px] leading-8 font-semibold tracking-tight text-ink">Live map</h1>
          <ZoneLegend />
        </div>
        <div className="flex items-center gap-3 text-[13px] text-muted">
          <span>Trails show each truck's last {TRAIL_POINTS} positions</span>
          <Button
            onClick={() => {
              setParams({}, { replace: true });
              setFitSignal((n) => n + 1);
            }}
          >
            Show all trucks
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
        <div className="h-[60vh] min-h-80 overflow-hidden rounded-lg border border-line lg:h-auto lg:flex-1">
          <FleetMap trucks={trucks} selectedId={selectedId} onSelect={select} fitSignal={fitSignal} />
        </div>

        <aside aria-label="Trucks" className="flex flex-col rounded-lg border border-line bg-surface lg:w-[340px]">
          <div className="border-b border-line p-2.5">
            <SearchInput value={query} onChange={setQuery} label="Find a truck" placeholder="Truck or driver" className="w-full" />
          </div>
          {rows.length === 0 ? (
            <p className="p-4 text-muted">No trucks have reported yet.</p>
          ) : list.length === 0 ? (
            <p className="p-4 text-muted">No truck matches "{query.trim()}".</p>
          ) : (
            <ul className="divide-y divide-line lg:overflow-y-auto">
              {list.map((r) => (
                <TruckRow key={r.truck.truck_id} row={r} selected={r.truck.truck_id === selectedId} onSelect={select} />
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}
