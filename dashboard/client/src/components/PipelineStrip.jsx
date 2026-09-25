import { Fragment } from 'react';

import { useFleetStore } from '../store/useFleetStore.js';

const DOT = { ok: 'bg-ok', degraded: 'bg-warn', down: 'bg-crit', unknown: 'bg-idle' };

function Hop({ label, status, detail }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap" title={detail}>
      <span aria-hidden className={`size-2 rounded-full ${DOT[status] ?? DOT.unknown}`} />
      <span className={status === 'ok' ? 'text-muted' : 'text-ink'}>{label}</span>
      <span className="sr-only">
        {status}
        {detail ? `, ${detail}` : ''}
      </span>
    </span>
  );
}

// Where the data travels before it reaches this page, one dot per hop.
// Server hops come from pipeline:status; the last hop is this browser's own connection.
export default function PipelineStrip() {
  const pipeline = useFleetStore((s) => s.pipeline);
  const connection = useFleetStore((s) => s.connection);
  const connected = connection === 'connected';

  // While disconnected the server's last report is out of date, so show it as unknown.
  const serverHops = (pipeline?.hops ?? [{ id: 'bff', label: 'BFF' }]).map((h) => ({
    ...h,
    status: connected ? h.status : 'unknown',
  }));
  const uiHop = {
    id: 'ui',
    label: connected ? 'UI' : connection === 'connecting' ? 'Connecting…' : 'Reconnecting…',
    status: connected ? 'ok' : 'down',
    detail: connected ? 'Live updates connected' : 'Trying to reach the fleet server',
  };
  const hops = [...serverHops, uiHop];

  return (
    <div role="status" aria-label="Data pipeline" className="flex min-w-0 items-center gap-2 overflow-x-auto text-sm">
      {hops.map((h, i) => (
        <Fragment key={h.id}>
          {i > 0 && <span aria-hidden className="h-px w-4 shrink-0 bg-line" />}
          <Hop label={h.label} status={h.status} detail={h.detail} />
        </Fragment>
      ))}
      {connected && pipeline?.latency_ms != null && (
        <span className="ml-2 whitespace-nowrap text-muted" title="Now minus the newest hardware timestamp">
          Latency {(pipeline.latency_ms / 1000).toFixed(1)} s
        </span>
      )}
    </div>
  );
}
