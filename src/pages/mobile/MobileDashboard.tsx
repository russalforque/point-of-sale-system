import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from 'recharts'

import { dashboardApi } from '../../api/dashboardApi'
import {
  EmptyState,
  ErrorState,
  Spinner,
} from '../../components/ui/States'
import { useNavigate } from 'react-router-dom'

import { useAuth } from '../../context/AuthContext'
import { useSettings } from '../../context/SettingsContext'
import { useAsync } from '../../hooks/useAsync'
import { useDismissOnBack } from '../../hooks/useDismissOnBack'
import { usePersistentNotifications } from '../../hooks/usePersistentNotifications'
import {
  formatDateTime,
  formatMoney,
} from '../../utils/format'

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
  createdAt: string | Date
  paymentMethod?: string
}

export interface TopSellingProduct {
  productId: string | number
  name: string
  imageUrl?: string | null
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

type MobileFilterTab =
  | 'all'
  | 'sales'
  | 'transactions'
  | 'inventory'

/* =============================================================
   CONSTANTS
============================================================= */

// Items shown per list on the overview tab; the full list lives in its own tab.
const PREVIEW_LIMIT = 3

const GREEN = '#1F5E3B'
const BAR_PAST = '#D3E6DB'
const BAR_EMPTY = '#EDF2EF'

/* =============================================================
   HELPERS
============================================================= */

const safeFormatDateTime = (
  date: string | Date | null | undefined,
): string => {
  if (!date) return ''

  const value =
    date instanceof Date
      ? date.toISOString()
      : String(date)

  return formatDateTime(value)
}

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? '' : 's'}`

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')

/* =============================================================
   MAIN DASHBOARD
============================================================= */

export function MobileDashboard() {
  const { settings } = useSettings()

  const {
    data,
    loading,
    error,
    reload,
  } = useAsync<DashboardData>(
    () => dashboardApi.get(),
    [],
  )

  const [activeTab, setActiveTab] =
    useState<MobileFilterTab>('all')

  const [isRefreshing, setIsRefreshing] =
    useState(false)

  const { can } = useAuth()
  const navigate = useNavigate()
  const tabsAnchorRef = useRef<HTMLDivElement | null>(null)

  /** Switch section; if the tabs have scrolled off-screen, bring them back so the new content starts in view. */
  const selectTab = (tab: MobileFilterTab) => {
    setActiveTab(tab)
    window.requestAnimationFrame(() => {
      const anchor = tabsAnchorRef.current
      if (anchor && anchor.getBoundingClientRect().top < 0) {
        anchor.scrollIntoView({ block: 'start', behavior: 'smooth' })
      }
    })
  }

  const money = (value: number) =>
    formatMoney(value, settings.currencySymbol)

  /* -------------------------------------------------------------
     GENERATED NOTIFICATIONS
  ------------------------------------------------------------- */

  const generatedNotifications =
    useMemo<AppNotification[]>(() => {
      if (!data) return []

      const items: AppNotification[] = []

      data.lowStockProducts
        ?.filter((product) => product.stockQuantity <= 0)
        .forEach((product) => {
          items.push({
            id: `oos-${product.id}`,
            title: 'Out of stock',
            description: `${product.name} (${product.sku}) has no units left.`,
            timestamp: 'Now',
            type: 'critical',
            read: false,
          })
        })

      data.lowStockProducts
        ?.filter((product) => product.stockQuantity > 0)
        .slice(0, 3)
        .forEach((product) => {
          items.push({
            id: `low-${product.id}`,
            title: 'Running low',
            description: `${product.name}: ${product.stockQuantity} left (reorder at ${product.reorderLevel}).`,
            timestamp: 'Reorder',
            type: 'warning',
            read: false,
          })
        })

      data.recentTransactions
        ?.slice(0, 2)
        .forEach((transaction) => {
          items.push({
            id: `tx-${transaction.id}`,
            title: 'Sale completed',
            description: `${transaction.invoiceNumber} · ${formatMoney(
              transaction.total,
              settings.currencySymbol,
            )}`,
            timestamp: safeFormatDateTime(transaction.createdAt),
            type: 'info',
            read: false,
          })
        })

      return items
    }, [data, settings.currencySymbol])

  /* -------------------------------------------------------------
     NOTIFICATION STATE — read / dismissed survives reloads
  ------------------------------------------------------------- */

  const {
    notifications,
    markAsRead: handleMarkAsRead,
    markAllAsRead: handleMarkAllAsRead,
    clearAll: handleClearAll,
    dismiss: handleDismiss,
  } = usePersistentNotifications(generatedNotifications, Boolean(data))

  /* -------------------------------------------------------------
     REFRESH
  ------------------------------------------------------------- */

  const handleReload = async () => {
    setIsRefreshing(true)

    try {
      await reload()
    } finally {
      setIsRefreshing(false)
    }
  }

  /* -------------------------------------------------------------
     LOADING / ERROR / EMPTY
  ------------------------------------------------------------- */

  if (loading && !data) {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center bg-white px-6 text-center">
        <Spinner />
        <p className="mt-4 text-sm text-slate-500">
          Loading dashboard…
        </p>
      </div>
    )
  }

  // Only replace the screen when there is nothing to show; a failed refresh keeps the last numbers.
  if (!data) {
    return (
      <div className="min-h-screen bg-white px-5 py-16">
        <div className="mx-auto max-w-lg text-center">
          {error ? (
            <ErrorState message={error} onRetry={() => void reload()} />
          ) : (
            <EmptyState title="No store metrics available" />
          )}
        </div>
      </div>
    )
  }

  /* -------------------------------------------------------------
     DERIVED
  ------------------------------------------------------------- */

  const averageTicket =
    data.todaysTransactions > 0
      ? data.todaysSales / data.todaysTransactions
      : 0

  const depletedCount = data.lowStockProducts.filter(
    (product) => product.stockQuantity <= 0,
  ).length

  const healthyInventory = data.lowStockCount === 0

  const canUpdateStock = can('inventory.manage')

  const isOverview = activeTab === 'all'

  const showSales = isOverview || activeTab === 'sales'
  const showTransactions = isOverview || activeTab === 'transactions'
  const showInventory = isOverview || activeTab === 'inventory'

  const limit = <T,>(items: T[], full: number) =>
    items.slice(0, isOverview ? PREVIEW_LIMIT : full)

  const todayLabel = new Date().toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })

  const hasSalesData = data.salesOverview.some(
    (item) => item.amount > 0,
  )

  const lastIndex = data.salesOverview.length - 1

  const tabs: { key: MobileFilterTab; label: string }[] = [
    { key: 'all', label: 'Overview' },
    { key: 'sales', label: 'Sales' },
    { key: 'transactions', label: 'Tickets' },
    { key: 'inventory', label: 'Stock' },
  ]

  /* =============================================================
     RENDER
  ============================================================= */

  return (
    <div className="min-h-screen bg-white pb-8 pt-[max(1.25rem,env(safe-area-inset-top,0px))] font-sans text-[#091413] antialiased">
      <main className="mx-auto w-full max-w-2xl px-5 sm:px-6">

        {/* HEADER */}

        <header className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm text-slate-500">{todayLabel}</p>
            <h1 className="mt-1 text-[28px] font-bold leading-tight tracking-tight">
              Dashboard
            </h1>
            
          </div>

          <div className="flex shrink-0 items-center gap-3">
            <IconButton
              label="Refresh dashboard data"
              onClick={handleReload}
              disabled={isRefreshing}
            >
              <RefreshIcon size={20} spinning={isRefreshing} />
            </IconButton>

            <NotificationBell
              notifications={notifications}
              onMarkAsRead={handleMarkAsRead}
              onMarkAllAsRead={handleMarkAllAsRead}
              onClearAll={handleClearAll}
              onDismiss={handleDismiss}
            />
          </div>
        </header>

        {error && (
          <p role="alert" className="mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
            Couldn’t refresh. Showing the last loaded numbers.
          </p>
        )}

        {/* SALES CARD */}

        <section
          aria-label="Today's sales"
          className="mt-6 rounded-3xl bg-[#F2F8F4] p-5"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-[#1F5E3B]">
                Sales today
              </p>
              <p className="mt-2 truncate text-[40px] font-bold leading-none tracking-[-0.03em] tabular-nums">
                {money(data.todaysSales)}
              </p>
            </div>

            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#E1EFE6] text-[#1F5E3B]">
              <TrendUpIcon size={20} />
            </span>
          </div>

          <dl className="mt-6 grid grid-cols-3 divide-x divide-[#DCE9E1]">
            <Stat label="Tickets" value={String(data.todaysTransactions)} />
            <Stat label="Avg. ticket" value={money(averageTicket)} />
            <Stat label="All customers" value={String(data.totalCustomers)} />
          </dl>
        </section>

        {/* ATTENTION — only when stock needs action */}

        {!healthyInventory && activeTab !== 'inventory' && (
          <button
            type="button"
            onClick={() => selectTab('inventory')}
            className="mt-3 flex min-h-12 w-full items-center gap-3 rounded-2xl bg-amber-50 px-4 py-3 text-left transition active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
          >
            <span className="text-amber-600">
              <AlertIcon size={16} />
            </span>

            <span className="min-w-0 flex-1 text-sm text-amber-900">
              <span className="font-medium">
                {plural(data.lowStockCount, 'item')}
              </span>{' '}
              {depletedCount > 0
                ? `low on stock · ${depletedCount} out`
                : 'low on stock'}
            </span>

            <ChevronIcon size={16} className="text-amber-700" />
          </button>
        )}

        {/* TABS */}

        <div ref={tabsAnchorRef} aria-hidden="true" />
        <nav
          aria-label="Dashboard sections"
          className="sticky top-0 z-30 -mx-5 mt-4 bg-white/90 px-5 py-2 backdrop-blur sm:-mx-6 sm:px-6"
        >
          <div className="grid grid-cols-4 rounded-full bg-[#F1F4F3] p-1">
            {tabs.map((tab) => {
              const isActive = activeTab === tab.key

              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => selectTab(tab.key)}
                  aria-pressed={isActive}
                  className={`relative min-h-11 rounded-full text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B] focus-visible:ring-offset-2 ${
                    isActive
                      ? 'bg-[#1F5E3B] text-white shadow-sm'
                      : 'text-slate-600 hover:text-[#091413]'
                  }`}
                >
                  {tab.label}
                  {tab.key === 'inventory' && !healthyInventory && !isActive && (
                    <span
                      aria-label={`${data.lowStockCount} alerts`}
                      className="absolute right-3 top-2.5 h-1.5 w-1.5 rounded-full bg-amber-500"
                    />
                  )}
                </button>
              )
            })}
          </div>
        </nav>

        {/* WEEKLY CHART */}

        {showSales && (
          <section className="mt-6">
            <SectionHeader title="This week" />

            {hasSalesData ? (
              <div className="mt-2 h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={data.salesOverview}
                    margin={{ top: 40, right: 4, left: 4, bottom: 0 }}
                    barCategoryGap="30%"
                  >
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
                          fontSize={13}
                          fontWeight={index === lastIndex ? 600 : 400}
                          fill={index === lastIndex ? '#091413' : '#94A3B8'}
                        >
                          {index === lastIndex ? 'Today' : payload.value}
                        </text>
                      )}
                    />

                    <Tooltip
                      cursor={false}
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null

                        return (
                          <div className="rounded-lg bg-[#091413] px-2.5 py-1.5 text-white">
                            <p className="text-[10px] text-white/60">{label}</p>
                            <p className="text-xs font-semibold tabular-nums">
                              {money(Number(payload[0]?.value ?? 0))}
                            </p>
                          </div>
                        )
                      }}
                    />

                    <Bar
                      dataKey="amount"
                      radius={[6, 6, 6, 6]}
                      maxBarSize={34}
                      minPointSize={6}
                    >
                      {data.salesOverview.map((item, index) => (
                        <Cell
                          key={item.label}
                          fill={
                            index === lastIndex
                              ? GREEN
                              : item.amount > 0
                              ? BAR_PAST
                              : BAR_EMPTY
                          }
                        />
                      ))}

                      {/* Value callout above today's bar */}
                      <LabelList
                        dataKey="amount"
                        content={(props) => {
                          if (props.index !== lastIndex) return null

                          const x = Number(props.x ?? 0)
                          const y = Number(props.y ?? 0)
                          const width = Number(props.width ?? 0)
                          const text = money(Number(props.value ?? 0))
                          const pillWidth = text.length * 7.5 + 18
                          const centerX = x + width / 2

                          return (
                            <g>
                              <line
                                x1={centerX}
                                x2={centerX}
                                y1={y - 12}
                                y2={y - 4}
                                stroke={GREEN}
                                strokeWidth={1.5}
                              />
                              <circle cx={centerX} cy={y - 12} r={2.5} fill={GREEN} />
                              <rect
                                x={centerX - pillWidth / 2}
                                y={y - 40}
                                width={pillWidth}
                                height={22}
                                rx={11}
                                fill={GREEN}
                              />
                              <text
                                x={centerX}
                                y={y - 25}
                                textAnchor="middle"
                                fontSize={12}
                                fontWeight={600}
                                fill="#fff"
                              >
                                {text}
                              </text>
                            </g>
                          )
                        }}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <Empty text="No sales recorded this week." />
            )}
          </section>
        )}

        {/* TOP SELLERS */}

        {showSales && (
          <section className="mt-6 overflow-hidden rounded-2xl border border-slate-100 bg-white">
            <button
              type="button"
              onClick={isOverview ? () => selectTab('sales') : undefined}
              disabled={!isOverview}
              className="flex min-h-[68px] w-full items-center gap-3 border-b border-slate-100 px-4 text-left transition enabled:active:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#1F5E3B]"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#EAF4EE] text-[#1F5E3B]">
                <TrophyIcon size={18} />
              </span>

              <span className="min-w-0 flex-1">
                <h2 className="text-base font-semibold">Top sellers</h2>
                <span className="block text-xs text-slate-400">All time, by units sold</span>
              </span>

              {isOverview && (
                <ChevronIcon size={18} className="text-slate-400" />
              )}
            </button>

            {data.topSellingProducts.length === 0 ? (
              <Empty text="No items sold yet." inset />
            ) : (
              <ul>
                {limit(data.topSellingProducts, 5).map((product, index) => (
                  <li
                    key={product.productId}
                    className="flex min-h-[72px] items-center gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#EAF4EE] text-sm font-medium tabular-nums text-[#1F5E3B]">
                      {index + 1}
                    </span>

                    <ProductThumb name={product.name} imageUrl={product.imageUrl} />

                    <p className="min-w-0 flex-1 truncate text-[15px]">
                      {product.name}
                    </p>

                    <span className="shrink-0 text-sm tabular-nums text-slate-500">
                      {product.quantitySold} sold
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {/* RECENT TICKETS */}

        {showTransactions && (
          <section className="mt-8">
            <SectionHeader
              title="Recent tickets"
              onViewAll={
                isOverview && data.recentTransactions.length > 0
                  ? () => selectTab('transactions')
                  : undefined
              }
            />

            <Card>
              {data.recentTransactions.length === 0 ? (
                <Empty text="No transactions yet." inset />
              ) : (
                <ul>
                  {limit(
                    data.recentTransactions,
                    data.recentTransactions.length,
                  ).map((transaction) => (
                    <li
                      key={transaction.id}
                      className="flex min-h-[64px] items-center gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[15px]">
                          {transaction.customerName ?? 'Walk-in customer'}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-slate-400">
                          {transaction.invoiceNumber}
                          {transaction.paymentMethod ? ` · ${transaction.paymentMethod}` : ''} ·{' '}
                          {safeFormatDateTime(transaction.createdAt)}
                        </p>
                      </div>

                      <span className="shrink-0 text-[15px] font-medium tabular-nums">
                        {money(transaction.total)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </section>
        )}

        {/* LOW STOCK */}

        {showInventory && (
          <section className="mt-8">
            <SectionHeader
              title="Low stock"
              actionLabel={isOverview ? 'View all' : 'Update stock'}
              onViewAll={
                data.lowStockProducts.length === 0
                  ? undefined
                  : isOverview
                  ? () => selectTab('inventory')
                  : canUpdateStock
                  ? () => navigate('/inventory')
                  : undefined
              }
            />

            <Card>
              {data.lowStockProducts.length === 0 ? (
                <div className="flex items-center gap-2 px-4 py-5 text-sm text-slate-500">
                  <span className="text-[#1F5E3B]">
                    <CheckCircleIcon size={16} />
                  </span>
                  All {data.totalProducts} products are well stocked.
                </div>
              ) : (
                <ul>
                  {limit(
                    data.lowStockProducts,
                    data.lowStockProducts.length,
                  ).map((product) => {
                    const isDepleted = product.stockQuantity <= 0

                    const ratio =
                      product.reorderLevel > 0
                        ? Math.min(
                            100,
                            Math.max(
                              0,
                              (product.stockQuantity / product.reorderLevel) * 100,
                            ),
                          )
                        : 0

                    return (
                      <li
                        key={product.id}
                        className="border-b border-slate-100 px-4 py-4 last:border-b-0"
                      >
                        <div className="flex items-baseline justify-between gap-3">
                          <p className="min-w-0 truncate text-[15px]">
                            {product.name}
                          </p>

                          <p
                            className={`shrink-0 text-sm tabular-nums ${
                              isDepleted
                                ? 'font-medium text-rose-600'
                                : 'text-slate-500'
                            }`}
                          >
                            {isDepleted
                              ? 'Out of stock'
                              : `${product.stockQuantity} left`}
                          </p>
                        </div>

                        <div
                          className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"
                          role="progressbar"
                          aria-valuenow={product.stockQuantity}
                          aria-valuemin={0}
                          aria-valuemax={product.reorderLevel}
                          aria-label={`${product.name} stock level`}
                        >
                          <div
                            className={`h-full rounded-full ${
                              ratio <= 25 ? 'bg-rose-500' : 'bg-amber-400'
                            }`}
                            style={{ width: `${ratio}%` }}
                          />
                        </div>

                        <p className="mt-1.5 text-xs text-slate-400">
                          SKU {product.sku} · alert at {product.reorderLevel}
                        </p>
                      </li>
                    )
                  })}
                </ul>
              )}
            </Card>
          </section>
        )}

      </main>
    </div>
  )
}

/* =============================================================
   BUILDING BLOCKS
============================================================= */

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 px-4 first:pl-0 last:pr-0">
      <dt className="text-sm text-slate-500">{label}</dt>
      <dd className="mt-1.5 truncate text-xl font-semibold tabular-nums">
        {value}
      </dd>
    </div>
  )
}

function SectionHeader({
  title,
  onViewAll,
  actionLabel = 'View all',
}: {
  title: string
  onViewAll?: () => void
  actionLabel?: string
}) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3">
      <h2 className="text-lg font-semibold">{title}</h2>

      {onViewAll && (
        <button
          type="button"
          onClick={onViewAll}
          className="-mr-2 inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-medium text-[#1F5E3B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B]"
        >
          {actionLabel}
          <ChevronIcon size={16} />
        </button>
      )}
    </div>
  )
}

/** Saved product photo; falls back to initials when there is none or it fails to load. */
function ProductThumb({ name, imageUrl }: { name: string; imageUrl?: string | null }) {
  const [failed, setFailed] = useState(false)
  const showImage = Boolean(imageUrl) && !failed

  return (
    <span
      aria-hidden="true"
      className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-100 text-xs font-semibold text-slate-500"
    >
      {showImage ? (
        <img
          src={imageUrl ?? undefined}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        initials(name)
      )}
    </span>
  )
}

function Card({ children }: { children: ReactNode }) {
  return (
    <div className="mt-2 overflow-hidden rounded-2xl border border-slate-100 bg-white">
      {children}
    </div>
  )
}

function Empty({ text, inset = false }: { text: string; inset?: boolean }) {
  return (
    <p className={`py-6 text-sm text-slate-400 ${inset ? 'px-4' : ''}`}>
      {text}
    </p>
  )
}

function IconButton({
  label,
  onClick,
  disabled,
  active,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  active?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-expanded={active}
      className={`relative inline-flex h-12 w-12 items-center justify-center rounded-full text-[#091413] transition active:scale-95 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B] ${
        active ? 'bg-[#E6ECE9]' : 'bg-[#F3F5F4] hover:bg-[#E9EEEB]'
      }`}
    >
      {children}
    </button>
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

function NotificationBell({
  notifications,
  onMarkAsRead,
  onMarkAllAsRead,
  onClearAll,
  onDismiss,
}: NotificationBellProps) {
  const [isOpen, setIsOpen] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)

  // Set by <CloseOnBack> while open; closing through it also consumes the history entry.
  const closeRef = useRef<(() => void) | null>(null)
  const requestClose = () => {
    if (closeRef.current) closeRef.current()
    else setIsOpen(false)
  }

  const unreadCount = useMemo(
    () => notifications.filter((notification) => !notification.read).length,
    [notifications],
  )

  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        requestClose()
      }
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') requestClose()
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen])

  return (
    <div ref={containerRef} className="relative">
      <IconButton
        label={
          unreadCount > 0
            ? `Notifications, ${unreadCount} unread`
            : 'Notifications'
        }
        onClick={() => (isOpen ? requestClose() : setIsOpen(true))}
        active={isOpen}
      >
        <BellIcon size={20} />

        {unreadCount > 0 && (
          <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-rose-500 ring-2 ring-white" />
        )}
      </IconButton>

      {isOpen && (
        <>
          <CloseOnBack
            onDismiss={() => setIsOpen(false)}
            closeRef={closeRef}
          />
          <div
            className="fixed inset-0 z-40 bg-black/10 sm:hidden"
            onClick={requestClose}
            aria-hidden="true"
          />

          <div
            role="dialog"
            aria-modal="true"
            aria-label="Notifications"
            className="fixed inset-x-3 top-[5.5rem] z-50 flex max-h-[70vh] flex-col overflow-hidden rounded-2xl bg-white shadow-[0_12px_40px_rgba(9,20,19,0.12)] ring-1 ring-slate-100 sm:absolute sm:right-0 sm:top-full sm:mt-2 sm:w-[360px]"
          >
            <div className="flex items-center justify-between px-4 pb-2 pt-3">
              <p className="text-sm font-semibold">Notifications</p>

              <div className="flex items-center">
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={onMarkAllAsRead}
                    className="min-h-10 rounded-lg px-2 text-xs font-medium text-[#1F5E3B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B]"
                  >
                    Mark all read
                  </button>
                )}

                {notifications.length > 0 && (
                  <button
                    type="button"
                    onClick={onClearAll}
                    className="min-h-10 rounded-lg px-2 text-xs text-slate-400 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B]"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto overscroll-contain">
              {notifications.length === 0 ? (
                <p className="px-4 pb-10 pt-8 text-center text-sm text-slate-400">
                  You're all caught up.
                </p>
              ) : (
                <ul>
                  {notifications.map((notification) => {
                    const isUnread = !notification.read

                    const dotColor =
                      notification.type === 'critical'
                        ? 'bg-rose-500'
                        : notification.type === 'warning'
                        ? 'bg-amber-400'
                        : 'bg-slate-300'

                    return (
                      <li
                        key={notification.id}
                        className="flex items-start gap-3 border-t border-slate-100 px-4 py-3"
                      >
                        <span
                          className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                            isUnread ? dotColor : 'bg-transparent'
                          }`}
                        />

                        <button
                          type="button"
                          onClick={() => isUnread && onMarkAsRead(notification.id)}
                          className="min-w-0 flex-1 text-left focus-visible:outline-none"
                        >
                          <div className="flex items-baseline justify-between gap-3">
                            <p
                              className={`text-sm ${
                                isUnread ? 'font-medium' : 'text-slate-500'
                              }`}
                            >
                              {notification.title}
                            </p>
                            <span className="shrink-0 text-[11px] text-slate-400">
                              {notification.timestamp}
                            </span>
                          </div>

                          <p className="mt-0.5 text-xs leading-5 text-slate-500">
                            {notification.description}
                          </p>
                        </button>

                        <button
                          type="button"
                          onClick={() => onDismiss(notification.id)}
                          aria-label="Dismiss notification"
                          className="-mr-3 -mt-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-300 transition hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B]"
                        >
                          <ClearIcon size={14} />
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/** Mounted only while the notification panel is open, so Android back closes it instead of leaving the page. */
function CloseOnBack({
  onDismiss,
  closeRef,
}: {
  onDismiss: () => void
  closeRef: { current: (() => void) | null }
}) {
  const { close } = useDismissOnBack('dashboardNotificationsOpen', onDismiss)

  useEffect(() => {
    closeRef.current = close
  })

  useEffect(
    () => () => {
      closeRef.current = null
    },
    [closeRef],
  )

  return null
}

/* =============================================================
   ICONS
============================================================= */

function Svg({
  size,
  className = '',
  children,
}: {
  size: number
  className?: string
  children: ReactNode
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

function RefreshIcon({ size = 16, spinning = false }: { size?: number; spinning?: boolean }) {
  return (
    <Svg size={size} className={spinning ? 'animate-spin' : ''}>
      <path d="M21 12a9 9 0 1 1-9-9c2.5 0 4.9 1 6.7 2.7L21 8" />
      <path d="M21 3v5h-5" />
    </Svg>
  )
}

function BellIcon({ size = 16 }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </Svg>
  )
}

function TrophyIcon({ size = 16 }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M8 21h8" />
      <path d="M12 17v4" />
      <path d="M7 4h10v5a5 5 0 0 1-10 0V4Z" />
      <path d="M17 5h3v2a3 3 0 0 1-3 3" />
      <path d="M7 5H4v2a3 3 0 0 0 3 3" />
    </Svg>
  )
}

function TrendUpIcon({ size = 16 }: { size?: number }) {
  return (
    <Svg size={size}>
      <polyline points="3 17 9 11 13 15 21 7" />
      <polyline points="15 7 21 7 21 13" />
    </Svg>
  )
}

function CheckCircleIcon({ size = 16 }: { size?: number }) {
  return (
    <Svg size={size}>
      <circle cx="12" cy="12" r="9" />
      <polyline points="8 12 11 15 16 9" />
    </Svg>
  )
}

function AlertIcon({ size = 16 }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M10.3 3.6 2.7 17a2 2 0 0 0 1.7 3h15.2a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </Svg>
  )
}

function ChevronIcon({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <Svg size={size} className={className}>
      <path d="m9 18 6-6-6-6" />
    </Svg>
  )
}

function ClearIcon({ size = 14 }: { size?: number }) {
  return (
    <Svg size={size}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </Svg>
  )
}

/* =============================================================
   BACKWARD-COMPATIBLE EXPORTS
============================================================= */

export {
  MobileDashboard as DashboardPage,
}

export default MobileDashboard
