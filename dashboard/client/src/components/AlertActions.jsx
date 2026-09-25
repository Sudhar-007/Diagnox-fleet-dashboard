import { useState } from 'react';

import Button from './ui/Button.jsx';
import Field from './ui/Field.jsx';
import { rememberName, rememberedName, sendJson } from '../lib/api.js';
import { queueAlertChange } from '../store/useFleetStore.js';

const ACTIONS = {
  ACKNOWLEDGED: { verb: 'Acknowledge', placeholder: 'e.g. Called driver, pulling over at next stop' },
  RESOLVED: { verb: 'Resolve', placeholder: 'e.g. Coolant topped up at depot' },
};

// Acknowledge / Resolve with an optional note and name (fleet manager input).
export default function AlertActions({ alert }) {
  const [mode, setMode] = useState(null);
  const [note, setNote] = useState('');
  const [by, setBy] = useState(rememberedName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  if (alert.status === 'RESOLVED') return null;

  const open = (status) => {
    setMode(status);
    setError(null);
  };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const change = await sendJson(`/api/alerts/${encodeURIComponent(alert.id)}`, 'PATCH', {
        status: mode,
        note: note.trim() || undefined,
        by: by.trim() || undefined,
      });
      if (by.trim()) rememberName(by.trim());
      queueAlertChange(change);
      setMode(null);
      setNote('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!mode) {
    return (
      <div className="mt-2.5 flex gap-2">
        {alert.status === 'ACTIVE' && <Button onClick={() => open('ACKNOWLEDGED')}>Acknowledge</Button>}
        <Button onClick={() => open('RESOLVED')}>Resolve</Button>
      </div>
    );
  }

  const action = ACTIONS[mode];
  return (
    <form onSubmit={submit} className="mt-3 grid gap-3 rounded-[4px] border border-line bg-asphalt/40 p-3 sm:grid-cols-[1fr_14rem]">
      <Field
        as="textarea"
        label="Note (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={500}
        placeholder={action.placeholder}
      />
      <Field
        label="Your name (optional)"
        value={by}
        onChange={(e) => setBy(e.target.value)}
        maxLength={60}
        autoComplete="name"
      />
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
        <Button type="submit" variant="primary" disabled={saving}>
          {saving ? 'Saving…' : action.verb}
        </Button>
        <Button variant="quiet" onClick={() => setMode(null)} disabled={saving}>
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
