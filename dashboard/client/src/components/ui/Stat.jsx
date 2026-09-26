// A labelled figure. Sized to be read at a glance, not to dominate the page.
export default function Stat({ label, value, unit, tone = 'text-ink', note }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5">
        <span className={`font-display text-xl leading-6 font-semibold ${tone}`}>{value}</span>
        {unit && <span className="ml-1 text-[13px] text-muted">{unit}</span>}
        {note && <span className="ml-1.5 text-xs text-muted">{note}</span>}
      </dd>
    </div>
  );
}
