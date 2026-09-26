// Single-choice filter as a row of joined buttons. options: [{ id, label, count? }].
export default function Segmented({ options, value, onChange, label }) {
  return (
    <div role="group" aria-label={label} className="no-scrollbar inline-flex max-w-full overflow-x-auto rounded-md border border-line-strong bg-surface p-0.5">
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.id)}
            className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[5px] px-2.5 text-[13px] whitespace-nowrap transition-colors ${
              on ? 'bg-ink text-white' : 'text-muted hover:bg-subtle hover:text-ink'
            }`}
          >
            {o.label}
            {o.count != null && <span className={on ? 'text-white/75' : 'text-faint'}>{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
