import { STATUS_META } from '../lib/status.js';

// Truck status: dot + word, so it never relies on colour alone. An open SOS outranks health.
export default function StatusBadge({ status, sos = false }) {
  if (sos) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold whitespace-nowrap text-crit">
        <span aria-hidden className="size-2 rounded-full bg-crit ring-2 ring-crit/25" />
        SOS
      </span>
    );
  }
  const meta = STATUS_META[status] ?? STATUS_META.normal;
  return (
    <span className={`inline-flex items-center gap-1.5 text-[13px] font-medium whitespace-nowrap ${meta.text}`}>
      <span aria-hidden className={`size-2 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
}
