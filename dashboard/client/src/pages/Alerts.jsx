import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import AlertRow from '../components/AlertRow.jsx';
import Plate from '../components/Plate.jsx';
import Tabs, { TabPanel } from '../components/ui/Tabs.jsx';
import Panel, { EmptyState } from '../components/ui/Panel.jsx';
import { byUrgency, eventDescription, isOpen } from '../lib/alerts.js';
import { formatDuration } from '../lib/format.js';
import { useFleetStore } from '../store/useFleetStore.js';

const LEVEL_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'critical', label: 'Critical' },
  { id: 'warning', label: 'Warning' },
];

function ActiveTab({ alerts }) {
  const [level, setLevel] = useState('all');
  const sosCount = alerts.filter((a) => a.kind === 'sos').length;
  const shown = alerts.filter((a) => level === 'all' || a.level === level);

  return (
    <Panel
      bodyClassName=""
      title={`${alerts.length} open${sosCount ? `, including ${sosCount} SOS` : ''}`}
      actions={
        <div className="flex gap-1" role="group" aria-label="Filter by level">
          {LEVEL_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={level === f.id}
              onClick={() => setLevel(f.id)}
              className={`rounded-[4px] px-2.5 py-1 text-sm ${level === f.id ? 'bg-panel-hi text-ink' : 'text-muted hover:text-ink'}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      }
    >
      {shown.length === 0 ? (
        <EmptyState>
          {alerts.length === 0
            ? 'No open alerts or SOS. Every truck is within its health thresholds.'
            : `No ${level} alerts open.`}
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line">
          {shown.map((a) => (
            <AlertRow key={a.id} alert={a} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function EventLogTab({ events }) {
  if (events.length === 0) {
    return (
      <Panel bodyClassName="">
        <EmptyState>Nothing has happened yet. Every alert change is listed here as it occurs.</EmptyState>
      </Panel>
    );
  }
  return (
    <Panel bodyClassName="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="border-b border-line text-muted">
          <tr>
            <th className="px-4 py-2 font-normal">Time</th>
            <th className="px-4 py-2 font-normal">Truck</th>
            <th className="px-4 py-2 font-normal">Event</th>
            <th className="px-4 py-2 font-normal">Note</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {events.map((e) => {
            return (
              <tr key={e.id} className="align-top">
                <td className="whitespace-nowrap px-4 py-2 text-muted">{e.at.slice(11)}</td>
                <td className="px-4 py-2">
                  <Plate truckId={e.truck_id} size="sm" />
                </td>
                <td className={`px-4 py-2 ${e.type === 'opened' || e.type === 'escalated' ? (e.level === 'critical' ? 'text-crit' : 'text-warn') : 'text-ink'}`}>
                  {eventDescription(e)}
                </td>
                <td className="px-4 py-2 text-muted">{e.note ?? ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Panel>
  );
}

function ResponseHistoryTab({ resolved }) {
  if (resolved.length === 0) {
    return (
      <Panel bodyClassName="">
        <EmptyState>No alerts have been resolved yet. Response times appear here once they are.</EmptyState>
      </Panel>
    );
  }
  const handled = resolved.filter((a) => a.acknowledged_ms);
  const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
  const avgAck = avg(handled.map((a) => (a.acknowledged_ms - a.opened_ms) / 1000));
  const avgResolve = avg(resolved.map((a) => (a.resolved_ms - a.opened_ms) / 1000));

  return (
    <div className="space-y-4">
      <dl className="flex flex-wrap gap-x-8 gap-y-2 text-[15px]">
        <div>
          <dt className="text-sm text-muted">Resolved</dt>
          <dd className="font-cond text-2xl font-bold">{resolved.length}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted">Average time to acknowledge</dt>
          <dd className="font-cond text-2xl font-bold">{avgAck != null ? formatDuration(avgAck) : 'None yet'}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted">Average time to resolve</dt>
          <dd className="font-cond text-2xl font-bold">{formatDuration(avgResolve)}</dd>
        </div>
      </dl>
      <Panel bodyClassName="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="border-b border-line text-muted">
            <tr>
              <th className="px-4 py-2 font-normal">Alert</th>
              <th className="px-4 py-2 font-normal">Opened</th>
              <th className="px-4 py-2 font-normal">Acknowledged</th>
              <th className="px-4 py-2 font-normal">Resolved</th>
              <th className="px-4 py-2 font-normal">How</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {resolved.map((a) => (
              <tr key={a.id} className="align-top">
                <td className="px-4 py-2">
                  <div className="flex items-center gap-2">
                    <Plate truckId={a.truck_id} size="sm" />
                    <span className={a.level === 'critical' ? 'text-crit' : 'text-warn'}>{a.name}</span>
                  </div>
                  <div className="mt-0.5 text-muted">
                    {a.kind === 'sos'
                      ? a.detail ?? 'SOS'
                      : `${a.field} ${a.value} ${a.unit} ${a.op} ${a.threshold} ${a.unit}`}
                  </div>
                </td>
                <td className="whitespace-nowrap px-4 py-2 text-muted">{a.opened_at.slice(11)}</td>
                <td className="whitespace-nowrap px-4 py-2">
                  {a.acknowledged_ms ? (
                    <>
                      <span className="text-ink">{formatDuration((a.acknowledged_ms - a.opened_ms) / 1000)}</span>
                      <span className="text-muted"> after opening</span>
                    </>
                  ) : (
                    <span className="text-faint">Not acknowledged</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-2">
                  <span className="text-ink">{formatDuration((a.resolved_ms - a.opened_ms) / 1000)}</span>
                  <span className="text-muted"> after opening</span>
                </td>
                <td className="px-4 py-2 text-muted">
                  {a.resolution === 'cleared' ? 'Cleared on its own' : `Resolved by ${a.resolved_by ?? 'hand'}`}
                  {a.resolve_note && <div className="text-ink">{a.resolve_note}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

const TAB_IDS = ['active', 'log', 'history'];

export default function Alerts() {
  const alerts = useFleetStore((s) => s.alerts);
  const events = useFleetStore((s) => s.alertEvents);
  const [params, setParams] = useSearchParams();
  const tab = TAB_IDS.includes(params.get('tab')) ? params.get('tab') : 'active';

  const all = useMemo(() => Object.values(alerts), [alerts]);
  const open = useMemo(() => all.filter(isOpen).sort(byUrgency), [all]);
  const resolved = useMemo(
    () => all.filter((a) => !isOpen(a)).sort((a, b) => b.resolved_ms - a.resolved_ms),
    [all],
  );

  return (
    <div className="mx-auto max-w-[1200px]">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h1 className="font-cond text-2xl font-bold">Alerts &amp; SOS</h1>
        <p className="text-sm text-muted">Health rules are demo-tuned thresholds, not validated limits.</p>
      </div>

      <div className="mt-4">
        <Tabs
          label="Alert views"
          value={tab}
          onChange={(id) => setParams(id === 'active' ? {} : { tab: id }, { replace: true })}
          tabs={[
            { id: 'active', label: 'Active', count: open.length },
            { id: 'log', label: 'Event Log' },
            { id: 'history', label: 'Response History', count: resolved.length },
          ]}
        />
        <TabPanel id={tab}>
          {tab === 'active' && <ActiveTab alerts={open} />}
          {tab === 'log' && <EventLogTab events={events} />}
          {tab === 'history' && <ResponseHistoryTab resolved={resolved} />}
        </TabPanel>
      </div>
    </div>
  );
}
