import { useEffect, useState } from 'react';
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import Plate from './Plate.jsx';
import ProvenanceBadge from './ProvenanceBadge.jsx';
import Button from './ui/Button.jsx';
import Field from './ui/Field.jsx';
import { EmptyState } from './ui/Panel.jsx';
import { API_URL } from '../config.js';
import { rememberName, rememberedName, sendJson, timeoutSignal } from '../lib/api.js';
import { ANOMALY_LABEL, anomalyDetail, levelBadge, levelTone } from '../lib/fuel.js';
import { themeColor } from '../lib/theme.js';
import { startText } from '../lib/trips.js';
import { reloadRegistry } from '../hooks/useSocket.js';
import { useFleetStore } from '../store/useFleetStore.js';

// Tank bar with percent and litres, badged by where the level comes from.
export function FuelLevel({ fuel, provenance, compact = false }) {
  if (!fuel) return <span className="text-faint">No data</span>;
  return (
    <div className={compact ? 'min-w-40' : 'max-w-sm'}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-ink">
          <span className="font-cond text-lg font-bold">{fuel.level_pct.toFixed(1)} %</span>{' '}
          <span className="text-muted">
            {Math.round(fuel.level_l)} of {fuel.capacity_l} L
          </span>
        </span>
        <ProvenanceBadge kind={levelBadge(fuel, provenance)} />
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-asphalt" role="presentation">
        <div className={`h-1.5 rounded-full ${levelTone(fuel.level_pct)}`} style={{ width: `${Math.max(0, Math.min(100, fuel.level_pct))}%` }} />
      </div>
    </div>
  );
}

const clock = (ms) => new Date(ms).toTimeString().slice(0, 5);

// Level over the last hours (a sample every 30 s), refreshed every 30 s.
export function FuelTrend({ truckId }) {
  const [state, setState] = useState({ rows: null, error: null });

  useEffect(() => {
    setState({ rows: null, error: null });
    let timer = null;
    let ctrl = null;
    const load = () => {
      ctrl = new AbortController();
      const t = timeoutSignal(ctrl.signal);
      fetch(`${API_URL}/api/fuel/${encodeURIComponent(truckId)}/history`, { signal: t.signal })
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`The server answered ${res.status}`))))
        .then((body) => setState({ rows: body.rows, error: null }))
        .catch((err) => {
          if (err.name !== 'AbortError') setState((s) => ({ ...s, error: 'Could not load the fuel trend.' }));
        })
        .finally(t.done);
    };
    load();
    timer = setInterval(load, 30_000);
    return () => {
      clearInterval(timer);
      ctrl?.abort();
    };
  }, [truckId]);

  if (state.error && !state.rows) return <EmptyState>{state.error}</EmptyState>;
  if (!state.rows) return <EmptyState>Loading fuel trend…</EmptyState>;
  if (state.rows.length < 2) return <EmptyState>Not enough readings yet for a trend.</EmptyState>;
  const data = state.rows.map(([t, pct]) => ({ t, pct }));

  return (
    <figure>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <XAxis
              dataKey="t"
              type="number"
              domain={['dataMin', 'dataMax']}
              tickFormatter={clock}
              tick={{ fill: themeColor('muted'), fontSize: 11 }}
              axisLine={{ stroke: themeColor('line') }}
              tickLine={false}
              minTickGap={40}
            />
            <YAxis
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
              width={36}
              unit="%"
              tick={{ fill: themeColor('muted'), fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              cursor={{ stroke: themeColor('line') }}
              contentStyle={{ background: themeColor('panel'), border: `1px solid ${themeColor('line')}`, fontSize: 12 }}
              labelStyle={{ color: themeColor('muted') }}
              itemStyle={{ color: themeColor('ink') }}
              labelFormatter={clock}
              formatter={(v) => [`${v.toFixed(1)} %`, 'Level']}
            />
            <Line dataKey="pct" dot={false} stroke={themeColor('ink')} strokeWidth={2} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="mt-1 text-xs text-muted">
        Tank level from {clock(data[0].t)} to {clock(data[data.length - 1].t)}, one reading every 30 s.
      </figcaption>
    </figure>
  );
}

// Possible thefts and detected refuels, newest first.
export function FuelEvents({ events, showTruck = true, empty }) {
  const now = useFleetStore((s) => s.now);
  const clockOffsetMs = useFleetStore((s) => s.clockOffsetMs);
  if (!events) return <EmptyState>Loading…</EmptyState>;
  if (events.length === 0) return <EmptyState>{empty}</EmptyState>;
  return (
    <table className="w-full min-w-[720px] text-left text-sm">
      <thead className="border-b border-line text-muted">
        <tr>
          <th className="px-4 py-2 font-normal">When</th>
          <th className="px-4 py-2 font-normal">What</th>
          <th className="px-4 py-2 font-normal">Level</th>
          {showTruck && <th className="px-4 py-2 font-normal">Truck</th>}
          <th className="px-4 py-2 font-normal">Where</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {events.map((e) => (
          <tr key={e.id} className="align-top">
            <td className="whitespace-nowrap px-4 py-2.5 text-ink">{startText(e.start_at, now + clockOffsetMs)}</td>
            <td className="whitespace-nowrap px-4 py-2.5">
              <span className={e.type === 'theft' ? 'text-crit' : 'text-ink'}>{ANOMALY_LABEL[e.type]}</span>
              {e.ongoing && <div className="text-xs text-muted">still changing</div>}
            </td>
            <td className="px-4 py-2.5 text-ink">{anomalyDetail(e)}</td>
            {showTruck && (
              <td className="px-4 py-2.5">
                <Plate truckId={e.truck_id} size="sm" />
                <div className="mt-1 text-muted">{e.driver_name}</div>
              </td>
            )}
            <td className="whitespace-nowrap px-4 py-2.5 text-muted">
              {e.latitude != null ? `${e.latitude.toFixed(4)}, ${e.longitude.toFixed(4)}` : 'No GPS fix'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// "2026-09-25T14:30" for now, local time.
function nowLocal() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function RefuelForm({ truckId = null, onDone }) {
  const registry = useFleetStore((s) => s.registry);
  const trucks = [...(registry?.trucks ?? [])].sort((a, b) => a.truck_id.localeCompare(b.truck_id));
  const [form, setForm] = useState({
    truck_id: truckId ?? trucks[0]?.truck_id ?? '',
    litres: '',
    cost_inr: '',
    at: nowLocal(),
    notes: '',
    by: rememberedName(),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const truck = trucks.find((t) => t.truck_id === form.truck_id);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body = { ...form, litres: Number(form.litres), cost_inr: form.cost_inr === '' ? null : Number(form.cost_inr) };
      const out = await sendJson('/api/refuels', 'POST', body);
      if (form.by.trim()) rememberName(form.by.trim());
      await reloadRegistry();
      if (!out.applied_to_estimate) {
        setNote('Saved. The level is unchanged: this truck measures its level with a sensor, the refuel is from before tracking began (already in the full tank the estimate starts from), or the truck has not reported since the server started.');
        return;
      }
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
      <Field
        label="Litres"
        type="number"
        min={1}
        max={truck?.tank_capacity_l ?? 2000}
        step="0.1"
        value={form.litres}
        onChange={set('litres')}
        required
        hint={truck ? `Tank holds ${truck.tank_capacity_l} L` : undefined}
      />
      <Field label="Cost in ₹ (optional)" type="number" min={0} step="1" value={form.cost_inr} onChange={set('cost_inr')} />
      <Field label="When" type="datetime-local" value={form.at} onChange={set('at')} required />
      <Field label="Notes (optional)" value={form.notes} onChange={set('notes')} maxLength={300} placeholder="IOCL Ennore, bill 4471" />
      <Field label="Your name (optional)" value={form.by} onChange={set('by')} maxLength={60} />
      <div className="flex flex-wrap items-end gap-2 sm:col-span-2">
        <Button type="submit" variant="primary" disabled={saving || Boolean(note) || trucks.length === 0}>
          {saving ? 'Saving…' : 'Add refuel'}
        </Button>
        <Button variant="quiet" onClick={onDone} disabled={saving}>
          {note ? 'Close' : 'Cancel'}
        </Button>
      </div>
      {(error || note) && (
        <p role={error ? 'alert' : 'status'} className={`text-sm sm:col-span-2 lg:col-span-4 ${error ? 'text-crit' : 'text-muted'}`}>
          {error ?? note}
        </p>
      )}
    </form>
  );
}

function RemoveRefuel({ id }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(null);
  const remove = async () => {
    try {
      await sendJson(`/api/refuels/${encodeURIComponent(id)}`, 'DELETE');
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
        Remove entry
      </Button>
      <Button variant="quiet" onClick={() => setConfirming(false)}>
        Keep
      </Button>
    </span>
  );
}

// Refuels entered by the fleet manager, newest first.
export function RefuelList({ refuels, showTruck = true }) {
  const now = useFleetStore((s) => s.now);
  const clockOffsetMs = useFleetStore((s) => s.clockOffsetMs);
  if (!refuels) return <EmptyState>Loading the refuel log…</EmptyState>;
  if (refuels.length === 0) return <EmptyState>No refuels logged. Use Add refuel after filling a tank; the estimate rises by the litres.</EmptyState>;
  return (
    <table className="w-full min-w-[720px] text-left text-sm">
      <thead className="border-b border-line text-muted">
        <tr>
          <th className="px-4 py-2 font-normal">When</th>
          {showTruck && <th className="px-4 py-2 font-normal">Truck</th>}
          <th className="px-4 py-2 font-normal">Litres</th>
          <th className="px-4 py-2 font-normal">Cost</th>
          <th className="px-4 py-2 font-normal">Notes</th>
          <th className="px-4 py-2 font-normal">
            <span className="sr-only">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {refuels.map((r) => (
          <tr key={r.id} className="align-top">
            <td className="whitespace-nowrap px-4 py-2.5 text-ink">
              {startText(r.at, now + clockOffsetMs)}
              <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
                <ProvenanceBadge kind="MANUAL" /> {r.by ?? ''}
              </div>
            </td>
            {showTruck && (
              <td className="px-4 py-2.5">
                <Plate truckId={r.truck_id} size="sm" />
              </td>
            )}
            <td className="whitespace-nowrap px-4 py-2.5 text-ink">{r.litres} L</td>
            <td className="whitespace-nowrap px-4 py-2.5 text-ink">
              {r.cost_inr != null ? `₹${r.cost_inr.toLocaleString('en-IN')}` : <span className="text-faint">Not given</span>}
            </td>
            <td className="px-4 py-2.5 text-ink">{r.notes ?? <span className="text-faint">None</span>}</td>
            <td className="whitespace-nowrap px-4 py-2.5 text-right">
              <RemoveRefuel id={r.id} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
