import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import FleetMap from '../components/FleetMap.jsx';
import FleetTable from '../components/FleetTable.jsx';
import Plate from '../components/Plate.jsx';
import ReadingsTable from '../components/ReadingsTable.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { LiveReadings, VehicleFocus } from '../components/TruckFocus.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import Panel, { EmptyState } from '../components/ui/Panel.jsx';
import Tabs, { TabPanel } from '../components/ui/Tabs.jsx';
import { API_URL } from '../config.js';
import { byUrgency as alertUrgency, eventDescription, isOpen, ruleReading, sosLabel } from '../lib/alerts.js';
import { byUrgency, useFleetRows } from '../lib/fleetView.js';
import { findingText, formatAgo, formatDuration } from '../lib/format.js';
import { useFleetStore } from '../store/useFleetStore.js';

const linkClass = 'text-[13px] font-medium text-accent hover:underline';

// One strip, eight answers: how many trucks, moving, parked, who needs attention, who went
// quiet, any SOS, any open alert, how much fuel. Each figure links to where it can be acted on.
function StatusStrip({ rows, openAlerts }) {
  const liveRows = rows.filter((r) => r.freshness === 'live');
  const moving = liveRows.filter((r) => r.truck.speed > 0);
  const parked = liveRows.filter((r) => !(r.truck.speed > 0));
  const idling = parked.filter((r) => r.truck.rpm > 0).length;
  const avgSpeed = moving.length ? Math.round(moving.reduce((sum, r) => sum + r.truck.speed, 0) / moving.length) : null;
  const attention = rows.filter((r) => r.attention).length;
  const silent = rows.filter((r) => r.silent).length;
  const sos = openAlerts.filter((a) => a.kind === 'sos').length;
  const health = openAlerts.filter((a) => a.kind !== 'sos');
  const critical = health.filter((a) => a.level === 'critical').length;
  const fuelled = rows.filter((r) => typeof r.truck.fuel?.level_pct === 'number');
  const avgFuel = fuelled.length ? fuelled.reduce((sum, r) => sum + r.truck.fuel.level_pct, 0) / fuelled.length : null;
  const lowest = fuelled.reduce((m, r) => (!m || r.truck.fuel.level_pct < m.truck.fuel.level_pct ? r : m), null);

  const cells = [
    { label: 'Trucks', value: rows.length, note: `${liveRows.length} reporting live`, to: '/vehicles' },
    { label: 'Moving', value: moving.length, note: avgSpeed != null ? `Average ${avgSpeed} km/h` : 'None on the move', to: '/live' },
    { label: 'Parked', value: parked.length, note: idling ? `${idling} with engine idling` : 'Engines off', to: '/live' },
    {
      label: 'Need attention',
      value: attention,
      note: 'Health issue or SOS',
      to: '/vehicles?status=attention',
      tone: attention ? 'text-warn' : 'text-ink',
    },
    { label: 'No recent data', value: silent, note: 'Stale or offline', to: '/vehicles?status=silent', tone: silent ? 'text-idle' : 'text-ink' },
    { label: 'Active SOS', value: sos, note: sos ? 'Respond now' : 'All clear', to: '/alerts', tone: sos ? 'text-crit' : 'text-ink' },
    {
      label: 'Open alerts',
      value: health.length,
      note: critical ? `${critical} critical` : health.length ? 'Warnings only' : 'Nothing open',
      to: '/alerts',
      tone: health.length ? (critical ? 'text-crit' : 'text-warn') : 'text-ink',
    },
    {
      label: 'Average fuel',
      value: avgFuel != null ? `${avgFuel.toFixed(1)} %` : '-',
      note: lowest ? `Lowest ${lowest.truck.truck_id}, ${lowest.truck.fuel.level_pct.toFixed(0)} %` : 'No fuel data',
      to: '/fuel',
    },
  ];

  return (
    <section
      aria-label="Fleet status"
      className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-4 2xl:grid-cols-8"
    >
      {cells.map((c) => (
        <Link key={c.label} to={c.to} className="group bg-surface px-4 py-3 transition-colors hover:bg-subtle">
          <div className="text-xs text-muted group-hover:text-ink">{c.label}</div>
          <div className={`mt-0.5 font-display text-xl leading-7 font-semibold tabular-nums ${c.tone ?? 'text-ink'}`}>{c.value}</div>
          <div className="truncate text-xs text-muted">{c.note}</div>
        </Link>
      ))}
    </section>
  );
}

// Trucks that need a person to look at them, most urgent first, with the reason.
function NeedsAttention({ rows }) {
  const list = rows.filter((r) => r.attention || r.silent).sort(byUrgency);
  return (
    <Panel
      title="Needs attention"
      description={list.length ? `${list.length} of ${rows.length} trucks` : null}
      bodyClassName="max-h-64 overflow-y-auto"
    >
      {list.length === 0 ? (
        <EmptyState>All {rows.length} trucks are reporting and within their limits.</EmptyState>
      ) : (
        <ul className="divide-y divide-line">
          {list.map(({ truck: t, status, sos, silent, age }) => {
            const reason = sos
              ? sosLabel(sos)
              : silent
                ? `No data for ${formatAgo(age).replace(' ago', '')}`
                : (t.findings ?? []).map(findingText)[0] ?? 'Outside limits';
            return (
              <li key={t.truck_id}>
                <Link
                  to={`/vehicles/${encodeURIComponent(t.truck_id)}`}
                  className={`flex items-start gap-3 px-4 py-2.5 hover:bg-subtle/60 ${sos ? 'bg-crit/5' : ''}`}
                >
                  <Plate truckId={t.truck_id} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-ink">{t.driver_name}</span>
                      <StatusBadge status={status} sos={Boolean(sos)} />
                    </div>
                    <p className={`mt-0.5 text-[13px] ${sos || status === 'critical' ? 'text-crit' : silent ? 'text-muted' : 'text-warn'}`}>
                      {reason}
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function OpenAlerts({ alerts }) {
  const now = useFleetStore((s) => s.now);
  const clockOffsetMs = useFleetStore((s) => s.clockOffsetMs);
  const shown = alerts.slice(0, 4);
  return (
    <Panel
      title="Open alerts"
      description={alerts.length ? `${alerts.length} open, most urgent first` : null}
      actions={
        <Link to="/alerts" className={linkClass}>
          All alerts
        </Link>
      }
      bodyClassName=""
    >
      {shown.length === 0 ? (
        <EmptyState>No open alerts or SOS.</EmptyState>
      ) : (
        <ul className="divide-y divide-line">
          {shown.map((a) => (
            <li key={a.id} className={`flex items-start gap-3 px-4 py-2.5 ${a.kind === 'sos' ? 'bg-crit/5' : ''}`}>
              <span
                aria-hidden
                className={`mt-1.5 size-2 shrink-0 rounded-full ${a.kind === 'sos' || a.level === 'critical' ? 'bg-crit' : 'bg-warn'}`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Plate truckId={a.truck_id} size="sm" />
                  <span className={`font-medium ${a.kind === 'sos' || a.level === 'critical' ? 'text-crit' : 'text-ink'}`}>
                    {a.kind === 'sos' ? sosLabel(a) : a.name}
                  </span>
                  {a.status === 'ACKNOWLEDGED' && <span className="text-xs text-muted">Acknowledged</span>}
                </div>
                <p className="mt-0.5 truncate text-[13px] text-muted">
                  {a.kind === 'sos' ? a.detail ?? 'Raised' : ruleReading(a)}, open {formatDuration((now + clockOffsetMs - a.opened_ms) / 1000)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function RecentActivity() {
  const events = useFleetStore((s) => s.alertEvents);
  const shown = events.slice(0, 8);
  return (
    <Panel
      title="Recent activity"
      actions={
        <Link to="/alerts?tab=log" className={linkClass}>
          Full event log
        </Link>
      }
      bodyClassName=""
    >
      {shown.length === 0 ? (
        <EmptyState>Nothing yet. Alert changes, acknowledgements and SOS show up here as they happen.</EmptyState>
      ) : (
        <ul className="divide-y divide-line">
          {shown.map((e) => (
            <li key={e.id} className="flex items-start gap-3 px-4 py-2">
              <span className="w-16 shrink-0 pt-px text-[13px] text-muted">{e.at.slice(11, 19)}</span>
              <Plate truckId={e.truck_id} size="sm" />
              <span
                className={`min-w-0 flex-1 text-[13px] ${
                  e.type === 'opened' || e.type === 'escalated' ? (e.level === 'critical' ? 'text-crit' : 'text-warn') : 'text-ink'
                }`}
              >
                {eventDescription(e)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Unreachable({ connection, syncError }) {
  if (connection !== 'connected' || syncError) {
    return (
      <Panel>
        <p className="font-medium text-ink">Can't reach the fleet server at {API_URL}.</p>
        <p className="mt-1 text-[13px] text-muted">
          {syncError ? `${syncError}. ` : ''}Start it with <code className="text-ink">npm run dev</code> in{' '}
          <code className="text-ink">dashboard/server</code>, or check <code className="text-ink">VITE_API_URL</code>. This page
          reconnects on its own.
        </p>
      </Panel>
    );
  }
  return (
    <Panel>
      <p className="text-muted">No trucks have reported yet. They appear here as soon as the first telemetry point arrives.</p>
    </Panel>
  );
}

export default function Dashboard() {
  const rows = useFleetRows();
  const alerts = useFleetStore((s) => s.alerts);
  const connection = useFleetStore((s) => s.connection);
  const syncError = useFleetStore((s) => s.syncError);
  const [focusId, setFocusId] = useState(null);
  const [tab, setTab] = useState('summary');

  const trucks = useMemo(() => rows.map((r) => r.truck), [rows]);
  const openAlerts = useMemo(() => Object.values(alerts).filter(isOpen).sort(alertUrgency), [alerts]);
  const live = rows.filter((r) => r.freshness === 'live').length;

  // Opens on the most urgent truck, then stays on whatever the user picks.
  useEffect(() => {
    if (!focusId && rows.length) setFocusId([...rows].sort(byUrgency)[0].truck.truck_id);
  }, [focusId, rows]);
  const focusRow = rows.find((r) => r.truck.truck_id === focusId) ?? rows[0];

  return (
    <div className="mx-auto max-w-[1440px]">
      <PageHeader
        title="Overview"
        description={rows.length ? `${live} of ${rows.length} trucks reporting live. Positions and readings update every second.` : null}
      />

      {rows.length === 0 ? (
        <Unreachable connection={connection} syncError={syncError} />
      ) : (
        <div className="space-y-4">
          <StatusStrip rows={rows} openAlerts={openAlerts} />

          <div className="grid gap-4 lg:grid-cols-3">
            <Panel
              title="Live positions"
              description="Select a truck on the map to focus it"
              actions={
                <Link to="/live" className={linkClass}>
                  Open live map
                </Link>
              }
              bodyClassName="h-[440px]"
              className="overflow-hidden lg:col-span-2"
            >
              <FleetMap trucks={trucks} compact selectedId={focusRow.truck.truck_id} onSelect={setFocusId} />
            </Panel>
            <VehicleFocus rows={rows} truckId={focusRow.truck.truck_id} onChange={setFocusId} />
          </div>

          <LiveReadings row={focusRow} />

          <div className="grid gap-4 lg:grid-cols-3">
            <NeedsAttention rows={rows} />
            <OpenAlerts alerts={openAlerts} />
            <RecentActivity />
          </div>

          <Panel
            title="Fleet"
            description="Every reporting truck. Select a vehicle to open its details."
            actions={
              <Link to="/vehicles" className={linkClass}>
                Manage vehicles
              </Link>
            }
            bodyClassName="pt-1"
          >
            <div className="px-4">
              <Tabs
                label="Fleet view"
                value={tab}
                onChange={setTab}
                tabs={[
                  { id: 'summary', label: 'Summary' },
                  { id: 'readings', label: 'Latest readings' },
                ]}
              />
            </div>
            <TabPanel id={tab}>
              <div className="-mt-4 overflow-x-auto">{tab === 'summary' ? <FleetTable rows={rows} /> : <ReadingsTable rows={rows} />}</div>
            </TabPanel>
          </Panel>
        </div>
      )}
    </div>
  );
}
