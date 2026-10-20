import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { Check, TriangleWarning, X } from '../components/ui/Icons'

type Toast = { id: number; message: string; tone: 'success' | 'error' }

type ToastContextValue = {
  notify: (message: string, tone?: Toast['tone']) => void
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined)

// Errors usually need reading (and acting on), so they stay up longer than confirmations.
const DURATION_MS: Record<Toast['tone'], number> = { success: 3200, error: 6000 }
// Rapid actions (e.g. several failed scans) shouldn't bury the screen in toasts.
const MAX_VISIBLE = 3

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const notify = useCallback(
    (message: string, tone: Toast['tone'] = 'success') => {
      const id = Date.now() + Math.random()
      setToasts((prev) => [...prev.filter((t) => t.message !== message), { id, message, tone }].slice(-MAX_VISIBLE))
      window.setTimeout(() => dismiss(id), DURATION_MS[tone])
    },
    [dismiss],
  )

  const value = useMemo(() => ({ notify }), [notify])

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Two live regions so screen readers announce errors assertively and confirmations politely. */}
      <div
        className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top,0px)+0.75rem)] z-[80] flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:right-4 sm:items-end sm:px-0"
      >
        {(['error', 'success'] as const).map((tone) => (
          <div
            key={tone}
            role={tone === 'error' ? 'alert' : 'status'}
            aria-live={tone === 'error' ? 'assertive' : 'polite'}
            className="flex w-full flex-col items-center gap-2 empty:hidden sm:w-auto sm:items-end"
          >
            {toasts
              .filter((toast) => toast.tone === tone)
              .map((toast) => (
                <ToastItem key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
              ))}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const isError = toast.tone === 'error'
  return (
    <div
      className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-2xl bg-[#091413] py-3 pl-4 pr-1.5 text-sm text-white shadow-[0_12px_32px_rgba(9,20,19,0.24)] [animation:toast-in_160ms_ease-out]"
    >
      <span
        aria-hidden="true"
        className={`mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
          isError ? 'bg-rose-500 text-white' : 'bg-[#4ADE80] text-[#091413]'
        }`}
      >
        {isError ? <TriangleWarning size={11} /> : <Check size={11} />}
      </span>
      <p className="min-w-0 flex-1 py-px leading-5">
        <span className="sr-only">{isError ? 'Error: ' : ''}</span>
        {toast.message}
      </p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="-my-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/60 transition hover:bg-white/10 hover:text-white"
      >
        <X size={12} />
      </button>
    </div>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('Toast context missing')
  return ctx
}
