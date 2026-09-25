import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import Button from './ui/Button.jsx';
import { API_URL, REQUEST_TIMEOUT_MS } from '../config.js';
import { sendJson } from '../lib/api.js';
import { useFleetStore } from '../store/useFleetStore.js';

const OPEN_KEY = 'fleet.demoPanel';

function readOpen() {
  try {
    return sessionStorage.getItem(OPEN_KEY) === '1';
  } catch {
    return false;
  }
}
function writeOpen(open) {
  try {
    sessionStorage.setItem(OPEN_KEY, open ? '1' : '0');
  } catch {
    // storage unavailable: the panel just forgets on reload
  }
}

function ScenarioRow({ scenario, truckIds, onRun, running }) {
  const [truck, setTruck] = useState(scenario.default_truck);
  const run = running.find((r) => r.truck_id === truck && r.id === scenario.id);
  const now = useFleetStore((s) => s.now);
  const clockOffsetMs = useFleetStore((s) => s.clockOffsetMs);
  const left = run ? Math.max(0, Math.round((run.ends_ms - (now + clockOffsetMs)) / 1000)) : null;

  return (
    <li className="px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[15px] text-ink">{scenario.label}</span>
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor={`sc-${scenario.id}`}>
            Truck for {scenario.label}
          </label>
          <select
            id={`sc-${scenario.id}`}
            value={truck}
            onChange={(e) => setTruck(e.target.value)}
            className="rounded-[4px] border border-line bg-asphalt px-1.5 py-1 text-sm text-ink"
          >
            {truckIds.map((id) => (
              <option key={id}>{id}</option>
            ))}
          </select>
          <Button onClick={() => onRun(scenario.id, truck)}>{run ? `Running, ${left} s` : 'Run'}</Button>
        </div>
      </div>
      <p className="mt-1 text-sm text-muted">{scenario.description}</p>
    </li>
  );
}

// Demo scenarios for the live presentation. Opens with ?demo=1 or Shift+D.
export default function ScenarioPanel() {
  const [params] = useSearchParams();
  const [open, setOpen] = useState(() => params.get('demo') === '1' || readOpen());
  const [data, setData] = useState(null);
  const [minimized, setMinimized] = useState(false);
  const [error, setError] = useState(null);
  const trucks = useFleetStore((s) => s.trucks);
  const truckIds = Object.keys(trucks).sort();

  useEffect(() => {
    if (params.get('demo') === '1') {
      setOpen(true);
      writeOpen(true);
    }
  }, [params]);

  useEffect(() => {
    const onKey = (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
      if (e.shiftKey && e.key.toLowerCase() === 'd' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        setOpen((o) => {
          writeOpen(!o);
          return !o;
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // One poll at a time; a poll still in flight when the panel closes is aborted, and a
  // response older than the last scenario start is ignored.
  const inFlight = useRef(null);
  const lastStart = useRef(0);
  const load = useCallback(async () => {
    if (inFlight.current) return;
    const ctrl = new AbortController();
    inFlight.current = ctrl;
    const sentAt = Date.now();
    try {
      const res = await fetch(`${API_URL}/api/demo/scenarios`, {
        signal: AbortSignal.any([ctrl.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
      });
      if (!res.ok) throw new Error(`The server answered ${res.status}`);
      const body = await res.json();
      if (sentAt >= lastStart.current) setData(body);
      setError(null);
    } catch (err) {
      if (err.name === 'AbortError') return;
      setError(err.name === 'TimeoutError' ? 'The server did not respond in time.' : err.message);
    } finally {
      if (inFlight.current === ctrl) inFlight.current = null;
    }
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    load();
    const id = setInterval(load, 3000);
    return () => {
      clearInterval(id);
      inFlight.current?.abort();
      inFlight.current = null;
    };
  }, [open, load]);

  if (!open) return null;

  const onRun = async (scenario, truck_id) => {
    try {
      const res = await sendJson('/api/demo/scenario', 'POST', { scenario, truck_id });
      lastStart.current = Date.now();
      setData((d) => (d ? { ...d, running: res.running } : d));
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  };

  const close = () => {
    setOpen(false);
    writeOpen(false);
  };

  return (
    <aside
      aria-label="Demo scenarios"
      className="fixed right-3 bottom-3 z-[1000] flex max-h-[70vh] w-[min(24rem,calc(100vw-1.5rem))] flex-col rounded-md border border-line bg-panel"
    >
      <header className={`flex items-center justify-between gap-2 px-3 py-2 ${minimized ? '' : 'border-b border-line'}`}>
        <div>
          <h2 className="text-[15px] font-medium text-ink">Demo scenarios</h2>
          {!minimized && <p className="text-xs text-muted">Simulated trucks only. Each one ends by itself.</p>}
          {minimized && data?.running?.length > 0 && (
            <p className="text-xs text-muted">{data.running.length} running</p>
          )}
        </div>
        <div className="flex gap-1">
          <Button variant="quiet" onClick={() => setMinimized((m) => !m)} aria-expanded={!minimized}>
            {minimized ? 'Expand' : 'Minimize'}
          </Button>
          <Button variant="quiet" onClick={close} aria-label="Close demo scenarios">
            Close
          </Button>
        </div>
      </header>
      {!minimized && (
        <>
      {error && <p className="px-3 pt-2 text-sm text-crit">{error}</p>}
      {data && !data.enabled && (
        <p className="px-3 py-3 text-sm text-muted">Scenarios are turned off on this server (DEMO_ENABLED=false).</p>
      )}
      {data?.enabled && (
        <ul className="divide-y divide-line overflow-y-auto">
          {data.available.map((s) => (
            <ScenarioRow key={s.id} scenario={s} truckIds={truckIds} onRun={onRun} running={data.running} />
          ))}
        </ul>
      )}
      <p className="border-t border-line px-3 py-1.5 text-xs text-faint">Shift+D shows or hides this panel.</p>
        </>
      )}
    </aside>
  );
}
