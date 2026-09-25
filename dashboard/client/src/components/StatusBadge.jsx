import { STATUS_META } from '../lib/status.js';

export default function StatusBadge({ status }) {
  const meta = STATUS_META[status] ?? STATUS_META.normal;
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${meta.text}`}>
      <span aria-hidden className={`size-2 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
}
