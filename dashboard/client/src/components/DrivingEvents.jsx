import { Link } from 'react-router-dom';

import Plate from './Plate.jsx';
import { EmptyState } from './ui/Panel.jsx';
import { EVENT_LABEL, eventDetail } from '../lib/driving.js';
import { startText } from '../lib/trips.js';
import { useFleetStore } from '../store/useFleetStore.js';

// A harsh event costs its points; overspeed and idling add to the trip's total time, which is
// charged per whole minute.
function Cost({ event }) {
  if (event.points != null) return `${event.points} ${event.points === 1 ? 'pt' : 'pts'}`;
  return <span className="text-muted">Per minute, in the trip total</span>;
}

// Driver behaviour events, newest first, each with the points it cost.
export default function DrivingEvents({ events, showDriver = true, empty }) {
  const trips = useFleetStore((s) => s.trips);
  const now = useFleetStore((s) => s.now);
  const clockOffsetMs = useFleetStore((s) => s.clockOffsetMs);
  if (!events) return <EmptyState>Loading events…</EmptyState>;
  if (events.length === 0) return <EmptyState>{empty}</EmptyState>;

  return (
    <table className="w-full min-w-[820px] text-left text-sm">
      <thead className="border-b border-line text-muted">
        <tr>
          <th className="px-4 py-2 font-normal">When</th>
          <th className="px-4 py-2 font-normal">Event</th>
          <th className="px-4 py-2 font-normal">What happened</th>
          {showDriver && <th className="px-4 py-2 font-normal">Driver</th>}
          <th className="px-4 py-2 font-normal">Trip</th>
          <th className="px-4 py-2 text-right font-normal">Cost</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {events.map((e) => {
          const trip = e.trip_id ? trips?.[e.trip_id] : null;
          return (
            <tr key={e.id} className="align-top">
              <td className="whitespace-nowrap px-4 py-2.5 text-ink">{startText(e.start_at, now + clockOffsetMs)}</td>
              <td className="whitespace-nowrap px-4 py-2.5">
                <span className={e.type === 'harsh_brake' || e.type === 'overspeed' ? 'text-warn' : 'text-ink'}>{EVENT_LABEL[e.type]}</span>
                {e.ongoing && <div className="text-xs text-muted">still going</div>}
              </td>
              <td className="px-4 py-2.5 text-ink">{eventDetail(e)}</td>
              {showDriver && (
                <td className="px-4 py-2.5">
                  <div className="text-ink">{e.driver_name ?? <span className="text-faint">No driver</span>}</div>
                  <div className="mt-1">
                    <Plate truckId={e.truck_id} size="sm" />
                  </div>
                </td>
              )}
              <td className="whitespace-nowrap px-4 py-2.5">
                {trip ? (
                  <Link
                    to={`/trips?tab=replay&trip=${encodeURIComponent(trip.id)}`}
                    className="text-ink underline decoration-line underline-offset-4 hover:decoration-ink"
                  >
                    Replay {startText(trip.start_at, now + clockOffsetMs)}
                  </Link>
                ) : (
                  <span className="text-faint">Outside a trip</span>
                )}
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 text-right text-ink">
                <Cost event={e} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
