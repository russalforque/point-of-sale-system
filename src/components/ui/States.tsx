import sellixMark from '../../assets/sellix-logo.png'

/**
 * Full-screen startup loader (session check). Mirrors the static loader in index.html -
 * same markup and `.app-loader` classes, styled there - so startup reads as one screen.
 */
export function AppLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="app-loader" role="status" aria-live="polite">
      <img className="app-loader__logo" src={sellixMark} alt="" width={64} height={64} />
      <p className="app-loader__name">Sellix</p>
      <p className="app-loader__status">{label}</p>
      <span className="app-loader__spinner" aria-hidden="true" />
    </div>
  )
}

/**
 * Inline loading indicator. Callers already give it room (py-12 … py-20 wrappers, table
 * cells, a row's trailing slot), so it only adds a little padding of its own.
 */
export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2.5 py-2 text-sm text-slate-500">
      <span
        aria-hidden="true"
        className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-[#E6F1EA] border-t-[#1F5E3B]"
      />
      {label}
    </div>
  )
}

/**
 * "Nothing here" message. Deliberately borderless: it is usually rendered inside a card or
 * list container already, and a dashed box inside a card reads as a broken widget.
 */
export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center px-4 py-8 text-center">
      <span aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-full bg-[#F3F5F4] text-slate-400">
        <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 12h-6l-2 3h-4l-2-3H2" />
          <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
        </svg>
      </span>
      <p className="mt-3 text-[15px] font-semibold text-[#091413]">{title}</p>
      {hint ? <p className="mx-auto mt-1 max-w-sm text-sm leading-5 text-slate-500">{hint}</p> : null}
    </div>
  )
}

/** Load failure with a clear retry. The message comes from getErrorMessage(), not a raw stack. */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center px-4 py-8 text-center">
      <span aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-50 text-rose-600">
        <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 8v4M12 16h.01" />
        </svg>
      </span>
      <p className="mt-3 text-[15px] font-semibold text-[#091413]">Couldn’t load this</p>
      <p className="mx-auto mt-1 max-w-sm text-sm leading-5 text-slate-500">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 inline-flex h-11 items-center rounded-full bg-white px-5 text-sm font-medium text-[#091413] ring-1 ring-slate-200 transition hover:bg-slate-50 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B]"
        >
          Try again
        </button>
      ) : null}
    </div>
  )
}
