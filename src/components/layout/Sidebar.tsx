import {
  faAnglesLeft,
  faAnglesRight,
  faBox,
  faBoxesStacked,
  faCartShopping,
  faChartLine,
  faGear,
  faHouse,
  faPrint,
  faRightFromBracket,
  faTags,
  faTruck,
  faUserShield,
  faUsers,
} from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { useEffect, useRef, useState } from 'react'
import type { FocusEvent, KeyboardEvent, PointerEvent } from 'react'
import { NavLink } from 'react-router-dom'

import sellixMark from '../../assets/sellix-mark.png'
import { useAuth } from '../../context/AuthContext'
import { ROLE_LABELS, type Permission, type Role } from '../../utils/permissions'
import { ConfirmDialog } from '../ui/Modal'

type NavItem = { to: string; label: string; icon: typeof faHouse; permission?: Permission }
type NavGroup = { title?: string; items: NavItem[] }

// Ordered by how often a cashier or manager needs each page. Every route here exists in App.tsx.
const groups: NavGroup[] = [
  {
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: faHouse },
      { to: '/sales', label: 'Sales', icon: faCartShopping, permission: 'sales.process' },
      { to: '/reports', label: 'Reports', icon: faChartLine, permission: 'reports.view' },
    ],
  },
  {
    title: 'Stock',
    items: [
      { to: '/inventory', label: 'Inventory', icon: faBoxesStacked, permission: 'inventory.manage' },
      { to: '/products', label: 'Products', icon: faBox, permission: 'products.view' },
      { to: '/categories', label: 'Categories', icon: faTags, permission: 'categories.manage' },
      { to: '/suppliers', label: 'Suppliers', icon: faTruck, permission: 'suppliers.manage' },
    ],
  },
  {
    title: 'People',
    items: [
      { to: '/customers', label: 'Customers', icon: faUsers, permission: 'customers.view' },
      { to: '/users', label: 'Users', icon: faUserShield, permission: 'users.manage' },
    ],
  },
  {
    title: 'System',
    items: [
      { to: '/printer-settings', label: 'Printer', icon: faPrint, permission: 'printer.configure' },
      { to: '/settings', label: 'Settings', icon: faGear, permission: 'settings.view' },
    ],
  },
]

/** Hover must rest this long before the rail previews, so sweeping past it does nothing. */
const PEEK_DELAY_MS = 250

const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B]'

/**
 * Desktop / tablet navigation. Phones use MobileBottomNav + MoreSheet instead.
 *
 * Icons keep the same x position in both states (rail centre = 36px), so collapsing
 * only reveals or hides labels and nothing jumps while the width animates.
 */
export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { user, logout, can } = useAuth()
  const [peeking, setPeeking] = useState(false)
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const peekTimerRef = useRef<number | undefined>(undefined)

  const expanded = !collapsed || peeking
  const overlaying = collapsed && peeking

  const visibleGroups = groups
    .map((group) => ({ ...group, items: group.items.filter((item) => !item.permission || can(item.permission)) }))
    .filter((group) => group.items.length > 0)

  const initials =
    user?.fullName
      ?.split(' ')
      .filter(Boolean)
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2) || '?'
  const roleLabel = user?.role ? ROLE_LABELS[user.role as Role] ?? user.role : ''

  useEffect(() => () => window.clearTimeout(peekTimerRef.current), [])

  function stopPeek() {
    window.clearTimeout(peekTimerRef.current)
    setPeeking(false)
  }

  // A resting mouse previews the collapsed rail over the page instead of pushing content aside.
  function handlePointerEnter(event: PointerEvent<HTMLElement>) {
    if (!collapsed || event.pointerType !== 'mouse') return
    window.clearTimeout(peekTimerRef.current)
    peekTimerRef.current = window.setTimeout(() => setPeeking(true), PEEK_DELAY_MS)
  }

  // Keyboard users get the same preview, so labels are readable while tabbing through icons.
  function handleFocus(event: FocusEvent<HTMLElement>) {
    if (collapsed && event.target.matches(':focus-visible')) setPeeking(true)
  }

  function handleBlur(event: FocusEvent<HTMLElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) stopPeek()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape' && overlaying) stopPeek()
  }

  function handleToggle() {
    stopPeek()
    onToggle()
  }

  const fade = `whitespace-nowrap transition-opacity duration-150 motion-reduce:transition-none ${
    expanded ? 'opacity-100' : 'opacity-0'
  }`

  const toggleLabel = !collapsed ? 'Collapse sidebar' : peeking ? 'Keep sidebar open' : 'Expand sidebar'

  return (
    <>
      {/* Reserves only the pinned width; a hover preview floats above the page. */}
      <aside
        className={`relative hidden h-full shrink-0 transition-[width] duration-200 ease-out motion-reduce:transition-none md:block ${
          collapsed ? 'w-18' : 'w-64'
        }`}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={stopPeek}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
      >
        <div
          className={`absolute inset-y-0 left-0 z-40 flex flex-col overflow-hidden border-r border-slate-100 bg-white text-[#091413] select-none transition-[width,box-shadow] duration-200 ease-out motion-reduce:transition-none ${
            expanded ? 'w-64' : 'w-18'
          } ${overlaying ? 'shadow-[8px_0_32px_rgba(9,20,19,0.10)]' : ''}`}
        >
          {/* BRAND */}
          <div className="flex h-16 shrink-0 items-center gap-3 px-5">
            <img src={sellixMark} alt={expanded ? '' : 'Sellix'} className="h-8 w-8 shrink-0 rounded-lg" />
            <div className={`min-w-0 ${fade}`} aria-hidden={!expanded}>
              <p className="truncate text-base font-bold leading-tight tracking-tight">Sellix</p>
              <p className="truncate text-xs text-slate-500">Point of sale</p>
            </div>
          </div>

          {/* NAVIGATION */}
          <nav aria-label="Main" className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-3 pb-3">
            {visibleGroups.map((group) => (
              <div key={group.title ?? 'main'} className={group.title ? 'mt-3' : 'mt-1'}>
                {group.title && (
                  // Same height in both states: a label when expanded, a divider on the rail.
                  <div className="relative flex h-7 items-center px-4" aria-hidden="true">
                    <span
                      className={`absolute inset-x-2 top-1/2 border-t border-slate-100 transition-opacity ${
                        expanded ? 'opacity-0' : 'opacity-100'
                      }`}
                    />
                    <span className={`text-xs font-medium text-slate-500 ${fade}`}>{group.title}</span>
                  </div>
                )}

                <ul className="space-y-0.5" aria-label={group.title}>
                  {group.items.map((item) => (
                    <li key={item.to}>
                      <NavLink
                        to={item.to}
                        onClick={stopPeek}
                        className={({ isActive }) =>
                          `relative flex h-11 items-center gap-3 rounded-xl px-4 text-sm transition-colors ${focusRing} ${
                            isActive
                              ? 'bg-[#E6F1EA] font-semibold text-[#1F5E3B]'
                              : 'font-medium text-slate-600 hover:bg-[#F3F5F4] hover:text-[#091413]'
                          }`
                        }
                      >
                        {({ isActive }) => (
                          <>
                            {/* Shape cue for the current page, not just colour */}
                            {isActive && (
                              <span aria-hidden="true" className="absolute inset-y-3 left-0 w-0.75 rounded-r-full bg-[#1F5E3B]" />
                            )}
                            <FontAwesomeIcon icon={item.icon} className="h-4 w-4 shrink-0" />
                            <span className={`truncate ${fade}`}>{item.label}</span>
                          </>
                        )}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>

          {/* COLLAPSE — always visible, so touch tablets can find it without hover */}
          <div className="shrink-0 border-t border-slate-100 px-3 py-2">
            <button
              type="button"
              onClick={handleToggle}
              aria-expanded={!collapsed}
              className={`flex h-11 w-full items-center gap-3 rounded-xl px-4 text-sm font-medium text-slate-500 transition-colors hover:bg-[#F3F5F4] hover:text-[#091413] ${focusRing}`}
            >
              <FontAwesomeIcon icon={collapsed ? faAnglesRight : faAnglesLeft} className="h-4 w-4 shrink-0" />
              <span className={fade}>{toggleLabel}</span>
            </button>
          </div>

          {/* ACCOUNT */}
          <div
            className={`shrink-0 border-t border-slate-100 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] ${
              expanded ? 'flex items-center gap-3 pl-4' : 'flex flex-col items-center gap-1'
            }`}
          >
            <span
              aria-hidden="true"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#E6F1EA] text-xs font-semibold text-[#1F5E3B]"
            >
              {initials}
            </span>
            {expanded && (
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{user?.fullName || 'Account'}</p>
                <p className="truncate text-xs text-slate-500">{roleLabel || user?.email}</p>
              </div>
            )}
            <button
              type="button"
              onClick={() => {
                stopPeek()
                setShowLogoutConfirm(true)
              }}
              aria-label="Log out"
              title="Log out"
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-500 transition-colors hover:bg-rose-50 hover:text-rose-600 ${focusRing}`}
            >
              <FontAwesomeIcon icon={faRightFromBracket} className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {showLogoutConfirm && (
        <ConfirmDialog
          title="Log out?"
          message="You’ll need your email and password to sign in again."
          confirmLabel="Log out"
          danger
          busy={loggingOut}
          onCancel={() => setShowLogoutConfirm(false)}
          onConfirm={() => {
            setLoggingOut(true)
            void logout().finally(() => {
              setLoggingOut(false)
              setShowLogoutConfirm(false)
            })
          }}
        />
      )}
    </>
  )
}

export default Sidebar
