import { useEffect, useId, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import {
  faBox,
  faBoxesStacked,
  faCartShopping,
  faChartLine,
  faEllipsis,
  faGear,
  faHouse,
  faPrint,
  faTags,
  faTruck,
  faUserShield,
  faUsers,
  faXmark,
} from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'

import {
  BOTTOM_NAV_HEIGHT,
  MORE_SHEET_STATE_KEY,
  MoreSheet,
  isMoreSheetOpen,
  matchesRoute,
  withoutMoreSheetState,
  type MoreNavGroup,
  type MoreNavItem,
} from '../../components/layout/MoreSheet'
import { ConfirmDialog } from '../../components/ui/Modal'
import { useAuth } from '../../context/AuthContext'
import { ROLE_LABELS, type Permission, type Role } from '../../utils/permissions'

interface MobileBottomNavProps {
  /** Optional notification count for inventory alerts */
  alertCount?: number
}

type PrimaryItem = { to: string; label: string; icon: IconDefinition; permission?: Permission; badge?: number }
type SecondaryItem = MoreNavItem & { permission: Permission }

/**
 * Secondary destinations shown in the "More" sheet. These mirror the existing
 * routes and permissions from App.tsx / Sidebar.tsx — nothing new is added.
 */
const SECONDARY_GROUPS: { title: string; items: SecondaryItem[] }[] = [
  {
    title: 'Management',
    items: [
      { to: '/products', label: 'Products', description: 'Catalog, prices and photos', icon: faBox, permission: 'products.view' },
      { to: '/customers', label: 'Customers', description: 'Contacts and loyalty points', icon: faUsers, permission: 'customers.view' },
      { to: '/categories', label: 'Categories', description: 'Group products at the register', icon: faTags, permission: 'categories.manage' },
      { to: '/suppliers', label: 'Suppliers', description: 'Vendors and their contacts', icon: faTruck, permission: 'suppliers.manage' },
    ],
  },
  {
    title: 'System',
    items: [
      { to: '/users', label: 'Users', description: 'Staff accounts and roles', icon: faUserShield, permission: 'users.manage' },
      { to: '/printer-settings', label: 'Printer', description: 'Receipt printer and cash drawer', icon: faPrint, permission: 'printer.configure' },
      { to: '/settings', label: 'Settings', description: 'Store, tax and receipts', icon: faGear, permission: 'settings.view' },
    ],
  },
]

export function MobileBottomNav({ alertCount = 0 }: MobileBottomNavProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const { can, user, logout } = useAuth()

  const sheetId = useId()
  const moreButtonRef = useRef<HTMLButtonElement | null>(null)
  const [confirmLogout, setConfirmLogout] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)

  const isSheetOpen = isMoreSheetOpen(location.state)
  const currentUrl = `${location.pathname}${location.search}${location.hash}`

  const allPrimaryItems: PrimaryItem[] = [
    { to: '/dashboard', label: 'Home', icon: faHouse },
    { to: '/sales', label: 'Orders', icon: faCartShopping, permission: 'sales.process' },
    {
      to: '/inventory',
      label: 'Inventory',
      icon: faBoxesStacked,
      permission: 'inventory.manage',
      badge: alertCount > 0 ? alertCount : undefined,
    },
    { to: '/reports', label: 'Reports', icon: faChartLine, permission: 'reports.view' },
  ]
  const primaryItems = allPrimaryItems.filter((item) => !item.permission || can(item.permission))

  const secondaryGroups: MoreNavGroup[] = SECONDARY_GROUPS.map((group) => ({
    title: group.title,
    items: group.items.filter((item) => can(item.permission)),
  })).filter((group) => group.items.length > 0)

  const isOnSecondaryRoute = secondaryGroups.some((group) =>
    group.items.some((item) => matchesRoute(location.pathname, item.to)),
  )

  // A reload can restore a history entry that still carries the "open" marker; start closed.
  useEffect(() => {
    if (isSheetOpen) {
      navigate(currentUrl, { replace: true, state: withoutMoreSheetState(location.state) })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function openSheet() {
    if (isSheetOpen) return
    // Push a same-URL entry so back (browser or Android) closes the sheet first.
    navigate(currentUrl, {
      state: { ...(withoutMoreSheetState(location.state) ?? {}), [MORE_SHEET_STATE_KEY]: true },
    })
  }

  function closeSheet() {
    if (isSheetOpen) navigate(-1)
  }

  /** Navigate from inside the sheet (or a tab while it is open) without leaving the marker entry behind. */
  function goTo(to: string) {
    if (location.pathname === to) {
      closeSheet()
      return
    }
    navigate(to, { replace: isSheetOpen })
  }

  function handleTabClick(event: MouseEvent<HTMLAnchorElement>, to: string) {
    if (!isSheetOpen) return
    event.preventDefault()
    goTo(to)
  }

  function requestLogout() {
    closeSheet()
    setConfirmLogout(true)
  }

  return (
    <>
      {/* Flow spacer: reserves the nav height in document flow so content is never covered */}
      <div
        aria-hidden="true"
        className="pointer-events-none block w-full shrink-0 select-none md:hidden"
        style={{ height: BOTTOM_NAV_HEIGHT }}
      />

      {/* Fixed bottom navigation — stays above the More sheet and its backdrop */}
      <nav
        aria-label="Main navigation"
        className="fixed inset-x-0 bottom-0 z-[43] block select-none border-t border-slate-100 bg-white md:hidden"
        style={{ paddingBottom: 'max(0.35rem, env(safe-area-inset-bottom, 0px))' }}
      >
        <div className="mx-auto flex h-[4.5rem] max-w-md items-center justify-around px-2">
          {primaryItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={(event) => handleTabClick(event, item.to)}
              aria-label={item.badge ? `${item.label}, ${item.badge} alerts` : item.label}
              className="flex flex-1 touch-manipulation flex-col items-center justify-center gap-1 rounded-xl py-1 text-center transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B]"
            >
              {({ isActive }) => {
                // While the sheet is open, "More" is the active tab.
                const active = isActive && !isSheetOpen
                return (
                  <>
                    <NavIcon icon={item.icon} active={active} badge={item.badge} />
                    <NavLabel label={item.label} active={active} />
                  </>
                )
              }}
            </NavLink>
          ))}

          <button
            ref={moreButtonRef}
            type="button"
            onClick={() => (isSheetOpen ? closeSheet() : openSheet())}
            aria-label={isSheetOpen ? 'Close more options' : 'More options'}
            aria-haspopup="dialog"
            aria-expanded={isSheetOpen}
            aria-controls={sheetId}
            className="flex flex-1 touch-manipulation flex-col items-center justify-center gap-1 rounded-xl py-1 text-center transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B]"
          >
            <NavIcon icon={isSheetOpen ? faXmark : faEllipsis} active={isSheetOpen || isOnSecondaryRoute} />
            <NavLabel label="More" active={isSheetOpen || isOnSecondaryRoute} />
          </button>
        </div>
      </nav>

      <MoreSheet
        id={sheetId}
        open={isSheetOpen}
        groups={secondaryGroups}
        activePath={location.pathname}
        accountName={user?.fullName}
        accountDetail={user?.role ? ROLE_LABELS[user.role as Role] ?? String(user.role) : user?.email}
        onNavigate={goTo}
        onClose={closeSheet}
        onLogout={requestLogout}
        returnFocusRef={moreButtonRef}
      />

      {confirmLogout && (
        <ConfirmDialog
          title="Log out?"
          message="You’ll need your email and password to sign back in."
          confirmLabel="Log out"
          danger
          busy={loggingOut}
          onCancel={() => setConfirmLogout(false)}
          onConfirm={() => {
            setLoggingOut(true)
            void logout().finally(() => {
              setLoggingOut(false)
              setConfirmLogout(false)
            })
          }}
        />
      )}
    </>
  )
}

function NavIcon({ icon, active, badge }: { icon: IconDefinition; active: boolean; badge?: number }) {
  return (
    <span
      className={`relative flex h-8 w-14 items-center justify-center rounded-full transition-colors duration-150 ${
        active ? 'bg-[#E6F1EA] text-[#1F5E3B]' : 'text-slate-500'
      }`}
    >
      <FontAwesomeIcon icon={icon} className="h-5 w-5" />

      {badge !== undefined && badge > 0 && (
        <span
          aria-hidden="true"
          className="absolute right-2 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white ring-2 ring-white"
        >
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </span>
  )
}

function NavLabel({ label, active }: { label: string; active: boolean }) {
  return (
    <span className={`text-xs ${active ? 'font-semibold text-[#1F5E3B]' : 'font-medium text-slate-500'}`}>{label}</span>
  )
}

export default MobileBottomNav
