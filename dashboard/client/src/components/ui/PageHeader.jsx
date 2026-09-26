import { Link } from 'react-router-dom';

// Same header on every page: optional trail back up, the title, one line of context, actions.
export default function PageHeader({ title, description, actions, trail = null, children }) {
  return (
    <div className="mb-5">
      {trail && (
        <nav aria-label="Breadcrumb" className="mb-1.5 text-[13px]">
          {trail.map((t, i) => (
            <span key={t.to ?? t.label}>
              {i > 0 && <span className="px-1.5 text-faint">/</span>}
              {t.to ? (
                <Link to={t.to} className="text-muted hover:text-ink hover:underline">
                  {t.label}
                </Link>
              ) : (
                <span className="text-ink">{t.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="font-display text-[22px] leading-8 font-semibold tracking-tight text-ink">{title}</h1>
          {description && <p className="mt-0.5 max-w-[80ch] text-[13px] text-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}
