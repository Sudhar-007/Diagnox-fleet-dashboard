import { useFleetStore } from '../store/useFleetStore.js';

const STATES = {
  connecting: { label: 'Connecting…', dot: 'bg-idle' },
  connected: { label: 'Connected', dot: 'bg-ok' },
  reconnecting: { label: 'Reconnecting…', dot: 'bg-crit' },
};

export default function ConnectionState() {
  const connection = useFleetStore((s) => s.connection);
  const s = STATES[connection] ?? STATES.connecting;
  return (
    <span className="inline-flex items-center gap-2 text-sm text-muted" role="status">
      <span aria-hidden className={`size-2 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}
