import { Menu } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'

const titles: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/sales': 'Sales',
  '/customers': 'Customers',
  '/inventory': 'Inventory',
  '/products': 'Products',
  '/categories': 'Categories',
  '/suppliers': 'Suppliers',
  '/reports': 'Reports',
  '/settings': 'Settings',
}

function titleFromPath(pathname: string): string {
  const match = Object.keys(titles)
    .sort((a, b) => b.length - a.length)
    .find((key) => pathname === key || pathname.startsWith(`${key}/`))
  return match ? titles[match] ?? 'Sellix POS' : 'Sellix POS'
}

export function MainLayout() {
  const location = useLocation()
  const shouldAutoHideSidebar = () =>
    window.innerWidth >= 1000 && window.innerHeight >= 800

  const [collapsed, setCollapsed] = useState(() => {
    const saved = localStorage.getItem('sellix.sidebar')
    if (saved !== null) return saved === '1'
    return shouldAutoHideSidebar()
  })
  const [mobileOpen, setMobileOpen] = useState(false)
  const [hoveredSidebar, setHoveredSidebar] = useState(false)
  const manualToggleLockRef = useRef(false)

  useEffect(() => {
    const handleResize = () => {
      if (!shouldAutoHideSidebar()) {
        setHoveredSidebar(false)
      }
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev
      localStorage.setItem('sellix.sidebar', next ? '1' : '0')
      setHoveredSidebar(false)
      manualToggleLockRef.current = true
      window.setTimeout(() => {
        manualToggleLockRef.current = false
      }, 250)
      return next
    })
  }

  const sidebarExpanded = !collapsed || hoveredSidebar

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (manualToggleLockRef.current) return

    const isNearLeft = shouldAutoHideSidebar() && e.clientX < 10
    setHoveredSidebar(isNearLeft)
  }

  return (
    <div 
      className="flex h-full bg-white"
      onPointerMove={handlePointerMove}
      onPointerLeave={() => {
        setHoveredSidebar(false)
        manualToggleLockRef.current = false
      }}
    >
      <Sidebar
        collapsed={!sidebarExpanded}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
        onToggle={toggle}
      />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex items-center gap-3 border-b border-gray-200 bg-white px-3 py-3 md:hidden">
          <button
            type="button"
            aria-label="Open sidebar"
            onClick={() => setMobileOpen(true)}
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 text-gray-700 transition-all duration-100 ease-out active:bg-gray-100"
          >
            <Menu size={18} />
          </button>
          <span className="text-sm font-semibold tracking-tight text-gray-900">
            {titleFromPath(location.pathname)}
          </span>
        </div>

        <main className="min-h-0 flex-1 overflow-auto bg-gray-50/50">
          <div className="mx-auto h-full max-w-screen-2xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
