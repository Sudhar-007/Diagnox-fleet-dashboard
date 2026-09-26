import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import Plate from './Plate.jsx';
import { formatPosition, openSos } from '../lib/alerts.js';
import { formatClock, formatDuration } from '../lib/format.js';
import { rememberedName, sendJson } from '../lib/api.js';
import { toast } from '../lib/toast.js';
import { queueAlertChange, useFleetStore } from '../store/useFleetStore.js';

const SOUND_KEY = 'fleet.sosSound';

function readSoundPref() {
  try {
    return localStorage.getItem(SOUND_KEY) === 'on';
  } catch {
    return false;
  }
}

// Two short tones every 2 s while an SOS is waiting for acknowledgement.
// Off by default. Browsers keep audio suspended until the viewer interacts with the page,
// so a suspended context is resumed on the first click or key press, and the banner says so.
// Returns true while sound is on but still blocked.
function useSosSound(active, enabled) {
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    if (!active || !enabled) return undefined;
    let ctx;
    try {
      ctx = new AudioContext();
    } catch {
      return undefined;
    }
    const unlock = () => {
      ctx.resume().then(() => setBlocked(false)).catch(() => {});
    };
    if (ctx.state === 'suspended') {
      setBlocked(true);
      window.addEventListener('pointerdown', unlock, { once: true });
      window.addEventListener('keydown', unlock, { once: true });
    }
    const tone = (at, freq) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.12, at);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.2);
    };
    const beep = () => {
      const t = ctx.currentTime;
      tone(t, 880);
      tone(t + 0.25, 660);
    };
    beep();
    const id = setInterval(beep, 2000);
    return () => {
      clearInterval(id);
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      setBlocked(false);
      ctx.close();
    };
  }, [active, enabled]);
  return blocked;
}

// Shown on every page while any SOS is ACTIVE (not yet acknowledged).
export default function SOSBanner() {
  const alerts = useFleetStore((s) => s.alerts);
  const now = useFleetStore((s) => s.now);
  const clockOffsetMs = useFleetStore((s) => s.clockOffsetMs);
  const [sound, setSound] = useState(readSoundPref);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const active = openSos(alerts).filter((a) => a.status === 'ACTIVE');
  const soundBlocked = useSosSound(active.length > 0, sound);
  if (active.length === 0) return null;

  const sos = active[0];

  const toggleSound = () => {
    const next = !sound;
    setSound(next);
    try {
      localStorage.setItem(SOUND_KEY, next ? 'on' : 'off');
    } catch {
      // storage unavailable: the choice lasts for this page only
    }
  };

  const acknowledge = async () => {
    setBusy(true);
    setError(null);
    try {
      const by = rememberedName().trim() || undefined;
      queueAlertChange(await sendJson(`/api/sos/${encodeURIComponent(sos.id)}`, 'PATCH', { status: 'ACKNOWLEDGED', by }));
      toast(`SOS on ${sos.truck_id} acknowledged`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="alert" className="bg-crit px-4 py-2.5 text-white md:px-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <span className="rounded-[3px] bg-white px-1.5 font-display text-sm font-semibold tracking-wide text-crit">SOS</span>
        <Plate truckId={sos.truck_id} size="sm" />
        <span className="font-medium">
          {sos.name}
          {sos.driver_name && <span className="font-normal text-white/85">, {sos.driver_name}</span>}
        </span>
        <span className="text-white/85">
          {formatPosition(sos.latitude, sos.longitude)} at {formatClock(sos.location_at)}
        </span>
        <span className="text-white/85">Open for {formatDuration((now + clockOffsetMs - sos.opened_ms) / 1000)}</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Link
            to={`/live?truck=${encodeURIComponent(sos.truck_id)}`}
            className="inline-flex h-7 items-center rounded-md border border-white/60 px-2.5 text-[13px] font-medium text-white hover:bg-white/10"
          >
            View on map
          </Link>
          <button
            type="button"
            onClick={acknowledge}
            disabled={busy}
            className="inline-flex h-7 items-center rounded-md bg-white px-3 text-[13px] font-semibold text-crit hover:bg-white/90 disabled:opacity-60"
          >
            {busy ? 'Saving…' : 'Acknowledge'}
          </button>
          <button
            type="button"
            onClick={toggleSound}
            aria-pressed={sound}
            className="inline-flex h-7 items-center rounded-md px-2 text-[13px] text-white/85 hover:bg-white/10 hover:text-white"
          >
            Sound {sound ? 'on' : 'off'}
          </button>
        </div>
      </div>
      {(active.length > 1 || error || soundBlocked) && (
        <div className="mt-1.5 flex flex-wrap gap-x-4 text-[13px]">
          {active.length > 1 && (
            <Link to="/alerts" className="font-medium underline underline-offset-4">
              {active.length - 1} more active SOS
            </Link>
          )}
          {soundBlocked && <span>Click anywhere on the page to enable the SOS sound.</span>}
          {error && <span className="rounded bg-white px-1.5 text-crit">{error}</span>}
        </div>
      )}
    </div>
  );
}
