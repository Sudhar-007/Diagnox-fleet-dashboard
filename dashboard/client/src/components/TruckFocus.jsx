import { useMemo } from 'react';
import { Link } from 'react-router-dom';

import { FuelLevel } from './Fuel.jsx';
import Plate from './Plate.jsx';
import ProvenanceBadge from './ProvenanceBadge.jsx';
import StatusBadge from './StatusBadge.jsx';
import { buttonClass } from './ui/Button.jsx';
import { CONTROL } from './ui/Field.jsx';
import Panel from './ui/Panel.jsx';
import { sosLabel } from '../lib/alerts.js';
import { formatAgo, formatDuration } from '../lib/format.js';
import { engineText, locationText } from '../lib/fleetView.js';
import { levelTone } from '../lib/fuel.js';
import { sortedTrips } from '../lib/trips.js';
import { useFleetStore } from '../store/useFleetStore.js';

function Row({ label, children }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="shrink-0 text-[13px] text-muted">{label}</dt>
      <dd className="min-w-0 text-right text-[13px] text-ink">{children}</dd>
    </div>
  );
}

function riskTone(score) {
  if (typeof score !== 'number') return 'text-muted';
  return score >= 50 ? 'text-crit' : score >= 20 ? 'text-warn' : 'text-ok';
}

// One truck at a glance: who, what, where, how it is doing. `rows` come from useFleetRows().
export function VehicleFocus({ rows, truckId, onChange }) {
  const trips = useFleetStore((s) => s.trips);
  const row = rows.find((r) => r.truck.truck_id === truckId) ?? rows[0];
  const t = row.truck;
  const trip = useMemo(() => sortedTrips(trips, { truck_id: t.truck_id, status: 'active' })[0] ?? null, [trips, t.truck_id]);
  const ml = t.ml_risk?.score;

  return (
    <Panel
      title="Vehicle focus"
      actions={
        <select
          aria-label="Vehicle in focus"
          value={t.truck_id}
          onChange={(e) => onChange(e.target.value)}
          className={`${CONTROL} h-7 w-auto py-0 pr-7 text-[13px]`}
        >
          {rows.map((r) => (
            <option key={r.truck.truck_id} value={r.truck.truck_id}>
              {r.truck.truck_id}
            </option>
          ))}
        </select>
      }
      className="flex flex-col"
      bodyClassName="flex flex-1 flex-col px-4 pb-4"
    >
      <div className="flex items-center gap-3 border-b border-line py-3">
        <Plate truckId={t.truck_id} />
        <div className="min-w-0 flex-1">
          <div className={`truncate font-medium ${t.in_registry === false ? 'text-warn' : 'text-ink'}`}>{t.driver_name}</div>
          <div className="truncate text-xs text-muted">{t.model ?? 'Model not set'}</div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <StatusBadge status={row.status} sos={Boolean(row.sos)} />
          <ProvenanceBadge kind={t.provenance} />
        </div>
      </div>

      {row.sos && <p className="mt-3 rounded-md bg-crit/5 px-3 py-2 text-[13px] font-medium text-crit">{sosLabel(row.sos)}</p>}

      <dl className="mt-1 divide-y divide-line">
        <Row label="Registration">{t.registration ?? <span className="text-muted">Not set</span>}</Row>
        <Row label="Speed">
          <span className="font-medium">{typeof t.speed === 'number' ? Math.round(t.speed) : '-'}</span>{' '}
          <span className="text-muted">km/h, engine {engineText(t).toLowerCase()}</span>
        </Row>
        <Row label="Location">
          <span className="inline-flex items-center gap-1.5">
            <span className="truncate">{locationText(t)}</span>
            {t.position_source === 'virtual_route' && <ProvenanceBadge kind="VIRTUAL_POSITION" />}
          </span>
        </Row>
        <Row label="Current trip">
          {trip ? (
            <>
              {trip.distance_km.toFixed(1)} km <span className="text-muted">in {formatDuration(trip.duration_s)}</span>
            </>
          ) : (
            <span className="text-muted">Not on a trip</span>
          )}
        </Row>
        <Row label="Maintenance risk">
          <span className={`font-medium ${riskTone(t.rule_risk_score)}`}>{t.rule_risk_score ?? '-'}</span>
          <span className="text-muted"> rule, </span>
          <span className={`font-medium ${riskTone(ml)}`}>{typeof ml === 'number' ? ml : '-'}</span>
          <span className="text-muted"> model, of 100</span>
        </Row>
        <Row label="Last reading">
          <span className={row.silent ? 'font-medium text-idle' : ''}>{formatAgo(row.age)}</span>
        </Row>
      </dl>

      <div className="mt-3">
        <div className="mb-1 text-[13px] text-muted">Fuel</div>
        <FuelLevel fuel={t.fuel} provenance={t.provenance} />
      </div>

      <div className="mt-auto flex gap-2 pt-4">
        <Link to={`/vehicles/${encodeURIComponent(t.truck_id)}`} className={`${buttonClass('primary', 'md')} flex-1`}>
          Open vehicle
        </Link>
        <Link to={`/live?truck=${encodeURIComponent(t.truck_id)}`} className={buttonClass('default', 'md')}>
          Live map
        </Link>
      </div>
    </Panel>
  );
}

// Display ranges for the bars; limits come from the live health rules.
const GAUGES = [
  { field: 'coolant_temp', label: 'Coolant', unit: '°C', digits: 0, min: 40, max: 130 },
  { field: 'oil_temp', label: 'Oil temperature', unit: '°C', digits: 0, min: 40, max: 140 },
  { field: 'battery_voltage', label: 'Battery', unit: 'V', digits: 1, min: 10, max: 16 },
  { field: 'rpm', label: 'Engine speed', unit: 'rpm', digits: 0, min: 0, max: 3500 },
  { field: 'engine_load', label: 'Engine load', unit: '%', digits: 0, min: 0, max: 100 },
];

const TONE = {
  critical: { text: 'text-crit', bar: 'bg-crit' },
  warning: { text: 'text-warn', bar: 'bg-warn' },
  ok: { text: 'text-ink', bar: 'bg-ok' },
  none: { text: 'text-ink', bar: 'bg-idle' },
};

function limitText(rules) {
  if (!rules.length) return 'No limit set';
  const warn = rules.filter((r) => r.level === 'warning');
  const shown = (warn.length ? warn : rules).map((r) => `${r.op === '>' ? 'above' : 'below'} ${r.threshold}`);
  return `${warn.length ? 'Warning' : 'Critical'} ${shown.join(' or ')}`;
}

function Gauge({ gauge, value, rules, finding, silent }) {
  const has = typeof value === 'number';
  const tone = TONE[finding?.level ?? (rules.length ? 'ok' : 'none')];
  const pos = (v) => Math.max(0, Math.min(100, ((v - gauge.min) / (gauge.max - gauge.min)) * 100));
  return (
    <div className="bg-surface px-4 py-3">
      <div className="text-xs text-muted">{gauge.label}</div>
      <div className="mt-0.5 flex items-baseline gap-1">
        <span className={`font-display text-2xl leading-8 font-semibold tabular-nums ${silent || !has ? 'text-muted' : tone.text}`}>
          {has ? value.toFixed(gauge.digits) : '-'}
        </span>
        <span className="text-[13px] text-muted">{gauge.unit}</span>
      </div>
      <div className="relative mt-2 h-1.5 rounded-full bg-subtle" role="presentation">
        {has && <div className={`h-1.5 rounded-full ${silent ? 'bg-faint' : tone.bar}`} style={{ width: `${pos(value)}%` }} />}
        {rules.map((r) => (
          <span
            key={r.id}
            className={`absolute -top-0.5 h-2.5 w-px ${r.level === 'critical' ? 'bg-crit' : 'bg-warn'}`}
            style={{ left: `${pos(r.threshold)}%` }}
          />
        ))}
      </div>
      <div className={`mt-1.5 text-xs ${finding ? tone.text : 'text-muted'}`}>{finding ? finding.name : limitText(rules)}</div>
    </div>
  );
}

// The focused truck's latest OBD readings against their alert limits.
export function LiveReadings({ row }) {
  const healthRules = useFleetStore((s) => s.healthRules) ?? [];
  const t = row.truck;
  const fuel = t.fuel;
  return (
    <Panel
      title={`Live readings, ${t.truck_id}`}
      description={row.silent ? `Last reading ${formatAgo(row.age)}` : `Reading of ${t.timestamp?.slice(11, 19) ?? '-'}`}
      bodyClassName=""
    >
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-b-lg bg-line sm:grid-cols-3 xl:grid-cols-6">
        {GAUGES.map((g) => (
          <Gauge
            key={g.field}
            gauge={g}
            value={t[g.field]}
            rules={healthRules.filter((r) => r.field === g.field)}
            finding={(t.findings ?? []).find((f) => f.field === g.field)}
            silent={row.silent}
          />
        ))}
        <div className="bg-surface px-4 py-3">
          <div className="text-xs text-muted">Fuel</div>
          <div className="mt-0.5 flex items-baseline gap-1">
            <span className={`font-display text-2xl leading-8 font-semibold tabular-nums ${fuel ? 'text-ink' : 'text-muted'}`}>
              {fuel ? fuel.level_pct.toFixed(1) : '-'}
            </span>
            <span className="text-[13px] text-muted">%</span>
          </div>
          <div className="mt-2 h-1.5 rounded-full bg-subtle" role="presentation">
            {fuel && <div className={`h-1.5 rounded-full ${levelTone(fuel.level_pct)}`} style={{ width: `${Math.min(100, fuel.level_pct)}%` }} />}
          </div>
          <div className="mt-1.5 text-xs text-muted">
            {fuel ? `${Math.round(fuel.level_l)} of ${fuel.capacity_l} L, ${fuel.source === 'sensor' ? 'sensor' : 'estimated'}` : 'No fuel data'}
          </div>
        </div>
      </div>
    </Panel>
  );
}
