import { useEffect, useRef, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { MobileBottomNav } from '../../pages/mobile/MobileButtomNav'

export function MainLayout() {
  const location = useLocation()
  const [pageLoading, setPageLoading] = useState(false)

  // 🟢 Detect if we are on the payment/checkout screen
  const isPaymentPage = location.pathname.startsWith('/payment')

  // Auto-collapse the sidebar to an icon rail on tablets too, not just desktop,
  // so it doesn't eat into the limited width — hover near the edge still expands it.
  const shouldAutoHideSidebar = () => window.innerWidth >= 768

  const [collapsed, setCollapsed] = useState(() => {
    const saved = localStorage.getItem('sellix.sidebar')
    if (saved !== null) return saved === '1'
    return shouldAutoHideSidebar()
  })
  const [mobileOpen, setMobileOpen] = useState(false)
  const [hoveredSidebar, setHoveredSidebar] = useState(false)
  const manualToggleLockRef = useRef(false)

  // Progress bar indicator on page change
  useEffect(() => {
    setPageLoading(true)
    const id = window.setTimeout(() => setPageLoading(false), 120)
    return () => window.clearTimeout(id)
  }, [location.pathname])

  // Automatically close mobile menu drawer when route changes
  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

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
      className="flex h-screen h-[100dvh] w-full overflow-hidden bg-white selection:bg-[#285A48] selection:text-white"
      onPointerMove={handlePointerMove}
      onPointerLeave={() => {
        setHoveredSidebar(false)
        manualToggleLockRef.current = false
      }}
    >
      {/* Brand Top Page Loading Bar */}
      <div
        aria-hidden="true"
        className={`pointer-events-none fixed inset-x-0 top-0 z-[100] h-0.5 origin-left bg-[#285A48] transition-transform duration-300 ease-out ${
          pageLoading ? 'scale-x-100 opacity-100' : 'scale-x-0 opacity-0'
        }`}
      />

      {/* Desktop Persistent Sidebar & Slide-in Mobile Drawer */}
      <Sidebar
        collapsed={!sidebarExpanded}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
        onToggle={toggle}
      />

      {/* Main Canvas Area */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Scrollable Content Area */}
        <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[#F6F8F7] pt-[env(safe-area-inset-top,0px)] md:pt-0">
          <div
            className={`mx-auto flex min-h-full max-w-screen-2xl flex-col ${
              isPaymentPage
                ? 'pb-0'
                : 'pb-[calc(5rem+env(safe-area-inset-bottom,0px))]'
            } md:pb-0`}
          >
            <Outlet />
          </div>
        </main>

        {/* 🟢 Bottom Navigation: Hidden on the payment screen to leave room for Pay/Settle */}
        {!isPaymentPage && (
          <MobileBottomNav onOpenMenu={() => setMobileOpen(true)} />
        )}
      </div>
    </div>
  )
}

export default MainLayout