// One button family. primary: the main action of a view (at most one per group).
// default: secondary actions. danger: destructive or emergency. quiet: low-emphasis inline actions.
const VARIANTS = {
  default: 'border border-line-strong bg-surface text-ink hover:bg-subtle',
  primary: 'border border-accent bg-accent text-accent-ink hover:bg-accent/90',
  danger: 'border border-crit bg-crit text-white hover:bg-crit/90',
  dangerOutline: 'border border-crit/50 bg-surface text-crit hover:bg-crit/5',
  quiet: 'border border-transparent text-muted hover:bg-subtle hover:text-ink',
};

const SIZES = {
  sm: 'h-7 px-2.5 text-[13px]',
  md: 'h-8 px-3 text-sm',
};

export default function Button({ variant = 'default', size = 'sm', className = '', type = 'button', ...props }) {
  return (
    <button
      type={type}
      className={`inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...props}
    />
  );
}

// Same look as Button, for navigation (react-router Link or <a>).
export function buttonClass(variant = 'default', size = 'sm') {
  return `inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors ${VARIANTS[variant]} ${SIZES[size]}`;
}
