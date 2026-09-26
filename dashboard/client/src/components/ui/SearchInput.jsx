import { CONTROL } from './Field.jsx';

// Text filter with a visible label for screen readers and a one-click clear.
export default function SearchInput({ value, onChange, label, placeholder, className = 'w-64' }) {
  return (
    <div className={`relative ${className}`}>
      <label className="sr-only" htmlFor={`search-${label}`}>
        {label}
      </label>
      <svg
        aria-hidden
        viewBox="0 0 16 16"
        className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      >
        <circle cx="7" cy="7" r="4.5" />
        <path d="M10.5 10.5 14 14" strokeLinecap="round" />
      </svg>
      <input
        id={`search-${label}`}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`${CONTROL} h-8 pr-7 pl-8`}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="absolute top-1/2 right-1.5 flex size-5 -translate-y-1/2 items-center justify-center rounded text-muted hover:bg-subtle hover:text-ink"
        >
          <svg aria-hidden viewBox="0 0 16 16" className="size-3" stroke="currentColor" strokeWidth="1.8">
            <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </div>
  );
}
