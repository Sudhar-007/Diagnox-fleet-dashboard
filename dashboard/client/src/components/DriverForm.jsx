import { useState } from 'react';

import Button from './ui/Button.jsx';
import Field from './ui/Field.jsx';
import { sendJson } from '../lib/api.js';
import { reloadRegistry } from '../hooks/useSocket.js';
import { useFleetStore } from '../store/useFleetStore.js';
import { toast } from '../lib/toast.js';

// Add a driver, or edit one. Picking a truck puts the driver on it in place of its current driver.
export default function DriverForm({ driver = null, onDone }) {
  const registry = useFleetStore((s) => s.registry);
  const [form, setForm] = useState({
    name: driver?.name ?? '',
    phone: driver?.phone ?? '',
    licence_no: driver?.licence_no ?? '',
    truck_id: driver?.truck_id ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const trucks = [...(registry?.trucks ?? [])].sort((a, b) => a.truck_id.localeCompare(b.truck_id));
  const replacing = trucks.find((t) => t.truck_id === form.truck_id && t.driver_id && t.driver_id !== driver?.driver_id);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      // The truck is sent only when changed here, so an edit from a stale form cannot move the
      // driver back to a truck someone else has since taken them off.
      const { truck_id, ...fields } = form;
      const body = !driver || truck_id !== (driver.truck_id ?? '') ? form : fields;
      if (driver) await sendJson(`/api/registry/drivers/${encodeURIComponent(driver.driver_id)}`, 'PUT', body);
      else await sendJson('/api/registry/drivers', 'POST', body);
      await reloadRegistry();
      toast(driver ? `${form.name.trim()} saved` : `${form.name.trim()} added`);
      onDone?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Field label="Name" value={form.name} onChange={set('name')} required maxLength={60} placeholder="Senthil Kumar" />
      <Field label="Phone (optional)" value={form.phone} onChange={set('phone')} maxLength={20} placeholder="98400 12345" />
      <Field label="Licence number (optional)" value={form.licence_no} onChange={set('licence_no')} maxLength={30} placeholder="TN09 20190012345" />
      <Field
        as="select"
        label="Truck"
        value={form.truck_id}
        onChange={set('truck_id')}
        hint={replacing ? `Replaces ${replacing.driver_name} on ${replacing.truck_id}` : undefined}
      >
        <option value="">No truck</option>
        {trucks.map((t) => (
          <option key={t.truck_id} value={t.truck_id}>
            {t.truck_id}
            {t.driver_name && t.driver_id !== driver?.driver_id ? ` (now ${t.driver_name})` : ''}
          </option>
        ))}
      </Field>
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-4">
        <Button type="submit" variant="primary" disabled={saving}>
          {saving ? 'Saving…' : driver ? 'Save changes' : 'Add driver'}
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
    </form>
  );
}
