const KINDS = {
  LIVE_HW: {
    label: 'LIVE HW',
    title: 'From the truck hardware',
    className: 'border-hw bg-hw/15 text-hw',
  },
  SIM: {
    label: 'SIM',
    title: 'From the built-in simulator',
    className: 'border-line text-muted',
  },
  ESTIMATED: {
    label: 'ESTIMATED',
    title: 'Derived by a model, not measured',
    className: 'border-dashed border-muted text-muted',
  },
  MANUAL: {
    label: 'MANUAL',
    title: 'Entered by a person in the dashboard',
    className: 'border-line text-ink',
  },
  ML_MODEL: {
    label: 'ML MODEL',
    title: 'Scored by the maintenance model in the fleet server (trained on synthetic data)',
    className: 'border-dashed border-muted text-muted',
  },
  RULE_BASED: {
    label: 'RULE-BASED',
    title: 'Computed from threshold rules in rules.js',
    className: 'border-line text-muted',
  },
};

export default function ProvenanceBadge({ kind }) {
  const k = KINDS[kind];
  if (!k) return null;
  return (
    <span
      title={k.title}
      className={`inline-block rounded-[2px] border px-1.5 py-px font-cond text-[11px] font-medium leading-4 tracking-wide ${k.className}`}
    >
      {k.label}
    </span>
  );
}
