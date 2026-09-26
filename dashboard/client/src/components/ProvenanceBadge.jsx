const KINDS = {
  LIVE_HW: {
    label: 'LIVE HW',
    title: 'From the truck hardware',
    className: 'border-hw/40 bg-hw/8 text-hw',
  },
  SIM: {
    label: 'SIM',
    title: 'From the built-in simulator',
    className: 'border-line-strong text-muted',
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
  VIRTUAL_POSITION: {
    label: 'SIM POSITION',
    title: "Bench board: the position is generated along a road route from the board's reported speed. Every reading is live from the board.",
    className: 'border-dashed border-hw/60 text-hw',
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
      className={`inline-block shrink-0 rounded-[3px] border px-1 text-[10.5px] leading-4 font-semibold tracking-[0.02em] ${k.className}`}
    >
      {k.label}
    </span>
  );
}
