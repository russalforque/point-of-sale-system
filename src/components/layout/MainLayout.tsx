import { useEffect, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useSettings } from '../../context/SettingsContext'
import { BusinessSettings } from '../settings/BusinessSettings'
import { AppLoader, ErrorState } from '../ui/States'
import { hasLocalDatabase } from '../../services/platform'
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
  const { settings, error: settingsError, reload: reloadSettings } = useSettings()
  useAndroidBackButton()
  const [pageLoading, setPageLoading] = useState(false)
  const [collapsed, setCollapsed] = useState(getInitialCollapsed)

  // ðŸŸ¢ Detect if we are on the payment/checkout screen
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

  if (!settings.id && hasLocalDatabase()) return settingsError ? <ErrorState message={settingsError} onRetry={() => void reloadSettings()} /> : <AppLoader label="Loading store settingsâ€¦" />
  if (!settings.businessSetupComplete) return <BusinessSettings setup />
  const shared = /^\/(dashboard|customers|reports|settings|shift|shift-history|users|audit-log|printer-settings|access-denied)(\/|$)/.test(location.pathname)
  if (settings.businessType === 'laundry' && !shared && !location.pathname.startsWith('/laundry/')) return <Navigate to="/dashboard" replace />
  if (settings.businessType === 'retail' && location.pathname.startsWith('/laundry/')) return <Navigate to="/dashboard" replace />

  return (
    <div data-business-type={settings.businessType} style={{ height: 'var(--app-height, 100dvh)', paddingTop: 'env(safe-area-inset-top,0px)', paddingLeft: 'env(safe-area-inset-left,0px)', paddingRight: 'env(safe-area-inset-right,0px)' }} className="flex w-full overflow-hidden bg-white selection:bg-[#285A48] selection:text-white">
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
        <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[#F6F8F7] scroll-pb-24 md:pb-[env(safe-area-inset-bottom,0px)]">
          <div
            className={`mx-auto flex min-h-full max-w-screen-2xl flex-col ${
              isPaymentPage
                ? 'pb-0'
                : settings.businessType === 'laundry' ? 'pb-6' : 'pb-[calc(5rem+env(safe-area-inset-bottom,0px))]'
            } md:pb-0`}
          >
            <Outlet />
          </div>
        </main>

        {/* ðŸŸ¢ Bottom Navigation: Hidden on the payment screen to leave room for Pay/Settle */}
        {!isPaymentPage && (
          <MobileBottomNav />
        )}
      </div>
    </div>
  )
}

export default MainLayout
