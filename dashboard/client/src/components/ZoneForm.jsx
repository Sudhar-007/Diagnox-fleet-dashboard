import { useMemo, useState } from 'react';
import { Circle, MapContainer, TileLayer, useMapEvents } from 'react-leaflet';

import Button from './ui/Button.jsx';
import Field from './ui/Field.jsx';
import { sendJson } from '../lib/api.js';
import { ATTRIBUTION, DEFAULT_CENTER, DEFAULT_ZOOM, TILE_URL } from '../lib/mapTiles.js';
import { themeColor } from '../lib/theme.js';
import { reloadZones } from '../hooks/useSocket.js';
import { useFleetStore } from '../store/useFleetStore.js';
import { toast } from '../lib/toast.js';

function ClickToPlace({ onPick }) {
  useMapEvents({ click: (e) => onPick(e.latlng) });
  return null;
}

const asNumber = (v) => (v === '' || v == null ? NaN : Number(v));

// Click the map to set the centre; the draft circle previews the zone as typed.
function ZonePicker({ zone, form, onPick }) {
  const zones = useFleetStore((s) => s.zones) ?? [];
  const lat = asNumber(form.center_lat);
  const lng = asNumber(form.center_lng);
  const radius = asNumber(form.radius_m);
  const placed = Number.isFinite(lat) && Number.isFinite(lng);
  const [start] = useState(() => (placed ? [lat, lng] : DEFAULT_CENTER));
  const others = zones.filter((z) => z.id !== zone?.id);
  const draft = form.type === 'restricted' ? themeColor('crit') : themeColor('ink');

  return (
    <div className="fleet-map h-64 overflow-hidden rounded-[4px] border border-line">
      <MapContainer className="h-full w-full cursor-crosshair" center={start} zoom={placed ? 14 : DEFAULT_ZOOM}>
        <TileLayer url={TILE_URL} attribution={ATTRIBUTION} maxZoom={19} />
        <ClickToPlace onPick={onPick} />
        {others.map((z) => (
          <Circle
            key={z.id}
            center={[z.center_lat, z.center_lng]}
            radius={z.radius_m}
            interactive={false}
            pathOptions={{ color: themeColor('muted'), weight: 1, fillOpacity: 0.05 }}
          />
        ))}
        {placed && Number.isFinite(radius) && radius > 0 && (
          <Circle
            center={[lat, lng]}
            radius={radius}
            interactive={false}
            pathOptions={{ color: draft, weight: 2, fillColor: draft, fillOpacity: 0.15 }}
          />
        )}
      </MapContainer>
    </div>
  );
}

// Add a zone, or edit one.
export default function ZoneForm({ zone = null, onDone }) {
  const registry = useFleetStore((s) => s.registry);
  const liveTrucks = useFleetStore((s) => s.trucks);
  const [form, setForm] = useState({
    name: zone?.name ?? '',
    type: zone?.type ?? 'restricted',
    center_lat: zone?.center_lat ?? '',
    center_lng: zone?.center_lng ?? '',
    radius_m: zone?.radius_m ?? 500,
    alert: zone?.alert ?? true,
    scope: zone?.truck_ids.length ? 'some' : 'all',
    truck_ids: zone?.truck_ids ?? [],
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const truckIds = useMemo(
    () =>
      [...new Set([...(registry?.trucks ?? []).map((t) => t.truck_id), ...Object.keys(liveTrucks), ...form.truck_ids])].sort(),
    [registry, liveTrucks, form.truck_ids],
  );

  const toggleTruck = (id) =>
    setForm((f) => ({
      ...f,
      truck_ids: f.truck_ids.includes(id) ? f.truck_ids.filter((t) => t !== id) : [...f.truck_ids, id],
    }));

  const onPick = ({ lat, lng }) =>
    setForm((f) => ({ ...f, center_lat: Number(lat.toFixed(6)), center_lng: Number(lng.toFixed(6)) }));

  const submit = async (e) => {
    e.preventDefault();
    if (form.scope === 'some' && form.truck_ids.length === 0) {
      setError('Pick at least one truck, or choose All trucks.');
      return;
    }
    setSaving(true);
    setError(null);
    const body = {
      name: form.name,
      type: form.type,
      center_lat: asNumber(form.center_lat),
      center_lng: asNumber(form.center_lng),
      radius_m: asNumber(form.radius_m),
      alert: form.alert,
      truck_ids: form.scope === 'all' ? [] : form.truck_ids,
    };
    try {
      if (zone) await sendJson(`/api/geofences/${encodeURIComponent(zone.id)}`, 'PUT', body);
      else await sendJson('/api/geofences', 'POST', body);
      await reloadZones();
      toast(zone ? `Zone ${form.name.trim()} saved` : `Zone ${form.name.trim()} added`);
      onDone?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" value={form.name} onChange={set('name')} required maxLength={60} placeholder="Ennore coal yard" />
          <Field as="select" label="Type" value={form.type} onChange={set('type')}>
            <option value="restricted">Restricted: trucks must stay out</option>
            <option value="allowed">Allowed: trucks must stay in</option>
          </Field>
          <Field
            label="Centre latitude"
            type="number"
            step="any"
            min={-90}
            max={90}
            value={form.center_lat}
            onChange={set('center_lat')}
            required
            hint="Or click the map"
          />
          <Field
            label="Centre longitude"
            type="number"
            step="any"
            min={-180}
            max={180}
            value={form.center_lng}
            onChange={set('center_lng')}
            required
          />
          <Field
            label="Radius (m)"
            type="number"
            min={50}
            max={50000}
            value={form.radius_m}
            onChange={set('radius_m')}
            required
          />
        </div>

        <label className="flex items-start gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={form.alert}
            onChange={(e) => setForm((f) => ({ ...f, alert: e.target.checked }))}
            className="mt-1 size-4 accent-plate"
          />
          <span>
            Alert on breach
            <span className="block text-sm text-muted">
              {form.type === 'restricted' ? 'When a truck is inside.' : 'When a truck is outside.'} Entries and exits
              are logged either way.
            </span>
          </span>
        </label>

        <fieldset>
          <legend className="mb-1 text-sm text-muted">Applies to</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink">
            {[
              ['all', 'All trucks'],
              ['some', 'Selected trucks'],
            ].map(([value, label]) => (
              <label key={value} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="zone-scope"
                  value={value}
                  checked={form.scope === value}
                  onChange={set('scope')}
                  className="size-4 accent-plate"
                />
                {label}
              </label>
            ))}
          </div>
          {form.scope === 'some' && (
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
              {truckIds.map((id) => (
                <label key={id} className="flex items-center gap-1.5 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={form.truck_ids.includes(id)}
                    onChange={() => toggleTruck(id)}
                    className="size-4 accent-plate"
                  />
                  {id}
                </label>
              ))}
            </div>
          )}
        </fieldset>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? 'Saving…' : zone ? 'Save changes' : 'Add zone'}
          </Button>
          <Button variant="quiet" onClick={() => onDone?.()} disabled={saving}>
            Cancel
          </Button>
          {error && (
            <p role="alert" className="text-sm text-crit">
              {error}
            </p>
          )}
        </div>
      </div>

      <ZonePicker zone={zone} form={form} onPick={onPick} />
    </form>
  );
}
