import type { ReactNode } from 'react'

export function MobileLoading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-3xl border border-[#E5EBE7] bg-white py-16 text-center shadow-xs">
      <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-[#EAF1EE] border-t-[#285A48]" />
      <p className="mt-3 text-sm font-semibold text-[#091413]">{label}</p>
    </div>
  )
}

export function MobileEmpty({
  icon,
  title,
  hint,
  action,
}: {
  icon?: ReactNode
  title: string
  hint?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-3xl border border-[#E5EBE7] bg-white p-8 text-center shadow-xs">
      {icon && (
        <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#EAF1EE] text-[#285A48]">
          {icon}
        </div>
      )}
      <p className="text-sm font-bold text-[#091413]">{title}</p>
      {hint && <p className="mx-auto mt-1 max-w-xs text-xs leading-5 text-slate-500">{hint}</p>}
      {action && <div className="mt-4 w-full">{action}</div>}
    </div>
  )
}

export function MobileError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-3xl border border-rose-200 bg-rose-50/60 p-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-100 text-lg font-black text-rose-600">
        !
      </div>
      <p className="mt-3 text-sm font-bold text-rose-700">Something went wrong</p>
      <p className="mt-1 text-xs leading-5 text-rose-600/90">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 flex h-11 items-center justify-center rounded-2xl bg-rose-600 px-5 text-xs font-bold text-white active:scale-95 touch-manipulation"
        >
          Try Again
        </button>
      )}
    </div>
  )
}

export function StickyToolbar({ children }: { children: ReactNode }) {
  return (
    <div className="sticky top-0 z-10 -mx-4 bg-[#F6F8F7]/95 px-4 pb-2.5 pt-1 backdrop-blur-sm sm:-mx-6 sm:px-6">
      {children}
    </div>
  )
}
