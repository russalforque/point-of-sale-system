import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { MobileBottomNav } from '../../pages/mobile/MobileButtomNav'
import { useAndroidBackButton } from '../../hooks/useAndroidBackButton'

const SIDEBAR_STORAGE_KEY = 'sellix.sidebar'

// Start as an icon rail on tablets and desktops so it doesn't eat into the page width;
// hovering or tabbing into the rail previews it. A saved choice always wins.
function getInitialCollapsed() {
  try {
    const saved = localStorage.getItem(SIDEBAR_STORAGE_KEY)
    if (saved !== null) return saved === '1'
  } catch {
    // Storage can be unavailable (private mode); fall back to the default.
  }
  return true
}

export function MainLayout() {
  const location = useLocation()
  useAndroidBackButton()
  const [pageLoading, setPageLoading] = useState(false)
  const [collapsed, setCollapsed] = useState(getInitialCollapsed)

  // 🟢 Detect if we are on the payment/checkout screen
  const isPaymentPage = location.pathname.startsWith('/payment')

  // Progress bar indicator on page change
  useEffect(() => {
    setPageLoading(true)
    const id = window.setTimeout(() => setPageLoading(false), 120)
    return () => window.clearTimeout(id)
  }, [location.pathname])

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, collapsed ? '1' : '0')
    } catch {
      // Not persisting is fine; the toggle still works for this session.
    }
  }, [collapsed])

  return (
    <div className="flex h-screen h-[100dvh] w-full overflow-hidden bg-white selection:bg-[#285A48] selection:text-white">
      {/* Brand Top Page Loading Bar */}
      <div
        aria-hidden="true"
        className={`pointer-events-none fixed inset-x-0 top-0 z-[100] h-0.5 origin-left bg-[#285A48] transition-transform duration-300 ease-out ${
          pageLoading ? 'scale-x-100 opacity-100' : 'scale-x-0 opacity-0'
        }`}
      />

      {/* Tablet / desktop sidebar (phones use the bottom navigation) */}
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((prev) => !prev)} />

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
          <MobileBottomNav />
        )}
      </div>
    </div>
  )
}

export default MainLayout
