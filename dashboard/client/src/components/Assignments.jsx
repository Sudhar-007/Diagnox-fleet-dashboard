import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import Plate from './Plate.jsx';
import Button from './ui/Button.jsx';
import Field from './ui/Field.jsx';
import { EmptyState } from './ui/Panel.jsx';
import { rememberName, rememberedName, sendJson } from '../lib/api.js';
import { formatDuration } from '../lib/format.js';
import { linkAssignments, startText } from '../lib/trips.js';
import { reloadRegistry } from '../hooks/useSocket.js';
import { useFleetStore } from '../store/useFleetStore.js';
import { toast } from '../lib/toast.js';

// "2026-09-25T14:30" in local time, rounded up to the next quarter hour.
function nextQuarterHour() {
  const d = new Date(Date.now() + 15 * 60_000);
  d.setMinutes(Math.floor(d.getMinutes() / 15) * 15, 0, 0);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function AssignmentForm({ truckId = null, onDone }) {
  const registry = useFleetStore((s) => s.registry);
  const [form, setForm] = useState({
    truck_id: truckId ?? registry?.trucks[0]?.truck_id ?? '',
    driver_id: '',
    from_place: '',
    to_place: '',
    cargo: '',
    planned_start: nextQuarterHour(),
    by: rememberedName(),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const trucks = [...(registry?.trucks ?? [])].sort((a, b) => a.truck_id.localeCompare(b.truck_id));
  const truck = trucks.find((t) => t.truck_id === form.truck_id);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      // "" = the truck's driver (server default), "none" = explicitly nobody.
      const driver_id = form.driver_id === 'none' ? '' : form.driver_id || undefined;
      await sendJson('/api/trip-assignments', 'POST', { ...form, driver_id });
      if (form.by.trim()) rememberName(form.by.trim());
      await reloadRegistry();
      toast(`Trip planned for ${form.truck_id}`);
      onDone?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Field as="select" label="Truck" value={form.truck_id} onChange={set('truck_id')} disabled={Boolean(truckId)} required>
        {trucks.map((t) => (
          <option key={t.truck_id} value={t.truck_id}>
            {t.truck_id}
          </option>
        ))}
      </Field>
      <Field as="select" label="Driver" value={form.driver_id} onChange={set('driver_id')}>
        <option value="">{truck?.driver_name ? `Truck's driver (${truck.driver_name})` : 'No driver'}</option>
        {truck?.driver_name && <option value="none">No driver</option>}
        {(registry?.drivers ?? []).map((d) => (
          <option key={d.driver_id} value={d.driver_id}>
            {d.name}
          </option>
        ))}
      </Field>
      <Field label="From" value={form.from_place} onChange={set('from_place')} required maxLength={60} placeholder="Ambattur depot" />
      <Field label="To" value={form.to_place} onChange={set('to_place')} required maxLength={60} placeholder="Chennai Port" />
      <Field label="Cargo (optional)" value={form.cargo} onChange={set('cargo')} maxLength={100} placeholder="18 t steel coils" />
      <Field label="Planned start" type="datetime-local" value={form.planned_start} onChange={set('planned_start')} required />
      <Field label="Your name (optional)" value={form.by} onChange={set('by')} maxLength={60} />
      <div className="flex flex-wrap items-end gap-2">
        <Button type="submit" variant="primary" disabled={saving || trucks.length === 0}>
          {saving ? 'Saving…' : 'Add trip assignment'}
        </Button>
        <Button variant="quiet" onClick={() => onDone?.()} disabled={saving}>
          Cancel
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-crit sm:col-span-2 lg:col-span-4">
          {error}
        </p>
      )}
    </form>
  );
}

function Remove({ id }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(null);
  const remove = async () => {
    try {
      await sendJson(`/api/trip-assignments/${encodeURIComponent(id)}`, 'DELETE');
      await reloadRegistry();
      toast('Planned trip removed');
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
        Remove plan
      </Button>
      <Button variant="quiet" onClick={() => setConfirming(false)}>
        Keep
      </Button>
    </span>
  );
}

function Status({ link, serverNow }) {
  if (!link) return null;
  const { trip, state } = link;
  if (trip) {
    return (
      <span>
        <span className={state === 'on_road' ? 'text-ok' : 'text-ink'}>
          {state === 'on_road' ? 'On the road' : 'Done'}
        </span>
        <span className="text-muted">, started {startText(trip.start_at, serverNow)} </span>
        <Link
          to={`/trips?tab=replay&trip=${encodeURIComponent(trip.id)}`}
          className="font-medium text-accent hover:underline"
        >
          Replay
        </Link>
      </span>
    );
  }
  if (state === 'upcoming') return <span className="text-muted">Not started yet</span>;
  return <span className="text-warn">Not started, {formatDuration(link.late_s)} past the planned start</span>;
}

// Planned jobs with how they are going, matched to detected trips (rules.trips).
export function AssignmentList({ assignments, showTruck = true }) {
  const trips = useFleetStore((s) => s.trips);
  const tripRules = useFleetStore((s) => s.tripRules);
  const now = useFleetStore((s) => s.now);
  const clockOffsetMs = useFleetStore((s) => s.clockOffsetMs);
  const serverNow = now + clockOffsetMs;
  // Recomputed every flush tick so "late" advances; the inputs are small.
  const links = useMemo(
    () => linkAssignments(assignments ?? [], trips, tripRules?.assignment_early_s ?? 1800, serverNow),
    [assignments, trips, tripRules, serverNow],
  );

  if (!assignments) return <EmptyState>Loading planned trips…</EmptyState>;
  if (assignments.length === 0) {
    return <EmptyState>No planned trips. Use Add trip assignment to plan one; it is matched to the truck's next detected trip.</EmptyState>;
  }
  return (
    <table className="w-full min-w-[860px] text-left text-sm">
      <thead className="border-b border-line">
        <tr>
          <th className="px-4 py-2">Planned start</th>
          {showTruck && <th className="px-4 py-2">Truck</th>}
          <th className="px-4 py-2">Driver</th>
          <th className="px-4 py-2">Route</th>
          <th className="px-4 py-2">Cargo</th>
          <th className="px-4 py-2">Status</th>
          <th className="px-4 py-2">
            <span className="sr-only">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {assignments.map((a) => (
          <tr key={a.id} className="align-top">
            <td className="whitespace-nowrap px-4 py-2.5 text-ink">{startText(a.planned_start, serverNow)}</td>
            {showTruck && (
              <td className="px-4 py-2.5">
                <Plate truckId={a.truck_id} size="sm" />
              </td>
            )}
            <td className="px-4 py-2.5 text-ink">{a.driver_name ?? <span className="text-faint">No driver</span>}</td>
            <td className="px-4 py-2.5 text-ink">
              {a.from_place} <span className="text-muted">to</span> {a.to_place}
            </td>
            <td className="px-4 py-2.5 text-ink">{a.cargo ?? <span className="text-faint">Not given</span>}</td>
            <td className="px-4 py-2.5">
              <Status link={links.get(a.id)} serverNow={serverNow} />
            </td>
            <td className="whitespace-nowrap px-4 py-2.5 text-right">
              <Remove id={a.id} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
