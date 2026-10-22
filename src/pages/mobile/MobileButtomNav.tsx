import { useEffect, useId, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import {
  faBox,
  faBoxesStacked,
  faJarWheat,
  faSliders,
  faCartShopping,
  faChartLine,
  faClipboardCheck,
  faClipboardList,
  faClock,
  faEllipsis,
  faFileInvoiceDollar,
  faGear,
  faHouse,
  faMoneyBillWave,
  faPrint,
  faPlus,
  faRotateLeft,
  faScroll,
  faTags,
  faTruck,
  faTruckRampBox,
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
import { useSettings } from '../../context/SettingsContext'
import { ROLE_LABELS, type Permission, type Role } from '../../utils/permissions'

interface MobileBottomNavProps {
  /** Optional notification count for inventory alerts */
  alertCount?: number
}

type PrimaryItem = { to: string; label: string; icon: IconDefinition; permission?: Permission; badge?: number }
type SecondaryItem = MoreNavItem & {
  permission: Permission
  /** Shown to any of these instead (baristas see Ingredients for waste and batches). */
  anyOf?: Permission[]
  /** Only with Settings → Recipes, ingredients & options turned on. */
  foodService?: boolean
}

/**
 * Secondary destinations shown in the "More" sheet. These mirror the existing
 * routes and permissions from App.tsx / Sidebar.tsx — nothing new is added.
 */
const SECONDARY_GROUPS: { title: string; items: SecondaryItem[] }[] = [
  {
    title: 'Operations',
    items: [
      { to: '/returns', label: 'Returns', description: 'Refunds, returns and voids by receipt number', icon: faRotateLeft, permission: 'sales.process' },
      {
        to: '/ingredients',
        label: 'Ingredients',
        description: 'Beans, milk, cups: stock, waste and batches',
        icon: faJarWheat,
        permission: 'inventory.manage',
        anyOf: ['inventory.manage', 'inventory.count', 'inventory.waste', 'inventory.produce'],
        foodService: true,
      },
      { to: '/stock-count', label: 'Stock Count', description: 'Count shelves and correct stock', icon: faClipboardCheck, permission: 'inventory.count' },
      { to: '/purchase-orders', label: 'Purchase Orders', description: 'Order stock from suppliers', icon: faFileInvoiceDollar, permission: 'purchasing.manage' },
      { to: '/receive-stock', label: 'Receive Stock', description: 'Record supplier deliveries', icon: faTruckRampBox, permission: 'inventory.receive' },
      { to: '/expenses', label: 'Expenses', description: 'Rent, bills and other costs', icon: faMoneyBillWave, permission: 'expenses.manage' },
    ],
  },
  {
    title: 'Management',
    items: [
      { to: '/products', label: 'Products', description: 'Catalog, prices and photos', icon: faBox, permission: 'products.view' },
      { to: '/modifiers', label: 'Options', description: 'Sizes, milks and add-ons', icon: faSliders, permission: 'products.manage', foodService: true },
      { to: '/customers', label: 'Customers', description: 'Contacts, points and credit', icon: faUsers, permission: 'customers.view' },
      { to: '/categories', label: 'Categories', description: 'Group products at the register', icon: faTags, permission: 'categories.manage' },
      { to: '/suppliers', label: 'Suppliers', description: 'Vendors and their contacts', icon: faTruck, permission: 'suppliers.manage' },
    ],
  },
  {
    title: 'System',
    items: [
      { to: '/users', label: 'Users', description: 'Staff accounts and roles', icon: faUserShield, permission: 'users.manage' },
      { to: '/audit-log', label: 'Audit Log', description: 'Who did what, and when', icon: faScroll, permission: 'audit.view' },
      { to: '/shift-history', label: 'Shift History', description: 'Every employee shift and its cash summary', icon: faClipboardList, permission: 'shifts.manage' },
      { to: '/printer-settings', label: 'Printer', description: 'Receipt printer and cash drawer', icon: faPrint, permission: 'printer.configure' },
      { to: '/settings', label: 'Settings', description: 'Store, tax and receipts', icon: faGear, permission: 'settings.view' },
    ],
  },
]

export function MobileBottomNav({ alertCount = 0 }: MobileBottomNavProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const { can, user, logout } = useAuth()
  const { settings } = useSettings()

  const sheetId = useId()
  const moreButtonRef = useRef<HTMLButtonElement | null>(null)
  const [confirmLogout, setConfirmLogout] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)

  const isSheetOpen = isMoreSheetOpen(location.state)
  const currentUrl = `${location.pathname}${location.search}${location.hash}`

  const allPrimaryItems: PrimaryItem[] = [
    { to: '/dashboard', label: 'Home', icon: faHouse },
    { to: '/sales', label: 'Orders', icon: faCartShopping, permission: 'sales.process' },
    { to: '/shift', label: 'Shift', icon: faClock, permission: 'sales.process' },
    {
      to: '/inventory',
      label: 'Inventory',
      icon: faBoxesStacked,
      permission: 'inventory.manage',
      badge: alertCount > 0 ? alertCount : undefined,
    },
    { to: '/reports', label: 'Reports', icon: faChartLine, permission: 'reports.view' },
  ]
  const laundry = settings.businessType === 'laundry'
  const laundryPrimary: PrimaryItem[] = [
    { to:'/dashboard',label:'Home',icon:faHouse },
    { to:'/laundry/orders',label:'Orders',icon:faClipboardList,permission:'sales.process' },
    { to:'/laundry/new',label:'New order',icon:faPlus,permission:'sales.process' },
    { to:'/customers',label:'Customers',icon:faUsers,permission:'customers.view' },
  ]
  const primaryItems = (laundry ? laundryPrimary : allPrimaryItems).filter((item) => !item.permission || can(item.permission))

  const laundrySecondary: { title: string; items: SecondaryItem[] }[] = [
    { title:'Laundry', items:[
      {to:'/laundry/services',label:'Services & Add-ons',description:'Configure laundry prices',icon:faSliders,permission:'products.manage'},
      {to:'/reports',label:'Reports',description:'Collections and balances',icon:faChartLine,permission:'reports.view'},
      {to:'/shift',label:'My Shift',description:'Open or close the register',icon:faClock,permission:'sales.process'},
    ] },
    ...SECONDARY_GROUPS.filter(group=>group.title==='System'),
  ]
  const secondaryGroups: MoreNavGroup[] = (laundry ? laundrySecondary : SECONDARY_GROUPS).map((group) => ({
    title: group.title,
    items: group.items
      .filter((item) => (!item.foodService || settings.foodServiceEnabled) && (item.anyOf ? item.anyOf.some(can) : can(item.permission)))
      .map(({ to, label, description, icon }) => ({ to, label, description, icon })),
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
        className={`${laundry ? 'laundry-bottom-nav ' : ''}fixed inset-x-0 bottom-0 z-[43] block select-none border-t border-slate-100 bg-white md:hidden`}
        style={{ paddingBottom: 'max(0.35rem, env(safe-area-inset-bottom, 0px))' }}
      >
        <div className="mx-auto flex max-w-md items-center justify-around px-2" style={{ height: 'var(--mobile-nav-row-height, 4.5rem)' }}>
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
                    <NavIcon icon={item.icon} active={active} badge={item.badge} prominent={laundry && item.to === '/laundry/new'} />
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

function NavIcon({ icon, active, badge, prominent = false }: { icon: IconDefinition; active: boolean; badge?: number; prominent?: boolean }) {
  return (
    <span
      className={`relative flex items-center justify-center transition-colors duration-150 ${prominent ? 'h-10 w-10 rounded-xl bg-[#20563E] text-white' : `h-8 w-14 rounded-full ${
        active ? 'bg-[#E6F1EA] text-[#1F5E3B]' : 'text-slate-500'}`
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
