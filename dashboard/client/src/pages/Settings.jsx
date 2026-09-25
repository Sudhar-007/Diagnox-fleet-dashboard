import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import Plate from '../components/Plate.jsx';
import ZoneForm from '../components/ZoneForm.jsx';
import Button from '../components/ui/Button.jsx';
import Panel, { EmptyState } from '../components/ui/Panel.jsx';
import Tabs, { TabPanel } from '../components/ui/Tabs.jsx';
import { API_URL } from '../config.js';
import { sendJson, timeoutSignal } from '../lib/api.js';
import { HEALTH_FIELDS } from '../lib/fields.js';
import { formatClock } from '../lib/format.js';
import { zoneRule, zoneScope } from '../lib/zones.js';
import { reloadRules, reloadZones } from '../hooks/useSocket.js';
import { useFleetStore } from '../store/useFleetStore.js';

function RemoveZone({ zone }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(null);
  const remove = async () => {
    try {
      await sendJson(`/api/geofences/${encodeURIComponent(zone.id)}`, 'DELETE');
      await reloadZones();
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
        Remove zone
      </Button>
      <Button variant="quiet" onClick={() => setConfirming(false)}>
        Keep
      </Button>
    </span>
  );
}

function VisitLog({ visits }) {
  if (visits.length === 0) {
    return (
      <EmptyState>
        No entries or exits yet. One is logged when a truck crosses a zone edge and the next reading confirms it.
      </EmptyState>
    );
  }
  return (
    <table className="w-full min-w-[520px] text-left text-sm">
      <thead className="border-b border-line text-muted">
        <tr>
          <th className="px-4 py-2 font-normal">Time</th>
          <th className="px-4 py-2 font-normal">Truck</th>
          <th className="px-4 py-2 font-normal">Event</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {visits.map((v) => (
          <tr key={v.id}>
            <td className="whitespace-nowrap px-4 py-2 text-muted">{formatClock(v.at)}</td>
            <td className="px-4 py-2">
              <Plate truckId={v.truck_id} size="sm" />
            </td>
            <td className="px-4 py-2 text-ink">
              {v.type === 'entered' ? 'Entered' : 'Left'} {v.zone_name}
              <span className="text-muted">{v.zone_type === 'restricted' ? ', restricted' : ', allowed'}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function GeofencesTab() {
  const zones = useFleetStore((s) => s.zones);
  const visits = useFleetStore((s) => s.zoneVisits);
  const trucks = useFleetStore((s) => s.trucks);
  const registry = useFleetStore((s) => s.registry);
  const [params, setParams] = useSearchParams();
  // 'new' | zone id | null; a map popup links here with ?zone=<id>.
  const editing = params.get('zone');
  const setEditing = (id) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (id) next.set('zone', id);
        else next.delete('zone');
        return next;
      },
      { replace: true },
    );

  const insideBy = useMemo(() => {
    const out = {};
    for (const t of Object.values(trucks)) {
      for (const z of t.zones_inside ?? []) (out[z.zone_id] ??= []).push(t.truck_id);
    }
    return out;
  }, [trucks]);

  const rows = useMemo(() => [...(zones ?? [])].sort((a, b) => a.name.localeCompare(b.name)), [zones]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <p className="max-w-2xl text-[15px] text-muted">
          Circles on the map. A restricted zone alerts while a covered truck is inside it, an allowed zone while a covered
          truck is outside it. A crossing counts after two readings in a row, so GPS jitter at the edge is ignored.
        </p>
        {editing !== 'new' && (
          <Button variant="primary" size="md" onClick={() => setEditing('new')}>
            Add zone
          </Button>
        )}
      </div>

      {editing === 'new' && (
        <Panel title="Add zone">
          <ZoneForm onDone={() => setEditing(null)} />
        </Panel>
      )}

      {registry && !registry.storage?.persistent && (
        <p className="text-sm text-muted">
          Zones are saved on the server, but its storage resets when the server restarts on the current hosting plan.
        </p>
      )}

      <Panel bodyClassName="overflow-x-auto">
        {!zones ? (
          <EmptyState>Loading zones…</EmptyState>
        ) : rows.length === 0 ? (
          <EmptyState>No zones yet. Use Add zone to draw the first one.</EmptyState>
        ) : (
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b border-line text-muted">
              <tr>
                <th className="px-4 py-2 font-normal">Zone</th>
                <th className="px-4 py-2 font-normal">Rule</th>
                <th className="px-4 py-2 font-normal">Applies to</th>
                <th className="px-4 py-2 font-normal">Radius</th>
                <th className="px-4 py-2 font-normal">Inside now</th>
                <th className="px-4 py-2 font-normal">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((z) => {
                if (editing === z.id) {
                  return (
                    <tr key={z.id}>
                      <td colSpan={6} className="px-4 py-3">
                        <ZoneForm zone={z} onDone={() => setEditing(null)} />
                      </td>
                    </tr>
                  );
                }
                const inside = insideBy[z.id] ?? [];
                return (
                  <tr key={z.id} className="align-middle">
                    <td className="px-4 py-2.5">
                      <div className="text-ink">{z.name}</div>
                      <div className={z.type === 'restricted' ? 'text-crit' : 'text-muted'}>
                        {z.type === 'restricted' ? 'Restricted' : 'Allowed'}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-ink">{zoneRule(z)}</td>
                    <td className="px-4 py-2.5 text-ink">{zoneScope(z)}</td>
                    <td className="px-4 py-2.5 text-ink">{z.radius_m} m</td>
                    <td className="px-4 py-2.5">
                      {inside.length ? (
                        <span className="flex flex-wrap gap-1">
                          {[...inside].sort().map((id) => (
                            <Plate key={id} truckId={id} size="sm" />
                          ))}
                        </span>
                      ) : (
                        <span className="text-faint">None</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right">
                      <Button variant="quiet" onClick={() => setEditing(z.id)}>
                        Edit
                      </Button>
                      <RemoveZone zone={z} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title="Recent entries and exits" bodyClassName="overflow-x-auto">
        <VisitLog visits={visits} />
      </Panel>
    </div>
  );
}

// Current rule values plus defaults and input limits, refetched whenever the live rules change.
function useRulesView() {
  const healthRules = useFleetStore((s) => s.healthRules);
  const [state, setState] = useState({ view: null, error: null });
  useEffect(() => {
    const ctrl = new AbortController();
    const t = timeoutSignal(ctrl.signal);
    fetch(`${API_URL}/api/rules`, { signal: t.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`The server answered ${res.status}`))))
      .then((view) => setState({ view, error: null }))
      .catch((err) => {
        if (err.name !== 'AbortError') setState((s) => ({ ...s, error: 'Could not load the rules.' }));
      })
      .finally(t.done);
    return () => ctrl.abort();
  }, [healthRules]);
  return [state, (view) => setState({ view, error: null })];
}

const LEVEL_TEXT = { warning: 'text-warn', critical: 'text-crit' };

function ruleCondition(r) {
  return [
    `${r.op === '>' ? 'above' : 'below'}`,
    r.sustain_s ? `held ${r.sustain_s} s` : null,
    r.only_when_running ? 'engine running' : null,
  ];
}

function OtherRules({ view }) {
  const items = [
    ['Stale', `no reading for ${view.freshness.stale_after_s} s`],
    ['Offline', `no reading for ${view.freshness.offline_after_s} s`],
    ['Alert clears', `after ${view.alerts.clear_after_s} s back within limits`],
    [
      'Possible collision',
      `speed from ${view.sos.collision.from_kmh} km/h or more to ${view.sos.collision.to_kmh} km/h or less within ${view.sos.collision.within_s} s`,
    ],
    ['Zone crossing', `confirmed after ${view.geofence.confirm_points} readings in a row`],
    ['Maintenance risk', `looks back ${view.risk.window_s / 60} minutes`],
  ];
  return (
    <dl className="grid gap-x-6 gap-y-2 text-[15px] sm:grid-cols-[auto_1fr]">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function ThresholdsTab() {
  const [{ view, error: loadError }, setView] = useRulesView();
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [savedAt, setSavedAt] = useState(null);

  const rules = view?.health ?? [];
  const valueOf = (r) => (draft[r.id] ?? String(r.threshold));
  const changed = rules.filter((r) => valueOf(r) !== String(r.threshold));
  const atDefaults = rules.every((r) => Number(valueOf(r)) === r.default_threshold);

  const byField = HEALTH_FIELDS.map((f) => ({
    ...f,
    rules: rules
      .filter((r) => r.field === f.field)
      .sort((a, b) => (a.op === b.op ? (a.level === 'warning' ? -1 : 1) : a.op === '<' ? -1 : 1)),
  })).filter((f) => f.rules.length);

  const save = async () => {
    setSaving(true);
    setError(null);
    const thresholds = Object.fromEntries(changed.map((r) => [r.id, Number(valueOf(r))]));
    try {
      const next = await sendJson('/api/rules', 'PUT', { thresholds });
      setView(next);
      setDraft({});
      setSavedAt(new Date().toLocaleTimeString('en-GB', { hour12: false }));
      reloadRules();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!view) return <p className="text-[15px] text-muted">{loadError ?? 'Loading the rules…'}</p>;

  return (
    <div className="space-y-5">
      <p className="max-w-2xl text-[15px] text-muted">
        Demo-tuned values, not validated limits. A change applies to every truck at once: alerts, health colours and the
        maintenance risk score all use these numbers. Open alerts on a changed value close and are checked again against the new numbers.
      </p>

      <Panel bodyClassName="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="border-b border-line text-muted">
            <tr>
              <th className="px-4 py-2 font-normal">Value</th>
              <th className="px-4 py-2 font-normal">Rule</th>
              <th className="px-4 py-2 font-normal">Fires when</th>
              <th className="px-4 py-2 font-normal">Threshold</th>
              <th className="px-4 py-2 font-normal">Default</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {byField.map((f) =>
              f.rules.map((r, i) => {
                const [dir, ...conds] = ruleCondition(r);
                const edited = valueOf(r) !== String(r.threshold);
                return (
                  <tr key={r.id} className="align-middle">
                    {i === 0 && (
                      <td rowSpan={f.rules.length} className="px-4 py-2.5 align-top">
                        <div className="text-ink">{f.label}</div>
                        <div className="text-muted">{f.field}</div>
                      </td>
                    )}
                    <td className="px-4 py-2.5">
                      <div className={LEVEL_TEXT[r.level]}>{r.name}</div>
                      <div className="text-muted">{r.description}</div>
                    </td>
                    <td className="px-4 py-2.5 text-ink">
                      {dir}
                      {conds.filter(Boolean).length > 0 && (
                        <span className="text-muted">, {conds.filter(Boolean).join(', ')}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <label className="sr-only" htmlFor={`th-${r.id}`}>
                        {r.name} threshold in {r.unit}
                      </label>
                      <span className="inline-flex items-center gap-1.5">
                        <input
                          id={`th-${r.id}`}
                          type="number"
                          step="any"
                          min={r.limits?.[0]}
                          max={r.limits?.[1]}
                          value={valueOf(r)}
                          onChange={(e) => setDraft((d) => ({ ...d, [r.id]: e.target.value }))}
                          className={`w-24 rounded-[4px] border bg-asphalt px-2 py-1 text-[15px] text-ink focus:border-muted focus:outline-none ${
                            edited ? 'border-plate' : 'border-line'
                          }`}
                        />
                        <span className="text-muted">{r.unit}</span>
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-muted">
                      {r.default_threshold} {r.unit}
                    </td>
                  </tr>
                );
              }),
            )}
          </tbody>
        </table>
      </Panel>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" size="md" onClick={save} disabled={saving || changed.length === 0}>
          {saving ? 'Saving…' : changed.length ? `Save ${changed.length} change${changed.length === 1 ? '' : 's'}` : 'Save changes'}
        </Button>
        <Button size="md" onClick={() => setDraft({})} disabled={saving || changed.length === 0}>
          Discard
        </Button>
        <Button
          variant="quiet"
          size="md"
          disabled={saving || atDefaults}
          onClick={() => setDraft(Object.fromEntries(rules.map((r) => [r.id, String(r.default_threshold)])))}
        >
          Reset to defaults
        </Button>
        {error && (
          <p role="alert" className="text-sm text-crit">
            {error}
          </p>
        )}
        {!error && savedAt && changed.length === 0 && <p className="text-sm text-muted">Saved at {savedAt}</p>}
      </div>

      <Panel title="Other rules (fixed in the server config)">
        <OtherRules view={view} />
      </Panel>
    </div>
  );
}

const TAB_IDS = ['geofences', 'thresholds'];

export default function Settings() {
  const [params, setParams] = useSearchParams();
  const tab = TAB_IDS.includes(params.get('tab')) ? params.get('tab') : 'geofences';

  return (
    <div className="mx-auto max-w-[1300px]">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h1 className="font-cond text-2xl font-bold">Settings</h1>
        <Link to="/live" className="text-sm text-ink underline decoration-line underline-offset-4 hover:decoration-ink">
          See zones on the Live Map
        </Link>
      </div>
      <div className="mt-4">
        <Tabs
          label="Settings sections"
          value={tab}
          onChange={(id) => setParams(id === 'geofences' ? {} : { tab: id }, { replace: true })}
          tabs={[
            { id: 'geofences', label: 'Geofences' },
            { id: 'thresholds', label: 'Alert Thresholds' },
          ]}
        />
        <TabPanel id={tab}>
          {tab === 'geofences' && <GeofencesTab />}
          {tab === 'thresholds' && <ThresholdsTab />}
        </TabPanel>
      </div>
    </div>
  );
}
