import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { AssignmentForm, AssignmentList } from '../components/Assignments.jsx';
import TripReplay from '../components/TripReplay.jsx';
import TripTable from '../components/TripTable.jsx';
import Button from '../components/ui/Button.jsx';
import Field from '../components/ui/Field.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import Panel, { EmptyState, LoadingState } from '../components/ui/Panel.jsx';
import Stat from '../components/ui/Stat.jsx';
import Tabs, { TabPanel } from '../components/ui/Tabs.jsx';
import { formatDuration } from '../lib/format.js';
import { sortedTrips, startText } from '../lib/trips.js';
import { useAssignments } from '../hooks/useAssignments.js';
import { useFleetStore } from '../store/useFleetStore.js';

function ActiveTab({ trips }) {
  const [adding, setAdding] = useState(false);
  const { assignments, error } = useAssignments(null);
  const active = sortedTrips(trips, { status: 'active' });

  return (
    <div className="space-y-5">
      <Panel title={`On the road now (${active.length})`} bodyClassName="overflow-x-auto">
        <TripTable trips={active} empty="No truck is on a trip right now." />
      </Panel>

      <Panel
        title="Planned trips"
        bodyClassName="overflow-x-auto"
        actions={
          !adding && (
            <Button variant="primary" onClick={() => setAdding(true)}>
              Add trip assignment
            </Button>
          )
        }
      >
        {adding && (
          <div className="border-b border-line p-4">
            <AssignmentForm onDone={() => setAdding(false)} />
          </div>
        )}
        {error ? <p className="p-4 text-sm text-crit">{error}</p> : <AssignmentList assignments={assignments} />}
      </Panel>
    </div>
  );
}

function CompletedTab({ trips }) {
  const [truck, setTruck] = useState('');
  const all = sortedTrips(trips, { status: 'completed' });
  const truckIds = [...new Set(all.map((t) => t.truck_id))].sort();
  const shown = truck ? all.filter((t) => t.truck_id === truck) : all;
  const km = shown.reduce((s, t) => s + t.distance_km, 0);
  const secs = shown.reduce((s, t) => s + t.duration_s, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <dl className="flex flex-wrap gap-x-10 gap-y-3">
          <Stat label="Trips" value={shown.length} />
          <Stat label="Distance" value={km.toFixed(1)} unit="km" />
          <Stat label="Time on the road" value={secs ? formatDuration(secs) : '0 min'} />
        </dl>
        <Field as="select" label="Truck" value={truck} onChange={(e) => setTruck(e.target.value)} className="w-40">
          <option value="">All trucks</option>
          {truckIds.map((id) => (
            <option key={id}>{id}</option>
          ))}
        </Field>
      </div>
      <Panel bodyClassName="overflow-x-auto">
        <TripTable trips={shown} empty="No completed trips yet. A trip ends once the truck has stood still for 2 minutes." />
      </Panel>
    </div>
  );
}

function ReplayTab({ trips, tripId, onPick }) {
  const now = useFleetStore((s) => s.now);
  const clockOffsetMs = useFleetStore((s) => s.clockOffsetMs);
  const all = sortedTrips(trips).filter((t) => t.has_path !== false);
  const current = all.find((t) => t.id === tripId) ?? all.find((t) => t.status === 'completed') ?? all[0];
  const truckIds = [...new Set(all.map((t) => t.truck_id))].sort();
  const forTruck = all.filter((t) => t.truck_id === current?.truck_id);

  if (!current) return <EmptyState>No trips to replay yet.</EmptyState>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field
          as="select"
          label="Truck"
          className="w-36"
          value={current.truck_id}
          onChange={(e) => {
            const first = all.find((t) => t.truck_id === e.target.value);
            if (first) onPick(first.id);
          }}
        >
          {truckIds.map((id) => (
            <option key={id}>{id}</option>
          ))}
        </Field>
        <Field as="select" label="Trip" className="w-80" value={current.id} onChange={(e) => onPick(e.target.value)}>
          {forTruck.map((t) => (
            <option key={t.id} value={t.id}>
              {startText(t.start_at, now + clockOffsetMs)}, {t.distance_km.toFixed(1)} km
              {t.status === 'active' ? ', on the road' : `, ${formatDuration(t.duration_s)}`}
            </option>
          ))}
        </Field>
      </div>
      {/* Ids restart with the server; the start time tells two T5s apart. */}
      <TripReplay key={`${current.id}|${current.start_ms}`} tripId={current.id} />
    </div>
  );
}

const TAB_IDS = ['active', 'completed', 'replay'];

export default function Trips() {
  const trips = useFleetStore((s) => s.trips);
  const tripRules = useFleetStore((s) => s.tripRules);
  const [params, setParams] = useSearchParams();
  const tab = TAB_IDS.includes(params.get('tab')) ? params.get('tab') : 'active';
  const counts = useMemo(() => {
    const list = Object.values(trips ?? {});
    return { active: list.filter((t) => t.status === 'active').length, completed: list.filter((t) => t.status === 'completed').length };
  }, [trips]);

  return (
    <div className="mx-auto max-w-[1440px]">
      <PageHeader
        title="Trips"
        description={
          tripRules
            ? `Detected from the readings: a trip starts after ${tripRules.start_hold_s} s above ${tripRules.start_speed_kmh} km/h and ends after ${tripRules.stop_hold_s / 60} min stopped or ${tripRules.no_data_end_s / 60} min without data.`
            : 'Trips detected from the readings, planned trips and replay.'
        }
      />
      <div>
        <Tabs
          label="Trip views"
          value={tab}
          onChange={(id) => setParams(id === 'active' ? {} : { tab: id }, { replace: true })}
          tabs={[
            { id: 'active', label: 'Active', count: counts.active },
            { id: 'completed', label: 'Completed', count: counts.completed },
            { id: 'replay', label: 'Replay' },
          ]}
        />
        <TabPanel id={tab}>
          {!trips ? (
            <Panel bodyClassName="">
              <LoadingState>Loading trips…</LoadingState>
            </Panel>
          ) : (
            <>
              {tab === 'active' && <ActiveTab trips={trips} />}
              {tab === 'completed' && <CompletedTab trips={trips} />}
              {tab === 'replay' && (
                <ReplayTab
                  trips={trips}
                  tripId={params.get('trip')}
                  onPick={(id) => setParams({ tab: 'replay', trip: id }, { replace: true })}
                />
              )}
            </>
          )}
        </TabPanel>
      </div>
    </div>
  );
}
