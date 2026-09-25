import { useEffect } from 'react';
import { io } from 'socket.io-client';

import { API_URL, REQUEST_TIMEOUT_MS, TRAIL_POINTS } from '../config.js';
import {
  useFleetStore,
  beginAlertResync,
  queueAlertChange,
  queueTruckUpdate,
  startFlushing,
} from '../store/useFleetStore.js';

const RETRY_MS = [1000, 2000, 4000, 8000];

// Best effort: a failed trail fetch just means the trail builds up from live updates.
function loadTrails(truckIds, isCancelled) {
  for (const id of truckIds) {
    fetch(`${API_URL}/api/trucks/${encodeURIComponent(id)}/history?limit=${TRAIL_POINTS}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (body && !isCancelled()) useFleetStore.getState().seedTrail(id, body.points);
      })
      .catch(() => {});
  }
}

async function getJson(path) {
  const res = await fetch(`${API_URL}${path}`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`The server answered ${res.status}`);
  return res.json();
}

// Fetches the full snapshot, retrying with backoff until it succeeds or a newer
// resync supersedes it. Returns a cancel function.
function startResync() {
  let cancelled = false;
  let timer = null;
  beginAlertResync();

  async function attempt(n) {
    const { applySnapshot, setSyncError } = useFleetStore.getState();
    const requestedAt = Date.now();
    try {
      const [body, alertBody, eventBody] = await Promise.all([
        getJson('/api/trucks'),
        getJson('/api/alerts'),
        getJson('/api/alerts/events?limit=500'),
      ]);
      if (cancelled) return;
      useFleetStore.getState().applyAlerts({ alerts: alertBody.alerts, events: eventBody.events });
      applySnapshot(body, requestedAt);
      loadTrails(
        body.trucks.map((t) => t.truck_id),
        () => cancelled,
      );
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
    socket.on('alert:new', queueAlertChange);
    socket.on('alert:update', queueAlertChange);

    return () => {
      cancelResync();
      socket.close();
      stopFlushing();
    };
  }, []);
}
