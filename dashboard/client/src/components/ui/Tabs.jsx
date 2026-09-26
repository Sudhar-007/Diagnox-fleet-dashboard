import { useRef } from 'react';

// Accessible tab bar. `tabs`: [{ id, label, count? }]. Arrow keys move between tabs.
export default function Tabs({ tabs, value, onChange, label }) {
  const refs = useRef({});
  const onKeyDown = (e, i) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = tabs[(i + step + tabs.length) % tabs.length];
    onChange(next.id);
    refs.current[next.id]?.focus();
  };

  return (
    <div role="tablist" aria-label={label} className="no-scrollbar mb-4 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-line">
      {tabs.map((t, i) => {
        const selected = t.id === value;
        return (
          <button
            key={t.id}
            ref={(el) => (refs.current[t.id] = el)}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={selected}
            aria-controls={`panel-${t.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={`shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors ${
              selected ? 'border-accent font-medium text-ink' : 'border-transparent text-muted hover:border-line-strong hover:text-ink'
            }`}
          >
            {t.label}
            {t.count != null && (
              <span className={`ml-1.5 rounded px-1.5 py-px text-xs ${selected ? 'bg-accent/10 text-accent' : 'bg-subtle text-muted'}`}>
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ id, children }) {
  return (
    <div role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`}>
      {children}
    </div>
  );
}
