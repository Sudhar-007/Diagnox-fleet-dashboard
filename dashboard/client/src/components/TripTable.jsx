import { Link } from 'react-router-dom';

import Plate from './Plate.jsx';
import { EmptyState } from './ui/Panel.jsx';
import { formatDuration } from '../lib/format.js';
import { scoreTone } from '../lib/driving.js';
import { placeText, startText } from '../lib/trips.js';
import { useFleetStore } from '../store/useFleetStore.js';

function AlertCount({ alerts }) {
  if (!alerts?.length) return <span className="text-faint">None</span>;
  const critical = alerts.some((a) => a.level === 'critical');
  return (
    <span className={critical ? 'text-crit' : 'text-warn'} title={alerts.map((a) => a.name).join(', ')}>
      {alerts.length} {alerts.length === 1 ? 'alert' : 'alerts'}
    </span>
  );
}

// Score with the number of events that cost points; sparse readings get no score.
function DrivingScore({ driving }) {
  if (!driving) return <span className="text-faint">Not rated</span>;
  if (driving.score == null) return <span className="text-faint">Readings too sparse</span>;
  return (
    <span>
      <span className={`font-medium ${scoreTone(driving.score)}`}>{driving.score}</span>
      {driving.events > 0 && (
        <span className="text-muted">
          , {driving.events} {driving.events === 1 ? 'event' : 'events'}
        </span>
      )}
    </span>
  );
}

// A zone name reads as a place; bare coordinates stay quiet.
function Place({ zone, position }) {
  return <div className={zone ? 'text-ink' : 'text-muted'}>{placeText(zone, position)}</div>;
}

// Detected trips. Running trips show time so far; `showTruck` adds truck and driver columns.
export default function TripTable({ trips, showTruck = true, empty }) {
  const now = useFleetStore((s) => s.now);
  const clockOffsetMs = useFleetStore((s) => s.clockOffsetMs);
  if (trips.length === 0) return <EmptyState>{empty}</EmptyState>;
  const serverNow = now + clockOffsetMs;

  return (
    <table className="w-full min-w-[980px] text-left text-sm">
      <thead className="border-b border-line text-muted">
        <tr>
          {showTruck && <th className="px-4 py-2 font-normal">Truck</th>}
          <th className="px-4 py-2 font-normal">Started</th>
          <th className="px-4 py-2 font-normal">Duration</th>
          <th className="px-4 py-2 font-normal">Distance</th>
          <th className="px-4 py-2 font-normal">Speed avg / max</th>
          <th className="px-4 py-2 font-normal">From / to</th>
          <th className="px-4 py-2 font-normal">During the trip</th>
          <th className="px-4 py-2 font-normal">Driving score</th>
          <th className="px-4 py-2 font-normal">
            <span className="sr-only">Replay</span>
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {trips.map((t) => {
          const active = t.status === 'active';
          return (
            <tr key={t.id} className="align-top">
              {showTruck && (
                <td className="px-4 py-2.5">
                  <Plate truckId={t.truck_id} size="sm" />
                  <div className="mt-1 text-muted">{t.driver_name}</div>
                </td>
              )}
              <td className="whitespace-nowrap px-4 py-2.5 text-ink">
                {startText(t.start_at, serverNow)}
                {t.from_first_reading && <div className="text-xs text-faint">history starts here</div>}
              </td>
              <td className="whitespace-nowrap px-4 py-2.5">
                {active ? (
                  <>
                    <span className="text-ink">{formatDuration((serverNow - t.start_ms) / 1000)}</span>
                    <div className="text-xs text-ok">on the road</div>
                  </>
                ) : (
                  <>
                    <span className="text-ink">{formatDuration(t.duration_s)}</span>
                    <div className="text-xs text-muted">
                      ended {t.end_at.slice(11, 16)}
                      {t.end_reason === 'no_data' ? ', data stopped' : ''}
                    </div>
                  </>
                )}
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 text-ink">{t.distance_km.toFixed(1)} km</td>
              <td className="whitespace-nowrap px-4 py-2.5 text-ink">
                {t.avg_speed ?? ''} / {t.max_speed} <span className="text-muted">km/h</span>
              </td>
              <td className="px-4 py-2.5">
                <Place zone={t.from_zone} position={t.start_position} />
                {active ? <div className="text-muted">still driving</div> : <Place zone={t.to_zone} position={t.end_position} />}
              </td>
              <td className="px-4 py-2.5">
                <AlertCount alerts={t.alerts} />
              </td>
              <td className="px-4 py-2.5">
                <DrivingScore driving={t.driving} />
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 text-right">
                {t.has_path !== false ? (
                  <Link
                    to={`/trips?tab=replay&trip=${encodeURIComponent(t.id)}`}
                    className="text-ink underline decoration-line underline-offset-4 hover:decoration-ink"
                  >
                    Replay
                  </Link>
                ) : (
                  <span className="text-faint">Path no longer kept</span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
