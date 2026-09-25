import { useEffect } from 'react';
import { io } from 'socket.io-client';

import { API_URL, REQUEST_TIMEOUT_MS } from '../config.js';
import { useFleetStore, queueTruckUpdate, startFlushing } from '../store/useFleetStore.js';

const RETRY_MS = [1000, 2000, 4000, 8000];

// Fetches the full snapshot, retrying with backoff until it succeeds or a newer
// resync supersedes it. Returns a cancel function.
function startResync() {
  let cancelled = false;
  let timer = null;

  async function attempt(n) {
    const { applySnapshot, setSyncError } = useFleetStore.getState();
    const requestedAt = Date.now();
    try {
      const res = await fetch(`${API_URL}/api/trucks`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`The server answered ${res.status}`);
      const body = await res.json();
      if (!cancelled) applySnapshot(body, requestedAt);
    } catch (err) {
      if (cancelled) return;
      setSyncError(err.name === 'TimeoutError' ? 'The server did not respond in time' : err.message);
      timer = setTimeout(() => attempt(n + 1), RETRY_MS[Math.min(n, RETRY_MS.length - 1)]);
    }
  }

  attempt(0);
  return () => {
    cancelled = true;
    clearTimeout(timer);
  };
}

// One connection for the whole app. Resyncs the full snapshot on every (re)connect.
export function useSocket() {
  useEffect(() => {
    const stopFlushing = startFlushing();
    const { setConnection } = useFleetStore.getState();
    let cancelResync = () => {};

    const socket = io(API_URL, { timeout: REQUEST_TIMEOUT_MS });
    socket.on('connect', () => {
      setConnection('connected');
      cancelResync();
      cancelResync = startResync();
    });
    socket.on('disconnect', () => setConnection('reconnecting'));
    socket.on('connect_error', () => setConnection('reconnecting'));
    socket.on('truck:update', queueTruckUpdate);

    return () => {
      cancelResync();
      socket.close();
      stopFlushing();
    };
  }, []);
}
