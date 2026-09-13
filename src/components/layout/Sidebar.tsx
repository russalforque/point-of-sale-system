import {
  faBox,
  faBoxesStacked,
  faChartLine,
  faCartShopping,
  faGear,
  faHouse,
  faRightFromBracket,
  faStore,
  faTags,
  faTruck,
  faUsers,
  faXmark,
  faChevronLeft,
} from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { useEffect, useRef, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'

type NavItem = { to: string; label: string; icon: typeof faHouse }

const groups: { title: string; items: NavItem[] }[] = [
  { title: 'MAIN', items: [{ to: '/dashboard', label: 'Dashboard', icon: faHouse }] },
  {
    title: 'SALES',
    items: [
      { to: '/sales', label: 'Order Process', icon: faCartShopping },
      { to: '/customers', label: 'Customers', icon: faUsers },
    ],
  },
  {
    title: 'INVENTORY',
    items: [
      { to: '/inventory', label: 'Inventory', icon: faBoxesStacked },
      { to: '/products', label: 'Products', icon: faBox },
      { to: '/categories', label: 'Categories', icon: faTags },
      { to: '/suppliers', label: 'Suppliers', icon: faTruck },
    ],
  },
  {
    title: 'MANAGEMENT',
    items: [{ to: '/reports', label: 'Reports', icon: faChartLine }],
  },
]

export function Sidebar({
  collapsed,
  mobileOpen,
  onCloseMobile,
  onToggle,
}: {
  collapsed: boolean
  mobileOpen: boolean
  onCloseMobile: () => void
  onToggle: () => void
}) {
  const { user, logout } = useAuth()
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const profileMenuRef = useRef<HTMLDivElement | null>(null)
  const profileTriggerRef = useRef<HTMLButtonElement | null>(null)

  // Close profile popover when clicking outside
  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (
        profileMenuRef.current &&
        !profileMenuRef.current.contains(target) &&
        profileTriggerRef.current &&
        !profileTriggerRef.current.contains(target)
      ) {
        setProfileMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [])

  // Lock body scroll on mobile when drawer is open
  useEffect(() => {
    if (mobileOpen) {
      const originalStyle = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      return () => {
        document.body.style.overflow = originalStyle
      }
    }
  }, [mobileOpen])

  // Handle Escape key to close mobile drawer or popover
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (profileMenuOpen) {
          setProfileMenuOpen(false)
        } else if (mobileOpen) {
          onCloseMobile()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [mobileOpen, profileMenuOpen, onCloseMobile])

  const initials =
    user?.fullName
      ?.split(' ')
      .filter(Boolean)
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2) || '?'

  const ProfilePopover = () =>
    profileMenuOpen ? (
      <div
        ref={profileMenuRef}
        role="dialog"
        aria-label="Account options"
        className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] left-3.5 z-[70] w-[min(18rem,calc(100vw-2rem))] rounded-2xl border border-gray-200 bg-white p-2.5 shadow-[0_12px_30px_rgba(15,23,42,0.15)] animate-in fade-in zoom-in-95 duration-150"
      >
        <div className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50/80 p-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-gray-100 to-gray-200 text-xs font-semibold text-gray-700 ring-1 ring-gray-200">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-gray-900">{user?.fullName || 'Admin'}</p>
            <p className="truncate text-xs text-gray-500">{user?.email}</p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            setProfileMenuOpen(false)
            onCloseMobile()
            void logout()
          }}
          className="mt-2 flex w-full min-h-[44px] items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium text-rose-600 transition-colors duration-150 hover:bg-rose-50 active:bg-rose-100 touch-manipulation"
        >
          <FontAwesomeIcon icon={faRightFromBracket} className="h-4 w-4" />
          <span>Log out</span>
        </button>
      </div>
    ) : null

  // Renders the internal sidebar structure (isMobile forces expanded layout)
  const renderSidebarContent = (isMobile = false) => {
    const isCollapsed = isMobile ? false : collapsed

    return (
      <div className="flex h-full flex-col bg-white text-neutral-700 select-none">
        {/* Header with Safe Area top padding */}
        <div
          className={`flex shrink-0 items-center border-b border-gray-200 px-4 transition-all duration-200 ease-out ${
            isMobile
              ? 'h-[calc(3.5rem+env(safe-area-inset-top,0px))] pt-[env(safe-area-inset-top,0px)] justify-between'
              : `h-14 ${isCollapsed ? 'justify-center px-2' : 'justify-between px-4'}`
          }`}
        >
          {isCollapsed ? (
            <button
              type="button"
              title="Expand sidebar"
              aria-label="Expand sidebar"
              onClick={onToggle}
              className="flex h-10 w-10 items-center justify-center rounded-xl text-gray-700 hover:bg-gray-100 active:scale-95 transition-all duration-150 touch-manipulation"
            >
              <FontAwesomeIcon icon={faStore} className="h-4 w-4" />
            </button>
          ) : (
            <>
              <div className="flex items-center gap-2.5">
               <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#285A48] text-white shadow-xs">
  <FontAwesomeIcon icon={faStore} className="h-4 w-4" />
</div>
                <span className="text-xs font-bold tracking-[0.16em] text-gray-900">
                  SELLIX
                </span>
              </div>

              {/* Close Button on Mobile / Collapse Button on Desktop */}
              <button
                type="button"
                aria-label={isMobile ? 'Close sidebar' : 'Collapse sidebar'}
                title={isMobile ? 'Close sidebar' : 'Collapse sidebar'}
                onClick={isMobile ? onCloseMobile : onToggle}
                className="flex h-9 w-9 items-center justify-center rounded-xl text-gray-500 hover:bg-gray-100 hover:text-gray-900 active:scale-95 transition-all duration-150 touch-manipulation"
              >
                <FontAwesomeIcon
  icon={isMobile ? faXmark : faChevronLeft}
  className="h-4 w-4 text-[#091413]/70 transition-colors hover:text-[#285A48]"
/>
              </button>
            </>
          )}
        </div>

        {/* Navigation Item List */}
        <nav className="flex-1 overflow-y-auto overscroll-contain py-3.5 px-2">
          {groups.map((group) => (
            <div key={group.title} className="mb-4">
              {!isCollapsed ? (
                <p className="px-3 pb-2 text-[10px] font-bold tracking-[0.15em] text-gray-400 uppercase">
                  {group.title}
                </p>
              ) : (
                <div className="mx-2 mb-2 border-t border-gray-100" />
              )}

              <div className="space-y-1">
                {group.items.map((item) => {
                  const Icon = item.icon
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      title={isCollapsed ? item.label : undefined}
                      onClick={() => {
                        if (isMobile) onCloseMobile()
                      }}
                      className={({ isActive }) =>
                        `group relative flex min-h-[44px] items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150 touch-manipulation active:scale-[0.98] ${
                          isActive
                            ? 'bg-gray-100 text-gray-950 font-semibold shadow-xs'
                            : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900 active:bg-gray-100'
                        } ${isCollapsed ? 'justify-center px-0' : ''}`
                      }
                    >
                      {({ isActive }) => (
                        <>
                          {isActive && (
                            <span className="absolute left-0 top-2 bottom-2 w-1 rounded-r-md bg-gray-900" />
                          )}
                          <FontAwesomeIcon
  icon={Icon}
  className={`h-4 w-4 shrink-0 transition-colors duration-150 ${
    isActive ? 'text-[#285A48]' : 'text-[#091413]/40 group-hover:text-[#285A48]'
  }`}
/>
                          {!isCollapsed && <span className="truncate">{item.label}</span>}
                        </>
                      )}
                    </NavLink>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Footer Area with Safe Area bottom padding */}
        <div
          className={`shrink-0 border-t border-gray-200 p-2.5 transition-all duration-150 ${
            isMobile ? 'pb-[max(0.75rem,env(safe-area-inset-bottom,0.75rem))]' : ''
          }`}
        >
          <div className={`flex items-center gap-1.5 ${isCollapsed ? 'justify-center' : 'justify-between'}`}>
            <button
              ref={profileTriggerRef}
              type="button"
              title="Account options"
              aria-label="Open account options"
              aria-haspopup="dialog"
              aria-expanded={profileMenuOpen}
              onClick={() => setProfileMenuOpen((open) => !open)}
              className={`flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-gray-500 hover:bg-gray-100 hover:text-gray-900 active:scale-95 transition-all duration-150 touch-manipulation ${
                profileMenuOpen ? 'bg-gray-100 text-gray-900' : ''
              }`}
            >
              <FontAwesomeIcon icon={faGear} className="h-4 w-4" />
            </button>

            {!isCollapsed && (
              <NavLink
                to="/settings"
                onClick={() => {
                  if (isMobile) onCloseMobile()
                }}
                className={({ isActive }) =>
                  `flex min-h-[44px] flex-1 items-center rounded-xl px-3 py-2 text-sm font-medium transition-all duration-150 touch-manipulation ${
                    isActive
                      ? 'bg-gray-100 text-gray-950 font-semibold'
                      : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900 active:bg-gray-100'
                  }`
                }
              >
                Settings
              </NavLink>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      {/* Desktop Persistent Sidebar */}
      <aside
        className={`hidden md:block h-full shrink-0 border-r border-gray-200 bg-white transition-all duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] ${
          collapsed ? 'w-18' : 'w-64 lg:w-70'
        }`}
      >
        {renderSidebarContent(false)}
      </aside>

      {/* Mobile Sliding Drawer & Backdrop */}
      <div
        className={`fixed inset-0 z-50 md:hidden transition-all duration-300 ${
          mobileOpen ? 'visible pointer-events-auto' : 'invisible pointer-events-none'
        }`}
        aria-hidden={!mobileOpen}
      >
        {/* Soft Dimmed Overlay */}
        <div
          className={`fixed inset-0 bg-black/40 backdrop-blur-xs transition-opacity duration-300 ease-out ${
            mobileOpen ? 'opacity-100' : 'opacity-0'
          }`}
          onClick={onCloseMobile}
          aria-hidden="true"
        />

        {/* Mobile Slide-in Panel */}
        <aside
          className={`fixed inset-y-0 left-0 flex h-full w-[82vw] max-w-[320px] flex-col bg-white shadow-2xl transition-transform duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] will-change-transform ${
            mobileOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
          role="dialog"
          aria-modal="true"
          aria-label="Navigation Menu"
        >
          {renderSidebarContent(true)}
        </aside>
      </div>

      {/* Global Profile Popover */}
      <ProfilePopover />
    </>
  )
}

export default Sidebar