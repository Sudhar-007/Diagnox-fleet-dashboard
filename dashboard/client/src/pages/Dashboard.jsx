import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import FleetMap from '../components/FleetMap.jsx';
import FleetTable from '../components/FleetTable.jsx';
import Plate from '../components/Plate.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import Panel, { EmptyState } from '../components/ui/Panel.jsx';
import { API_URL } from '../config.js';
import { byUrgency as alertUrgency, eventDescription, isOpen, ruleReading, sosLabel } from '../lib/alerts.js';
import { byUrgency, useFleetRows } from '../lib/fleetView.js';
import { findingText, formatAgo, formatDuration } from '../lib/format.js';
import { useFleetStore } from '../store/useFleetStore.js';

const linkClass = 'text-[13px] font-medium text-accent hover:underline';

// One strip, six answers: how many trucks, how many live, who needs attention, who went
// quiet, any SOS, any open alert. Each figure links to where it can be acted on.
function StatusStrip({ rows, openAlerts }) {
  const live = rows.filter((r) => r.freshness === 'live').length;
  const attention = rows.filter((r) => r.attention).length;
  const silent = rows.filter((r) => r.silent).length;
  const sos = openAlerts.filter((a) => a.kind === 'sos').length;
  const health = openAlerts.filter((a) => a.kind !== 'sos');
  const critical = health.some((a) => a.level === 'critical');

  const cells = [
    { label: 'Trucks', value: rows.length, to: '/vehicles' },
    { label: 'Live', value: live, to: '/live', tone: live < rows.length ? 'text-ink' : 'text-ok' },
    { label: 'Need attention', value: attention, to: '/vehicles?status=attention', tone: attention ? 'text-warn' : 'text-ink' },
    { label: 'No recent data', value: silent, to: '/vehicles?status=silent', tone: silent ? 'text-idle' : 'text-ink' },
    { label: 'Active SOS', value: sos, to: '/alerts', tone: sos ? 'text-crit' : 'text-ink' },
    { label: 'Open alerts', value: health.length, to: '/alerts', tone: health.length ? (critical ? 'text-crit' : 'text-warn') : 'text-ink' },
  ];

  return (
    <section
      aria-label="Fleet status"
      className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3 xl:grid-cols-6"
    >
      {cells.map((c) => (
        <Link key={c.label} to={c.to} className="group bg-surface px-4 py-3 transition-colors hover:bg-subtle">
          <div className="text-xs text-muted group-hover:text-ink">{c.label}</div>
          <div className={`mt-0.5 font-display text-xl leading-7 font-semibold ${c.tone ?? 'text-ink'}`}>{c.value}</div>
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
  const navigate = useNavigate();

  const trucks = useMemo(() => rows.map((r) => r.truck), [rows]);
  const openAlerts = useMemo(() => Object.values(alerts).filter(isOpen).sort(alertUrgency), [alerts]);
  const live = rows.filter((r) => r.freshness === 'live').length;

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
              actions={
                <Link to="/live" className={linkClass}>
                  Open live map
                </Link>
              }
              bodyClassName="h-[420px]"
              className="overflow-hidden lg:col-span-2"
            >
              <FleetMap trucks={trucks} compact onSelect={(id) => navigate(`/live?truck=${encodeURIComponent(id)}`)} />
            </Panel>
            <div className="space-y-4">
              <NeedsAttention rows={rows} />
              <OpenAlerts alerts={openAlerts} />
            </div>
          </div>

          <Panel
            title="Fleet"
            description="Every reporting truck. Select a vehicle to open its details."
            actions={
              <Link to="/vehicles" className={linkClass}>
                Manage vehicles
              </Link>
            }
            bodyClassName="overflow-x-auto"
          >
            <FleetTable rows={rows} />
          </Panel>

          <RecentActivity />
        </div>
      )}
    </div>
  );
}
