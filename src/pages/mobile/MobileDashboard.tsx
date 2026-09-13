import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { dashboardApi } from '../../api/dashboardApi'
import {
  EmptyState,
  ErrorState,
  Spinner,
} from '../../components/ui/States'
import { useSettings } from '../../context/SettingsContext'
import { useAsync } from '../../hooks/useAsync'
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

type MobileFilterTab =
  | 'all'
  | 'sales'
  | 'transactions'
  | 'inventory'

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

  const [notifications, setNotifications] =
    useState<AppNotification[]>([])

  /* -------------------------------------------------------------
     GENERATED NOTIFICATIONS
  ------------------------------------------------------------- */

  const generatedNotifications =
    useMemo<AppNotification[]>(() => {
      if (!data) return []

      const items: AppNotification[] = []

      data.lowStockProducts
        ?.filter(
          (product) => product.stockQuantity <= 0,
        )
        .forEach((product) => {
          items.push({
            id: `oos-${product.id}`,
            title: 'Stock Depleted',
            description:
              `${product.name} (${product.sku}) reached zero inventory.`,
            timestamp: 'Immediate action',
            type: 'critical',
            read: false,
          })
        })

      data.lowStockProducts
        ?.filter(
          (product) => product.stockQuantity > 0,
        )
        .slice(0, 3)
        .forEach((product) => {
          items.push({
            id: `low-${product.id}`,
            title: 'Low Par Threshold',
            description:
              `${product.name} has ${product.stockQuantity} remaining (Par: ${product.reorderLevel}).`,
            timestamp: 'Reorder suggested',
            type: 'warning',
            read: false,
          })
        })

      data.recentTransactions
        ?.slice(0, 2)
        .forEach((transaction) => {
          items.push({
            id: `tx-${transaction.id}`,
            title: 'Settled Ticket',
            description:
              `${transaction.invoiceNumber} • ${formatMoney(
                transaction.total,
                settings.currencySymbol,
              )}`,
            timestamp: safeFormatDateTime(
              transaction.createdAt,
            ),
            type: 'info',
            read: false,
          })
        })

      return items
    }, [data, settings.currencySymbol])

  /* -------------------------------------------------------------
     SYNC NOTIFICATIONS
  ------------------------------------------------------------- */

  useEffect(() => {
    if (generatedNotifications.length > 0) {
      setNotifications(generatedNotifications)
    }
  }, [generatedNotifications])

  /* -------------------------------------------------------------
     NOTIFICATION ACTIONS
  ------------------------------------------------------------- */

  const handleMarkAsRead = (id: string) => {
    setNotifications((previous) =>
      previous.map((notification) =>
        notification.id === id
          ? {
              ...notification,
              read: true,
            }
          : notification,
      ),
    )
  }

  const handleMarkAllAsRead = () => {
    setNotifications((previous) =>
      previous.map((notification) => ({
        ...notification,
        read: true,
      })),
    )
  }

  const handleClearAll = () => {
    setNotifications([])
  }

  const handleDismiss = (id: string) => {
    setNotifications((previous) =>
      previous.filter(
        (notification) => notification.id !== id,
      ),
    )
  }

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
     LOADING STATE
  ------------------------------------------------------------- */

  if (loading && !data) {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center bg-[#F6F8F7] px-6 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[#DDE5E1] bg-white">
          <Spinner />
        </div>

        <p className="mt-4 text-sm font-semibold text-[#091413]">
          Loading dashboard
        </p>

        <p className="mt-1 max-w-[220px] text-xs leading-5 text-slate-500">
          Synchronizing your latest store metrics.
        </p>
      </div>
    )
  }

  /* -------------------------------------------------------------
     ERROR STATE
  ------------------------------------------------------------- */

  if (error) {
    return (
      <div className="min-h-screen bg-[#F6F8F7] px-4 py-12">
        <div className="mx-auto max-w-lg rounded-2xl border border-rose-200 bg-white p-5">
          <ErrorState
            message={error}
            onRetry={() => void reload()}
          />
        </div>
      </div>
    )
  }

  /* -------------------------------------------------------------
     EMPTY STATE
  ------------------------------------------------------------- */

  if (!data) {
    return (
      <div className="min-h-screen bg-[#F6F8F7] px-4 py-12">
        <div className="mx-auto max-w-lg rounded-2xl border border-[#DDE5E1] bg-white p-8 text-center">
          <EmptyState title="No store metrics available" />
        </div>
      </div>
    )
  }

  /* -------------------------------------------------------------
     DERIVED METRICS
  ------------------------------------------------------------- */

  const averageTicket =
    data.todaysTransactions > 0
      ? data.todaysSales / data.todaysTransactions
      : 0

  const depletedCount =
    data.lowStockProducts.filter(
      (product) => product.stockQuantity <= 0,
    ).length

  const healthyInventory =
    data.lowStockCount === 0

  const todayLabel =
    new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    })

  /* =============================================================
     RENDER
  ============================================================= */

  return (
    <div className="min-h-screen bg-[#F6F8F7] pb-24 pt-[max(0.75rem,env(safe-area-inset-top,0px))] font-sans text-[#091413] antialiased selection:bg-[#285A48] selection:text-white">

      <main className="mx-auto w-full max-w-2xl px-4 sm:px-6">

        {/* =====================================================
            HEADER
        ===================================================== */}

        <header className="flex items-center justify-between gap-4 border-b border-[#DDE5E1] pb-4">

          <div className="min-w-0">
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-[#285A48]">
              Store overview
            </p>

            <h1 className="mt-1 text-[26px] font-bold tracking-[-0.04em] text-[#091413]">
              Dashboard
            </h1>

            
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={handleReload}
              disabled={isRefreshing}
              aria-label="Refresh dashboard data"
              className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[#DDE5E1] bg-white text-[#091413] transition hover:bg-[#F0F4F2] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#285A48]"
            >
              <RefreshIcon
                size={17}
                spinning={isRefreshing}
              />
            </button>

            <NotificationBell
              notifications={notifications}
              onMarkAsRead={handleMarkAsRead}
              onMarkAllAsRead={handleMarkAllAsRead}
              onClearAll={handleClearAll}
              onDismiss={handleDismiss}
            />
          </div>
        </header>

        {/* =====================================================
            PRIMARY SALES BLOCK
        ===================================================== */}

        <section
          aria-label="Today's sales"
          className="mt-5"
        >
          <div className="rounded-[22px] bg-[#091413] p-5 text-white sm:p-6">

            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/50">
                  Gross sales
                </p>

                <p className="mt-2 text-[38px] font-black leading-none tracking-[-0.055em] tabular-nums sm:text-5xl">
                  {formatMoney(
                    data.todaysSales,
                    settings.currencySymbol,
                  )}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />

                <span className="text-[10px] font-semibold text-white/75">
                  Live
                </span>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-2 border-t border-white/10 pt-4">

              <div>
                <p className="text-[10px] font-medium uppercase tracking-wider text-white/45">
                  Tickets
                </p>

                <p className="mt-1 text-xl font-bold tabular-nums">
                  {data.todaysTransactions}
                </p>

                <p className="mt-0.5 text-[10px] text-white/45">
                  settled today
                </p>
              </div>

              <div className="border-l border-white/10 pl-4">
                <p className="text-[10px] font-medium uppercase tracking-wider text-white/45">
                  Avg. ticket
                </p>

                <p className="mt-1 text-xl font-bold tabular-nums">
                  {formatMoney(
                    averageTicket,
                    settings.currencySymbol,
                  )}
                </p>

                <p className="mt-0.5 text-[10px] text-white/45">
                  per transaction
                </p>
              </div>

            </div>
          </div>
        </section>

        {/* =====================================================
            OPERATIONAL SNAPSHOT
        ===================================================== */}

        <section
          aria-label="Operational snapshot"
          className="mt-3 grid grid-cols-2 gap-3"
        >

          <button
            type="button"
            onClick={() => setActiveTab('all')}
            className="group min-h-[118px] rounded-2xl border border-[#DDE5E1] bg-white p-4 text-left transition hover:border-[#BFCBC5] hover:bg-[#FBFCFB] active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#285A48]"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                Customers
              </span>

              <span className="text-[#285A48]">
                <UsersIcon size={15} />
              </span>
            </div>

            <p className="mt-5 text-2xl font-bold tracking-tight tabular-nums">
              {data.totalCustomers}
            </p>

            <p className="mt-0.5 text-[11px] text-slate-500">
              registered accounts
            </p>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('inventory')}
            className={`group min-h-[118px] rounded-2xl border p-4 text-left transition active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#285A48] ${
              healthyInventory
                ? 'border-[#DDE5E1] bg-white hover:border-[#BFCBC5]'
                : 'border-amber-200 bg-[#FFFCF6] hover:border-amber-300'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                Inventory
              </span>

              {healthyInventory ? (
                <CheckCircleIcon
                  size={16}
                />
              ) : (
                <AlertIcon size={16} />
              )}
            </div>

            <p className="mt-5 text-2xl font-bold tracking-tight tabular-nums">
              {data.totalProducts}
            </p>

            <p className="mt-0.5 text-[11px] text-slate-500">
              {healthyInventory
                ? 'stock levels healthy'
                : `${data.lowStockCount} item${data.lowStockCount === 1 ? '' : 's'} need attention`}
            </p>
          </button>

        </section>

        {/* =====================================================
            SECTION NAVIGATION
        ===================================================== */}

        <nav
          aria-label="Dashboard sections"
          className="mt-6"
        >
          <div className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">

            {[
              {
                key: 'all',
                label: 'Overview',
              },
              {
                key: 'sales',
                label: 'Sales',
              },
              {
                key: 'transactions',
                label: 'Tickets',
              },
              {
                key: 'inventory',
                label:
                  data.lowStockCount > 0
                    ? `Stock · ${data.lowStockCount}`
                    : 'Stock',
              },
            ].map((tab) => {
              const isActive =
                activeTab === tab.key

              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() =>
                    setActiveTab(
                      tab.key as MobileFilterTab,
                    )
                  }
                  aria-pressed={isActive}
                  className={`min-h-11 shrink-0 rounded-full px-4 text-xs font-semibold transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#285A48] ${
                    isActive
                      ? 'bg-[#285A48] text-white'
                      : 'border border-[#DDE5E1] bg-white text-slate-600 hover:bg-[#F0F4F2]'
                  }`}
                >
                  {tab.label}
                </button>
              )
            })}

          </div>
        </nav>

        {/* =====================================================
            SALES SECTION
        ===================================================== */}

        {(activeTab === 'all' ||
          activeTab === 'sales') && (
          <section className="mt-5">

            <SectionHeading
              eyebrow="Sales performance"
              title="Weekly velocity"
              description="Sales volume across recent days."
            />

            <div className="mt-3 overflow-hidden rounded-2xl border border-[#DDE5E1] bg-white">

              {data.salesOverview.every(
                (item) => item.amount === 0,
              ) ? (
                <div className="px-4 py-10 text-center">
                  <EmptyState title="No sales data recorded" />
                </div>
              ) : (
                <div className="h-56 w-full px-2 pb-3 pt-5 sm:h-64">
                  <ResponsiveContainer
                    width="100%"
                    height="100%"
                  >
                    <BarChart
                      data={data.salesOverview}
                      margin={{
                        top: 4,
                        right: 4,
                        left: -24,
                        bottom: 0,
                      }}
                    >
                      <XAxis
                        dataKey="label"
                        tick={{
                          fontSize: 10,
                          fill: '#64748B',
                          fontWeight: 500,
                        }}
                        tickLine={false}
                        axisLine={false}
                      />

                      <YAxis
                        tick={{
                          fontSize: 9,
                          fill: '#94A3B8',
                        }}
                        tickLine={false}
                        axisLine={false}
                        width={34}
                      />

                      <Tooltip
                        cursor={{
                          fill: '#F6F8F7',
                        }}
                        content={({
                          active,
                          payload,
                          label,
                        }) => {
                          if (
                            !active ||
                            !payload ||
                            !payload.length
                          ) {
                            return null
                          }

                          const value =
                            payload[0]?.value

                          return (
                            <div className="rounded-xl border border-[#24302D] bg-[#091413] px-3 py-2 text-white">
                              <p className="text-[9px] font-semibold uppercase tracking-wider text-white/50">
                                {label}
                              </p>

                              <p className="mt-0.5 text-xs font-bold tabular-nums">
                                {formatMoney(
                                  Number(value ?? 0),
                                  settings.currencySymbol,
                                )}
                              </p>
                            </div>
                          )
                        }}
                      />

                      <Bar
                        dataKey="amount"
                        fill="#285A48"
                        radius={[5, 5, 0, 0]}
                        maxBarSize={28}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

            </div>
          </section>
        )}

        {/* =====================================================
            TOP SELLING PRODUCTS
        ===================================================== */}

        {(activeTab === 'all' ||
          activeTab === 'sales') && (
          <section className="mt-7">

            <SectionHeading
              eyebrow="Product performance"
              title="Top sellers"
              description="Items with the highest unit volume."
            />

            <div className="mt-3 overflow-hidden rounded-2xl border border-[#DDE5E1] bg-white">

              {data.topSellingProducts.length ===
              0 ? (
                <div className="px-4 py-10 text-center">
                  <EmptyState title="No items sold yet" />
                </div>
              ) : (
                <div>
                  {data.topSellingProducts
                    .slice(0, 5)
                    .map(
                      (
                        product,
                        index,
                      ) => (
                        <div
                          key={
                            product.productId
                          }
                          className="flex min-h-[68px] items-center gap-3 border-b border-[#E8EEEB] px-4 last:border-b-0"
                        >
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#F1F5F3] font-mono text-[11px] font-bold text-[#285A48]">
                            {String(
                              index + 1,
                            ).padStart(2, '0')}
                          </div>

                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-[#091413]">
                              {product.name}
                            </p>

                            <p className="mt-0.5 text-[10px] text-slate-400">
                              Product
                            </p>
                          </div>

                          <div className="shrink-0 text-right">
                            <p className="text-sm font-bold tabular-nums text-[#091413]">
                              {
                                product.quantitySold
                              }
                            </p>

                            <p className="text-[10px] text-slate-400">
                              sold
                            </p>
                          </div>
                        </div>
                      ),
                    )}
                </div>
              )}

            </div>
          </section>
        )}

        {/* =====================================================
            RECENT TRANSACTIONS
        ===================================================== */}

        {(activeTab === 'all' ||
          activeTab === 'transactions') && (
          <section className="mt-7">

            <SectionHeading
              eyebrow="Transaction journal"
              title="Recent tickets"
              description="Latest settled transactions."
            />

            <div className="mt-3 overflow-hidden rounded-2xl border border-[#DDE5E1] bg-white">

              {data.recentTransactions.length ===
              0 ? (
                <div className="px-4 py-10 text-center">
                  <EmptyState title="No transactions logged" />
                </div>
              ) : (
                <div>
                  {data.recentTransactions.map(
                    (transaction) => (
                      <div
                        key={transaction.id}
                        className="flex min-h-[76px] items-center gap-3 border-b border-[#E8EEEB] px-4 last:border-b-0"
                      >
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#F1F5F3] text-[#285A48]">
                          <ReceiptIcon
                            size={16}
                          />
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center gap-2">
                            <p className="truncate font-mono text-xs font-bold text-[#091413]">
                              {
                                transaction.invoiceNumber
                              }
                            </p>
                          </div>

                          <p className="mt-1 truncate text-[11px] text-slate-500">
                            {transaction.customerName ??
                              'Counter Sale'}
                          </p>

                          <p className="mt-0.5 text-[10px] text-slate-400">
                            {safeFormatDateTime(
                              transaction.createdAt,
                            )}
                          </p>
                        </div>

                        <p className="shrink-0 text-sm font-bold tabular-nums text-[#091413]">
                          {formatMoney(
                            transaction.total,
                            settings.currencySymbol,
                          )}
                        </p>
                      </div>
                    ),
                  )}
                </div>
              )}

            </div>
          </section>
        )}

        {/* =====================================================
            INVENTORY ALERTS
        ===================================================== */}

        {(activeTab === 'all' ||
          activeTab === 'inventory') && (
          <section className="mt-7">

            <div className="flex items-end justify-between gap-3">
              <SectionHeading
                eyebrow="Inventory control"
                title="Stock attention"
                description={
                  healthyInventory
                    ? 'Everything is above its reorder threshold.'
                    : 'Items that may need replenishment.'
                }
              />

              {!healthyInventory && (
                <span className="mb-0.5 shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-bold text-amber-800">
                  {data.lowStockCount} alert
                  {data.lowStockCount === 1
                    ? ''
                    : 's'}
                </span>
              )}
            </div>

            <div className="mt-3 overflow-hidden rounded-2xl border border-[#DDE5E1] bg-white">

              {data.lowStockProducts.length ===
              0 ? (
                <div className="px-5 py-10 text-center">

                  <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-[#EAF1EE] text-[#285A48]">
                    <CheckCircleIcon
                      size={20}
                    />
                  </div>

                  <p className="mt-3 text-sm font-bold text-[#091413]">
                    Inventory looks good
                  </p>

                  <p className="mx-auto mt-1 max-w-[250px] text-xs leading-5 text-slate-400">
                    All catalog items are currently
                    above their reorder thresholds.
                  </p>
                </div>
              ) : (
                <div>
                  {data.lowStockProducts.map(
                    (product) => {
                      const isDepleted =
                        product.stockQuantity <=
                        0

                      const stockRatio =
                        product.reorderLevel > 0
                          ? Math.min(
                              100,
                              Math.max(
                                0,
                                (product.stockQuantity /
                                  product.reorderLevel) *
                                  100,
                              ),
                            )
                          : 0

                      return (
                        <div
                          key={product.id}
                          className="border-b border-[#E8EEEB] px-4 py-4 last:border-b-0"
                        >
                          <div className="flex items-start gap-3">

                            <div
                              className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                                isDepleted
                                  ? 'bg-rose-50 text-rose-600'
                                  : 'bg-amber-50 text-amber-700'
                              }`}
                            >
                              <BoxIcon
                                size={16}
                              />
                            </div>

                            <div className="min-w-0 flex-1">

                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-semibold text-[#091413]">
                                    {product.name}
                                  </p>

                                  <p className="mt-0.5 font-mono text-[10px] text-slate-400">
                                    SKU {product.sku}
                                  </p>
                                </div>

                                <div className="shrink-0 text-right">
                                  <p
                                    className={`text-lg font-black leading-none tabular-nums ${
                                      isDepleted
                                        ? 'text-rose-600'
                                        : 'text-[#091413]'
                                    }`}
                                  >
                                    {
                                      product.stockQuantity
                                    }
                                  </p>

                                  <p className="mt-0.5 text-[9px] uppercase tracking-wider text-slate-400">
                                    /{' '}
                                    {
                                      product.reorderLevel
                                    } par
                                  </p>
                                </div>
                              </div>

                              <div className="mt-3 flex items-center gap-2">
                                <div
                                  className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#EEF2F0]"
                                  role="progressbar"
                                  aria-valuenow={
                                    product.stockQuantity
                                  }
                                  aria-valuemin={0}
                                  aria-valuemax={
                                    product.reorderLevel
                                  }
                                  aria-label={`${product.name} stock level`}
                                >
                                  <div
                                    className={`h-full rounded-full transition-all duration-500 ${
                                      isDepleted
                                        ? 'bg-rose-500'
                                        : stockRatio <=
                                            25
                                        ? 'bg-rose-500'
                                        : 'bg-amber-500'
                                    }`}
                                    style={{
                                      width: `${
                                        isDepleted
                                          ? 0
                                          : Math.max(
                                              6,
                                              stockRatio,
                                            )
                                      }%`,
                                    }}
                                  />
                                </div>

                                <span className="w-8 shrink-0 text-right font-mono text-[9px] tabular-nums text-slate-400">
                                  {Math.round(
                                    stockRatio,
                                  )}
                                  %
                                </span>
                              </div>

                              <div className="mt-2">
                                <span
                                  className={`inline-flex rounded-full px-2 py-1 text-[9px] font-bold uppercase tracking-wider ${
                                    isDepleted
                                      ? 'bg-rose-50 text-rose-700'
                                      : 'bg-amber-50 text-amber-800'
                                  }`}
                                >
                                  {isDepleted
                                    ? 'Stockout'
                                    : 'Low stock'}
                                </span>
                              </div>

                            </div>
                          </div>
                        </div>
                      )
                    },
                  )}
                </div>
              )}

            </div>
          </section>
        )}

        {/* =====================================================
            INVENTORY SUMMARY FOOTER
        ===================================================== */}

        {activeTab === 'inventory' &&
          data.lowStockProducts.length > 0 && (
            <div className="mt-3 flex items-center justify-between rounded-xl border border-[#DDE5E1] bg-white px-4 py-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Inventory status
                </p>

                <p className="mt-0.5 text-xs font-semibold text-[#091413]">
                  {depletedCount > 0
                    ? `${depletedCount} depleted item${
                        depletedCount === 1
                          ? ''
                          : 's'
                      }`
                    : 'No depleted items'}
                </p>
              </div>

              <BoxIcon
                size={16}
                className="text-slate-400"
              />
            </div>
          )}

        {/* =====================================================
            LAST UPDATED
        ===================================================== */}

        <footer className="py-8 text-center">
          <p className="font-mono text-[9px] uppercase tracking-[0.15em] text-slate-400">
            Dashboard · Live register data
          </p>
        </footer>

      </main>
    </div>
  )
}

/* =============================================================
   SECTION HEADING
============================================================= */

function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string
  title: string
  description: string
}) {
  return (
    <div>
      <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-[#285A48]">
        {eyebrow}
      </p>

      <h2 className="mt-1 text-lg font-bold tracking-[-0.025em] text-[#091413]">
        {title}
      </h2>

      <p className="mt-0.5 text-[11px] leading-4 text-slate-500">
        {description}
      </p>
    </div>
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
  const [isOpen, setIsOpen] =
    useState(false)

  const containerRef =
    useRef<HTMLDivElement>(null)

  const unreadCount = useMemo(
    () =>
      notifications.filter(
        (notification) =>
          !notification.read,
      ).length,
    [notifications],
  )

  /* -------------------------------------------------------------
     OUTSIDE CLICK
  ------------------------------------------------------------- */

  useEffect(() => {
    const handleClickOutside = (
      event: MouseEvent,
    ) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(
          event.target as Node,
        )
      ) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener(
        'mousedown',
        handleClickOutside,
      )
    }

    return () => {
      document.removeEventListener(
        'mousedown',
        handleClickOutside,
      )
    }
  }, [isOpen])

  return (
    <div
      ref={containerRef}
      className="relative"
    >
      {/* =======================================================
          BELL BUTTON
      ======================================================= */}

      <button
        type="button"
        onClick={() =>
          setIsOpen((previous) => !previous)
        }
        aria-label="Open notifications"
        aria-expanded={isOpen}
        className={`relative inline-flex h-11 w-11 items-center justify-center rounded-xl border transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#285A48] ${
          isOpen
            ? 'border-[#285A48] bg-[#285A48] text-white'
            : 'border-[#DDE5E1] bg-white text-[#091413] hover:bg-[#F0F4F2]'
        }`}
      >
        <BellIcon size={17} />

        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-rose-600 px-1 font-mono text-[9px] font-bold text-white ring-2 ring-[#F6F8F7]">
            {unreadCount > 9
              ? '9+'
              : unreadCount}
          </span>
        )}
      </button>

      {/* =======================================================
          NOTIFICATION PANEL
      ======================================================= */}

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-[#091413]/20 sm:hidden"
            onClick={() => setIsOpen(false)}
            aria-hidden="true"
          />

          <div
            role="dialog"
            aria-modal="true"
            aria-label="Notifications"
            className="fixed inset-x-3 top-[4.5rem] z-50 flex max-h-[72vh] flex-col overflow-hidden rounded-2xl border border-[#DDE5E1] bg-white shadow-[0_20px_60px_rgba(9,20,19,0.16)] sm:absolute sm:right-0 sm:top-full sm:mt-2 sm:w-[360px]"
          >

            {/* =================================================
                PANEL HEADER
            ================================================= */}

            <div className="flex items-center justify-between border-b border-[#E5EBE8] bg-[#091413] px-4 py-3.5 text-white">

              <div>
                <p className="text-sm font-bold">
                  Notifications
                </p>

                <p className="mt-0.5 text-[10px] text-white/45">
                  {unreadCount > 0
                    ? `${unreadCount} unread`
                    : 'All caught up'}
                </p>
              </div>

              <div className="flex items-center gap-3">
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={onMarkAllAsRead}
                    className="min-h-10 px-1 text-[11px] font-semibold text-emerald-300 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  >
                    Read all
                  </button>
                )}

                {notifications.length > 0 && (
                  <button
                    type="button"
                    onClick={onClearAll}
                    className="min-h-10 px-1 text-[11px] font-medium text-white/55 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            {/* =================================================
                LIST
            ================================================= */}

            <div className="flex-1 overflow-y-auto overscroll-contain">

              {notifications.length ===
              0 ? (
                <div className="px-6 py-12 text-center">

                  <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-[#EAF1EE] text-[#285A48]">
                    <CheckCircleIcon
                      size={20}
                    />
                  </div>

                  <p className="mt-3 text-sm font-bold text-[#091413]">
                    Nothing needs attention
                  </p>

                  <p className="mx-auto mt-1 max-w-[220px] text-xs leading-5 text-slate-400">
                    New stock and transaction alerts
                    will appear here.
                  </p>

                </div>
              ) : (
                notifications.map(
                  (notification) => {
                    const isUnread =
                      !notification.read

                    const isCritical =
                      notification.type ===
                      'critical'

                    const isWarning =
                      notification.type ===
                      'warning'

                    return (
                      <div
                        key={notification.id}
                        className={`border-b border-[#E8EEEB] px-4 py-4 last:border-b-0 ${
                          isUnread
                            ? 'bg-[#F7FAF8]'
                            : 'bg-white'
                        }`}
                      >
                        <div className="flex gap-3">

                          {/* Severity marker */}

                          <div className="pt-1.5">
                            <span
                              className={`block h-2 w-2 rounded-full ${
                                isCritical
                                  ? 'bg-rose-500'
                                  : isWarning
                                  ? 'bg-amber-500'
                                  : 'bg-[#285A48]'
                              }`}
                            />
                          </div>

                          {/* Content */}

                          <button
                            type="button"
                            onClick={() =>
                              isUnread &&
                              onMarkAsRead(
                                notification.id,
                              )
                            }
                            className="min-w-0 flex-1 text-left focus-visible:outline-none"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <p
                                className={`text-xs ${
                                  isUnread
                                    ? 'font-bold text-[#091413]'
                                    : 'font-medium text-slate-700'
                                }`}
                              >
                                {
                                  notification.title
                                }
                              </p>

                              <span className="shrink-0 text-[9px] text-slate-400">
                                {
                                  notification.timestamp
                                }
                              </span>
                            </div>

                            <p className="mt-1 text-[11px] leading-4 text-slate-500">
                              {
                                notification.description
                              }
                            </p>
                          </button>

                          {/* Dismiss */}

                          <button
                            type="button"
                            onClick={() =>
                              onDismiss(
                                notification.id,
                              )
                            }
                            aria-label="Dismiss notification"
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#285A48]"
                          >
                            <ClearIcon
                              size={13}
                            />
                          </button>

                        </div>
                      </div>
                    )
                  },
                )
              )}

            </div>
          </div>
        </>
      )}
    </div>
  )
}

/* =============================================================
   ICONS
============================================================= */

function RefreshIcon({
  size = 16,
  spinning = false,
}: {
  size?: number
  spinning?: boolean
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={
        spinning
          ? 'animate-spin text-[#285A48]'
          : ''
      }
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-9-9c2.5 0 4.9 1 6.7 2.7L21 8" />
      <path d="M21 3v5h-5" />
    </svg>
  )
}

function BellIcon({
  size = 16,
}: {
  size?: number
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  )
}

function CheckCircleIcon({
  size = 16,
}: {
  size?: number
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="9"
      />
      <polyline points="8 12 11 15 16 9" />
    </svg>
  )
}

function AlertIcon({
  size = 16,
}: {
  size?: number
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10.3 3.6 2.7 17a2 2 0 0 0 1.7 3h15.2a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  )
}

function UsersIcon({
  size = 16,
}: {
  size?: number
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle
        cx="9"
        cy="7"
        r="4"
      />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
}

function ReceiptIcon({
  size = 16,
}: {
  size?: number
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 2h12v20l-3-2-3 2-3-2-3 2V2Z" />
      <path d="M9 7h6" />
      <path d="M9 11h6" />
      <path d="M9 15h3" />
    </svg>
  )
}

function BoxIcon({
  size = 16,
  className = '',
}: {
  size?: number
  className?: string
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="m21 8-9 5-9-5" />
      <path d="m3 8 9-5 9 5v8l-9 5-9-5V8Z" />
      <path d="M12 13v8" />
    </svg>
  )
}

function ClearIcon({
  size = 14,
}: {
  size?: number
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line
        x1="18"
        y1="6"
        x2="6"
        y2="18"
      />
      <line
        x1="6"
        y1="6"
        x2="18"
        y2="18"
      />
    </svg>
  )
}

/* =============================================================
   BACKWARD-COMPATIBLE EXPORTS
============================================================= */

export {
  MobileDashboard as DashboardPage,
}

export default MobileDashboard