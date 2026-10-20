import { useEffect, useId, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode, Ref } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'

import { useDismissOnBack } from '../../hooks/useDismissOnBack'
import type { AppNotification, NotificationKind } from '../../hooks/useDashboardNotifications'
import { formatRelativeTime } from '../../utils/format'
import { Check, ChevronRight, Package, ShoppingCart, TriangleWarning, X } from '../ui/Icons'
import { Segmented } from '../ui/MobileKit'

/**
 * Bell button + notification panel shared by the desktop/tablet and phone dashboards.
 *
 * The panel adapts to orientation rather than width, so it suits how a tablet is held:
 * - portrait (phones, tablets upright): a bottom sheet within thumb reach, swipe down to close;
 * - landscape ≥ 640px (tablets sideways, desktops): a full-height side drawer that leaves
 *   the dashboard visible beside it.
 * It is portaled to <body>, so it never depends on where the bell lands when the header wraps.
 */

// Must match the `drawer` custom variant in index.css.
const DRAWER_QUERY = '(orientation: landscape) and (min-width: 640px)'
const EXIT_MS = 180
const UNDO_MS = 6000
// How far the sheet must be dragged down before letting go closes it.
const DRAG_CLOSE_PX = 96

export interface NotificationCenterProps {
  notifications: AppNotification[]
  markAsRead: (id: string) => void
  markAllAsRead: () => void
  dismiss: (id: string) => void
  clearAll: () => void
  restore: (ids: string[]) => void
  /** `outlined` sits in the desktop/tablet page header; `soft` matches the phone header's icon buttons. */
  variant?: 'outlined' | 'soft'
}

export function NotificationCenter({ variant = 'outlined', ...state }: NotificationCenterProps) {
  const [open, setOpen] = useState(false)
  const bellRef = useRef<HTMLButtonElement>(null)

  const unread = state.notifications.filter((n) => !n.read)

  return (
    <>
      <BellButton
        ref={bellRef}
        variant={variant}
        open={open}
        unreadCount={unread.length}
        urgent={unread.some((n) => n.kind === 'out-of-stock')}
        onClick={() => setOpen(true)}
      />
      {open &&
        createPortal(
          <NotificationPanel
            {...state}
            onClosed={() => {
              setOpen(false)
              bellRef.current?.focus({ preventScroll: true })
            }}
          />,
          document.body,
        )}
    </>
  )
}

/* =============================================================
   BELL
============================================================= */

function BellButton({
  ref,
  variant,
  open,
  unreadCount,
  urgent,
  onClick,
}: {
  ref: Ref<HTMLButtonElement>
  variant: 'outlined' | 'soft'
  open: boolean
  unreadCount: number
  urgent: boolean
  onClick: () => void
}) {
  const shape =
    variant === 'outlined'
      ? `h-11 w-11 ring-1 ${open ? 'bg-[#F2F8F4] text-[#1F5E3B] ring-[#1F5E3B]' : 'bg-white text-[#091413] ring-slate-200 hover:bg-slate-50'}`
      : `h-12 w-12 text-[#091413] ${open ? 'bg-[#E6ECE9]' : 'bg-[#F3F5F4] hover:bg-[#E9EEEB]'}`

  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
      aria-haspopup="dialog"
      aria-expanded={open}
      className={`relative inline-flex shrink-0 items-center justify-center rounded-full transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B] ${shape}`}
    >
      <BellIcon />
      {unreadCount > 0 && (
        <span
          aria-hidden="true"
          className={`absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-semibold tabular-nums text-white ring-2 ${
            urgent ? 'bg-rose-500' : 'bg-[#1F5E3B]'
          } ${variant === 'outlined' ? 'ring-[#F6F8F7]' : 'ring-white'}`}
        >
          {unreadCount > 9 ? '9+' : unreadCount}
        </span>
      )}
    </button>
  )
}

/* =============================================================
   PANEL
============================================================= */

type Filter = 'all' | 'unread'
type Undo = { ids: string[]; message: string }

function NotificationPanel({
  notifications,
  markAsRead,
  markAllAsRead,
  dismiss,
  clearAll,
  restore,
  onClosed,
}: Omit<NotificationCenterProps, 'variant'> & { onClosed: () => void }) {
  const navigate = useNavigate()
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)

  const [filter, setFilter] = useState<Filter>('all')
  const [closing, setClosing] = useState(false)
  const [undo, setUndo] = useState<Undo | null>(null)
  const [dragY, setDragY] = useState(0)
  const dragRef = useRef<{ pointerId: number; startY: number } | null>(null)

  // Android / browser back closes the panel instead of leaving the dashboard.
  const { close } = useDismissOnBack('notificationsOpen', onClosed)

  const closingRef = useRef(false)
  function requestClose() {
    if (closingRef.current) return
    closingRef.current = true
    setClosing(true)
    window.setTimeout(close, EXIT_MS)
  }

  const requestCloseRef = useRef(requestClose)
  useEffect(() => {
    requestCloseRef.current = requestClose
  })

  // Focus moves into the panel, Tab stays inside it, Escape closes it.
  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true })

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        requestCloseRef.current()
        return
      }
      if (event.key !== 'Tab' || !panelRef.current) return
      const focusable = panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]')
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!first || !last) return
      const active = document.activeElement
      if (event.shiftKey && (active === first || active === panelRef.current)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (!undo) return
    const timer = window.setTimeout(() => setUndo(null), UNDO_MS)
    return () => window.clearTimeout(timer)
  }, [undo])

  const unreadCount = notifications.filter((n) => !n.read).length
  const visible = filter === 'unread' ? notifications.filter((n) => !n.read) : notifications
  const attention = visible.filter((n) => n.kind !== 'sale')
  const activity = visible.filter((n) => n.kind === 'sale')

  function handleOpen(notification: AppNotification) {
    markAsRead(notification.id)
    // Replacing the panel's history entry means back from the target screen returns to the dashboard.
    if (notification.action) navigate(notification.action.to, { replace: true })
  }

  function handleDismiss(notification: AppNotification) {
    dismiss(notification.id)
    setUndo({ ids: [notification.id], message: 'Notification removed' })
  }

  function handleClearAll() {
    const ids = notifications.map((n) => n.id)
    clearAll()
    setUndo({ ids, message: `Cleared ${ids.length} ${ids.length === 1 ? 'notification' : 'notifications'}` })
  }

  function handleUndo() {
    if (!undo) return
    restore(undo.ids)
    setUndo(null)
  }

  /* Swipe the sheet down to close (bottom-sheet layout only; the drawer has a close button). */
  function onDragStart(event: ReactPointerEvent<HTMLDivElement>) {
    if (window.matchMedia(DRAWER_QUERY).matches) return
    if ((event.target as Element).closest('button')) return
    dragRef.current = { pointerId: event.pointerId, startY: event.clientY }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function onDragMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    setDragY(Math.max(0, event.clientY - drag.startY))
  }

  function onDragEnd(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    if (event.clientY - drag.startY > DRAG_CLOSE_PX) requestClose()
    else setDragY(0)
  }

  const motion = closing
    ? '[animation:sheet-out_180ms_ease-in_forwards] drawer:[animation:drawer-out_180ms_ease-in_forwards]'
    : '[animation:sheet-in_260ms_cubic-bezier(0.2,0.8,0.2,1)] drawer:[animation:drawer-in_220ms_cubic-bezier(0.2,0.8,0.2,1)]'

  return (
    <div className="fixed inset-0 z-[70]">
      <div
        aria-hidden="true"
        onClick={requestClose}
        className={`absolute inset-0 bg-[#091413]/30 ${
          closing ? '[animation:fade-out_180ms_ease-in_forwards]' : '[animation:fade-in_200ms_ease-out]'
        }`}
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={dragY > 0 ? { transform: `translateY(${dragY}px)`, transition: 'none' } : undefined}
        className={`absolute inset-x-0 bottom-0 mx-auto flex max-h-[85dvh] w-full max-w-[640px] flex-col overflow-hidden rounded-t-3xl bg-white text-[#091413] shadow-[0_-8px_32px_rgba(9,20,19,0.12)] transition-transform duration-200 focus:outline-none drawer:inset-y-3 drawer:left-auto drawer:right-3 drawer:mx-0 drawer:max-h-none drawer:w-[min(420px,calc(100vw-1.5rem))] drawer:max-w-none drawer:rounded-3xl drawer:shadow-[0_16px_48px_rgba(9,20,19,0.18)] ${motion}`}
      >
        {/* HEADER — also the drag area for the sheet */}
        <div
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
          className="shrink-0 touch-none select-none drawer:touch-auto drawer:select-auto"
        >
          <div className="flex justify-center pb-1 pt-2.5 drawer:hidden" aria-hidden="true">
            <span className="h-1 w-10 rounded-full bg-slate-200" />
          </div>
          <div className="flex items-start gap-3 px-5 pb-3 pt-2 drawer:pt-5">
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="text-lg font-semibold leading-tight">
                Notifications
              </h2>
              <p className="mt-0.5 text-sm text-slate-500">
                {notifications.length === 0
                  ? 'Nothing needs your attention'
                  : unreadCount > 0
                    ? `${unreadCount} unread`
                    : 'You’re all caught up'}
              </p>
            </div>
            <button
              type="button"
              onClick={requestClose}
              aria-label="Close notifications"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#F3F5F4] text-slate-500 transition hover:bg-[#E9EEEB] hover:text-slate-700 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B]"
            >
              <X size={14} />
            </button>
          </div>

          {notifications.length > 0 && (
            <div className="px-5 pb-3 *:mt-0">
              <Segmented<Filter>
                label="Show notifications"
                value={filter}
                onChange={setFilter}
                options={[
                  { key: 'all', label: 'All', count: notifications.length },
                  { key: 'unread', label: 'Unread', count: unreadCount },
                ]}
              />
            </div>
          )}
        </div>

        {/* LIST */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-slate-100 px-2 pb-3">
          {visible.length === 0 ? (
            <EmptyPanel
              filtered={filter === 'unread' && notifications.length > 0}
              onShowAll={() => setFilter('all')}
            />
          ) : (
            <>
              {attention.length > 0 && (
                <Section title="Needs attention" count={attention.length}>
                  {attention.map((n) => (
                    <NotificationRow key={n.id} notification={n} onOpen={handleOpen} onDismiss={handleDismiss} />
                  ))}
                </Section>
              )}
              {activity.length > 0 && (
                <Section title="Recent activity" count={activity.length}>
                  {activity.map((n) => (
                    <NotificationRow key={n.id} notification={n} onOpen={handleOpen} onDismiss={handleDismiss} />
                  ))}
                </Section>
              )}
            </>
          )}
        </div>

        {/* UNDO */}
        <div role="status" aria-live="polite" className="shrink-0 empty:hidden">
          {undo && (
            <div className="mx-3 mb-2 flex items-center gap-3 rounded-2xl bg-[#091413] py-1.5 pl-4 pr-1.5 text-sm text-white [animation:toast-in_160ms_ease-out]">
              <p className="min-w-0 flex-1 truncate">{undo.message}</p>
              <button
                type="button"
                onClick={handleUndo}
                className="h-10 shrink-0 rounded-xl px-3 font-semibold text-[#4ADE80] transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4ADE80]"
              >
                Undo
              </button>
            </div>
          )}
        </div>

        {/* FOOTER */}
        {notifications.length > 0 && (
          <div className="flex shrink-0 items-center gap-2 border-t border-slate-100 px-5 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] pt-3 drawer:pb-4">
            <button
              type="button"
              onClick={handleClearAll}
              className="h-11 rounded-full px-4 text-sm font-medium text-slate-600 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B]"
            >
              Clear all
            </button>
            <button
              type="button"
              onClick={markAllAsRead}
              disabled={unreadCount === 0}
              className="ml-auto inline-flex h-11 items-center gap-2 rounded-full bg-[#1F5E3B] px-5 text-sm font-semibold text-white transition hover:bg-[#194d30] active:scale-95 disabled:bg-[#F3F5F4] disabled:text-slate-400 disabled:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B] focus-visible:ring-offset-2"
            >
              <Check size={12} />
              Mark all as read
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/* =============================================================
   PIECES
============================================================= */

const KIND_STYLE: Record<NotificationKind, { label: string; icon: ReactNode; tile: string; pill: string }> = {
  'out-of-stock': {
    label: 'Out of stock',
    icon: <TriangleWarning size={15} />,
    tile: 'bg-rose-50 text-rose-600',
    pill: 'bg-rose-50 text-rose-700',
  },
  'low-stock': {
    label: 'Low stock',
    icon: <Package size={15} />,
    tile: 'bg-amber-50 text-amber-600',
    pill: 'bg-amber-50 text-amber-800',
  },
  sale: {
    label: 'Sale',
    icon: <ShoppingCart size={15} />,
    tile: 'bg-[#EAF3EE] text-[#1F5E3B]',
    pill: 'bg-[#EAF3EE] text-[#1F5E3B]',
  },
}

function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <section className="pt-3">
      <h3 className="flex items-center gap-2 px-3 pb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
        {title}
        <span className="rounded-full bg-[#F3F5F4] px-1.5 py-px text-[11px] tabular-nums text-slate-500">{count}</span>
      </h3>
      <ul className="space-y-1">{children}</ul>
    </section>
  )
}

function NotificationRow({
  notification: n,
  onOpen,
  onDismiss,
}: {
  notification: AppNotification
  onOpen: (notification: AppNotification) => void
  onDismiss: (notification: AppNotification) => void
}) {
  const style = KIND_STYLE[n.kind]
  const unread = !n.read
  const time = n.at ? formatRelativeTime(n.at) : ''

  return (
    <li className="group relative">
      <button
        type="button"
        onClick={() => onOpen(n)}
        aria-label={`${unread ? 'Unread. ' : ''}${style.label}: ${n.title}. ${n.description}${time ? `. ${time}` : ''}${
          n.action ? `. ${n.action.label}` : ''
        }`}
        className={`flex w-full items-start gap-3 rounded-2xl px-3 py-3 text-left transition active:bg-[#EEF2F0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B] ${
          unread ? 'bg-[#F4F9F6] hover:bg-[#EDF5F0]' : 'hover:bg-[#F6F8F7]'
        }`}
      >
        <span aria-hidden="true" className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${style.tile}`}>
          {style.icon}
          {unread && <span className="absolute -left-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-[#1F5E3B] ring-2 ring-[#F4F9F6]" />}
        </span>

        <span aria-hidden="true" className="min-w-0 flex-1">
          <span
            className={`block truncate pr-9 text-sm pointer-coarse:pr-11 ${unread ? 'font-semibold text-[#091413]' : 'font-medium text-slate-600'}`}
            title={n.title}
          >
            {n.title}
          </span>
          <span className="mt-0.5 block text-[13px] leading-5 text-slate-500">{n.description}</span>
          <span className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <span className={`rounded-full px-2 py-0.5 font-medium ${style.pill}`}>{style.label}</span>
            {time && <span className="text-slate-400">{time}</span>}
            {n.action && (
              <span className="ml-auto inline-flex items-center gap-1 font-semibold text-[#1F5E3B]">
                {n.action.label}
                <ChevronRight size={9} />
              </span>
            )}
          </span>
        </span>
      </button>

      {/* Always visible on touch; revealed on hover / focus with a mouse. */}
      <button
        type="button"
        onClick={() => onDismiss(n)}
        aria-label={`Remove notification: ${n.title}`}
        className="absolute right-1.5 top-1.5 flex h-9 w-9 items-center justify-center rounded-full text-slate-400 opacity-0 transition hover:bg-white hover:text-slate-700 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B] group-hover:opacity-100 pointer-coarse:right-0.5 pointer-coarse:top-0.5 pointer-coarse:h-11 pointer-coarse:w-11 [@media(hover:none)]:opacity-100"
      >
        <X size={12} />
      </button>
    </li>
  )
}

function EmptyPanel({ filtered, onShowAll }: { filtered: boolean; onShowAll: () => void }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <span aria-hidden="true" className="flex h-14 w-14 items-center justify-center rounded-full bg-[#EAF3EE] text-[#1F5E3B]">
        <Check size={18} />
      </span>
      <p className="mt-4 text-base font-semibold">{filtered ? 'No unread notifications' : 'You’re all caught up'}</p>
      <p className="mt-1 max-w-xs text-sm text-slate-500">
        {filtered ? 'Everything here has been read.' : 'Stock alerts and new sales will show up here.'}
      </p>
      {filtered && (
        <button
          type="button"
          onClick={onShowAll}
          className="mt-4 h-11 rounded-full bg-[#F3F5F4] px-5 text-sm font-medium text-[#091413] transition hover:bg-[#E9EEEB] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B]"
        >
          Show all
        </button>
      )}
    </div>
  )
}

function BellIcon() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  )
}
