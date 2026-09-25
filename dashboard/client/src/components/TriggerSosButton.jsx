import { useState } from 'react';

import Button from './ui/Button.jsx';
import { rememberedName, sendJson } from '../lib/api.js';
import { queueAlertChange, useFleetStore } from '../store/useFleetStore.js';

// Manual SOS with a confirm step, so it cannot be raised by a stray click.
export default function TriggerSosButton({ truckId }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const hasOpen = useFleetStore((s) =>
    Object.values(s.alerts).some((a) => a.kind === 'sos' && a.truck_id === truckId && a.status !== 'RESOLVED'),
  );

  if (hasOpen) return <p className="text-sm text-crit">SOS open for this truck</p>;

  const raise = async () => {
    setBusy(true);
    setError(null);
    try {
      const by = rememberedName().trim() || undefined;
      queueAlertChange(await sendJson(`/api/trucks/${encodeURIComponent(truckId)}/sos`, 'POST', { by }));
      setConfirming(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!confirming) {
    return (
      <Button variant="default" onClick={() => setConfirming(true)} className="border-crit/60 text-crit">
        Trigger SOS
      </Button>
    );
  }
  return (
    <div className="space-y-1.5">
      <p className="text-sm text-ink">Raise an SOS for {truckId}?</p>
      <div className="flex gap-2">
        <Button variant="danger" onClick={raise} disabled={busy}>
          {busy ? 'Raising…' : 'Raise SOS'}
        </Button>
        <Button variant="quiet" onClick={() => setConfirming(false)} disabled={busy}>
          Cancel
        </Button>
      </div>
      {error && <p className="text-sm text-crit">{error}</p>}
    </div>
  );
}
