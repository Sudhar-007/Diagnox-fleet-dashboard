import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import DriverForm from '../components/DriverForm.jsx';
import DrivingEvents from '../components/DrivingEvents.jsx';
import Plate from '../components/Plate.jsx';
import ProvenanceBadge from '../components/ProvenanceBadge.jsx';
import Button from '../components/ui/Button.jsx';
import Panel, { EmptyState } from '../components/ui/Panel.jsx';
import { sendJson } from '../lib/api.js';
import { EVENT_LABEL, deductionText, driverRows, scoreTone } from '../lib/driving.js';
import { formatDuration } from '../lib/format.js';
import { sortedTrips, startText } from '../lib/trips.js';
import { reloadRegistry } from '../hooks/useSocket.js';
import { useFleetStore } from '../store/useFleetStore.js';

function RemoveDriver({ driver, onRemoved }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(null);
  const remove = async () => {
    try {
      await sendJson(`/api/registry/drivers/${encodeURIComponent(driver.driver_id)}`, 'DELETE');
      await reloadRegistry();
      onRemoved?.();
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
        Remove {driver.name}
      </Button>
      <Button variant="quiet" onClick={() => setConfirming(false)}>
        Keep
      </Button>
    </span>
  );
}

function Score({ value, note }) {
  if (value == null) return <span className="text-faint">{note ?? 'No rated trip yet'}</span>;
  return <span className={`font-cond text-lg font-bold ${scoreTone(value)}`}>{value}</span>;
}

function countsText(counts) {
  const parts = Object.keys(EVENT_LABEL)
    .filter((t) => counts[t])
    .map((t) => `${counts[t]} ${EVENT_LABEL[t].toLowerCase()}`);
  return parts.length ? parts.join(', ') : null;
}

function ScoreRules({ rules }) {
  if (!rules) return null;
  const p = rules.points;
  const items = [
    [`Harsh braking`, `speed falls faster than ${rules.harsh_brake_kmh_s} km/h per second`, `${p.harsh_brake} pts each`],
    [`Harsh acceleration`, `speed rises faster than ${rules.harsh_accel_kmh_s} km/h per second`, `${p.harsh_accel} pts each`],
    [`Overspeed`, `above ${rules.overspeed_kmh} km/h`, `${p.overspeed_per_min} pts per minute`],
    [`Idling`, `0 km/h with the engine running for more than ${formatDuration(rules.idle_min_s)}`, `${p.idle_per_min} pt per minute`],
  ];
  return (
    <Panel title="How the score works">
      <p className="text-sm text-muted">
        Every trip starts at {rules.start_score} and loses points for each event, never below 0. Events are judged only between
        readings at most {rules.max_gap_s} s apart; a trip with sparser readings gets no score. Overspeed and idling time is added
        up over the trip and charged per whole minute, at least one. A driver's score is the average of their completed trips
        kept in memory.
      </p>
      <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        {items.map(([name, rule, cost]) => (
          <div key={name} className="flex justify-between gap-4 border-t border-line pt-2">
            <dt>
              <span className="text-ink">{name}</span>
              <span className="text-muted">: {rule}</span>
            </dt>
            <dd className="whitespace-nowrap text-ink">{cost}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

// A driver's trips with the score of each and what it lost points for.
function DriverTrips({ trips }) {
  const now = useFleetStore((s) => s.now);
  const clockOffsetMs = useFleetStore((s) => s.clockOffsetMs);
  if (trips.length === 0) return <EmptyState>No trips for this driver since the server started.</EmptyState>;
  return (
    <table className="w-full min-w-[760px] text-left text-sm">
      <thead className="border-b border-line text-muted">
        <tr>
          <th className="px-4 py-2 font-normal">Started</th>
          <th className="px-4 py-2 font-normal">Truck</th>
          <th className="px-4 py-2 font-normal">Duration, distance</th>
          <th className="px-4 py-2 font-normal">Score</th>
          <th className="px-4 py-2 font-normal">Points lost for</th>
          <th className="px-4 py-2 font-normal">
            <span className="sr-only">Replay</span>
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {trips.map((t) => {
          const d = t.driving;
          return (
            <tr key={t.id} className="align-top">
              <td className="whitespace-nowrap px-4 py-2.5 text-ink">
                {startText(t.start_at, now + clockOffsetMs)}
                {t.status === 'active' && <div className="text-xs text-ok">on the road</div>}
              </td>
              <td className="px-4 py-2.5">
                <Plate truckId={t.truck_id} size="sm" />
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 text-ink">
                {formatDuration(t.duration_s)}, {t.distance_km.toFixed(1)} km
              </td>
              <td className="px-4 py-2.5">
                <Score value={d?.score} note={d && !d.rated ? 'Readings too sparse to rate' : undefined} />
              </td>
              <td className="px-4 py-2.5 text-ink">
                {d?.deductions.length ? d.deductions.map(deductionText).join('; ') : <span className="text-faint">Nothing</span>}
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 text-right">
                {t.has_path !== false && (
                  <Link
                    to={`/trips?tab=replay&trip=${encodeURIComponent(t.id)}`}
                    className="text-ink underline decoration-line underline-offset-4 hover:decoration-ink"
                  >
                    Replay
                  </Link>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default function Drivers() {
  const registry = useFleetStore((s) => s.registry);
  const trips = useFleetStore((s) => s.trips);
  const events = useFleetStore((s) => s.driverEvents);
  const rules = useFleetStore((s) => s.driverRules);
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);

  const rows = useMemo(() => driverRows(registry?.drivers, trips, events), [registry, trips, events]);
  const selected = rows.find((r) => r.driver.driver_id === params.get('driver')) ?? null;
  const pick = (id) => setParams(id ? { driver: id } : {}, { replace: true });

  return (
    <div className="mx-auto max-w-[1300px] space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h1 className="font-cond text-2xl font-bold">Drivers</h1>
        <p className="flex items-center gap-2 text-sm text-muted">
          Driving scores <ProvenanceBadge kind="RULE_BASED" /> from speed and rpm readings
        </p>
      </div>

      <Panel
        title={`Fleet drivers (${rows.length})`}
        bodyClassName="overflow-x-auto"
        actions={
          !adding && (
            <Button variant="primary" onClick={() => setAdding(true)}>
              Add driver
            </Button>
          )
        }
      >
        {adding && (
          <div className="border-b border-line p-4">
            <DriverForm onDone={() => setAdding(false)} />
          </div>
        )}
        {!registry ? (
          <EmptyState>Loading drivers…</EmptyState>
        ) : rows.length === 0 ? (
          <EmptyState>No drivers yet. Use Add driver to enter one and put them on a truck.</EmptyState>
        ) : (
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="border-b border-line text-muted">
              <tr>
                <th className="px-4 py-2 font-normal">Driver</th>
                <th className="px-4 py-2 font-normal">Truck</th>
                <th className="px-4 py-2 font-normal">Score</th>
                <th className="px-4 py-2 font-normal">Current trip</th>
                <th className="px-4 py-2 font-normal">Events</th>
                <th className="px-4 py-2 font-normal">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => {
                const d = r.driver;
                const isSelected = selected?.driver.driver_id === d.driver_id;
                if (editing === d.driver_id) {
                  return (
                    <tr key={d.driver_id}>
                      <td colSpan={6} className="p-4">
                        <DriverForm driver={d} onDone={() => setEditing(null)} />
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={d.driver_id} className={`align-top ${isSelected ? 'bg-asphalt' : ''}`}>
                    <td className="px-4 py-2.5">
                      <button
                        type="button"
                        onClick={() => pick(isSelected ? null : d.driver_id)}
                        className="text-left text-ink underline decoration-line underline-offset-4 hover:decoration-ink"
                        aria-pressed={isSelected}
                      >
                        {d.name}
                      </button>
                      <div className="mt-0.5 text-muted">{[d.phone, d.licence_no].filter(Boolean).join(', ') || 'No contact details'}</div>
                    </td>
                    <td className="px-4 py-2.5">
                      {d.truck_id ? <Plate truckId={d.truck_id} size="sm" /> : <span className="text-faint">No truck</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      <Score value={r.score} />
                      {r.score != null && (
                        <div className="text-xs text-muted">
                          over {r.ratedTrips} {r.ratedTrips === 1 ? 'trip' : 'trips'}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {r.active ? (
                        <>
                          <Score value={r.active.driving?.score} note="Not rated" />
                          <div className="text-xs text-ok">on the road</div>
                        </>
                      ) : (
                        <span className="text-faint">Not driving</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-ink">{countsText(r.counts) ?? <span className="text-faint">None</span>}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right">
                      <span className="inline-flex gap-1.5">
                        <Button variant="quiet" onClick={() => setEditing(d.driver_id)}>
                          Edit
                        </Button>
                        <RemoveDriver driver={d} onRemoved={() => isSelected && pick(null)} />
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>

      {selected ? (
        <>
          <Panel
            title={`${selected.driver.name}: trips`}
            bodyClassName="overflow-x-auto"
            actions={
              <Button variant="quiet" onClick={() => pick(null)}>
                Show all drivers
              </Button>
            }
          >
            <DriverTrips trips={sortedTrips(trips).filter((t) => t.driver_id === selected.driver.driver_id)} />
          </Panel>
          <Panel title={`${selected.driver.name}: events`} bodyClassName="overflow-x-auto">
            <DrivingEvents
              events={events?.filter((e) => e.driver_id === selected.driver.driver_id) ?? null}
              showDriver={false}
              empty="No harsh braking, harsh acceleration, overspeed or idling recorded for this driver."
            />
          </Panel>
        </>
      ) : (
        <Panel title="Recent events, all drivers" bodyClassName="overflow-x-auto">
          <DrivingEvents
            events={events}
            empty="No harsh braking, harsh acceleration, overspeed or idling since the server started. The Harsh braking demo scenario (Shift+D) shows one."
          />
        </Panel>
      )}

      <ScoreRules rules={rules} />
    </div>
  );
}
