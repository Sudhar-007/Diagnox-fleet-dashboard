import { Fragment } from 'react';
import { Circle, Marker, Popup } from 'react-leaflet';
import { Link } from 'react-router-dom';
import L from 'leaflet';

import { themeColor } from '../lib/theme.js';
import { zoneScope } from '../lib/zones.js';

const M_PER_DEG_LAT = 111_320;

function zoneStyle(zone) {
  return zone.type === 'restricted'
    ? { color: themeColor('crit'), weight: 2, fillColor: themeColor('crit'), fillOpacity: 0.12 }
    : { color: themeColor('ink'), weight: 1.5, dashArray: '6 5', fillColor: themeColor('ink'), fillOpacity: 0.04 };
}

const labelCache = new Map();
function labelIcon(zone) {
  const key = `${zone.type}|${zone.name}`;
  if (!labelCache.has(key)) {
    const span = document.createElement('span');
    span.textContent = zone.name;
    labelCache.set(
      key,
      L.divIcon({
        className: `zone-label zone-label--${zone.type}`,
        html: span.outerHTML,
        iconSize: null,
        iconAnchor: [0, 18],
      }),
    );
  }
  return labelCache.get(key);
}

// Geofence circles. The full map labels each zone at its north edge and opens a summary
// on click; the compact mini-map draws the circles only.
export default function ZoneLayer({ zones, compact = false }) {
  return zones.map((z) => {
    const center = [z.center_lat, z.center_lng];
    const north = [z.center_lat + z.radius_m / M_PER_DEG_LAT, z.center_lng];
    return (
      <Fragment key={z.id}>
        {!compact && <Marker position={north} icon={labelIcon(z)} interactive={false} keyboard={false} />}
        <Circle center={center} radius={z.radius_m} pathOptions={zoneStyle(z)} interactive={!compact}>
          {!compact && (
            <Popup closeButton={false} autoPan={false}>
              <div className="min-w-44 space-y-1">
                <div className="text-sm font-medium text-ink">{z.name}</div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[13px]">
                  <dt className="text-muted">Type</dt>
                  <dd className={z.type === 'restricted' ? 'text-crit' : 'text-ink'}>
                    {z.type === 'restricted' ? 'Restricted' : 'Allowed'}
                  </dd>
                  <dt className="text-muted">Radius</dt>
                  <dd className="text-ink">{z.radius_m} m</dd>
                  <dt className="text-muted">Alerts</dt>
                  <dd className="text-ink">{z.alert ? 'On' : 'Off, visits only'}</dd>
                  <dt className="text-muted">Applies to</dt>
                  <dd className="text-ink">{zoneScope(z)}</dd>
                </dl>
                <Link to={`/settings?zone=${encodeURIComponent(z.id)}`} className="text-[13px] font-medium text-accent hover:underline">
                  Edit in Settings
                </Link>
              </div>
            </Popup>
          )}
        </Circle>
      </Fragment>
    );
  });
}
