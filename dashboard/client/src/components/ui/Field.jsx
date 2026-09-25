import { useId } from 'react';

const CONTROL =
  'w-full rounded-[4px] border border-line bg-asphalt px-2.5 py-1.5 text-[15px] text-ink placeholder:text-faint focus:border-muted focus:outline-none';

// Label + control (an input by default, or as="textarea" / as="select") + optional hint.
export default function Field({ label, hint, as = 'input', className = '', ...controlProps }) {
  const id = useId();
  const Control = as;
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-sm text-muted">
        {label}
      </label>
      <Control id={id} className={`${CONTROL} ${as === 'textarea' ? 'min-h-16 resize-y' : ''}`} {...controlProps} />
      {hint && <p className="mt-1 text-xs text-faint">{hint}</p>}
    </div>
  );
}
