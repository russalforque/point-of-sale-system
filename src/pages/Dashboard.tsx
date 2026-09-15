import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { dashboardApi } from '../api/dashboardApi'
import { DataCard, DesktopPage, SafeImage, SecondaryButton, SectionCard } from '../components/ui/DesktopKit'
import { ChevronRight, X } from '../components/ui/Icons'
import { EmptyState, ErrorState, Spinner } from '../components/ui/States'
import { useAuth } from '../context/AuthContext'
import { useSettings } from '../context/SettingsContext'
import { useAsync } from '../hooks/useAsync'
import { useIsMobile } from '../hooks/useIsMobile'
import { usePersistentNotifications } from '../hooks/usePersistentNotifications'
import { formatDateTime, formatMoney } from '../utils/format'
import MobileDashboard from './mobile/MobileDashboard'

/* =============================================================
   TYPES
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
  paymentMethod?: string
}

export interface TopSellingProduct {
  productId: string | number
  name: string
  imageUrl?: string | null
  quantitySold: number
  revenue?: number
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

const GREEN = '#1F5E3B'
const BAR_PAST = '#D3E6DB'

/** Compact currency for axis ticks only ("₱1.2k"); every other value uses full precision. */
function formatCompactMoney(amount: number, symbol: string): string {
  if (Math.abs(amount) >= 1000) {
    return `${symbol}${(amount / 1000).toLocaleString('en-PH', { maximumFractionDigits: 1 })}k`
  }
  return `${symbol}${Math.round(amount).toLocaleString('en-PH')}`
}

/* =============================================================
   MAIN EXPORT: AUTO-SWITCHER
============================================================= */

export function DashboardPage() {
  const isMobile = useIsMobile()
  if (isMobile) return <MobileDashboard />
  return <DesktopDashboard />
}

/* =============================================================
   DESKTOP DASHBOARD
============================================================= */

function DesktopDashboard() {
  const { settings } = useSettings()
  const { can } = useAuth()
  const money = (value: number) => formatMoney(value, settings.currencySymbol)

  const { data, loading, error, reload } = useAsync<DashboardData>(() => dashboardApi.get(), [])
  const [loadedAt, setLoadedAt] = useState<Date | null>(null)

  useEffect(() => {
    if (data) setLoadedAt(new Date())
  }, [data])

  const generatedNotifications = useMemo<AppNotification[]>(() => {
    if (!data) return []
    const items: AppNotification[] = []

    data.lowStockProducts
      ?.filter((p) => p.stockQuantity <= 0)
      .forEach((p) => {
        items.push({
          id: `oos-${p.id}`,
          title: 'Out of stock',
          description: `${p.name} (${p.sku}) has no units left.`,
          timestamp: 'Now',
          type: 'critical',
          read: false,
        })
      })

    data.lowStockProducts
      ?.filter((p) => p.stockQuantity > 0)
      .slice(0, 3)
      .forEach((p) => {
        items.push({
          id: `low-${p.id}`,
          title: 'Running low',
          description: `${p.name}: ${p.stockQuantity} left (low-stock alert at ${p.reorderLevel}).`,
          timestamp: 'Reorder',
          type: 'warning',
          read: false,
        })
      })

    data.recentTransactions?.slice(0, 2).forEach((tx) => {
      items.push({
        id: `tx-${tx.id}`,
        title: 'Sale completed',
        description: `${tx.invoiceNumber} · ${formatMoney(tx.total, settings.currencySymbol)}`,
        timestamp: formatDateTime(tx.createdAt),
        type: 'info',
        read: false,
      })
    })

    return items
  }, [data, settings.currencySymbol])

  // Read / dismissed state is persisted so it survives reloads and navigation.
  const { notifications, markAsRead, markAllAsRead, clearAll, dismiss } = usePersistentNotifications(
    generatedNotifications,
    Boolean(data),
  )

  const todayLabel = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  if (loading && !data) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center bg-[#F6F8F7]">
        <Spinner />
      </div>
    )
  }

  if (!data) {
    return (
      <DesktopPage title="Dashboard" subtitle={todayLabel}>
        <div className="mt-6">
          {error ? <ErrorState message={error} onRetry={() => void reload()} /> : <EmptyState title="No dashboard data yet" />}
        </div>
      </DesktopPage>
    )
  }

  /* ------------------------------------------------------------------
     DERIVED (salesOverview = last 7 days, oldest first; last entry is today)
  ------------------------------------------------------------------ */

  const overview = data.salesOverview
  const yesterdaySales = overview.length >= 2 ? overview[overview.length - 2]?.amount ?? 0 : 0
  const weekTotal = overview.reduce((sum, day) => sum + day.amount, 0)
  const averageSale = data.todaysTransactions > 0 ? data.todaysSales / data.todaysTransactions : 0
  const vsYesterday = yesterdaySales > 0 ? ((data.todaysSales - yesterdaySales) / yesterdaySales) * 100 : null
  const outOfStock = data.lowStockProducts.filter((p) => p.stockQuantity <= 0).length
  const hasWeekSales = overview.some((day) => day.amount > 0)
  const stockLink = can('inventory.manage') ? '/inventory' : can('products.view') ? '/products' : null

  return (
    <DesktopPage
      title="Dashboard"
      subtitle={`${todayLabel}${loadedAt ? ` · Updated ${loadedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}`}
      actions={
        <>
          <SecondaryButton onClick={() => void reload()} disabled={loading}>
            <RefreshIcon spinning={loading} />
            Refresh
          </SecondaryButton>
          <NotificationBell
            notifications={notifications}
            onMarkAsRead={markAsRead}
            onMarkAllAsRead={markAllAsRead}
            onClearAll={clearAll}
            onDismiss={dismiss}
          />
          {can('sales.process') && (
            <Link
              to="/sales"
              className="inline-flex h-11 items-center gap-2 rounded-full bg-[#1F5E3B] px-5 text-sm font-semibold text-white transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B] focus-visible:ring-offset-2"
            >
              Start new sale
            </Link>
          )}
        </>
      }
    >
      {error && (
        <p className="mt-6 rounded-2xl bg-rose-50 px-5 py-3 text-sm text-rose-700">Couldn’t refresh: {error}. Showing the last loaded numbers.</p>
      )}

      {/* ATTENTION — only when stock needs action */}
      {data.lowStockCount > 0 && (
        <div className="mt-6 flex flex-wrap items-center gap-3 rounded-2xl bg-amber-50 px-5 py-3.5">
          <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" aria-hidden="true" />
          <p className="min-w-0 flex-1 text-sm text-amber-900">
            <span className="font-semibold">
              {data.lowStockCount} {data.lowStockCount === 1 ? 'product needs' : 'products need'} restocking
            </span>
            {outOfStock > 0 && ` · ${outOfStock} out of stock`}
          </p>
          {stockLink && (
            <Link to={stockLink} className="inline-flex h-9 items-center gap-1 rounded-full bg-white px-4 text-sm font-medium text-amber-900 hover:bg-amber-100">
              Review stock
              <ChevronRight size={10} />
            </Link>
          )}
        </div>
      )}

      {/* KEY NUMBERS */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Sales today"
          value={money(data.todaysSales)}
          highlight
          footer={
            vsYesterday === null ? (
              <span className="text-slate-500">No sales yesterday to compare</span>
            ) : (
              <span className={vsYesterday >= 0 ? 'text-[#1F5E3B]' : 'text-rose-600'}>
                {vsYesterday >= 0 ? '▲' : '▼'} {Math.abs(vsYesterday).toFixed(0)}% <span className="text-slate-500">vs yesterday</span>
              </span>
            )
          }
        />
        <KpiCard
          label="Transactions today"
          value={String(data.todaysTransactions)}
          footer={<span className="text-slate-500">{data.todaysTransactions > 0 ? `Average sale ${money(averageSale)}` : 'No sales yet today'}</span>}
        />
        <KpiCard label="Last 7 days" value={money(weekTotal)} footer={<span className="text-slate-500">Completed sales</span>} to={can('reports.view') ? '/reports' : undefined} />
        <KpiCard
          label="Customers"
          value={data.totalCustomers.toLocaleString()}
          footer={<span className="text-slate-500">{data.totalProducts.toLocaleString()} active products</span>}
          to={can('customers.view') ? '/customers' : undefined}
        />
      </div>

      {/* TREND + TOP SELLERS */}
      <div className="mt-6 grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <SectionCard title="Last 7 days" description={hasWeekSales ? `${money(weekTotal)} in completed sales` : undefined}>
          {hasWeekSales ? (
            <div className="h-60 w-full min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={overview} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    interval={0}
                    tick={({ x, y, payload, index }) => (
                      <text
                        x={Number(x)}
                        y={Number(y) + 14}
                        textAnchor="middle"
                        fontSize={12}
                        fontWeight={index === overview.length - 1 ? 600 : 400}
                        fill={index === overview.length - 1 ? '#091413' : '#94A3B8'}
                      >
                        {index === overview.length - 1 ? 'Today' : payload.value}
                      </text>
                    )}
                  />
                  <YAxis
                    tick={{ fontSize: 12, fill: '#94A3B8' }}
                    tickLine={false}
                    axisLine={false}
                    width={56}
                    tickFormatter={(value) => formatCompactMoney(Number(value), settings.currencySymbol)}
                    allowDecimals={false}
                  />
                  <Tooltip
                    cursor={{ fill: '#F6F8F7' }}
                    content={({ active, payload, label }) =>
                      active && payload?.length ? (
                        <div className="rounded-lg bg-[#091413] px-3 py-2 text-white">
                          <p className="text-[11px] text-white/60">{label}</p>
                          <p className="text-sm font-semibold tabular-nums">{money(Number(payload[0]?.value ?? 0))}</p>
                        </div>
                      ) : null
                    }
                  />
                  <Bar dataKey="amount" radius={[6, 6, 0, 0]} maxBarSize={44} minPointSize={3}>
                    {overview.map((day, index) => (
                      <Cell key={`${day.label}-${index}`} fill={index === overview.length - 1 ? GREEN : BAR_PAST} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex h-60 items-center justify-center text-sm text-slate-400">No sales in the last 7 days.</div>
          )}
        </SectionCard>

        <SectionCard title="Top sellers" description="Best sellers by units, all time">
          {data.topSellingProducts.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-400">No products sold yet.</p>
          ) : (
            <ul>
              {data.topSellingProducts.slice(0, 5).map((product, index) => (
                <li key={product.productId} className="flex min-h-14 items-center gap-3 border-b border-slate-100 py-2 last:border-b-0">
                  <span className="w-4 shrink-0 text-center text-sm tabular-nums text-slate-400">{index + 1}</span>
                  <ProductThumb name={product.name} imageUrl={product.imageUrl} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium" title={product.name}>
                      {product.name}
                    </p>
                    {typeof product.revenue === 'number' && <p className="text-xs tabular-nums text-slate-400">{money(product.revenue)}</p>}
                  </div>
                  <span className="shrink-0 text-sm tabular-nums text-slate-500">{product.quantitySold} sold</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      {/* RECENT SALES + LOW STOCK */}
      <div className="mt-6 grid min-w-0 gap-6 xl:grid-cols-2">
        <DataCard>
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-6 py-4">
            <h2 className="text-base font-semibold">Recent sales</h2>
            {can('reports.view') && (
              <Link to="/reports" className="inline-flex h-9 items-center gap-1 rounded-full px-3 text-sm font-medium text-[#1F5E3B] hover:bg-[#F2F8F4]">
                View all
                <ChevronRight size={10} />
              </Link>
            )}
          </div>
          {data.recentTransactions.length === 0 ? (
            <p className="px-6 py-12 text-center text-sm text-slate-400">No sales yet. Completed sales will show up here.</p>
          ) : (
            <ul>
              {data.recentTransactions.map((tx) => (
                <li key={tx.id} className="flex min-h-16 items-center gap-4 border-b border-slate-100 px-6 py-3 last:border-b-0">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{tx.customerName || 'Walk-in customer'}</p>
                    <p className="truncate text-xs text-slate-400">
                      {tx.invoiceNumber}
                      {tx.paymentMethod ? ` · ${tx.paymentMethod}` : ''} · {formatDateTime(tx.createdAt)}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-medium tabular-nums">{money(tx.total)}</span>
                </li>
              ))}
            </ul>
          )}
        </DataCard>

        <DataCard>
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-6 py-4">
            <div>
              <h2 className="text-base font-semibold">Low stock</h2>
              <p className="text-xs text-slate-500">At or below the low-stock alert</p>
            </div>
            {stockLink && data.lowStockProducts.length > 0 && (
              <Link to={stockLink} className="inline-flex h-9 items-center gap-1 rounded-full px-3 text-sm font-medium text-[#1F5E3B] hover:bg-[#F2F8F4]">
                {stockLink === '/inventory' ? 'Update stock' : 'View products'}
                <ChevronRight size={10} />
              </Link>
            )}
          </div>
          {data.lowStockProducts.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <p className="text-sm font-medium">Stock levels look healthy</p>
              <p className="mt-1 text-sm text-slate-400">All {data.totalProducts} active products are above their low-stock alert.</p>
            </div>
          ) : (
            <ul>
              {data.lowStockProducts.map((product) => {
                const depleted = product.stockQuantity <= 0
                const fill = product.reorderLevel > 0 ? Math.min(100, (product.stockQuantity / product.reorderLevel) * 100) : 0
                return (
                  <li key={product.id} className="flex min-h-16 items-center gap-4 border-b border-slate-100 px-6 py-3 last:border-b-0">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium" title={product.name}>
                        {product.name}
                      </p>
                      <div className="mt-1.5 flex items-center gap-2">
                        <div
                          className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100"
                          role="progressbar"
                          aria-label={`${product.name} stock level`}
                          aria-valuenow={product.stockQuantity}
                          aria-valuemin={0}
                          aria-valuemax={product.reorderLevel}
                        >
                          <div className={`h-full rounded-full ${fill <= 25 ? 'bg-rose-500' : 'bg-amber-400'}`} style={{ width: `${fill}%` }} />
                        </div>
                        <span className="truncate text-xs text-slate-400">SKU {product.sku}</span>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className={`text-sm font-semibold tabular-nums ${depleted ? 'text-rose-600' : 'text-amber-700'}`}>
                        {depleted ? 'Out of stock' : `${product.stockQuantity} left`}
                      </p>
                      <p className="text-xs tabular-nums text-slate-400">alert at {product.reorderLevel}</p>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </DataCard>
      </div>
    </DesktopPage>
  )
}

/* =============================================================
   PIECES
============================================================= */

function KpiCard({
  label,
  value,
  footer,
  highlight = false,
  to,
}: {
  label: string
  value: string
  footer?: ReactNode
  highlight?: boolean
  to?: string
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className={`truncate text-sm ${highlight ? 'font-medium text-[#1F5E3B]' : 'text-slate-500'}`}>{label}</p>
        {to && <ChevronRight size={10} className="shrink-0 text-slate-300 transition group-hover:text-[#1F5E3B]" />}
      </div>
      <p className="mt-1 truncate text-2xl font-bold tabular-nums tracking-tight">{value}</p>
      {footer && <p className="mt-1 truncate text-xs">{footer}</p>}
    </>
  )

  const className = `group block rounded-2xl p-5 ring-1 transition ${highlight ? 'bg-[#F2F8F4] ring-[#DCE9E1]' : 'bg-white ring-slate-100'}`

  return to ? (
    <Link
      to={to}
      className={`${className} hover:ring-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B]`}
    >
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  )
}

function ProductThumb({ name, imageUrl }: { name: string; imageUrl?: string | null }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
  const fallback = <span className="text-xs font-semibold text-slate-400">{initials}</span>

  return (
    <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[#F3F5F4]">
      {imageUrl ? <SafeImage src={imageUrl} className="h-full w-full object-cover" fallback={fallback} /> : fallback}
    </span>
  )
}

/* =============================================================
   NOTIFICATION BELL
============================================================= */

interface NotificationBellProps {
  notifications: AppNotification[]
  onMarkAsRead: (id: string) => void
  onMarkAllAsRead: () => void
  onClearAll: () => void
  onDismiss: (id: string) => void
}

function NotificationBell({ notifications, onMarkAsRead, onMarkAllAsRead, onClearAll, onDismiss }: NotificationBellProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [showUnreadOnly, setShowUnreadOnly] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const unreadCount = useMemo(() => notifications.filter((n) => !n.read).length, [notifications])
  const displayed = showUnreadOnly ? notifications.filter((n) => !n.read) : notifications

  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setIsOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        className={`relative flex h-11 w-11 items-center justify-center rounded-full ring-1 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B] ${
          isOpen ? 'bg-[#F2F8F4] text-[#1F5E3B] ring-[#1F5E3B]' : 'bg-white text-[#091413] ring-slate-200 hover:bg-slate-50'
        }`}
      >
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[11px] font-semibold text-white ring-2 ring-[#F6F8F7]">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 z-50 mt-2 w-96 overflow-hidden rounded-2xl bg-white shadow-[0_12px_40px_rgba(9,20,19,0.14)] ring-1 ring-slate-100"
        >
          <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-3">
            <p className="text-sm font-semibold">Notifications</p>
            <div className="flex items-center">
              {unreadCount > 0 && (
                <button type="button" onClick={onMarkAllAsRead} className="h-9 rounded-lg px-2 text-xs font-medium text-[#1F5E3B] hover:bg-[#F2F8F4]">
                  Mark all read
                </button>
              )}
              {notifications.length > 0 && (
                <button type="button" onClick={onClearAll} className="h-9 rounded-lg px-2 text-xs text-slate-500 hover:bg-slate-100">
                  Clear
                </button>
              )}
            </div>
          </div>

          <div className="flex gap-1 px-4 pb-2">
            {[
              { key: false, label: `All (${notifications.length})` },
              { key: true, label: `Unread (${unreadCount})` },
            ].map((tab) => (
              <button
                key={String(tab.key)}
                type="button"
                onClick={() => setShowUnreadOnly(tab.key)}
                aria-pressed={showUnreadOnly === tab.key}
                className={`h-8 rounded-full px-3 text-xs font-medium transition ${
                  showUnreadOnly === tab.key ? 'bg-[#1F5E3B] text-white' : 'bg-[#F3F5F4] text-slate-600 hover:bg-[#E9EEEB]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <ul className="max-h-96 overflow-y-auto border-t border-slate-100">
            {displayed.length === 0 ? (
              <li className="px-4 py-10 text-center text-sm text-slate-400">You’re all caught up.</li>
            ) : (
              displayed.map((n) => (
                <li key={n.id} className={`group flex items-start gap-2 border-b border-slate-100 px-4 py-3 last:border-b-0 ${n.read ? '' : 'bg-[#F7FAF8]'}`}>
                  <span
                    aria-hidden="true"
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                      !n.read ? (n.type === 'critical' ? 'bg-rose-500' : n.type === 'warning' ? 'bg-amber-400' : 'bg-[#1F5E3B]') : 'bg-transparent'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => !n.read && onMarkAsRead(n.id)}
                    className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B] rounded-lg"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <p className={`text-sm ${n.read ? 'text-slate-500' : 'font-medium'}`}>{n.title}</p>
                      <span className="shrink-0 text-[11px] text-slate-400">{n.timestamp}</span>
                    </div>
                    <p className="mt-0.5 text-xs leading-5 text-slate-500">{n.description}</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDismiss(n.id)}
                    aria-label={`Dismiss ${n.title}`}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-300 opacity-0 transition hover:bg-slate-100 hover:text-slate-600 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B] group-hover:opacity-100"
                  >
                    <X size={12} />
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  )
}

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={spinning ? 'animate-spin' : ''} aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-9-9c2.5 0 4.9 1 6.7 2.7L21 8" />
      <path d="M21 3v5h-5" />
    </svg>
  )
}
