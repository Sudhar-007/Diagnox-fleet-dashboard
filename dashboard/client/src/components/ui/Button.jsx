const VARIANTS = {
  default: 'border border-line text-ink hover:bg-panel-hi',
  primary: 'border border-ink bg-ink text-asphalt hover:bg-ink/85',
  danger: 'border border-crit bg-crit text-white hover:bg-crit/85',
  quiet: 'border border-transparent text-muted hover:text-ink hover:bg-panel-hi',
};

const SIZES = {
  sm: 'px-2.5 py-1 text-sm',
  md: 'px-3 py-1.5 text-[15px]',
};

export default function Button({ variant = 'default', size = 'sm', className = '', type = 'button', ...props }) {
  return (
    <button
      type={type}
      className={`inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[4px] font-medium disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...props}
    />
  );
}
