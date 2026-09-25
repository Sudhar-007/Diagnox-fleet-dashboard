import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import AlertRow from '../components/AlertRow.jsx';
import Plate from '../components/Plate.jsx';
import ProvenanceBadge from '../components/ProvenanceBadge.jsx';
import RiskPanel from '../components/RiskPanel.jsx';
import ServiceHistory from '../components/ServiceHistory.jsx';
import ServiceRecordForm from '../components/ServiceRecordForm.jsx';
import Sparkline from '../components/Sparkline.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import TriggerSosButton from '../components/TriggerSosButton.jsx';
import Button from '../components/ui/Button.jsx';
import Panel from '../components/ui/Panel.jsx';
import Tabs, { TabPanel } from '../components/ui/Tabs.jsx';
import { API_URL } from '../config.js';
import { timeoutSignal } from '../lib/api.js';
import { byUrgency, isOpen } from '../lib/alerts.js';
import { HEALTH_FIELDS, thresholdSummary } from '../lib/fields.js';
import { formatAgo } from '../lib/format.js';
import { parseTsMs } from '../lib/time.js';
import { useTruckStatus } from '../lib/useTruckStatus.js';
import { useServiceRecords } from '../hooks/useServiceRecords.js';
import { useFleetStore } from '../store/useFleetStore.js';

const WINDOW_S = 300;

// Last 5 minutes of raw points: fetched on open and again after every reconnect (to fill
// the gap), then extended by live updates.
function useRecentPoints(truckId, latest) {
  const [points, setPoints] = useState([]);
  const connected = useFleetStore((s) => s.connection === 'connected');

  useEffect(() => {
    setPoints([]);
  }, [truckId]);

  useEffect(() => {
    if (!connected) return undefined;
    const ctrl = new AbortController();
    const t = timeoutSignal(ctrl.signal);
    fetch(`${API_URL}/api/trucks/${encodeURIComponent(truckId)}/history?limit=${WINDOW_S}`, { signal: t.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => body && setPoints((live) => merge(body.points, live)))
      .catch(() => {})
      .finally(t.done);
    return () => ctrl.abort();
  }, [truckId, connected]);

  useEffect(() => {
    if (latest?.timestamp) setPoints((prev) => merge(prev, [latest]));
  }, [latest]);

  return points;
}

function merge(a, b) {
  const byTs = new Map(a.map((p) => [p.timestamp, p]));
  for (const p of b) byTs.set(p.timestamp, p);
  const all = [...byTs.values()].sort((x, y) => (x.timestamp < y.timestamp ? -1 : 1));
  const newest = parseTsMs(all.at(-1)?.timestamp);
  return newest == null ? all : all.filter((p) => newest - parseTsMs(p.timestamp) <= WINDOW_S * 1000);
}

function HealthTab({ truck, points }) {
  const rules = useFleetStore((s) => s.healthRules) ?? [];
  const findings = Object.fromEntries((truck.findings ?? []).map((f) => [f.field, f]));
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {HEALTH_FIELDS.map((f) => {
        const finding = findings[f.field];
        const value = truck[f.field];
        return (
          <Panel key={f.field} as="section" aria-label={f.label} bodyClassName="p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-[15px] text-ink">{f.label}</h3>
                <p className="text-xs text-muted">{f.field}</p>
              </div>
              <div className="text-right">
                <span className="font-cond text-3xl font-bold leading-none">
                  {typeof value === 'number' ? value.toFixed(f.digits) : 'n/a'}
                </span>
                <span className="ml-1 text-sm text-muted">{f.unit}</span>
              </div>
            </div>
            <p className={`mt-1 text-sm ${finding ? (finding.level === 'critical' ? 'text-crit' : 'text-warn') : 'text-muted'}`}>
              {finding ? `${finding.name}: ${finding.op} ${finding.threshold} ${finding.unit}` : 'Within limits'}
            </p>
            <div className="mt-2">
              <Sparkline points={points} field={f.field} unit={f.unit} digits={f.digits} rules={rules} label={f.label} />
            </div>
            <p className="mt-1 text-xs text-faint">{thresholdSummary(rules, f.field)}</p>
          </Panel>
        );
      })}
    </div>
  );
}

function MaintenanceTab({ truck, truckId }) {
  const [adding, setAdding] = useState(false);
  const { records, error } = useServiceRecords(truckId);
  const alerts = useFleetStore((s) => s.alerts);
  const open = useMemo(
    () => Object.values(alerts).filter((a) => a.truck_id === truckId && isOpen(a)).sort(byUrgency),
    [alerts, truckId],
  );

  return (
    <div className="space-y-4">
      <Panel title="Maintenance risk">
        {truck ? <RiskPanel truck={truck} /> : <p className="text-muted">No telemetry yet, so no score.</p>}
      </Panel>

      <Panel title={`Open alerts (${open.length})`} bodyClassName="">
        {open.length === 0 ? (
          <p className="px-4 py-4 text-[15px] text-muted">No open alerts for this truck.</p>
        ) : (
          <ul className="divide-y divide-line">
            {open.map((a) => (
              <AlertRow key={a.id} alert={a} />
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        title="Service history"
        actions={
          !adding && (
            <Button variant="primary" onClick={() => setAdding(true)}>
              Add service record
            </Button>
          )
        }
      >
        {adding && (
          <div className="mb-4 border-b border-line pb-4">
            <ServiceRecordForm truckId={truckId} onDone={() => setAdding(false)} />
          </div>
        )}
        {error ? <p className="text-sm text-crit">{error}</p> : <ServiceHistory records={records} />}
      </Panel>
    </div>
  );
}

function Header({ truck, reg, truckId }) {
  const { age, status } = useTruckStatus(truck ?? {});
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex items-center gap-4">
        <Plate truckId={truckId} size="lg" />
        <div>
          <div className="text-lg text-ink">{truck?.driver_name ?? reg?.driver_name ?? 'No driver assigned'}</div>
          <div className="text-sm text-muted">
            {[reg?.registration, reg?.model].filter(Boolean).join(', ') || 'No registration or model on file'}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {truck ? (
          <>
            <StatusBadge status={status} />
            <ProvenanceBadge kind={truck.provenance} />
            <span className="text-sm text-muted">Last seen {formatAgo(age)}</span>
            <TriggerSosButton truckId={truckId} />
          </>
        ) : (
          <span className="text-sm text-muted">No telemetry received yet</span>
        )}
      </div>
    </div>
  );
}

const TAB_IDS = ['health', 'maintenance'];

export default function VehicleDetails() {
  const { truckId } = useParams();
  const truck = useFleetStore((s) => s.trucks[truckId]);
  const registry = useFleetStore((s) => s.registry);
  const reg = registry?.trucks.find((t) => t.truck_id === truckId);
  const [params, setParams] = useSearchParams();
  const tab = TAB_IDS.includes(params.get('tab')) ? params.get('tab') : 'health';
  const points = useRecentPoints(truckId, truck);

  if (!truck && registry && !reg) {
    return (
      <div className="mx-auto max-w-xl py-10 text-[15px]">
        <h1 className="font-cond text-2xl font-bold">No truck {truckId}</h1>
        <p className="mt-2 text-muted">
          It is not in the fleet list and has not reported. Check the ID, or add it on the{' '}
          <Link to="/vehicles" className="text-ink underline underline-offset-4">
            Vehicles
          </Link>{' '}
          page.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1300px]">
      <p className="mb-3 text-sm">
        <Link to="/vehicles" className="text-muted hover:text-ink">
          Vehicles
        </Link>
        <span className="text-faint"> / </span>
        <span className="text-ink">{truckId}</span>
      </p>
      <Header truck={truck} reg={reg} truckId={truckId} />

      <div className="mt-5">
        <Tabs
          label="Vehicle views"
          value={tab}
          onChange={(id) => setParams(id === 'health' ? {} : { tab: id }, { replace: true })}
          tabs={[
            { id: 'health', label: 'Health' },
            { id: 'maintenance', label: 'Maintenance' },
          ]}
        />
        <TabPanel id={tab}>
          {tab === 'health' &&
            (truck ? (
              <HealthTab truck={truck} points={points} />
            ) : (
              <p className="text-[15px] text-muted">Live values appear here once this truck starts reporting.</p>
            ))}
          {tab === 'maintenance' && <MaintenanceTab truck={truck} truckId={truckId} />}
        </TabPanel>
      </div>
    </div>
  );
}
