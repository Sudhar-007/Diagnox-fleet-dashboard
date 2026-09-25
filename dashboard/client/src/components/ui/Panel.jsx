// Bordered surface used for every grouped block of content.
export default function Panel({ as: Tag = 'section', title, actions, className = '', bodyClassName = 'p-4', children, ...props }) {
  return (
    <Tag className={`rounded-md border border-line bg-panel ${className}`} {...props}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          {title && <h2 className="text-[15px] font-medium text-ink">{title}</h2>}
          {actions}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </Tag>
  );
}

export function EmptyState({ children }) {
  return <p className="px-4 py-6 text-[15px] text-muted">{children}</p>;
}
