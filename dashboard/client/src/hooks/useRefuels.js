import { useEffect, useState } from 'react';

import { API_URL } from '../config.js';
import { timeoutSignal } from '../lib/api.js';
import { useFleetStore } from '../store/useFleetStore.js';

// Manager refuel log (all, or one truck's), refetched whenever the fleet registry changes.
export function useRefuels(truckId) {
  const version = useFleetStore((s) => s.registryVersion);
  const [state, setState] = useState({ refuels: null, error: null });

  useEffect(() => {
    setState({ refuels: null, error: null });
  }, [truckId]);

  useEffect(() => {
    const ctrl = new AbortController();
    const t = timeoutSignal(ctrl.signal);
    const q = truckId ? `?truck_id=${encodeURIComponent(truckId)}` : '';
    fetch(`${API_URL}/api/refuels${q}`, { signal: t.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`The server answered ${res.status}`))))
      .then((body) => setState({ refuels: body.refuels, error: null }))
      .catch((err) => {
        if (err.name !== 'AbortError') setState((s) => ({ ...s, error: 'Could not load the refuel log.' }));
      })
      .finally(t.done);
    return () => ctrl.abort();
  }, [truckId, version]);

  return state;
}
