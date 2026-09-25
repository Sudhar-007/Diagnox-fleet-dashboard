import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { FuelEvents, FuelLevel, FuelTrend, RefuelForm, RefuelList } from '../components/Fuel.jsx';
import Plate from '../components/Plate.jsx';
import ProvenanceBadge from '../components/ProvenanceBadge.jsx';
import Button from '../components/ui/Button.jsx';
import Field from '../components/ui/Field.jsx';
import Panel, { EmptyState } from '../components/ui/Panel.jsx';
import { useRefuels } from '../hooks/useRefuels.js';
import { useFleetStore } from '../store/useFleetStore.js';

const litres = (v) => (v == null ? '' : `${v.toFixed(1)} L`);

function Consumption({ fuel }) {
  if (!fuel) return null;
  const idleShare = fuel.used_l > 0 ? Math.round((fuel.idle_l / fuel.used_l) * 100) : 0;
  return (
    <dl className="flex flex-wrap gap-x-8 gap-y-2">
      <div>
        <dt className="text-sm text-muted">Used since {fuel.since.slice(11, 16)}</dt>
        <dd className="font-cond text-2xl font-bold">{litres(fuel.used_l)}</dd>
      </div>
      <div>
        <dt className="text-sm text-muted">Distance</dt>
        <dd className="font-cond text-2xl font-bold">{fuel.distance_km.toFixed(1)} km</dd>
      </div>
      <div>
        <dt className="text-sm text-muted">Economy</dt>
        <dd className="font-cond text-2xl font-bold">{fuel.km_per_l != null ? `${fuel.km_per_l.toFixed(2)} km/L` : 'Not yet'}</dd>
      </div>
      <div>
        <dt className="text-sm text-muted">Burnt idling</dt>
        <dd className="font-cond text-2xl font-bold">
          {litres(fuel.idle_l)} <span className="text-base font-normal text-muted">{idleShare} %</span>
        </dd>
      </div>
    </dl>
  );
}

// Used by Vehicle Details too.
export function TruckFuel({ truckId, truck }) {
  const fuelEvents = useFleetStore((s) => s.fuelEvents);
  const [adding, setAdding] = useState(false);
  const { refuels, error } = useRefuels(truckId);
  const fuel = truck?.fuel ?? null;
  return (
    <div className="space-y-4">
      <Panel title="Tank">
        {fuel ? (
          <div className="space-y-4">
            <FuelLevel fuel={fuel} provenance={truck.provenance} />
            <div className="flex items-center gap-2 text-sm text-muted">
              Consumption <ProvenanceBadge kind="ESTIMATED" /> from engine load and rpm
            </div>
            <Consumption fuel={fuel} />
          </div>
        ) : (
          <p className="text-[15px] text-muted">Fuel appears here once this truck starts reporting.</p>
        )}
      </Panel>
      {fuel && (
        <Panel title="Level trend">
          <FuelTrend truckId={truckId} />
        </Panel>
      )}
      <Panel title="Possible theft and refuels" bodyClassName="overflow-x-auto">
        <FuelEvents
          events={fuelEvents?.filter((e) => e.truck_id === truckId) ?? null}
          showTruck={false}
          empty={
            fuel?.source === 'sensor'
              ? 'No sudden drops or refuels in the level readings.'
              : 'Checked only on a measured level; this truck sends no fuel_level, so its level is estimated.'
          }
        />
      </Panel>
      <Panel
        title="Refuel log"
        bodyClassName="overflow-x-auto"
        actions={
          !adding && (
            <Button variant="primary" onClick={() => setAdding(true)}>
              Add refuel
            </Button>
          )
        }
      >
        {adding && (
          <div className="border-b border-line p-4">
            <RefuelForm truckId={truckId} onDone={() => setAdding(false)} />
          </div>
        )}
        {error ? <p className="p-4 text-sm text-crit">{error}</p> : <RefuelList refuels={refuels} showTruck={false} />}
      </Panel>
    </div>
  );
}

function FuelRules({ rules }) {
  if (!rules) return null;
  return (
    <Panel title="How fuel is worked out">
      <ul className="space-y-2 text-sm text-muted">
        <li>
          <span className="text-ink">Level.</span> A truck that sends fuel_level shows that reading. For the others the level is{' '}
          estimated: it starts from a full tank when the server starts, burns {rules.base_lph} + {rules.load_factor} × engine load ×
          (rpm / {rules.rpm_ref}) litres per hour while the engine runs, and rises by the litres of each refuel logged here.
        </li>
        <li>
          <span className="text-ink">Consumption.</span> Litres used, km/L and fuel burnt idling (stopped with the engine running)
          come from the same burn rate for every truck, since the server started.
        </li>
        <li>
          <span className="text-ink">Possible theft.</span> The measured level drops by more than {rules.theft_drop_pct} % within{' '}
          {rules.anomaly_window_s} s while the truck stands still.
        </li>
        <li>
          <span className="text-ink">Refuel.</span> The measured level rises by more than {rules.refuel_rise_pct} % within{' '}
          {rules.anomaly_window_s} s.
        </li>
      </ul>
    </Panel>
  );
}

export default function Fuel() {
  const trucks = useFleetStore((s) => s.trucks);
  const fuelEvents = useFleetStore((s) => s.fuelEvents);
  const rules = useFleetStore((s) => s.fuelRules);
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState(false);
  const { refuels, error } = useRefuels(null);
  const list = Object.values(trucks)
    .filter((t) => t.fuel)
    .sort((a, b) => a.truck_id.localeCompare(b.truck_id));
  const selectedId = list.some((t) => t.truck_id === params.get('truck')) ? params.get('truck') : list[0]?.truck_id;
  const theftCount = (id) => (fuelEvents ?? []).filter((e) => e.truck_id === id && e.type === 'theft').length;

  return (
    <div className="mx-auto max-w-[1300px] space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h1 className="font-cond text-2xl font-bold">Fuel</h1>
        <p className="text-sm text-muted">Since the server started; levels reset with it.</p>
      </div>

      <Panel title="Fleet fuel" bodyClassName="overflow-x-auto">
        {list.length === 0 ? (
          <EmptyState>Fuel appears once trucks start reporting.</EmptyState>
        ) : (
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b border-line text-muted">
              <tr>
                <th className="px-4 py-2 font-normal">Truck</th>
                <th className="px-4 py-2 font-normal">Level</th>
                <th className="px-4 py-2 font-normal">Used</th>
                <th className="px-4 py-2 font-normal">Economy</th>
                <th className="px-4 py-2 font-normal">Burnt idling</th>
                <th className="px-4 py-2 font-normal">Possible thefts</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {list.map((t) => {
                const f = t.fuel;
                const thefts = theftCount(t.truck_id);
                return (
                  <tr key={t.truck_id} className={`align-top ${t.truck_id === selectedId ? 'bg-asphalt' : ''}`}>
                    <td className="px-4 py-2.5">
                      <button
                        type="button"
                        onClick={() => setParams({ truck: t.truck_id }, { replace: true })}
                        aria-pressed={t.truck_id === selectedId}
                        className="rounded-[3px]"
                        aria-label={`Show the fuel trend of ${t.truck_id}`}
                      >
                        <Plate truckId={t.truck_id} size="sm" />
                      </button>
                      <div className="mt-1">
                        <Link
                          to={`/vehicles/${encodeURIComponent(t.truck_id)}?tab=fuel`}
                          className="text-muted underline decoration-line underline-offset-4 hover:text-ink"
                        >
                          Vehicle fuel
                        </Link>
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <FuelLevel fuel={f} provenance={t.provenance} compact />
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-ink">
                      {litres(f.used_l)}
                      <div className="text-xs text-muted">{f.distance_km.toFixed(1)} km</div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-ink">
                      {f.km_per_l != null ? `${f.km_per_l.toFixed(2)} km/L` : <span className="text-faint">Not yet</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-ink">{litres(f.idle_l)}</td>
                    <td className="px-4 py-2.5">
                      {f.source !== 'sensor' ? (
                        <span className="text-faint">Needs a fuel sensor</span>
                      ) : thefts ? (
                        <span className="text-crit">{thefts}</span>
                      ) : (
                        <span className="text-muted">None</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="flex items-center gap-2 border-t border-line px-4 py-2.5 text-xs text-muted">
          Used, economy and idling are <ProvenanceBadge kind="ESTIMATED" /> from engine load and rpm for every truck.
        </p>
      </Panel>

      {selectedId && (
        <Panel
          title="Level trend"
          actions={
            <Field
              as="select"
              label="Truck"
              className="w-32"
              value={selectedId}
              onChange={(e) => setParams({ truck: e.target.value }, { replace: true })}
            >
              {list.map((t) => (
                <option key={t.truck_id}>{t.truck_id}</option>
              ))}
            </Field>
          }
        >
          <FuelTrend truckId={selectedId} />
        </Panel>
      )}

      <Panel
        title={
          <span className="flex items-center gap-2">
            Possible theft and refuels <ProvenanceBadge kind="RULE_BASED" />
          </span>
        }
        bodyClassName="overflow-x-auto"
      >
        <FuelEvents
          events={fuelEvents}
          empty="No sudden drops or refuels in the measured levels. The Fuel theft demo scenario (Shift+D) drains TN01's tank."
        />
      </Panel>

      <Panel
        title="Refuel log"
        bodyClassName="overflow-x-auto"
        actions={
          !adding && (
            <Button variant="primary" onClick={() => setAdding(true)}>
              Add refuel
            </Button>
          )
        }
      >
        {adding && (
          <div className="border-b border-line p-4">
            <RefuelForm onDone={() => setAdding(false)} />
          </div>
        )}
        {error ? <p className="p-4 text-sm text-crit">{error}</p> : <RefuelList refuels={refuels} />}
      </Panel>

      <FuelRules rules={rules} />
    </div>
  );
}
