import { useState } from 'react';

import Button from './ui/Button.jsx';
import Field from './ui/Field.jsx';
import { rememberName, rememberedName, sendJson } from '../lib/api.js';
import { reloadRegistry } from '../hooks/useSocket.js';
import { useFleetStore } from '../store/useFleetStore.js';
import { toast } from '../lib/toast.js';

const today = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// Log maintenance done on a truck. `truckId` fixes the truck; otherwise a select is shown.
export default function ServiceRecordForm({ truckId = null, onDone }) {
  const registry = useFleetStore((s) => s.registry);
  const types = registry?.service_types ?? [];
  const [form, setForm] = useState({
    truck_id: truckId ?? registry?.trucks?.[0]?.truck_id ?? '',
    date: today(),
    type: types[0] ?? '',
    odometer_km: '',
    cost_inr: '',
    notes: '',
    by: rememberedName(),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await sendJson('/api/service-records', 'POST', {
        truck_id: form.truck_id,
        date: form.date,
        type: form.type,
        odometer_km: form.odometer_km === '' ? undefined : Number(form.odometer_km),
        cost_inr: form.cost_inr === '' ? undefined : Number(form.cost_inr),
        notes: form.notes || undefined,
        by: form.by || undefined,
      });
      if (form.by.trim()) rememberName(form.by.trim());
      await reloadRegistry();
      toast(`Service record saved for ${form.truck_id}`);
      onDone?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {!truckId && (
        <Field as="select" label="Truck" value={form.truck_id} onChange={set('truck_id')} required>
          {(registry?.trucks ?? []).map((t) => (
            <option key={t.truck_id} value={t.truck_id}>
              {t.truck_id}
            </option>
          ))}
        </Field>
      )}
      <Field label="Date" type="date" value={form.date} max={today()} onChange={set('date')} required />
      <Field as="select" label="Work done" value={form.type} onChange={set('type')} required>
        {types.map((t) => (
          <option key={t}>{t}</option>
        ))}
      </Field>
      <Field label="Odometer (km)" type="number" min={0} value={form.odometer_km} onChange={set('odometer_km')} />
      <Field label="Cost (₹)" type="number" min={0} value={form.cost_inr} onChange={set('cost_inr')} />
      <Field label="Done by (optional)" value={form.by} onChange={set('by')} maxLength={60} />
      <Field
        as="textarea"
        label="Notes (optional)"
        value={form.notes}
        onChange={set('notes')}
        maxLength={500}
        className="sm:col-span-2"
        placeholder="e.g. Radiator hose replaced"
      />
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-4">
        <Button type="submit" variant="primary" disabled={saving}>
          {saving ? 'Saving…' : 'Add service record'}
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
