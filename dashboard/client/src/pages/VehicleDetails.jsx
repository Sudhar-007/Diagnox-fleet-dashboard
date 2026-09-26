import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import AlertRow from '../components/AlertRow.jsx';
import { AssignmentForm, AssignmentList } from '../components/Assignments.jsx';
import Plate from '../components/Plate.jsx';
import ProvenanceBadge from '../components/ProvenanceBadge.jsx';
import RiskPanel from '../components/RiskPanel.jsx';
import ServiceHistory from '../components/ServiceHistory.jsx';
import ServiceRecordForm from '../components/ServiceRecordForm.jsx';
import Sparkline from '../components/Sparkline.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import TriggerSosButton from '../components/TriggerSosButton.jsx';
import TripTable from '../components/TripTable.jsx';
import { TruckFuel } from './Fuel.jsx';
import Button from '../components/ui/Button.jsx';
import Panel from '../components/ui/Panel.jsx';
import Tabs, { TabPanel } from '../components/ui/Tabs.jsx';
import { API_URL } from '../config.js';
import { timeoutSignal } from '../lib/api.js';
import { byUrgency, isOpen } from '../lib/alerts.js';
import { HEALTH_FIELDS, thresholdSummary } from '../lib/fields.js';
import { formatAgo, formatNumber } from '../lib/format.js';
import { engineText, locationText } from '../lib/fleetView.js';
import { parseTsMs } from '../lib/time.js';
import { useTruckStatus } from '../lib/useTruckStatus.js';
import { sortedTrips } from '../lib/trips.js';
import { useAssignments } from '../hooks/useAssignments.js';
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
    <Panel title="Readings" description="Latest value per sensor, the last 5 minutes, and the limits it is judged against." bodyClassName="overflow-x-auto">
      <table className="w-full min-w-[860px] text-left text-sm">
        <thead className="border-b border-line">
          <tr>
            <th className="px-4 py-2">Reading</th>
            <th className="px-3 py-2 text-right">Now</th>
            <th className="px-3 py-2">State</th>
            <th className="w-[34%] px-3 py-2">Last 5 minutes</th>
            <th className="px-4 py-2">Limits</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {HEALTH_FIELDS.map((f) => {
            const finding = findings[f.field];
            const value = truck[f.field];
            const tone = finding ? (finding.level === 'critical' ? 'text-crit' : 'text-warn') : 'text-ink';
            return (
              <tr key={f.field} className="align-middle">
                <td className="px-4 py-2 whitespace-nowrap">
                  <div className="text-ink">{f.label}</div>
                  <div className="text-xs text-faint">{f.field}</div>
                </td>
                <td className={`px-3 py-2 text-right whitespace-nowrap ${tone}`}>
                  <span className="font-display text-lg font-semibold">{typeof value === 'number' ? value.toFixed(f.digits) : 'n/a'}</span>
                  <span className="ml-1 text-[13px] text-muted">{f.unit}</span>
                </td>
                <td className="px-3 py-2 text-[13px] whitespace-nowrap">
                  {finding ? (
                    <span className={`font-medium ${tone}`}>
                      {finding.name}, {finding.op} {finding.threshold} {finding.unit}
                    </span>
                  ) : (
                    <span className="text-ok">Within limits</span>
                  )}
                </td>
                <td className="px-3 py-1">
                  <Sparkline points={points} field={f.field} unit={f.unit} digits={f.digits} rules={rules} label={f.label} />
                </td>
                <td className="px-4 py-2 text-xs text-muted">{thresholdSummary(rules, f.field)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Panel>
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
          <p className="px-4 py-4 text-sm text-muted">No open alerts for this truck.</p>
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

function TripsTab({ truckId }) {
  const trips = useFleetStore((s) => s.trips);
  const [adding, setAdding] = useState(false);
  const { assignments, error } = useAssignments(truckId);
  const own = sortedTrips(trips, { truck_id: truckId });
  return (
    <div className="space-y-4">
      <Panel title={`Detected trips (${own.length})`} bodyClassName="overflow-x-auto">
        {!trips ? (
          <p className="px-4 py-4 text-sm text-muted">Loading trips…</p>
        ) : (
          <TripTable trips={own} showTruck={false} empty="No trips detected for this truck yet." />
        )}
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
            <AssignmentForm truckId={truckId} onDone={() => setAdding(false)} />
          </div>
        )}
        {error ? <p className="p-4 text-sm text-crit">{error}</p> : <AssignmentList assignments={assignments} showTruck={false} />}
      </Panel>
    </div>
  );
}

function Readout({ label, children }) {
  return (
    <div className="min-w-0 bg-surface px-4 py-2.5">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 truncate text-sm text-ink">{children}</dd>
    </div>
  );
}

function Header({ truck, reg, truckId }) {
  const { age, status, freshness } = useTruckStatus(truck ?? {});
  const findings = truck?.findings ?? [];
  const worst = findings.find((f) => f.level === 'critical') ?? findings[0];
  return (
    <div className="mb-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <Plate truckId={truckId} size="lg" />
          <div>
            <h1 className="font-display text-[22px] leading-7 font-semibold tracking-tight text-ink">
              {truck?.driver_name ?? reg?.driver_name ?? 'No driver assigned'}
            </h1>
            <p className="text-[13px] text-muted">
              {[reg?.registration, reg?.model].filter(Boolean).join(', ') || (reg ? 'No registration or model on file' : 'Not in the fleet list')}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {truck ? (
            <>
              <StatusBadge status={status} />
              <ProvenanceBadge kind={truck.provenance} />
              <span className={`text-[13px] ${freshness === 'live' ? 'text-muted' : 'font-medium text-idle'}`}>Last seen {formatAgo(age)}</span>
              <TriggerSosButton truckId={truckId} />
            </>
          ) : (
            <span className="text-[13px] text-muted">No telemetry received yet</span>
          )}
        </div>
      </div>
      {truck && (
        <dl className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3 xl:grid-cols-6">
          <Readout label="Speed">
            <span className="font-medium">{formatNumber(truck.speed)}</span> km/h
          </Readout>
          <Readout label="Engine">
            {engineText(truck)}
            {typeof truck.rpm === 'number' && truck.rpm > 0 && <span className="text-muted">, {Math.round(truck.rpm)} rpm</span>}
          </Readout>
          <Readout label="Location">
            <span className="flex items-center gap-1.5">
              <span className="truncate">{locationText(truck)}</span>
              {truck.position_source === 'virtual_route' && <ProvenanceBadge kind="VIRTUAL_POSITION" />}
            </span>
          </Readout>
          <Readout label="Health">
            {worst ? (
              <span className={worst.level === 'critical' ? 'text-crit' : 'text-warn'}>
                {worst.name}
                {findings.length > 1 && <span className="text-muted"> +{findings.length - 1}</span>}
              </span>
            ) : (
              <span className="text-ok">Within limits</span>
            )}
          </Readout>
          <Readout label="Fuel">
            {truck.fuel ? (
              <>
                <span className="font-medium">{truck.fuel.level_pct.toFixed(0)} %</span>{' '}
                <span className="text-muted">{truck.fuel.source === 'sensor' ? 'sensor' : 'estimate'}</span>
              </>
            ) : (
              <span className="text-muted">No data</span>
            )}
          </Readout>
          <Readout label="Maintenance risk, rule / ML">
            <span className="font-medium">{truck.rule_risk_score ?? 0}</span>
            <span className="text-muted"> / {typeof truck.ml_risk?.score === 'number' ? truck.ml_risk.score : '-'}</span>
          </Readout>
        </dl>
      )}
    </div>
  );
}

const TAB_IDS = ['health', 'maintenance', 'trips', 'fuel'];

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
      <div className="mx-auto max-w-xl py-10 text-sm">
        <h1 className="font-display text-[22px] font-semibold tracking-tight">No truck {truckId}</h1>
        <p className="mt-2 text-muted">
          It is not in the fleet list and has not reported. Check the ID, or add it on the{' '}
          <Link to="/vehicles" className="font-medium text-accent hover:underline">
            Vehicles
          </Link>{' '}
          page.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1440px]">
      <nav aria-label="Breadcrumb" className="mb-3 text-[13px]">
        <Link to="/vehicles" className="text-muted hover:text-ink hover:underline">
          Vehicles
        </Link>
        <span className="px-1.5 text-faint">/</span>
        <span className="text-ink">{truckId}</span>
      </nav>
      <Header truck={truck} reg={reg} truckId={truckId} />

      <div>
        <Tabs
          label="Vehicle views"
          value={tab}
          onChange={(id) => setParams(id === 'health' ? {} : { tab: id }, { replace: true })}
          tabs={[
            { id: 'health', label: 'Health' },
            { id: 'maintenance', label: 'Maintenance' },
            { id: 'trips', label: 'Trips' },
            { id: 'fuel', label: 'Fuel' },
          ]}
        />
        <TabPanel id={tab}>
          {tab === 'health' &&
            (truck ? (
              <HealthTab truck={truck} points={points} />
            ) : (
              <Panel>
                <p className="text-muted">Live values appear here once this truck starts reporting.</p>
              </Panel>
            ))}
          {tab === 'maintenance' && <MaintenanceTab truck={truck} truckId={truckId} />}
          {tab === 'trips' && <TripsTab truckId={truckId} />}
          {tab === 'fuel' && <TruckFuel truckId={truckId} truck={truck} />}
        </TabPanel>
      </div>
    </div>
  );
}
