import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, RefObject } from 'react'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import { faRightFromBracket, faXmark } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'

/**
 * Secondary navigation for mobile, opened from the "More" tab.
 *
 * Open state lives in router history (see MORE_SHEET_STATE_KEY) rather than
 * component state, so the browser / Android back action dismisses the sheet
 * before it leaves the current screen.
 */

export const MORE_SHEET_STATE_KEY = 'moreSheetOpen'

/** Height of the fixed bottom navigation, including the Android gesture/nav bar inset. */
export const BOTTOM_NAV_HEIGHT = 'calc(4.5rem + max(0.35rem, env(safe-area-inset-bottom, 0px)))'

export function isMoreSheetOpen(state: unknown): boolean {
  return typeof state === 'object' && state !== null && (state as Record<string, unknown>)[MORE_SHEET_STATE_KEY] === true
}

export function withoutMoreSheetState(state: unknown): Record<string, unknown> | null {
  if (typeof state !== 'object' || state === null) return null
  const entries = Object.entries(state as Record<string, unknown>).filter(([key]) => key !== MORE_SHEET_STATE_KEY)
  return entries.length > 0 ? Object.fromEntries(entries) : null
}

export function matchesRoute(pathname: string, to: string): boolean {
  return pathname === to || pathname.startsWith(`${to}/`)
}

export type MoreNavItem = {
  to: string
  label: string
  description: string
  icon: IconDefinition
}

export type MoreNavGroup = {
  title: string
  items: MoreNavItem[]
}

const TRANSITION_MS = 220
const DRAG_DISMISS_PX = 80
const FOCUSABLE = 'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'

type MoreSheetProps = {
  id: string
  open: boolean
  groups: MoreNavGroup[]
  activePath: string
  accountName?: string
  accountDetail?: string
  onNavigate: (to: string) => void
  onClose: () => void
  onLogout: () => void
  /** Element that receives focus again when the sheet closes (the "More" tab). */
  returnFocusRef: RefObject<HTMLButtonElement | null>
}

function getInitials(name?: string) {
  return (
    name
      ?.split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || '?'
  )
}

export function MoreSheet({
  id,
  open,
  groups,
  activePath,
  accountName,
  accountDetail,
  onNavigate,
  onClose,
  onLogout,
  returnFocusRef,
}: MoreSheetProps) {
  // `rendered` keeps the sheet mounted during the exit transition; `visible` drives the transform.
  const [rendered, setRendered] = useState(open)
  const [visible, setVisible] = useState(false)
  const [dragY, setDragY] = useState(0)
  const [dragging, setDragging] = useState(false)

  const sheetRef = useRef<HTMLDivElement | null>(null)
  const dragStartRef = useRef<number | null>(null)

  useEffect(() => {
    if (open) {
      setRendered(true)
      setDragY(0)
      return
    }

    // Hand focus back to the "More" tab if it was inside the sheet.
    if (sheetRef.current?.contains(document.activeElement)) {
      returnFocusRef.current?.focus({ preventScroll: true })
    }
    setVisible(false)
    const timeout = window.setTimeout(() => setRendered(false), TRANSITION_MS)
    return () => window.clearTimeout(timeout)
  }, [open, returnFocusRef])

  // Start the slide-up on the frame after mounting so the transition runs.
  useEffect(() => {
    if (!rendered || !open) return
    const frame = window.requestAnimationFrame(() => {
      setVisible(true)
      sheetRef.current?.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [rendered, open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  /** Keep Tab / Shift+Tab inside the sheet while it is open. */
  function trapFocus(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Tab' || !sheetRef.current) return
    const focusables = Array.from(sheetRef.current.querySelectorAll<HTMLElement>(FOCUSABLE))
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    if (!first || !last) return
    if (event.shiftKey && (document.activeElement === first || document.activeElement === sheetRef.current)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  /* Drag-to-dismiss, limited to the header so taps on the grid are unaffected. */

  function handleDragStart(event: ReactPointerEvent<HTMLDivElement>) {
    // Let the close button receive its own tap.
    if ((event.target as HTMLElement).closest('button')) return
    dragStartRef.current = event.clientY
    setDragging(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function handleDragMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragStartRef.current === null) return
    setDragY(Math.max(0, event.clientY - dragStartRef.current))
  }

  function handleDragEnd() {
    if (dragStartRef.current === null) return
    dragStartRef.current = null
    setDragging(false)
    if (dragY > DRAG_DISMISS_PX) onClose()
    else setDragY(0)
  }

  if (!rendered) return null

  return (
    <>
      {/* Backdrop stops at the bottom navigation so the primary tabs stay visible and usable. */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className={`fixed inset-x-0 top-0 z-[41] bg-black/30 transition-opacity duration-200 md:hidden ${
          visible ? 'opacity-100' : 'opacity-0'
        }`}
        style={{ bottom: BOTTOM_NAV_HEIGHT }}
      />

      <div
        id={id}
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        tabIndex={-1}
        onKeyDown={trapFocus}
        className="fixed inset-x-0 z-[42] mx-auto flex max-w-lg flex-col overflow-hidden rounded-t-3xl bg-white text-[#091413] shadow-[0_-4px_24px_rgba(9,20,19,0.08)] outline-none md:hidden motion-reduce:transition-none"
        style={{
          bottom: BOTTOM_NAV_HEIGHT,
          // Never reach the status bar; leave a strip of the page visible above the sheet.
          maxHeight: `calc(100dvh - ${BOTTOM_NAV_HEIGHT} - env(safe-area-inset-top, 0px) - 3rem)`,
          transform: visible ? `translateY(${dragY}px)` : 'translateY(calc(100% + 1rem))',
          transition: dragging ? 'none' : `transform ${TRANSITION_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1)`,
        }}
      >
        {/* Handle + title + close (drag zone) */}
        <div
          onPointerDown={handleDragStart}
          onPointerMove={handleDragMove}
          onPointerUp={handleDragEnd}
          onPointerCancel={handleDragEnd}
          className="shrink-0 touch-none select-none pt-2"
        >
          <div className="flex justify-center" aria-hidden="true">
            <span className="h-1 w-10 rounded-full bg-slate-200" />
          </div>
          <div className="flex items-center justify-between pl-5 pr-2">
            <h2 id={`${id}-title`} className="text-lg font-semibold">
              More
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex h-11 w-11 items-center justify-center rounded-full text-slate-500 transition-colors active:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B]"
            >
              <FontAwesomeIcon icon={faXmark} className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">
          <nav aria-label="More pages">
            {groups.map((group) => (
              <section key={group.title} aria-labelledby={`${id}-${group.title}`} className="mt-4 first:mt-1">
                <h3 id={`${id}-${group.title}`} className="px-1 pb-2 text-sm font-medium text-slate-500">
                  {group.title}
                </h3>
                <ul className="grid grid-cols-3 gap-2">
                  {group.items.map((item) => {
                    const active = matchesRoute(activePath, item.to)
                    const descriptionId = `${id}-${item.to}-desc`
                    return (
                      <li key={item.to}>
                        <button
                          type="button"
                          onClick={() => onNavigate(item.to)}
                          aria-current={active ? 'page' : undefined}
                          aria-describedby={descriptionId}
                          className={`flex h-full min-h-24 w-full touch-manipulation flex-col items-center justify-center gap-2 rounded-2xl px-1 py-3 text-center transition active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B] ${
                            active ? 'bg-[#F2F8F4] ring-1 ring-[#1F5E3B]/20' : 'bg-[#F6F8F7] active:bg-[#EDF1EF]'
                          }`}
                        >
                          <span
                            className={`flex h-11 w-11 items-center justify-center rounded-2xl ${
                              active ? 'bg-[#1F5E3B] text-white' : 'bg-white text-[#1F5E3B]'
                            }`}
                          >
                            <FontAwesomeIcon icon={item.icon} className="h-4.5 w-4.5" />
                          </span>
                          <span className={`w-full truncate text-[13px] leading-tight ${active ? 'font-semibold text-[#1F5E3B]' : 'font-medium'}`}>
                            {item.label}
                          </span>
                          <span id={descriptionId} className="sr-only">
                            {active ? `Current page. ${item.description}` : item.description}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}
          </nav>

          {/* Account — logging out must stay reachable for every role */}
          <section aria-label="Account" className="mt-5 flex items-center gap-3 rounded-2xl border border-slate-100 p-2 pl-3">
            <span
              aria-hidden="true"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#E6F1EA] text-sm font-semibold text-[#1F5E3B]"
            >
              {getInitials(accountName)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-medium">{accountName || 'Signed in'}</p>
              {accountDetail && <p className="truncate text-xs text-slate-500">{accountDetail}</p>}
            </div>
            <button
              type="button"
              onClick={onLogout}
              className="flex h-11 shrink-0 items-center gap-2 rounded-full px-4 text-sm font-medium text-rose-600 transition-colors active:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
            >
              <FontAwesomeIcon icon={faRightFromBracket} className="h-4 w-4" />
              Log out
            </button>
          </section>
        </div>
      </div>
    </>
  )
}

export default MoreSheet
