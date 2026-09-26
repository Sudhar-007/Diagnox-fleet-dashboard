import { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import ProvenanceBadge from '../components/ProvenanceBadge.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import Panel, { ErrorState, LoadingState } from '../components/ui/Panel.jsx';
import Segmented from '../components/ui/Segmented.jsx';
import { API_URL } from '../config.js';
import { timeoutSignal } from '../lib/api.js';
import { formatDuration } from '../lib/format.js';
import { themeColor } from '../lib/theme.js';
import { useFleetStore } from '../store/useFleetStore.js';

// Categorical series colours for the white surface, validated (lightness band, chroma,
// colour-blind separation between neighbours). Aqua, yellow and magenta sit below 3:1 on
// white, so every chart keeps its "Show the numbers" table. Green and red are left out
// because they mean ok and critical elsewhere. A sixth series and beyond is "Other" (gray).
const SERIES = ['#2a78d6', '#1baf7a', '#eda100', '#e87ba4', '#4a3aa7'];
const OTHER = '#8a939e';
const SINGLE = SERIES[0];

const RANGES = [
  { id: '15m', label: '15 min', caption: 'in the last 15 min' },
  { id: '1h', label: '1 hour', caption: 'in the last hour' },
  { id: 'session', label: 'Session', caption: 'across everything the server still holds' },
];
const REFRESH_MS = 15_000;

const clock = (ms) => new Date(ms).toTimeString().slice(0, 5);
const axisTick = () => ({ fill: themeColor('muted'), fontSize: 11 });

function tooltipProps() {
  return {
    cursor: { fill: 'rgba(28,34,43,0.04)', stroke: themeColor('line') },
    contentStyle: {
      background: themeColor('surface'),
      border: `1px solid ${themeColor('line')}`,
      borderRadius: 6,
      fontSize: 12,
      boxShadow: '0 2px 8px rgba(28,34,43,0.12)',
    },
    labelStyle: { color: themeColor('ink'), marginBottom: 2 },
    itemStyle: { color: themeColor('ink'), padding: 0 },
  };
}

const legendProps = () => ({
  iconType: 'square',
  iconSize: 10,
  wrapperStyle: { fontSize: 12, paddingTop: 6 },
  // Legend text stays in the text colour; the swatch carries the series colour.
  formatter: (value) => <span style={{ color: themeColor('muted') }}>{value}</span>,
});

function Empty() {
  return <p className="flex h-48 items-center justify-center text-sm text-muted">Not enough data in this range yet</p>;
}

// One chart: title, optional badge, the chart, its source caption and its numbers as a table.
function ChartPanel({ title, badge, caption, empty, table, children }) {
  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          {title} {badge && <ProvenanceBadge kind={badge} />}
        </span>
      }
    >
      {empty ? <Empty /> : <div className="h-64">{children}</div>}
      <p className="mt-2 text-xs text-muted">{caption}</p>
      {!empty && table && (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-muted hover:text-ink">Show the numbers</summary>
          <div className="mt-2 overflow-x-auto">{table}</div>
        </details>
      )}
    </Panel>
  );
}

function DataTable({ head, rows }) {
  return (
    <table className="w-full text-left text-sm">
      <thead className="border-b border-line">
        <tr>
          {head.map((h) => (
            <th key={h} className="px-2 py-1.5 font-normal">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((c, j) => (
              <td key={j} className="px-2 py-1.5 text-ink">
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Colour per truck, fixed by the truck's place in the sorted list so a range change never repaints.
function truckColors(ids) {
  const sorted = [...new Set(ids)].sort();
  return (id) => {
    const i = sorted.indexOf(id);
    return i >= 0 && i < SERIES.length ? SERIES[i] : OTHER;
  };
}

function AlertsChart({ data, caption }) {
  const top = data.rules.slice(0, SERIES.length - 1);
  const hasOther = data.rules.length > top.length;
  const keys = hasOther ? [...top, 'Other'] : top;
  const rows = data.trucks.map((t) => {
    const row = { truck: t.truck_id };
    for (const k of top) row[k] = t.by_rule[k] ?? 0;
    if (hasOther) row.Other = Object.entries(t.by_rule).reduce((s, [k, v]) => s + (top.includes(k) ? 0 : v), 0);
    return row;
  });
  return (
    <ChartPanel
      title="Alerts per truck, by rule"
      caption={`Computed from the alert log: alerts opened ${caption}, ${data.total} in total.`}
      empty={data.total === 0}
      table={
        <DataTable
          head={['Truck', 'Rule', 'Alerts']}
          rows={data.trucks.flatMap((t) => Object.entries(t.by_rule).map(([rule, n]) => [t.truck_id, rule, n]))}
        />
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -12 }} barCategoryGap="30%">
          <CartesianGrid vertical={false} stroke={themeColor('line')} />
          <XAxis dataKey="truck" tick={axisTick()} axisLine={{ stroke: themeColor('line') }} tickLine={false} />
          <YAxis allowDecimals={false} tick={axisTick()} axisLine={false} tickLine={false} />
          <Tooltip {...tooltipProps()} />
          <Legend {...legendProps()} />
          {keys.map((k, i) => (
            <Bar
              key={k}
              dataKey={k}
              stackId="a"
              fill={k === 'Other' ? OTHER : SERIES[i]}
              stroke={themeColor('surface')}
              strokeWidth={2}
              radius={i === keys.length - 1 ? [4, 4, 0, 0] : 0}
              maxBarSize={56}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartPanel>
  );
}

function RiskChart({ risk, caption, truckIds }) {
  const series = risk?.series ?? [];
  const color = truckColors(truckIds);
  // Trucks are sampled at slightly different moments; line them up on the sampling step.
  const stepMs = (risk?.every_s ?? 30) * 1000;
  const byTime = new Map();
  for (const s of series) {
    for (const [t, v] of s.points) {
      const key = Math.floor(t / stepMs) * stepMs;
      byTime.set(key, { ...(byTime.get(key) ?? { t: key }), [s.truck_id]: v });
    }
  }
  const rows = [...byTime.values()].sort((a, b) => a.t - b.t);
  return (
    <ChartPanel
      title="Rule risk score per truck"
      badge="RULE_BASED"
      caption={`Computed from the ring buffer: each truck's rule risk score over the trailing ${Math.round((risk?.window_s ?? 600) / 60)} min, sampled every 30 s${(risk?.every_s ?? 30) > 30 ? ` (one point per ${formatDuration(risk.every_s)} shown)` : ''} ${caption}.`}
      empty={rows.length < 2}
      table={
        <DataTable
          head={['Truck', 'Latest', 'Highest']}
          rows={series.map((s) => [s.truck_id, s.points[s.points.length - 1][1], Math.max(...s.points.map((p) => p[1]))])}
        />
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
          <CartesianGrid vertical={false} stroke={themeColor('line')} />
          <XAxis
            dataKey="t"
            type="number"
            domain={['dataMin', 'dataMax']}
            tickFormatter={clock}
            tick={axisTick()}
            axisLine={{ stroke: themeColor('line') }}
            tickLine={false}
            minTickGap={40}
          />
          <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tick={axisTick()} axisLine={false} tickLine={false} />
          <Tooltip {...tooltipProps()} labelFormatter={clock} />
          <Legend {...legendProps()} iconType="plainline" />
          {series.map((s) => (
            <Line
              key={s.truck_id}
              dataKey={s.truck_id}
              stroke={color(s.truck_id)}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, stroke: themeColor('surface'), strokeWidth: 2 }}
              connectNulls
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </ChartPanel>
  );
}

// Distance and duration have different units: two charts on one row, never two axes on one.
function TripCharts({ trips, caption }) {
  const recent = trips.slice(-20);
  const rows = recent.map((t) => ({ label: `${t.truck_id} ${t.start_at.slice(11, 16)}`, km: t.distance_km, min: Math.round(t.duration_s / 60) }));
  const note = trips.length > recent.length ? ` Showing the newest ${recent.length} of ${trips.length}.` : '';
  const table = (
    <DataTable head={['Trip', 'Distance', 'Duration']} rows={recent.map((t) => [`${t.truck_id} ${t.start_at.slice(11, 16)}`, `${t.distance_km} km`, formatDuration(t.duration_s)])} />
  );
  const bars = (key, unit) => (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} margin={{ top: 16, right: 8, bottom: 0, left: -12 }}>
        <CartesianGrid vertical={false} stroke={themeColor('line')} />
        <XAxis dataKey="label" tick={axisTick()} axisLine={{ stroke: themeColor('line') }} tickLine={false} interval="preserveStartEnd" minTickGap={16} />
        <YAxis tick={axisTick()} axisLine={false} tickLine={false} />
        <Tooltip {...tooltipProps()} formatter={(v) => [`${v} ${unit}`, key === 'km' ? 'Distance' : 'Duration']} />
        <Bar dataKey={key} fill={SINGLE} radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <ChartPanel title="Distance per completed trip (km)" caption={`Computed from detected trips that ended ${caption}.${note}`} empty={rows.length === 0} table={table}>
        {bars('km', 'km')}
      </ChartPanel>
      <ChartPanel title="Duration per completed trip (min)" caption={`Computed from detected trips that ended ${caption}.${note}`} empty={rows.length === 0}>
        {bars('min', 'min')}
      </ChartPanel>
    </div>
  );
}

function DriverChart({ drivers, caption }) {
  const rows = drivers.map((d) => ({ name: d.driver_name, score: d.score, trips: d.trips }));
  return (
    <ChartPanel
      title="Driver scores, ranked"
      badge="RULE_BASED"
      caption={`Computed from driving scores of completed, rated trips that ended ${caption}, averaged per driver.`}
      empty={rows.length === 0}
      table={<DataTable head={['Driver', 'Score', 'Trips']} rows={rows.map((r) => [r.name, r.score, r.trips])} />}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 36, bottom: 0, left: 8 }} barCategoryGap="25%">
          <CartesianGrid horizontal={false} stroke={themeColor('line')} />
          <XAxis type="number" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tick={axisTick()} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="name" width={110} tick={{ ...axisTick(), fill: themeColor('ink') }} axisLine={false} tickLine={false} />
          <Tooltip {...tooltipProps()} formatter={(v, _, p) => [`${v} over ${p.payload.trips} ${p.payload.trips === 1 ? 'trip' : 'trips'}`, 'Score']} />
          <Bar dataKey="score" fill={SINGLE} radius={[0, 4, 4, 0]} maxBarSize={22} isAnimationActive={false}>
            <LabelList dataKey="score" position="right" fill={themeColor('ink')} fontSize={12} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartPanel>
  );
}

function FuelChart({ fuel, caption }) {
  const rows = fuel.map((f) => ({ truck: f.truck_id, litres: f.used_l }));
  return (
    <ChartPanel
      title="Fuel used per truck (L)"
      badge="ESTIMATED"
      caption={`Computed from the burn estimate (engine load and rpm): litres burnt ${caption}.`}
      empty={rows.length === 0}
      table={<DataTable head={['Truck', 'Litres']} rows={rows.map((r) => [r.truck, r.litres])} />}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 20, right: 8, bottom: 0, left: -12 }}>
          <CartesianGrid vertical={false} stroke={themeColor('line')} />
          <XAxis dataKey="truck" tick={axisTick()} axisLine={{ stroke: themeColor('line') }} tickLine={false} />
          <YAxis tick={axisTick()} axisLine={false} tickLine={false} />
          <Tooltip {...tooltipProps()} formatter={(v) => [`${v} L`, 'Used']} />
          <Bar dataKey="litres" fill={SINGLE} radius={[4, 4, 0, 0]} maxBarSize={48} isAnimationActive={false}>
            <LabelList dataKey="litres" position="top" fill={themeColor('ink')} fontSize={12} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartPanel>
  );
}

function CostChart({ costs, caption }) {
  const rows = costs.map((c) => ({ truck: c.truck_id, Service: c.service_inr, Refuel: c.refuel_inr }));
  const rupees = (v) => `₹${Number(v).toLocaleString('en-IN')}`;
  return (
    <ChartPanel
      title="Manager-entered costs per truck (₹)"
      badge="MANUAL"
      caption={`Computed from service records and refuels logged by the fleet manager, dated ${caption}.`}
      empty={rows.length === 0 || rows.every((r) => r.Service + r.Refuel === 0)}
      table={<DataTable head={['Truck', 'Service', 'Refuel']} rows={rows.map((r) => [r.truck, rupees(r.Service), rupees(r.Refuel)])} />}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} stroke={themeColor('line')} />
          <XAxis dataKey="truck" tick={axisTick()} axisLine={{ stroke: themeColor('line') }} tickLine={false} />
          <YAxis tick={axisTick()} axisLine={false} tickLine={false} tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : v)} />
          <Tooltip {...tooltipProps()} formatter={(v, name) => [rupees(v), name]} />
          <Legend {...legendProps()} />
          <Bar dataKey="Service" stackId="c" fill={SERIES[0]} stroke={themeColor('surface')} strokeWidth={2} maxBarSize={48} isAnimationActive={false} />
          <Bar dataKey="Refuel" stackId="c" fill={SERIES[1]} stroke={themeColor('surface')} strokeWidth={2} radius={[4, 4, 0, 0]} maxBarSize={48} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </ChartPanel>
  );
}

function useAnalytics(range) {
  const [state, setState] = useState({ data: null, error: null, range });
  useEffect(() => {
    setState({ data: null, error: null, range });
    let ctrl = null;
    const load = () => {
      ctrl = new AbortController();
      const t = timeoutSignal(ctrl.signal);
      fetch(`${API_URL}/api/analytics?range=${range}`, { signal: t.signal })
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`The server answered ${res.status}`))))
        .then((data) => setState({ data, error: null, range }))
        .catch((err) => {
          if (err.name !== 'AbortError') setState((s) => ({ ...s, error: 'Could not load analytics. Retrying.' }));
        })
        .finally(t.done);
    };
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      clearInterval(timer);
      ctrl?.abort();
    };
  }, [range]);
  return state;
}

export default function Analytics() {
  const [range, setRange] = useState('1h');
  const state = useAnalytics(range);
  // Right after a range switch the previous range's numbers must not show under the new caption.
  const data = state.range === range ? state.data : null;
  const { error } = state;
  // Colours follow every known truck, so a truck missing from one range never shifts the others.
  const knownTrucks = useFleetStore((s) => s.trucks);
  const truckIds = Object.keys(knownTrucks);
  const r = RANGES.find((x) => x.id === range);

  return (
    <div className="mx-auto max-w-[1440px] space-y-4">
      <PageHeader
        title="Analytics"
        description={
          data?.to_ms != null
            ? `Readings from ${clock(data.from_ms)} to ${clock(data.to_ms)}, refreshed every ${REFRESH_MS / 1000} s.`
            : 'Fleet trends from the readings the server holds.'
        }
        actions={<Segmented label="Time range" value={range} onChange={setRange} options={RANGES} />}
      />

      {error && (
        <Panel bodyClassName="">
          <ErrorState>{error}</ErrorState>
        </Panel>
      )}
      {!data ? (
        <Panel bodyClassName="">
          <LoadingState>Loading analytics…</LoadingState>
        </Panel>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <AlertsChart data={data.alerts} caption={r.caption} />
            <RiskChart risk={data.risk} caption={r.caption} truckIds={truckIds} />
          </div>
          <TripCharts trips={data.trips} caption={r.caption} />
          <div className="grid gap-4 lg:grid-cols-2">
            <DriverChart drivers={data.drivers} caption={r.caption} />
            <FuelChart fuel={data.fuel} caption={r.caption} />
          </div>
          <CostChart costs={data.costs} caption={r.caption} />
        </>
      )}
    </div>
  );
}
