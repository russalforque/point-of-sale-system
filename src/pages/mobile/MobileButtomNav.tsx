import {
  faBars,
  faBoxesStacked,
  faCartShopping,
  faChartLine,
  faHouse,
} from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { useLocation, NavLink } from 'react-router-dom'

interface MobileBottomNavProps {
  /** Callback to open the full slide-out mobile drawer (Sidebar) */
  onOpenMenu: () => void
  /** Optional notification count for orders or inventory alerts */
  alertCount?: number
}

// Routes that live inside the "More" menu
const MORE_ROUTES = [
  '/customers',
  '/products',
  '/categories',
  '/suppliers',
  '/settings',
]

export function MobileBottomNav({ onOpenMenu, alertCount = 0 }: MobileBottomNavProps) {
  const location = useLocation()

  // Check if current route belongs to one of the secondary "More" pages
  const isMoreActive = MORE_ROUTES.some((path) =>
    location.pathname.startsWith(path)
  )

  const navItems = [
    {
      to: '/dashboard',
      label: 'Home',
      icon: faHouse,
    },
    {
      to: '/sales',
      label: 'Orders',
      icon: faCartShopping,
    },
    {
      to: '/inventory',
      label: 'Inventory',
      icon: faBoxesStacked,
      badge: alertCount > 0 ? alertCount : undefined,
    },
    {
      to: '/reports',
      label: 'Reports',
      icon: faChartLine,
    },
  ]

  return (
    <>
      {/* 🟢 1. Flow Spacer: Takes up the exact same height in document flow so nothing is covered */}
      <div
        aria-hidden="true"
        className="block md:hidden w-full shrink-0 select-none pointer-events-none"
        style={{
          height: 'calc(3.5rem + max(0.35rem, env(safe-area-inset-bottom, 0px)))',
        }}
      />

      {/* 🟢 2. Fixed Bottom Nav */}
      <nav
        aria-label="Mobile Navigation"
        className="fixed inset-x-0 bottom-0 z-40 block md:hidden border-t border-gray-200/80 bg-white/95 backdrop-blur-md transition-all select-none"
        style={{
          paddingBottom: 'max(0.35rem, env(safe-area-inset-bottom, 0px))',
        }}
      >
        <div className="mx-auto flex h-14 max-w-md items-center justify-around px-2">
          {navItems.map((item) => {
            const Icon = item.icon

            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `group relative flex flex-1 flex-col items-center justify-center py-1 text-center transition-all duration-150 touch-manipulation active:scale-95 ${
                    isActive
                      ? 'font-bold text-[#285A48]'
                      : 'text-gray-400 hover:text-gray-600'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <div className="relative flex items-center justify-center">
                      {/* Active Background Glow / Pill */}
                      {isActive && (
                        <span className="absolute -inset-x-2 -inset-y-1 rounded-xl bg-[#EAF1EE] transition-all -z-10" />
                      )}

                      <FontAwesomeIcon
                        icon={Icon}
                        className={`h-4.5 w-4.5 transition-transform duration-150 ${
                          isActive ? 'scale-105 text-[#285A48]' : 'text-gray-400'
                        }`}
                      />

                      {/* Numeric Badge (e.g., Low stock alerts) */}
                      {item.badge && item.badge > 0 && (
                        <span className="absolute -right-2.5 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white ring-2 ring-white shadow-xs">
                          {item.badge > 99 ? '99+' : item.badge}
                        </span>
                      )}
                    </div>

                    <span
                      className={`mt-1 text-[10px] tracking-tight ${
                        isActive ? 'font-bold text-[#091413]' : 'font-medium text-gray-500'
                      }`}
                    >
                      {item.label}
                    </span>
                  </>
                )}
              </NavLink>
            )
          })}

          {/* "More / Menu" Button */}
          <button
            type="button"
            aria-label="Open full menu"
            onClick={onOpenMenu}
            className={`group relative flex flex-1 flex-col items-center justify-center py-1 text-center transition-all duration-150 touch-manipulation active:scale-95 ${
              isMoreActive
                ? 'font-bold text-[#285A48]'
                : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            <div className="relative flex items-center justify-center">
              {isMoreActive && (
                <span className="absolute -inset-x-2 -inset-y-1 rounded-xl bg-[#EAF1EE] transition-all -z-10" />
              )}

              <FontAwesomeIcon
                icon={faBars}
                className={`h-4.5 w-4.5 transition-transform duration-150 ${
                  isMoreActive ? 'scale-105 text-[#285A48]' : 'text-gray-400'
                }`}
              />

              {/* Indicator dot if on a nested "More" page */}
              {isMoreActive && (
                <span className="absolute -right-1.5 -top-1 flex h-2 w-2 rounded-full bg-[#285A48] ring-2 ring-white" />
              )}
            </div>

            <span
              className={`mt-1 text-[10px] tracking-tight ${
                isMoreActive ? 'font-bold text-[#091413]' : 'font-medium text-gray-500'
              }`}
            >
              Menu
            </span>
          </button>
        </div>
      </nav>
    </>
  )
}

export default MobileBottomNav