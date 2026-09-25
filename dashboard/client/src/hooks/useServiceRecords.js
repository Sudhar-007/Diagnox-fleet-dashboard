import { useEffect, useState } from 'react';

import { API_URL } from '../config.js';
import { timeoutSignal } from '../lib/api.js';
import { useFleetStore } from '../store/useFleetStore.js';

// Service records (all, or one truck's), refetched whenever the fleet registry changes.
export function useServiceRecords(truckId) {
  const version = useFleetStore((s) => s.registryVersion);
  const [state, setState] = useState({ records: null, error: null });

  // A different truck starts from "loading", never from the previous truck's list.
  useEffect(() => {
    setState({ records: null, error: null });
  }, [truckId]);

  useEffect(() => {
    const ctrl = new AbortController();
    const t = timeoutSignal(ctrl.signal);
    const q = truckId ? `?truck_id=${encodeURIComponent(truckId)}` : '';
    fetch(`${API_URL}/api/service-records${q}`, { signal: t.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`The server answered ${res.status}`))))
      .then((body) => setState({ records: body.records, error: null }))
      .catch((err) => {
        if (err.name !== 'AbortError') setState((s) => ({ ...s, error: 'Could not load service records.' }));
      })
      .finally(t.done);
    return () => ctrl.abort();
  }, [truckId, version]);

  return state;
}
