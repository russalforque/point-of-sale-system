import {
  BarChart3,
  LayoutDashboard,
  LogOut,
  Package,
  Settings,
  ShoppingCart,
  Store,
  Tags,
  Truck,
  Users,
  Warehouse,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'


type NavItem = { to: string; label: string; icon: typeof LayoutDashboard }

const groups: { title: string; items: NavItem[] }[] = [
  { title: 'MAIN', items: [{ to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard }] },
  {
    title: 'SALES',
    items: [
      { to: '/sales', label: 'Order Process', icon: ShoppingCart },
      { to: '/customers', label: 'Customers', icon: Users },
    ],
  },
  {
    title: 'INVENTORY',
    items: [
      { to: '/inventory', label: 'Inventory', icon: Warehouse },
      { to: '/products', label: 'Products', icon: Package },
      { to: '/categories', label: 'Categories', icon: Tags },
      { to: '/suppliers', label: 'Suppliers', icon: Truck },
    ],
  },
  {
    title: 'MANAGEMENT',
    items: [{ to: '/reports', label: 'Reports', icon: BarChart3 }],
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

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target as Node)) {
        setProfileMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [])

  const initials =
    user?.fullName
      ?.split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2) || '?'

  const ProfilePopover = () =>
    profileMenuOpen ? (
      <div
        ref={profileMenuRef}
        className="absolute bottom-[calc(100%+0.75rem)] left-3 right-3 z-50 rounded-2xl border border-gray-200 bg-white p-2 shadow-[0_12px_30px_rgba(15,23,42,0.12)]"
      >
        <div className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50 p-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-gray-100 to-gray-200 text-xs font-semibold text-gray-700 ring-1 ring-gray-200">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-gray-900">{user?.fullName}</p>
            <p className="truncate text-xs text-gray-500">{user?.email}</p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            setProfileMenuOpen(false)
            void logout()
          }}
          className="mt-2 flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm text-neutral-400 transition-all duration-100 ease-out hover:bg-neutral-50 hover:text-neutral-900 active:bg-neutral-100"
        >
          <LogOut size={15} />
          <span>Log out</span>
        </button>
      </div>
    ) : null

  const body = (
    <div className="flex h-full flex-col bg-white text-neutral-700">
      <div className={`flex h-14 items-center justify-between border-b border-gray-200 px-4 pt-[env(safe-area-inset-top)] transition-all duration-200 ease-out ${collapsed ? 'justify-center px-2' : 'gap-2 px-4'}`}>
        {collapsed ? (
          <button
            type="button"
            title="Expand sidebar"
            onClick={onToggle}
            className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-600 transition-all duration-100 ease-out active:bg-neutral-100 will-change-transform"
          >
            <Store size={18} />
          </button>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Store size={20} className="text-gray-900 transition-colors duration-150 ease-out" />
              <span className="text-[11px] font-semibold tracking-[0.15em] text-gray-900 transition-opacity duration-150 ease-out">SELLIX</span>
            </div>
            <button
              type="button"
              aria-label={mobileOpen ? 'Close sidebar' : 'Open sidebar'}
              title={mobileOpen ? 'Close sidebar' : 'Open sidebar'}
              onClick={onToggle}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-600 transition-all duration-200 ease-[cubic-bezier(0.2,0.8,0.2,1)] active:bg-neutral-100 active:text-neutral-900 will-change-transform"
            >
              <X size={16} className={`transition-transform duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] ${mobileOpen ? 'rotate-0' : 'rotate-90'}`} />
            </button>
          </>
        )}
      </div>
      <nav className="flex-1 overflow-y-auto py-4">
        {groups.map((group) => (
          <div key={group.title} className="mb-4">
            {!collapsed ? (
              <p className="px-5 pb-2 text-[11px] font-semibold tracking-[0.15em] text-gray-500 transition-colors duration-150 ease-out uppercase">{group.title}</p>
            ) : (
              <div className="mx-2 mb-2 border-t border-gray-200 transition-all duration-150 ease-out" />
            )}
            {group.items.map((item) => {
              const Icon = item.icon
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  title={collapsed ? item.label : undefined}
                  onClick={onCloseMobile}
                  className={({ isActive }) =>
                    `group relative mx-2 mb-1 flex items-center gap-3 rounded-xl px-5 py-4 text-sm transition-all duration-100 ease-out active:bg-neutral-100 ${
                      isActive
                        ? 'bg-gray-50 font-medium text-neutral-900 shadow-[0_1px_2px_rgba(0,0,0,0.03)]'
                        : 'text-neutral-400 active:text-neutral-900'
                    } ${collapsed ? 'justify-center' : ''}`
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive ? (
                        <span className="absolute inset-y-2 left-0 w-1 rounded-r-md bg-gray-900 opacity-100 transition-opacity duration-150 ease-out" />
                      ) : (
                        <span className="absolute inset-y-2 left-0 w-1 rounded-r-md bg-gray-900 opacity-0 transition-opacity duration-150 ease-out" />
                      )}
                      <Icon size={18} className="relative z-10 transition-all duration-150 ease-out" />
                      {!collapsed ? <span className="relative z-10 transition-colors duration-150 ease-out">{item.label}</span> : null}
                    </>
                  )}
                </NavLink>
              )
            })}
          </div>
        ))}
      </nav>

      <div className="relative border-t border-gray-200 p-3 transition-all duration-150 ease-out">
        <div className={`flex items-center justify-between gap-2 ${collapsed ? 'justify-center' : ''}`}>
          <NavLink
            to="/settings"
            title={collapsed ? 'Settings' : undefined}
            onClick={onCloseMobile}
            className={({ isActive }) =>
              `group flex items-center gap-3 rounded-xl px-3 py-3 text-sm transition-all duration-100 ease-out active:bg-neutral-100 ${
                isActive ? 'bg-gray-50 font-medium text-neutral-900' : 'text-neutral-400 active:text-neutral-900'
              } ${collapsed ? 'justify-center px-2.5' : 'flex-1'}`
            }
          >
            {({ isActive }) => (
              <>
                {isActive ? (
                  <span className="absolute inset-y-2 left-0 w-1 rounded-r-md bg-gray-900 opacity-100 transition-opacity duration-150 ease-out" />
                ) : (
                  <span className="absolute inset-y-2 left-0 w-1 rounded-r-md bg-gray-900 opacity-0 transition-opacity duration-150 ease-out" />
                )}
                <Settings size={18} className="relative z-10 transition-all duration-150 ease-out" />
                {!collapsed ? <span className="relative z-10 transition-colors duration-150 ease-out">Settings</span> : null}
              </>
            )}
          </NavLink>

          <button
            type="button"
            title="Account options"
            onClick={() => setProfileMenuOpen((open) => !open)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-gray-100 to-gray-200 text-xs font-semibold text-gray-700 shadow-sm ring-1 ring-gray-200 transition-all duration-150 ease-out hover:bg-gray-100 active:scale-[0.98]"
          >
            {initials}
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <>
      <div className="relative">
        <aside
          className={`hidden h-full shrink-0 overflow-hidden border-r border-gray-200 bg-white transition-transform duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] will-change-transform md:block ${
            collapsed ? 'w-[72px]' : 'w-[280px] max-w-[80vw]'
          }`}
        >
          {body}
        </aside>
        <ProfilePopover />
      </div>

      <div className={`fixed inset-0 z-40 md:hidden ${mobileOpen ? '' : 'pointer-events-none'}`}>
        <div
          className={`fixed inset-0 z-40 bg-black/30 backdrop-blur-xs transition-all duration-300 ease-out ${mobileOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
          onClick={onCloseMobile}
        />

        <aside
          className={`fixed inset-y-0 left-0 z-50 w-[85vw] max-w-[320px] -translate-x-full transform bg-white transition-transform duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] will-change-transform sm:w-[320px] ${
            mobileOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          {body}
        </aside>

        <ProfilePopover />
      </div>
    </>
  )
}

