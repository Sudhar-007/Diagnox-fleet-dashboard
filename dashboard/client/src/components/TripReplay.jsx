import { useEffect, useMemo, useRef, useState } from 'react';
import { CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet';
import { Line, LineChart, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import L from 'leaflet';

import Plate from './Plate.jsx';
import Button from './ui/Button.jsx';
import { API_URL } from '../config.js';
import { timeoutSignal } from '../lib/api.js';
import { formatDuration } from '../lib/format.js';
import { haversine } from '../lib/geo.js';
import { ATTRIBUTION, TILE_URL } from '../lib/mapTiles.js';
import { themeColor } from '../lib/theme.js';
import { parseTsMs } from '../lib/time.js';
import { placeText } from '../lib/trips.js';

const SPEEDS = [10, 30, 60];
const TICK_MS = 100;
const CHART_POINTS = 600;

function useTrip(tripId) {
  const [state, setState] = useState({ trip: null, error: null, loading: true, reload: 0 });
  useEffect(() => {
    setState((s) => ({ ...s, trip: null, error: null, loading: true }));
    const ctrl = new AbortController();
    const t = timeoutSignal(ctrl.signal);
    fetch(`${API_URL}/api/trips/${encodeURIComponent(tripId)}`, { signal: t.signal })
      .then((res) => {
        if (res.status === 404) throw new Error('This trip is no longer on the server (it restarted since).');
        if (!res.ok) throw new Error(`The server answered ${res.status}`);
        return res.json();
      })
      .then((body) => setState((s) => ({ ...s, trip: body.trip, loading: false })))
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setState((s) => ({
          ...s,
          loading: false,
          error: err.name === 'TimeoutError' ? 'The server did not respond in time.' : err.message,
        }));
      })
      .finally(t.done);
    return () => ctrl.abort();
  }, [tripId, state.reload]);
  return [state, () => setState((s) => ({ ...s, reload: s.reload + 1 }))];
}

function FitPath({ positions, tripId }) {
  const map = useMap();
  useEffect(() => {
    if (positions.length > 1) map.fitBounds(positions, { padding: [30, 30], animate: false });
    // Refit only when another trip is opened, not while scrubbing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId, map]);
  return null;
}

function iconFor(truckId) {
  const span = document.createElement('span');
  span.className = 'truck-pin__plate';
  span.textContent = truckId;
  return L.divIcon({
    className: 'truck-pin truck-pin--replay',
    html: `<span class="truck-pin__dot"></span>${span.outerHTML}`,
    iconSize: [72, 20],
    iconAnchor: [8, 10],
  });
}

// First row index at or after telemetry time `t` (rows ascending by time).
function indexAt(times, t) {
  let lo = 0;
  let hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export default function TripReplay({ tripId }) {
  const [{ trip, error, loading }, reload] = useTrip(tripId);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(30);
  const idxRef = useRef(0);
  idxRef.current = idx;

  const data = useMemo(() => {
    if (!trip?.path) return null;
    const col = Object.fromEntries(trip.path.fields.map((f, i) => [f, i]));
    const rows = trip.path.rows;
    const times = rows.map((r) => r[col.t_ms]);
    const positions = rows
      .map((r) => [r[col.latitude], r[col.longitude]])
      .map((p) => (Number.isFinite(p[0]) && Number.isFinite(p[1]) ? p : null));
    const km = [0];
    let last = null;
    for (let i = 0; i < rows.length; i++) {
      if (i > 0) km.push(km[i - 1]);
      const p = positions[i];
      if (p && last) km[i] += haversine(last[0], last[1], p[0], p[1]) / 1000;
      if (p) last = p;
    }
    const step = Math.max(1, Math.ceil(rows.length / CHART_POINTS));
    const chart = rows.filter((_, i) => i % step === 0).map((r) => ({ t: r[col.t_ms], speed: r[col.speed] }));
    const alertMarks = (trip.alerts ?? []).map((a) => ({ ...a, index: indexAt(times, parseTsMs(a.opened_at)) }));
    return { col, rows, times, positions, km, chart, alertMarks, drawn: positions.filter(Boolean), icon: iconFor(trip.truck_id) };
  }, [trip]);

  useEffect(() => {
    setIdx(0);
    setPlaying(false);
  }, [tripId]);

  useEffect(() => {
    if (!playing || !data) return undefined;
    const id = setInterval(() => {
      const from = Math.min(idxRef.current, data.rows.length - 1);
      const next = indexAt(data.times, data.times[from] + speed * TICK_MS);
      const clamped = Math.min(Math.max(next, from + 1), data.rows.length - 1);
      setIdx(clamped);
      if (clamped >= data.rows.length - 1) setPlaying(false);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [playing, speed, data]);

  if (loading) return <p className="text-[15px] text-muted">Loading the trip…</p>;
  if (error) return <p className="text-[15px] text-crit">{error}</p>;
  if (!data || data.rows.length === 0) {
    return <p className="text-[15px] text-muted">This trip's path is no longer kept (only the newest paths are stored).</p>;
  }

  const { col, rows, times, positions, km, chart, alertMarks, drawn, icon } = data;
  if (drawn.length === 0) {
    return <p className="text-[15px] text-muted">No GPS fix was received during this trip, so there is no path to replay.</p>;
  }
  // A reloaded running trip can come back shorter (it ended where the truck stopped).
  const i = Math.min(idx, rows.length - 1);
  const row = rows[i];
  const here = positions[i] ?? drawn[0];
  const travelled = positions.slice(0, i + 1).filter(Boolean);
  const at = new Date(times[i]).toLocaleTimeString('en-GB', { hour12: false });
  const value = (f, digits = 0) => (typeof row[col[f]] === 'number' ? row[col[f]].toFixed(digits) : 'n/a');
  const readout = [
    ['Time', at],
    ['Since start', formatDuration((times[i] - times[0]) / 1000)],
    ['Speed', `${value('speed')} km/h`],
    ['Distance so far', `${km[i].toFixed(2)} km`],
    ['Engine speed', `${value('rpm')} rpm`],
    ['Engine load', `${value('engine_load')} %`],
    ['Coolant', `${value('coolant_temp', 1)} °C`],
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[15px]">
        <Plate truckId={trip.truck_id} size="sm" />
        <span className="text-ink">{trip.driver_name}</span>
        <span className="text-muted">
          {placeText(trip.from_zone, trip.start_position)} to{' '}
          {trip.status === 'active' ? 'still driving' : placeText(trip.to_zone, trip.end_position)}
        </span>
        <span className="text-muted">
          {trip.distance_km.toFixed(1)} km in {formatDuration(trip.duration_s)}
        </span>
        {trip.status === 'active' && (
          <Button onClick={reload}>Load the latest readings</Button>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="fleet-map h-[440px] overflow-hidden rounded-md border border-line">
          <MapContainer className="h-full w-full" center={here} zoom={13}>
            <TileLayer url={TILE_URL} attribution={ATTRIBUTION} maxZoom={19} />
            <FitPath positions={drawn} tripId={tripId} />
            <Polyline positions={drawn} pathOptions={{ color: themeColor('muted'), weight: 3, opacity: 0.6, dashArray: '4 6' }} interactive={false} />
            <Polyline positions={travelled} pathOptions={{ color: themeColor('ink'), weight: 4, opacity: 0.9 }} interactive={false} />
            {alertMarks.map((a) =>
              positions[a.index] ? (
                <CircleMarker
                  key={a.id}
                  center={positions[a.index]}
                  radius={7}
                  pathOptions={{ color: themeColor(a.level === 'critical' ? 'crit' : 'warn'), weight: 2, fillOpacity: 0.5 }}
                  eventHandlers={{ click: () => setIdx(a.index) }}
                >
                  <Tooltip>{`${a.name}, ${a.opened_at.slice(11)}`}</Tooltip>
                </CircleMarker>
              ) : null,
            )}
            <Marker position={here} icon={icon} interactive={false} />
          </MapContainer>
        </div>

        <dl className="grid content-start gap-x-4 gap-y-2 rounded-md border border-line bg-panel p-4 text-[15px] sm:grid-cols-[auto_1fr] lg:grid-cols-1">
          {readout.map(([k, v]) => (
            <div key={k}>
              <dt className="text-sm text-muted">{k}</dt>
              <dd className="font-cond text-xl font-semibold text-ink">{v}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="rounded-md border border-line bg-panel p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={() => (i >= rows.length - 1 ? (setIdx(0), setPlaying(true)) : setPlaying((p) => !p))}>
            {playing ? 'Pause' : i >= rows.length - 1 ? 'Play again' : 'Play'}
          </Button>
          <div className="flex gap-1" role="group" aria-label="Playback speed">
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={speed === s}
                onClick={() => setSpeed(s)}
                className={`rounded-[4px] px-2 py-1 text-sm ${speed === s ? 'bg-panel-hi text-ink' : 'text-muted hover:text-ink'}`}
              >
                {s}x
              </button>
            ))}
          </div>
          <span className="ml-auto text-sm text-muted">
            Reading {i + 1} of {rows.length}
          </span>
        </div>
        <label htmlFor="replay-scrub" className="sr-only">
          Position in trip
        </label>
        <input
          id="replay-scrub"
          type="range"
          min={0}
          max={rows.length - 1}
          value={i}
          onChange={(e) => {
            setPlaying(false);
            setIdx(Number(e.target.value));
          }}
          className="mt-3 w-full accent-plate"
        />
        <div className="mt-2 h-24" aria-hidden>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chart} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} hide />
              <YAxis width={36} tick={{ fill: themeColor('muted'), fontSize: 11 }} axisLine={false} tickLine={false} />
              <Line dataKey="speed" dot={false} stroke={themeColor('muted')} strokeWidth={1.5} isAnimationActive={false} />
              <ReferenceLine x={times[i]} stroke={themeColor('ink')} strokeWidth={1.5} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p className="text-xs text-faint">Speed over the trip (km/h). The line marks the replay position.</p>
      </div>

      {alertMarks.length > 0 && (
        <div className="rounded-md border border-line bg-panel p-4">
          <h3 className="text-[15px] font-medium text-ink">Alerts during this trip</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {alertMarks.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => {
                    setPlaying(false);
                    setIdx(a.index);
                  }}
                  className={`underline decoration-line underline-offset-4 hover:decoration-ink ${a.level === 'critical' ? 'text-crit' : 'text-warn'}`}
                >
                  {a.opened_at.slice(11)} {a.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
