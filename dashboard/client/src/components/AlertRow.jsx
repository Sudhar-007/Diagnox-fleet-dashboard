import AlertActions from './AlertActions.jsx';
import ProvenanceBadge from './ProvenanceBadge.jsx';
import { Link } from 'react-router-dom';

import { alertText, formatPosition, resolutionText } from '../lib/alerts.js';
import { formatClock, formatDuration } from '../lib/format.js';
import { useFleetStore } from '../store/useFleetStore.js';

const LEVEL_DOT = { critical: 'bg-crit', warning: 'bg-warn' };

const STATUS_STYLE = {
  ACTIVE: { critical: 'border-crit/40 bg-crit/5 text-crit', warning: 'border-warn/40 bg-warn/5 text-warn' },
  ACKNOWLEDGED: 'border-line-strong text-muted',
  RESOLVED: 'border-line text-faint',
};

const STATUS_LABEL = { ACTIVE: 'Active', ACKNOWLEDGED: 'Acknowledged', RESOLVED: 'Resolved' };

function StatusChip({ alert }) {
  const style = STATUS_STYLE[alert.status];
  const cls = typeof style === 'string' ? style : style[alert.level];
  return (
    <span className={`rounded-[3px] border px-1.5 text-xs leading-5 font-medium ${cls}`}>{STATUS_LABEL[alert.status] ?? alert.status}</span>
  );
}

// What the server currently knows about the condition behind an open alert.
function ConditionNote({ alert, live }) {
  switch (alert.condition) {
    case 'firing':
      return (
        <span>
          Now {live ?? alert.last_value} {alert.unit}
        </span>
      );
    case 'within':
      return <span className="text-ok">Back within limits, closes on its own if it stays there</span>;
    case 'unknown':
      return <span>Cannot be judged right now (engine off or no reading)</span>;
    case 'no_data':
      return <span className="text-idle">No data from the truck; stays open until it reports or is resolved</span>;
    default:
      return null;
  }
}

function ZoneConditionNote({ alert }) {
  switch (alert.condition) {
    case 'firing':
      return (
        <span>
          Now {alert.last_value} m from centre, {alert.zone_type === 'restricted' ? 'still inside' : 'still outside'}
        </span>
      );
    case 'unknown':
      return <span>No GPS fix right now</span>;
    case 'no_data':
      return <span className="text-idle">No data from the truck; stays open until it reports or is resolved</span>;
    default:
      return null;
  }
}

export default function AlertRow({ alert, actions = true }) {
  const now = useFleetStore((s) => s.now);
  const clockOffsetMs = useFleetStore((s) => s.clockOffsetMs);
  const truck = useFleetStore((s) => s.trucks[alert.truck_id]);
  const open = alert.status !== 'RESOLVED';
  const live = truck?.[alert.field];

  return (
    <li
      className={`border-l-[3px] px-4 py-3 ${
        alert.kind === 'sos' && open ? 'border-crit bg-crit/5' : alert.level === 'critical' && alert.status === 'ACTIVE' ? 'border-crit/60' : 'border-transparent'
      }`}
    >
      <div className="flex items-start gap-3">
        <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${LEVEL_DOT[alert.level] ?? 'bg-idle'}`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
            <p className={`text-sm ${alert.kind === 'sos' && open ? 'font-semibold text-crit' : 'font-medium text-ink'}`}>
              {alert.kind === 'sos' && <span className="mr-2 rounded-[3px] bg-crit px-1.5 py-px text-xs font-semibold text-white">SOS</span>}
              {alertText(alert)}
            </p>
            <div className="flex shrink-0 items-center gap-2">
              <StatusChip alert={alert} />
              <ProvenanceBadge kind={alert.source} />
            </div>
          </div>

          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[13px] text-muted">
            {alert.driver_name && <span>{alert.driver_name}</span>}
            {open ? (
              <span>Open for {formatDuration((now + clockOffsetMs - alert.opened_ms) / 1000)}</span>
            ) : (
              <span>Open for {formatDuration((alert.resolved_ms - alert.opened_ms) / 1000)}</span>
            )}
            {alert.peak_value !== alert.value &&
              (alert.kind === 'geofence' ? (
                <span>
                  {alert.zone_type === 'restricted' ? 'Closest' : 'Farthest'} {alert.peak_value} m from centre
                </span>
              ) : (
                <span>
                  Worst {alert.peak_value} {alert.unit}
                </span>
              ))}
            {open && alert.kind === 'health' && (
              <ConditionNote alert={alert} live={typeof live === 'number' ? live : null} />
            )}
            {open && alert.kind === 'geofence' && <ZoneConditionNote alert={alert} />}
          </div>

          {alert.kind === 'geofence' && (
            <p className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[13px] text-muted">
              <span>
                {alert.zone_type === 'restricted' ? 'Restricted zone' : 'Allowed zone'} {alert.zone_name}
              </span>
              <Link
                to={`/live?truck=${encodeURIComponent(alert.truck_id)}`}
                className="font-medium text-accent hover:underline"
              >
                View on map
              </Link>
            </p>
          )}

          {alert.kind === 'sos' && (
            <p className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[13px] text-muted">
              <span>
                Last position {formatPosition(alert.latitude, alert.longitude)} at {formatClock(alert.location_at)}
              </span>
              <Link
                to={`/live?truck=${encodeURIComponent(alert.truck_id)}`}
                className="font-medium text-accent hover:underline"
              >
                View on map
              </Link>
              {alert.raised_by && <span>Raised by {alert.raised_by}</span>}
            </p>
          )}

          {alert.acknowledged_at && (
            <p className="mt-1 text-[13px] text-muted">
              Acknowledged{alert.acknowledged_by ? ` by ${alert.acknowledged_by}` : ''} at {alert.acknowledged_at.slice(11)}
              {alert.ack_note && <span className="text-ink">: {alert.ack_note}</span>}
            </p>
          )}
          {alert.resolved_at && (
            <p className="mt-1 text-[13px] text-muted">
              {alert.resolution === 'manual'
                ? `Resolved${alert.resolved_by ? ` by ${alert.resolved_by}` : ''} at ${alert.resolved_at.slice(11)}`
                : `${resolutionText(alert)} at ${alert.resolved_at.slice(11)}`}
              {alert.resolve_note && <span className="text-ink">: {alert.resolve_note}</span>}
            </p>
          )}

          {actions && <AlertActions alert={alert} />}
        </div>
      </div>
    </li>
  );
}
