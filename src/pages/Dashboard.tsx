import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import {
  faArrowTrendUp,
  faReceipt,
  faUsers,
  faBoxesStacked,
} from '@fortawesome/free-solid-svg-icons'

import { dashboardApi } from '../api/dashboardApi'
import { PageHeader } from '../components/ui/Page'
import {
  EmptyState,
  ErrorState,
  Spinner,
} from '../components/ui/States'
import { useSettings } from '../context/SettingsContext'
import { useAsync } from '../hooks/useAsync'
import {
  formatDateTime,
  formatMoney,
} from '../utils/format'

// 1. Import your dedicated Mobile Dashboard component
import MobileDashboard from "./mobile/MobileDashboard";

/* =============================================================
   MOBILE DETECTION HOOK
============================================================= */

function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth < breakpoint
    }
    return false
  })

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`)
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches)

    setIsMobile(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [breakpoint])

  return isMobile
}

/* =============================================================
   MAIN EXPORT: AUTO-SWITCHER
============================================================= */

export function DashboardPage() {
  const isMobile = useIsMobile(768)

  // 📱 Render MobileDashboard when on mobile devices (< 768px)
  if (isMobile) {
    return <MobileDashboard />
  }

  // 💻 Otherwise, render Desktop Dashboard
  return <DesktopDashboard />
}

/* =============================================================
   TYPES & NOTIFICATION INTERFACES
============================================================= */

export interface LowStockProduct {
  id: string | number
  name: string
  sku: string
  stockQuantity: number
  reorderLevel: number
}

export interface RecentTransaction {
  id: string | number
  invoiceNumber: string
  customerName?: string | null
  total: number
  createdAt: string
}

export interface TopSellingProduct {
  productId: string | number
  name: string
  quantitySold: number
}

export interface SalesOverviewItem {
  label: string
  amount: number
}

export interface DashboardData {
  todaysSales: number
  todaysTransactions: number
  totalCustomers: number
  totalProducts: number
  lowStockCount: number
  lowStockProducts: LowStockProduct[]
  recentTransactions: RecentTransaction[]
  topSellingProducts: TopSellingProduct[]
  salesOverview: SalesOverviewItem[]
}

interface AppNotification {
  id: string
  title: string
  description: string
  timestamp: string
  type: 'critical' | 'warning' | 'info'
  read: boolean
}

/* =============================================================
   DESKTOP DASHBOARD IMPLEMENTATION
============================================================= */

function DesktopDashboard() {
  const { settings } = useSettings()

  const {
    data,
    loading,
    error,
    reload,
  } = useAsync<DashboardData>(() => dashboardApi.get(), [])

  const generatedNotifications = useMemo<AppNotification[]>(() => {
    if (!data) return []

    const items: AppNotification[] = []

    // 1. Depleted stock
    data.lowStockProducts
      ?.filter((p: LowStockProduct) => p.stockQuantity <= 0)
      .forEach((p: LowStockProduct) => {
        items.push({
          id: `oos-${p.id}`,
          title: 'Stock Depleted',
          description: `${p.name} (${p.sku}) is completely out of stock!`,
          timestamp: 'Just now',
          type: 'critical',
          read: false,
        })
      })

    // 2. Low stock items
    data.lowStockProducts
      ?.filter((p: LowStockProduct) => p.stockQuantity > 0)
      .slice(0, 3)
      .forEach((p: LowStockProduct) => {
        items.push({
          id: `low-${p.id}`,
          title: 'Low Stock Warning',
          description: `${p.name} has only ${p.stockQuantity} units left (Reorder at ${p.reorderLevel}).`,
          timestamp: 'Action needed',
          type: 'warning',
          read: false,
        })
      })

    // 3. Newest transactions
    data.recentTransactions?.slice(0, 2).forEach((tx: RecentTransaction) => {
      items.push({
        id: `tx-${tx.id}`,
        title: 'Transaction Processed',
        description: `Invoice ${tx.invoiceNumber} paid: ${formatMoney(tx.total, settings.currencySymbol)}`,
        timestamp: formatDateTime(tx.createdAt),
        type: 'info',
        read: false,
      })
    })

    return items
  }, [data, settings.currencySymbol])

  const [notifications, setNotifications] = useState<AppNotification[]>([])

  useEffect(() => {
    if (generatedNotifications.length > 0) {
      setNotifications(generatedNotifications)
    }
  }, [generatedNotifications])

  const handleMarkAsRead = (id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    )
  }

  const handleMarkAllAsRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
  }

  const handleClearAll = () => {
    setNotifications([])
  }

  const handleDismiss = (id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id))
  }

  if (loading && !data) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-4">
        <Spinner />
      </div>
    )
  }

  if (error) {
    return (
      <div className="mx-auto max-w-7xl px-3.5 py-6 sm:px-6 sm:py-8 md:px-8">
        <ErrorState message={error} onRetry={() => void reload()} />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-7xl px-3.5 py-6 sm:px-6 sm:py-8 md:px-8">
        <EmptyState title="No dashboard data" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#091413]/[0.02] text-[#091413] antialiased">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 md:px-8 py-6">
        {/* Page Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <PageHeader
            title="Dashboard"
            subtitle="Store performance and live operational metrics"
          />

          <div className="flex items-center gap-3 self-end sm:self-auto">
            <NotificationBell
              notifications={notifications}
              onMarkAsRead={handleMarkAsRead}
              onMarkAllAsRead={handleMarkAllAsRead}
              onClearAll={handleClearAll}
              onDismiss={handleDismiss}
            />

            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[#091413]/10 bg-white px-2.5 py-1.5 text-xs font-medium text-[#091413]/70 shadow-xs select-none">
              <svg
                className="h-3.5 w-3.5 shrink-0 text-[#285A48]"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth="1.75"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6.75 3v2.25M17.25 3v2.25M3 7.5h18M4.5 4.5h15a2.25 2.25 0 012.25 2.25v13.5A2.25 2.25 0 0119.5 22.5H4.5A2.25 2.25 0 012.25 20.25V6.75A2.25 2.25 0 014.5 4.5z"
                />
              </svg>
              <span>
                {new Date().toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </span>
            </span>
          </div>
        </div>

        {/* Metric KPI Cards */}
        <div className="mt-2 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
          <MetricCard
            icon={faArrowTrendUp}
            label="Today's Sales"
            value={formatMoney(data.todaysSales, settings.currencySymbol)}
            indicator="brand"
            sublabel="Real-time revenue"
          />
          <MetricCard
            icon={faReceipt}
            label="Transactions"
            value={String(data.todaysTransactions)}
            indicator="brand"
            sublabel="Completed checkouts"
          />
          <MetricCard
            icon={faUsers}
            label="Total Customers"
            value={String(data.totalCustomers)}
            sublabel="Registered accounts"
          />
          <MetricCard
            icon={faBoxesStacked}
            label="Active Products"
            value={data.totalProducts.toLocaleString()}
            sublabel="In-catalog items"
          />
        </div>

        {/* Charts Section */}
        <div className="mt-6 grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.8fr)_minmax(320px,1fr)]">
          {/* Sales Overview Chart */}
          <div className="overflow-hidden rounded-xl border border-[#091413]/10 bg-white p-5 shadow-xs transition-colors hover:border-[#285A48]/30">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-[#091413]/60">
                  Sales Overview
                </h2>
                <p className="mt-0.5 text-xs text-[#091413]/40">Last 7 days revenue</p>
              </div>

              <span className="rounded-md border border-[#285A48]/20 bg-[#285A48]/5 px-2 py-0.5 text-[11px] font-medium text-[#285A48]">
                Weekly
              </span>
            </div>

            {data.salesOverview.every((p: SalesOverviewItem) => p.amount === 0) ? (
              <div className="flex h-56 items-center justify-center">
                <EmptyState title="No sales recorded in the last 7 days" />
              </div>
            ) : (
              <div className="h-56 w-full min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={data.salesOverview}
                    margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
                  >
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11, fill: '#091413', opacity: 0.6 }}
                      tickLine={false}
                      axisLine={{ stroke: '#091413', opacity: 0.1 }}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: '#091413', opacity: 0.6 }}
                      tickLine={false}
                      axisLine={false}
                      width={38}
                    />
                    <Tooltip
                      cursor={{ fill: 'rgba(40, 90, 72, 0.06)' }}
                      contentStyle={{
                        backgroundColor: '#ffffff',
                        border: '1px solid rgba(40, 90, 72, 0.25)',
                        borderRadius: 8,
                        boxShadow: '0 4px 14px rgba(9, 20, 19, 0.08)',
                        fontSize: 12,
                        color: '#091413',
                      }}
                      formatter={(value) => [
                        formatMoney(Number(value), settings.currencySymbol),
                        'Sales',
                      ]}
                    />
                    <Bar
                      dataKey="amount"
                      fill="#285A48"
                      radius={[4, 4, 0, 0]}
                      maxBarSize={32}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Best Selling Products */}
          <div className="overflow-hidden rounded-xl border border-[#091413]/10 bg-white p-5 shadow-xs transition-colors hover:border-[#285A48]/30 flex flex-col justify-between">
            <div>
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-[#091413]/60">
                    Best Selling
                  </h2>
                  <p className="mt-0.5 text-xs text-[#091413]/40">Top 5 items by volume</p>
                </div>
                <span className="rounded-md border border-[#285A48]/20 bg-[#285A48]/5 px-2 py-0.5 text-[11px] font-medium text-[#285A48]">
                  Top Units
                </span>
              </div>

              {data.topSellingProducts.length === 0 ? (
                <div className="flex h-56 items-center justify-center">
                  <EmptyState title="No product sales yet" />
                </div>
              ) : (
                <ul className="divide-y divide-[#091413]/5">
                  {data.topSellingProducts.slice(0, 5).map((p: TopSellingProduct, index: number) => (
                    <li
                      key={p.productId}
                      className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[#285A48]/20 bg-[#285A48]/10 font-mono text-[11px] font-semibold text-[#285A48]">
                        {index + 1}
                      </span>
                      <div className="min-w-0 flex-1 truncate">
                        <p className="truncate text-xs font-medium text-[#091413]" title={p.name}>
                          {p.name}
                        </p>
                      </div>
                      <span className="rounded-md border border-[#091413]/5 bg-[#091413]/[0.03] px-2 py-0.5 font-mono text-xs font-medium text-[#091413]/80">
                        {p.quantitySold} sold
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>

        {/* Operational Tables */}
        <div className="mt-6 grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
          {/* Recent Transactions Table */}
          <div className="overflow-hidden rounded-xl border border-[#091413]/10 bg-white shadow-xs transition-colors hover:border-[#285A48]/30">
            <div className="border-b border-[#091413]/10 px-5 py-3.5 flex items-center justify-between">
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-[#091413]/60">
                  Recent Transactions
                </h2>
                <p className="mt-0.5 text-[11px] text-[#091413]/40">Latest store checkout logs</p>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#285A48]/20 bg-[#285A48]/10 px-2 py-0.5 text-[11px] font-medium text-[#285A48]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#285A48]" />
                Live
              </span>
            </div>

            {data.recentTransactions.length === 0 ? (
              <div className="p-8">
                <EmptyState title="No transactions yet" />
              </div>
            ) : (
              <div className="w-full overflow-x-auto">
                <table className="w-full text-left text-xs text-[#091413]/70">
                  <thead className="border-b border-[#091413]/10 bg-[#091413]/[0.02] text-[11px] font-medium uppercase tracking-wider text-[#091413]/50">
                    <tr>
                      <th className="py-2.5 pl-5 pr-3 font-medium">Invoice</th>
                      <th className="py-2.5 px-3 font-medium">Customer</th>
                      <th className="py-2.5 px-3 text-right font-medium">Total</th>
                      <th className="py-2.5 pl-3 pr-5 text-right font-medium">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#091413]/5 font-normal">
                    {data.recentTransactions.map((row: RecentTransaction) => (
                      <tr key={row.id} className="transition-colors hover:bg-[#285A48]/[0.03]">
                        <td className="py-3 pl-5 pr-3 font-mono text-xs font-medium text-[#091413]">
                          {row.invoiceNumber}
                        </td>
                        <td className="py-3 px-3 text-[#091413]/80 truncate max-w-[140px]" title={row.customerName ?? 'Walk-in'}>
                          {row.customerName ?? 'Walk-in'}
                        </td>
                        <td className="py-3 px-3 text-right font-mono font-medium text-[#091413] whitespace-nowrap">
                          {formatMoney(row.total, settings.currencySymbol)}
                        </td>
                        <td className="py-3 pl-3 pr-5 text-right text-[11px] text-[#091413]/40 whitespace-nowrap">
                          {formatDateTime(row.createdAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Inventory Alerts Table */}
          <div className="overflow-hidden rounded-xl border border-[#091413]/10 bg-white shadow-xs transition-colors hover:border-[#285A48]/30">
            <div className="border-b border-[#091413]/10 px-5 py-3.5 flex items-center justify-between">
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-[#091413]/60">
                  Inventory Alerts
                </h2>
                <p className="mt-0.5 text-[11px] text-[#091413]/40">Products at or below reorder level</p>
              </div>

              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  data.lowStockCount > 0
                    ? 'bg-rose-50 text-rose-700 border border-rose-200/60'
                    : 'bg-[#285A48]/10 text-[#285A48] border border-[#285A48]/20'
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    data.lowStockCount > 0 ? 'bg-rose-500' : 'bg-[#285A48]'
                  }`}
                />
                {data.lowStockCount} low stock
              </span>
            </div>

            {data.lowStockProducts.length === 0 ? (
              <div className="p-8">
                <EmptyState
                  title="Stock levels look healthy"
                  hint="All products are currently above their specified reorder thresholds."
                />
              </div>
            ) : (
              <div className="w-full overflow-x-auto">
                <table className="w-full text-left text-xs text-[#091413]/70">
                  <thead className="border-b border-[#091413]/10 bg-[#091413]/[0.02] text-[11px] font-medium uppercase tracking-wider text-[#091413]/50">
                    <tr>
                      <th className="py-2.5 pl-5 pr-3 font-medium">Product</th>
                      <th className="py-2.5 px-3 font-medium">SKU</th>
                      <th className="py-2.5 pl-3 pr-5 text-right font-medium">Stock / Reorder</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#091413]/5 font-normal">
                    {data.lowStockProducts.map((row: LowStockProduct) => (
                      <tr key={row.id} className="transition-colors hover:bg-[#285A48]/[0.03]">
                        <td className="py-3 pl-5 pr-3 font-medium text-[#091413] truncate max-w-[170px]" title={row.name}>
                          {row.name}
                        </td>
                        <td className="py-3 px-3 font-mono text-[11px] text-[#091413]/50 truncate max-w-[100px]" title={row.sku}>
                          {row.sku}
                        </td>
                        <td className="py-3 pl-3 pr-5 text-right font-mono whitespace-nowrap">
                          <span className="font-semibold text-rose-600">
                            {row.stockQuantity}
                          </span>
                          <span className="text-[#091413]/40"> / {row.reorderLevel}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/* =============================================================
   NOTIFICATION BELL COMPONENT
============================================================= */

interface NotificationBellProps {
  notifications: AppNotification[]
  onMarkAsRead: (id: string) => void
  onMarkAllAsRead: () => void
  onClearAll: () => void
  onDismiss: (id: string) => void
}

function NotificationBell({
  notifications,
  onMarkAsRead,
  onMarkAllAsRead,
  onClearAll,
  onDismiss,
}: NotificationBellProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<'all' | 'unread'>('all')
  const containerRef = useRef<HTMLDivElement>(null)

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications]
  )

  const displayedNotifications = useMemo(() => {
    if (activeTab === 'unread') {
      return notifications.filter((n) => !n.read)
    }
    return notifications
  }, [notifications, activeTab])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('keydown', handleKeyDown)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  return (
    <div className="relative inline-block text-left" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label="Open notifications"
        className={`relative flex h-8 w-8 items-center justify-center rounded-lg border transition-all ${
          isOpen
            ? 'border-[#285A48] bg-[#285A48]/10 text-[#285A48]'
            : 'border-[#091413]/10 bg-white text-[#091413]/70 hover:border-[#285A48]/40 hover:text-[#091413] shadow-xs'
        }`}
      >
        <svg
          className="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth="1.75"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
          />
        </svg>

        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#285A48] px-1 text-[10px] font-bold text-white shadow-xs">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 z-50 mt-2 w-80 sm:w-96 origin-top-right rounded-xl border border-[#091413]/15 bg-white shadow-xl ring-1 ring-black/5 focus:outline-none">
          <div className="flex items-center justify-between border-b border-[#091413]/10 px-4 py-3">
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[#091413]">
                Notifications
              </h3>
              {unreadCount > 0 && (
                <span className="rounded-full bg-[#285A48]/10 text-[#285A48] px-2 py-0.5 text-[10px] font-semibold">
                  {unreadCount} new
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={onMarkAllAsRead}
                  className="text-[11px] font-medium text-[#285A48] hover:text-[#091413] transition-colors"
                >
                  Mark all read
                </button>
              )}
              {notifications.length > 0 && (
                <button
                  type="button"
                  onClick={onClearAll}
                  className="text-[11px] font-medium text-[#091413]/40 hover:text-rose-600 transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          <div className="flex border-b border-[#091413]/10 px-4 py-1.5 gap-2 bg-[#091413]/[0.02]">
            <button
              type="button"
              onClick={() => setActiveTab('all')}
              className={`rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${
                activeTab === 'all'
                  ? 'bg-[#285A48] text-white'
                  : 'text-[#091413]/60 hover:text-[#091413]'
              }`}
            >
              All ({notifications.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('unread')}
              className={`rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${
                activeTab === 'unread'
                  ? 'bg-[#285A48] text-white'
                  : 'text-[#091413]/60 hover:text-[#091413]'
              }`}
            >
              Unread ({unreadCount})
            </button>
          </div>

          <div className="max-h-80 overflow-y-auto divide-y divide-[#091413]/5">
            {displayedNotifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-8 text-center">
                <p className="text-xs font-medium text-[#091413]">All caught up</p>
                <p className="text-[11px] text-[#091413]/40">No new alerts to review</p>
              </div>
            ) : (
              displayedNotifications.map((n) => (
                <div
                  key={n.id}
                  onClick={() => !n.read && onMarkAsRead(n.id)}
                  className={`group relative flex items-start gap-3 p-3.5 transition-colors cursor-pointer ${
                    n.read ? 'bg-white hover:bg-[#091413]/[0.02]' : 'bg-[#285A48]/[0.04] hover:bg-[#285A48]/[0.08]'
                  }`}
                >
                  <span
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                      n.type === 'critical'
                        ? 'bg-rose-500'
                        : n.type === 'warning'
                        ? 'bg-amber-500'
                        : 'bg-[#285A48]'
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1">
                      <p className={`text-xs font-semibold ${n.read ? 'text-[#091413]/70' : 'text-[#091413]'}`}>
                        {n.title}
                      </p>
                      <span className="text-[10px] text-[#091413]/40 shrink-0">{n.timestamp}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-[#091413]/70 line-clamp-2">{n.description}</p>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onDismiss(n.id)
                    }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-[#091413]/40 hover:text-[#091413] rounded"
                    title="Dismiss"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/* =============================================================
   REFINED MICRO-COMPONENTS
============================================================= */

function MetricCard({
  label,
  value,
  icon,
  indicator,
  sublabel,
}: {
  label: string
  value: string | number
  icon?: IconDefinition
  indicator?: 'brand' | 'emerald' | 'amber' | 'rose'
  sublabel?: string
}) {
  return (
    <div className="group relative flex flex-col justify-between rounded-xl border border-[#091413]/10 bg-white p-3.5 sm:p-4 shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-[#285A48]/40 hover:shadow-md hover:shadow-[#091413]/5">
      {/* Top Header Row */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[#091413]/60">
          {label}
        </span>

        {icon ? (
          <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#285A48]/20 bg-[#285A48]/10 text-[#285A48] transition-colors group-hover:bg-[#285A48] group-hover:text-white">
            <FontAwesomeIcon icon={icon} className="h-3.5 w-3.5" />
          </div>
        ) : indicator === 'brand' || indicator === 'emerald' ? (
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#285A48] opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-[#285A48]" />
          </span>
        ) : null}
      </div>

      {/* Main Metric Value */}
      <div className="mt-3">
        <p className="text-xl font-bold tracking-tight text-[#091413] sm:text-2xl font-mono">
          {value}
        </p>
        {sublabel && (
          <p className="mt-1 text-[11px] text-[#091413]/40">
            {sublabel}
          </p>
        )}
      </div>
    </div>
  )
}