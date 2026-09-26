import { useFleetStore } from '../store/useFleetStore.js';

// Silent while everything is flowing. Speaks up only when this page has lost the fleet
// server, or the server says a data source has stopped, so a stale screen never looks live.
export default function ConnectionNotice() {
  const pipeline = useFleetStore((s) => s.pipeline);
  const connection = useFleetStore((s) => s.connection);

  let message = null;
  if (connection !== 'connected') {
    message = connection === 'connecting' ? 'Connecting to the fleet server…' : 'Connection lost. Reconnecting to the fleet server…';
  } else {
    // A hop with nothing to carry yet ("0 of 0 hardware trucks") is waiting, not failing.
    const down = (pipeline?.hops ?? []).filter((h) => h.status === 'down' && !/^0 of 0/.test(h.detail ?? ''));
    if (down.length) message = `No data from ${down.map((h) => h.label.toLowerCase()).join(' or ')}: ${down[0].detail ?? 'check the source'}`;
  }

  if (!message) return <span />;
  return (
    <p role="status" className="inline-flex min-w-0 items-center gap-2 truncate rounded-md bg-warn/10 px-2.5 py-1 text-[13px] font-medium text-warn">
      <span aria-hidden className="size-2 shrink-0 rounded-full bg-warn" />
      <span className="truncate">{message}</span>
    </p>
  );
}
