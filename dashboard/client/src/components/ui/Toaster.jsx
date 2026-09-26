import { dismissToast, useToasts } from '../../lib/toast.js';

const TONE = {
  ok: 'bg-ok',
  info: 'bg-accent',
  warn: 'bg-warn',
};

// Bottom-left stack, clear of the demo panel on the right. Announced politely.
export default function Toaster() {
  const list = useToasts((s) => s.list);
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-4 left-4 z-[1100] flex flex-col gap-2 md:left-[232px]">
      {list.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto flex max-w-sm items-center gap-3 rounded-md border border-line bg-surface py-2 pr-2 pl-3 text-sm text-ink shadow-[0_2px_8px_rgb(28_34_43/0.12)]"
        >
          <span aria-hidden className={`size-2 shrink-0 rounded-full ${TONE[t.tone] ?? TONE.ok}`} />
          <span className="flex-1">{t.message}</span>
          <button
            type="button"
            onClick={() => dismissToast(t.id)}
            aria-label="Dismiss"
            className="flex size-6 items-center justify-center rounded text-muted hover:bg-subtle hover:text-ink"
          >
            <svg aria-hidden viewBox="0 0 16 16" className="size-3" stroke="currentColor" strokeWidth="1.8">
              <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
