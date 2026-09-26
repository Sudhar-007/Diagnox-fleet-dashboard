// Bordered surface for one group of content. Header: title (+ optional count/description) and actions.
export default function Panel({
  as: Tag = 'section',
  title,
  description,
  actions,
  className = '',
  bodyClassName = 'p-4',
  children,
  ...props
}) {
  return (
    <Tag className={`rounded-lg border border-line bg-surface ${className}`} {...props}>
      {(title || actions) && (
        <header className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b border-line px-4 py-2">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold text-ink">{title}</h2>}
            {description && <p className="text-xs text-muted">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </Tag>
  );
}

// What a data section shows when it has nothing, is loading, or failed. Says what happened
// and, when there is one, what to do next.
export function EmptyState({ children, action = null }) {
  return (
    <div className="px-4 py-6 text-sm text-muted">
      <p>{children}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function LoadingState({ children = 'Loading…' }) {
  return (
    <p role="status" className="px-4 py-6 text-sm text-muted">
      {children}
    </p>
  );
}

export function ErrorState({ children }) {
  return (
    <p role="alert" className="px-4 py-4 text-sm text-crit">
      {children}
    </p>
  );
}
