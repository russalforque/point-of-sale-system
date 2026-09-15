import sellixMark from '../../assets/sellix-mark.png'

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

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-500">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600" />
      {label}
    </div>
  )
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded border border-dashed border-gray-300 bg-white px-4 py-12 text-center">
      <p className="text-sm font-medium text-gray-800">{title}</p>
      {hint ? <p className="mt-1 text-sm text-gray-500">{hint}</p> : null}
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded border border-red-200 bg-white px-4 py-10 text-center">
      <p className="text-sm text-red-700">{message}</p>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="mt-3 text-sm font-medium text-blue-600 hover:underline">
          Try again
        </button>
      ) : null}
    </div>
  )
}
