import { useState } from 'react';

import Button from './ui/Button.jsx';
import Field from './ui/Field.jsx';
import { sendJson } from '../lib/api.js';
import { reloadRegistry } from '../hooks/useSocket.js';
import { useFleetStore } from '../store/useFleetStore.js';

// Add a truck, or edit one (truck_id is fixed once created).
export default function TruckForm({ truck = null, onDone }) {
  const registry = useFleetStore((s) => s.registry);
  const [form, setForm] = useState({
    truck_id: truck?.truck_id ?? '',
    registration: truck?.registration ?? '',
    model: truck?.model ?? '',
    tank_capacity_l: truck?.tank_capacity_l ?? 300,
    driver_id: truck?.driver_id ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // Drivers not driving another truck, plus this truck's own driver.
  const drivers = (registry?.drivers ?? []).filter((d) => !d.truck_id || d.truck_id === truck?.truck_id);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const body = {
      registration: form.registration,
      model: form.model,
      tank_capacity_l: Number(form.tank_capacity_l),
      driver_id: form.driver_id || null,
    };
    try {
      if (truck) await sendJson(`/api/registry/trucks/${encodeURIComponent(truck.truck_id)}`, 'PUT', body);
      else await sendJson('/api/registry/trucks', 'POST', { ...body, truck_id: form.truck_id });
      await reloadRegistry();
      onDone?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <Field
        label="Truck ID"
        value={form.truck_id}
        onChange={set('truck_id')}
        disabled={Boolean(truck)}
        required
        maxLength={16}
        placeholder="TN06"
        hint={truck ? 'Cannot be changed' : 'Exactly as the device sends it, capitals included'}
      />
      <Field label="Registration" value={form.registration} onChange={set('registration')} maxLength={20} placeholder="TN 09 AB 1234" />
      <Field label="Model" value={form.model} onChange={set('model')} maxLength={60} placeholder="Tata Signa 4825" />
      <Field
        label="Tank capacity (L)"
        type="number"
        min={20}
        max={2000}
        value={form.tank_capacity_l}
        onChange={set('tank_capacity_l')}
        required
      />
      <Field as="select" label="Driver" value={form.driver_id} onChange={set('driver_id')}>
        <option value="">No driver</option>
        {drivers.map((d) => (
          <option key={d.driver_id} value={d.driver_id}>
            {d.name}
          </option>
        ))}
      </Field>
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-5">
        <Button type="submit" variant="primary" disabled={saving}>
          {saving ? 'Saving…' : truck ? 'Save changes' : 'Add truck'}
        </Button>
        <Button variant="quiet" onClick={onDone} disabled={saving}>
          Cancel
        </Button>
        {error && (
          <p role="alert" className="text-sm text-crit">
            {error}
          </p>
        )}
      </div>
    </form>
  );
}
