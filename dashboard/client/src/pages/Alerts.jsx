import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import AlertRow from '../components/AlertRow.jsx';
import Plate from '../components/Plate.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import Segmented from '../components/ui/Segmented.jsx';
import Stat from '../components/ui/Stat.jsx';
import Tabs, { TabPanel } from '../components/ui/Tabs.jsx';
import Panel, { EmptyState } from '../components/ui/Panel.jsx';
import { byUrgency, eventDescription, isOpen, resolutionText, ruleReading } from '../lib/alerts.js';
import { formatDuration } from '../lib/format.js';
import { useFleetStore } from '../store/useFleetStore.js';

const LEVEL_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'sos', label: 'SOS' },
  { id: 'critical', label: 'Critical' },
  { id: 'warning', label: 'Warning' },
];

const matches = (a, level) => level === 'all' || (level === 'sos' ? a.kind === 'sos' : a.kind !== 'sos' && a.level === level);

function ActiveTab({ alerts }) {
  const [level, setLevel] = useState('all');
  const sosCount = alerts.filter((a) => a.kind === 'sos').length;
  const shown = alerts.filter((a) => matches(a, level));

  return (
    <Panel
      bodyClassName=""
      title={`${alerts.length} open${sosCount ? `, including ${sosCount} SOS` : ''}`}
      description="SOS first, then critical, then newest. Acknowledge to show someone is on it; resolve when it is handled."
      actions={
        <Segmented
          label="Filter by level"
          value={level}
          onChange={setLevel}
          options={LEVEL_FILTERS.map((f) => ({ ...f, count: alerts.filter((a) => matches(a, f.id)).length }))}
        />
      }
    >
      {shown.length === 0 ? (
        <EmptyState>
          {alerts.length === 0
            ? 'No open alerts or SOS. Every truck is within its health thresholds and zones.'
            : `No ${level === 'sos' ? 'SOS' : `${level} alerts`} open.`}
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
        <thead className="border-b border-line">
          <tr>
            <th className="px-4 py-2">Time</th>
            <th className="px-4 py-2">Truck</th>
            <th className="px-4 py-2">Event</th>
            <th className="px-4 py-2">Note</th>
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
      <dl className="flex flex-wrap gap-x-10 gap-y-3 rounded-lg border border-line bg-surface px-4 py-3">
        <Stat label="Resolved" value={resolved.length} />
        <Stat label="Average time to acknowledge" value={avgAck != null ? formatDuration(avgAck) : 'None yet'} />
        <Stat label="Average time to resolve" value={formatDuration(avgResolve)} />
      </dl>
      <Panel bodyClassName="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="border-b border-line">
            <tr>
              <th className="px-4 py-2">Alert</th>
              <th className="px-4 py-2">Opened</th>
              <th className="px-4 py-2">Acknowledged</th>
              <th className="px-4 py-2">Resolved</th>
              <th className="px-4 py-2">How</th>
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
                    {a.kind === 'sos' ? a.detail ?? 'SOS' : ruleReading(a)}
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
                  {resolutionText(a)}
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
    <div className="mx-auto max-w-[1440px]">
      <PageHeader
        title="Alerts & SOS"
        description="Health, zone and SOS alerts across the fleet. Health thresholds are demo-tuned, not validated limits; change them in Settings."
      />

      <div>
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
