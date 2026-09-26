import { useId } from 'react';

// Shared control look: inputs, selects and textareas across every form.
export const CONTROL =
  'w-full rounded-md border border-line-strong bg-surface px-2.5 text-sm text-ink placeholder:text-faint transition-colors hover:border-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:bg-subtle disabled:text-muted aria-[invalid=true]:border-crit';

// Label + control (an input by default, or as="textarea" / as="select") + optional hint or error.
export default function Field({ label, hint, error, as = 'input', className = '', required, ...controlProps }) {
  const id = useId();
  const Control = as;
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-[13px] font-medium text-ink">
        {label}
        {required && (
          <span className="text-crit" aria-hidden>
            {' '}
            *
          </span>
        )}
      </label>
      <Control
        id={id}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`${CONTROL} ${as === 'textarea' ? 'min-h-16 resize-y py-1.5' : 'h-8'}`}
        {...controlProps}
      />
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-xs text-crit">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="mt-1 text-xs text-muted">
            {hint}
          </p>
        )
      )}
    </div>
  );
}
