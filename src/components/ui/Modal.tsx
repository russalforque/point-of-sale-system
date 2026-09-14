import { useEffect, useId, useRef, type ReactNode } from 'react'
import { TriangleWarning, X } from './Icons'
import { Button } from './Button'

type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl'

const sizeClass: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-3xl',
  '2xl': 'max-w-4xl',
}

export function Modal({
  title,
  description,
  onClose,
  children,
  footer,
  wide,
  size,
  preventClose,
  mobileFullScreen,
}: {
  title: ReactNode
  description?: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  /** @deprecated pass `size="xl"` instead */
  wide?: boolean
  size?: ModalSize
  /** Disable backdrop-click / Escape / the header close button — use while a submit is in flight. */
  preventClose?: boolean
  /** Expand to a full-screen sheet below the `sm` breakpoint instead of a centered card. */
  mobileFullScreen?: boolean
}) {
  const resolvedSize: ModalSize = size ?? (wide ? 'xl' : 'md')
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement | null>(null)

  // Focus the dialog on open and hand focus back to whatever triggered it on close
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    panelRef.current?.focus()
    return () => {
      previouslyFocused?.focus?.()
    }
  }, [])

  // Lock background scroll while the dialog is open
  useEffect(() => {
    const original = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = original
    }
  }, [])

  // Escape closes the dialog unless it's mid-submit / a critical confirmation
  useEffect(() => {
    if (preventClose) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, preventClose])

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px] animate-in fade-in duration-150 ${
        mobileFullScreen ? 'p-0 sm:p-4' : 'p-3 sm:p-4'
      }`}
      onMouseDown={(e) => {
        if (preventClose) return
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`flex max-h-[min(88vh,44rem)] w-full flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.18)] outline-none animate-in fade-in zoom-in-95 duration-150 ${sizeClass[resolvedSize]} ${
          mobileFullScreen
            ? 'max-sm:h-full max-sm:max-h-full max-sm:max-w-full max-sm:rounded-none max-sm:border-0'
            : ''
        }`}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold text-gray-900">
              {title}
            </h2>
            {description && <p className="mt-0.5 text-sm text-gray-500">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={preventClose}
            aria-label="Close dialog"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-300 touch-manipulation"
          >
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer ? (
          <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-gray-100 bg-gray-50/60 px-5 py-3.5">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  danger,
  onCancel,
  onConfirm,
  busy,
}: {
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
  onCancel: () => void
  onConfirm: () => void
  busy?: boolean
}) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      size="sm"
      preventClose={busy}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy} className="flex-1 sm:flex-none">
            Cancel
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            onClick={onConfirm}
            disabled={busy}
            className="flex-1 sm:flex-none"
          >
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex items-start gap-3">
        {danger && (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rose-50 text-rose-600">
            <TriangleWarning size={16} />
          </div>
        )}
        <p className="pt-1.5 text-sm leading-relaxed text-gray-600">{message}</p>
      </div>
    </Modal>
  )
}
