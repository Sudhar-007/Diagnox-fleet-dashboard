import { useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';

import Plate from './Plate.jsx';
import StatusBadge from './StatusBadge.jsx';
import ProvenanceBadge from './ProvenanceBadge.jsx';
import TriggerSosButton from './TriggerSosButton.jsx';
import { useFleetStore } from '../store/useFleetStore.js';
import { useTruckStatus } from '../lib/useTruckStatus.js';
import { formatAgo, formatNumber } from '../lib/format.js';
import { isValidPosition } from '../lib/position.js';

const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
// Initial view before the first trucks report (central Chennai).
const DEFAULT_CENTER = [13.05, 80.24];
const DEFAULT_ZOOM = 11;

const TRAIL_TOKEN = {
  normal: '--color-ok',
  warning: '--color-warn',
  critical: '--color-crit',
  stale: '--color-idle',
  offline: '--color-idle',
};

// Leaflet writes colours into SVG attributes, which cannot resolve CSS variables,
// so read the theme values once.
let trailColors = null;
function trailColor(status) {
  if (!trailColors) {
    const css = getComputedStyle(document.documentElement);
    trailColors = Object.fromEntries(
      Object.entries(TRAIL_TOKEN).map(([s, token]) => [s, css.getPropertyValue(token).trim()]),
    );
  }
  return trailColors[status] || trailColors.stale;
}

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const iconCache = new Map();
function truckIcon(truckId, status, selected, sos) {
  const key = `${truckId}|${status}|${selected}|${sos}`;
  if (!iconCache.has(key)) {
    iconCache.set(
      key,
      L.divIcon({
        className: `truck-pin truck-pin--${status}${selected ? ' truck-pin--selected' : ''}${sos ? ' truck-pin--sos' : ''}`,
        html: `<span class="truck-pin__dot"></span><span class="truck-pin__plate">${escapeHtml(truckId)}</span>${
          sos ? '<span class="truck-pin__sos">SOS</span>' : ''
        }`,
        iconSize: [72, 20],
        iconAnchor: [8, 10],
        popupAnchor: [0, -10],
      }),
    );
  }
  return iconCache.get(key);
}

function hasPosition(t) {
  return isValidPosition(t.latitude, t.longitude);
}

function PlainAttributionPrefix() {
  const map = useMap();
  useEffect(() => {
    map.attributionControl?.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
  }, [map]);
  return null;
}

// Fits the map to all trucks whenever the set of trucks changes, until the user pans or
// zooms; `fitSignal` forces a fit to current positions and hands control back to auto-fit.
function FitToTrucks({ positions, truckKey, fitSignal }) {
  const map = useMap();
  const latest = useRef(positions);
  latest.current = positions;
  const userMoved = useRef(false);
  const fitting = useRef(false);
  const lastSignal = useRef(fitSignal);

  useEffect(() => {
    const onUserMove = () => {
      if (!fitting.current) userMoved.current = true;
    };
    map.on('dragstart zoomstart', onUserMove);
    return () => map.off('dragstart zoomstart', onUserMove);
  }, [map]);

  useEffect(() => {
    if (lastSignal.current !== fitSignal) userMoved.current = false;
    lastSignal.current = fitSignal;
    if (latest.current.length === 0 || userMoved.current) return;
    // Not animated, so the move events fire synchronously and are not mistaken for the user.
    fitting.current = true;
    map.fitBounds(latest.current, { padding: [40, 40], maxZoom: 14, animate: false });
    fitting.current = false;
  }, [truckKey, fitSignal, map]);

  return null;
}

function FlyToSelected({ truck }) {
  const map = useMap();
  const lastId = useRef(null);
  useEffect(() => {
    if (!truck) {
      lastId.current = null;
      return;
    }
    if (lastId.current === truck.truck_id || !hasPosition(truck)) return;
    map.flyTo([truck.latitude, truck.longitude], Math.max(map.getZoom(), 14), { duration: 0.6 });
    lastId.current = truck.truck_id;
  }, [truck, map]);
  return null;
}

function TruckLayer({ truck, trail, selected, onSelect, compact }) {
  const { age, status } = useTruckStatus(truck);
  const markerRef = useRef(null);
  const sos = useFleetStore((s) =>
    Object.values(s.alerts).some((a) => a.kind === 'sos' && a.truck_id === truck.truck_id && a.status !== 'RESOLVED'),
  );
  const icon = truckIcon(truck.truck_id, status, selected, sos);
  const path = useMemo(() => trail.map((p) => [p.lat, p.lng]), [trail]);

  useEffect(() => {
    if (compact) return;
    if (selected) markerRef.current?.openPopup();
    else markerRef.current?.closePopup();
  }, [selected, compact]);

  return (
    <>
      {path.length > 1 && (
        <Polyline
          positions={path}
          pathOptions={{ color: trailColor(status), weight: 4, opacity: 0.75 }}
          interactive={false}
        />
      )}
      <Marker
        ref={markerRef}
        position={[truck.latitude, truck.longitude]}
        icon={icon}
        eventHandlers={{ click: () => onSelect?.(truck.truck_id) }}
        keyboard
        title={`${truck.truck_id}, ${truck.driver_name}`}
      >
        {!compact && (
          <Popup closeButton={false} autoPan={false}>
            <div className="min-w-44 space-y-1.5">
              <div className="flex items-center justify-between gap-3">
                <Plate truckId={truck.truck_id} size="sm" />
                <StatusBadge status={status} />
              </div>
              <div className="text-ink">{truck.driver_name}</div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[13px]">
                <dt className="text-muted">Speed</dt>
                <dd className="text-ink">{formatNumber(truck.speed)} km/h</dd>
                <dt className="text-muted">Timestamp</dt>
                <dd className="text-ink">{truck.timestamp?.replace('T', ' ')}</dd>
                <dt className="text-muted">Last seen</dt>
                <dd className="text-ink">{formatAgo(age)}</dd>
              </dl>
              <div className="flex items-center justify-between gap-2">
                <ProvenanceBadge kind={truck.provenance} />
                <Link to={`/vehicles/${encodeURIComponent(truck.truck_id)}`} className="text-sm text-ink underline underline-offset-4">
                  Open vehicle
                </Link>
              </div>
              <div className="border-t border-line pt-2">
                <TriggerSosButton truckId={truck.truck_id} />
              </div>
            </div>
          </Popup>
        )}
      </Marker>
    </>
  );
}

export default function FleetMap({ trucks, selectedId = null, onSelect, fitSignal = 0, compact = false }) {
  const trails = useFleetStore((s) => s.trails);
  const placed = trucks.filter(hasPosition);
  const positions = placed.map((t) => [t.latitude, t.longitude]);
  // Auto-fit reacts to the set of trucks changing, not to every position update.
  const truckKey = placed.map((t) => t.truck_id).join(',');
  const selected = placed.find((t) => t.truck_id === selectedId);

  return (
    <MapContainer
      className="fleet-map h-full w-full"
      center={DEFAULT_CENTER}
      zoom={DEFAULT_ZOOM}
      zoomControl={!compact}
      scrollWheelZoom={!compact}
      attributionControl
    >
      <TileLayer url={TILE_URL} attribution={ATTRIBUTION} maxZoom={19} />
      <PlainAttributionPrefix />
      <FitToTrucks positions={positions} truckKey={truckKey} fitSignal={fitSignal} />
      {!compact && <FlyToSelected truck={selected} />}
      {placed.map((t) => (
        <TruckLayer
          key={t.truck_id}
          truck={t}
          trail={trails[t.truck_id] ?? []}
          selected={t.truck_id === selectedId}
          onSelect={onSelect}
          compact={compact}
        />
      ))}
    </MapContainer>
  );
}
