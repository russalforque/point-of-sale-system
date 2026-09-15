import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from 'recharts'

import { salesApi } from '../../api/salesApi'

import { ChevronRight, Search, X } from '../../components/ui/Icons'
import { ExportOptions } from '../../components/reports/ExportOptions'
import { Sheet, SheetBody, SheetHeader } from '../../components/ui/MobileKit'
import { EmptyState, ErrorState, Spinner } from '../../components/ui/States'

import { useSettings } from '../../context/SettingsContext'
import { useToast } from '../../context/ToastContext'
import { useDismissOnBack } from '../../hooks/useDismissOnBack'
import { useReceiptPrinter } from '../../hooks/useReceiptPrinter'
import { printerErrorMessage } from '../../services/printer'

import type { Sale } from '../../types'
import { getErrorMessage } from '../../utils/errors'
import { formatMoney } from '../../utils/format'
import { exportReport, toTransactionRow, type ExportFormat } from '../../utils/reportExport'
import { PAYMENT_OPTIONS } from '../../utils/pos'

type DateRangeFilter = 'today' | 'yesterday' | '7days' | '30days' | 'all'

const RANGES: { value: DateRangeFilter; label: string; previousLabel: string }[] = [
  { value: 'today', label: 'Today', previousLabel: 'yesterday' },
  { value: 'yesterday', label: 'Yesterday', previousLabel: 'the day before' },
  { value: '7days', label: '7 days', previousLabel: 'previous 7 days' },
  { value: '30days', label: '30 days', previousLabel: 'previous 30 days' },
  { value: 'all', label: 'All time', previousLabel: '' },
]

const GREEN = '#1F5E3B'
const BAR_PAST = '#D3E6DB'
const PAGE_STEP = 20
const DAY_MS = 24 * 60 * 60 * 1000

/* =============================================================
   DATE HELPERS
============================================================= */

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

/** Current period bounds plus the equally long period right before it (for comparison). */
function rangeBounds(filter: DateRangeFilter, now = new Date()) {
  if (filter === 'all') return null

  const today = startOfDay(now)
  const [start, end] =
    filter === 'today'
      ? [today, addDays(today, 1)]
      : filter === 'yesterday'
      ? [addDays(today, -1), today]
      : filter === '7days'
      ? [addDays(today, -6), addDays(today, 1)]
      : [addDays(today, -29), addDays(today, 1)]

  const length = end.getTime() - start.getTime()
  return { start, end, prevStart: new Date(start.getTime() - length), prevEnd: start }
}

function inRange(sale: Sale, start: Date, end: Date) {
  const time = new Date(sale.createdAt).getTime()
  return !Number.isNaN(time) && time >= start.getTime() && time < end.getTime()
}

const isCompleted = (sale: Sale) => sale.status !== 'Voided'

const sumTotal = (sales: Sale[]) => sales.reduce((sum, sale) => sum + (Number(sale.total) || 0), 0)

const itemCount = (sale: Sale) =>
  sale.items?.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0) ?? 0

function formatSaleTime(value: string, withDate: boolean) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString([], {
    ...(withDate ? { month: 'short', day: 'numeric' } : {}),
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** "Sep 9 – Sep 15", or a single date for one-day ranges. */
function formatPeriod(bounds: { start: Date; end: Date } | null) {
  if (!bounds) return null
  const last = addDays(bounds.end, -1)
  const format = (date: Date) => date.toLocaleDateString([], { month: 'short', day: 'numeric' })
  return bounds.start.getTime() === last.getTime() ? format(bounds.start) : `${format(bounds.start)} – ${format(last)}`
}

/* =============================================================
   PAGE
============================================================= */

export function MobileReports() {
  const { notify } = useToast()
  const { settings } = useSettings()
  const { printReceipt: sendReceiptToPrinter, isPrinting, lastPrintError } = useReceiptPrinter()

  const [sales, setSales] = useState<Sale[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loadedAt, setLoadedAt] = useState<Date | null>(null)

  const [rangeFilter, setRangeFilter] = useState<DateRangeFilter>('7days')
  const [methodFilter, setMethodFilter] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [visibleCount, setVisibleCount] = useState(PAGE_STEP)
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null)

  const [exportOpen, setExportOpen] = useState(false)
  const [exportingFormat, setExportingFormat] = useState<ExportFormat | null>(null)
  const closeExportRef = useRef<(() => void) | null>(null)
  const closeExport = () => {
    if (exportingFormat) return
    if (closeExportRef.current) closeExportRef.current()
    else setExportOpen(false)
  }

  const money = (value: number) => formatMoney(value, settings.currencySymbol)

  async function loadSales() {
    try {
      setLoading(true)
      setError(null)

      const firstResponse = await salesApi.list({ page: 1, pageSize: 100 })
      const firstItems = Array.isArray(firstResponse?.items) ? firstResponse.items : []
      const totalPages = Number(firstResponse?.totalPages) || 1

      const remaining =
        totalPages > 1
          ? await Promise.all(
              Array.from({ length: totalPages - 1 }, (_, index) =>
                salesApi.list({ page: index + 2, pageSize: 100 }),
              ),
            )
          : []

      setSales([...firstItems, ...remaining.flatMap((response) => response?.items ?? [])])
      setLoadedAt(new Date())
    } catch (err) {
      const message = getErrorMessage(err)
      setError(message)
      notify(message, 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadSales()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Collapse the list back when the question being asked changes.
  useEffect(() => {
    setVisibleCount(PAGE_STEP)
  }, [rangeFilter, methodFilter, searchQuery])

  const transactionsRef = useRef<HTMLElement | null>(null)

  // Set by <CloseOnBack> while the sale sheet is open; closing through it also consumes the history entry.
  const closeSheetRef = useRef<(() => void) | null>(null)
  const closeSale = () => {
    if (closeSheetRef.current) closeSheetRef.current()
    else setSelectedSale(null)
  }

  /** Filter by payment method and bring the (far-below) transaction list into view so the result is visible. */
  function selectMethod(method: string | null) {
    setMethodFilter(method)
    if (method) {
      window.requestAnimationFrame(() => transactionsRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
    }
  }

  useEffect(() => {
    if (!selectedSale) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeSale()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [selectedSale])

  const bounds = useMemo(() => rangeBounds(rangeFilter), [rangeFilter, loadedAt])
  const range = RANGES.find((r) => r.value === rangeFilter) ?? {
    value: rangeFilter,
    label: 'Selected period',
    previousLabel: 'previous period',
  }

  // Sales in the selected period (all statuses — voided ones still appear in the list).
  const periodSales = useMemo(
    () => (bounds ? sales.filter((sale) => inRange(sale, bounds.start, bounds.end)) : sales),
    [sales, bounds],
  )

  const completed = useMemo(() => periodSales.filter(isCompleted), [periodSales])

  const summary = useMemo(() => {
    const revenue = sumTotal(completed)
    const previousRevenue = bounds
      ? sumTotal(sales.filter((sale) => isCompleted(sale) && inRange(sale, bounds.prevStart, bounds.prevEnd)))
      : 0

    return {
      revenue,
      count: completed.length,
      average: completed.length > 0 ? revenue / completed.length : 0,
      itemsSold: completed.reduce((sum, sale) => sum + itemCount(sale), 0),
      discount: completed.reduce((sum, sale) => sum + (Number(sale.discount) || 0), 0),
      tax: completed.reduce((sum, sale) => sum + (Number(sale.tax) || 0), 0),
      delta: bounds && previousRevenue > 0 ? (revenue - previousRevenue) / previousRevenue : null,
      voided: periodSales.length - completed.length,
    }
  }, [completed, periodSales, sales, bounds])

  const chartData = useMemo(() => {
    if (rangeFilter === 'today' || rangeFilter === 'yesterday') {
      const hours = Array.from({ length: 24 }, (_, hour) => ({
        key: String(hour),
        label: hour === 0 ? '12a' : hour < 12 ? `${hour}a` : hour === 12 ? '12p' : `${hour - 12}p`,
        amount: 0,
      }))
      const saleHours: number[] = []
      completed.forEach((sale) => {
        const hour = new Date(sale.createdAt).getHours()
        const bucket = hours[hour]
        if (!bucket) return
        bucket.amount += Number(sale.total) || 0
        saleHours.push(hour)
      })
      // Show store hours (8a–8p) plus any hour that had sales, instead of 24 mostly-empty bars.
      const currentHour = rangeFilter === 'today' ? new Date().getHours() : 8
      const first = Math.min(8, currentHour, ...saleHours)
      const last = Math.max(20, ...saleHours)
      return hours.slice(first, last + 1)
    }

    if (bounds) {
      const days = Math.round((bounds.end.getTime() - bounds.start.getTime()) / DAY_MS)
      const buckets = Array.from({ length: days }, (_, index) => {
        const day = addDays(bounds.start, index)
        return {
          key: day.toDateString(),
          label:
            days <= 7
              ? day.toLocaleDateString([], { weekday: 'short' })
              : day.toLocaleDateString([], { month: 'short', day: 'numeric' }),
          amount: 0,
        }
      })
      const byKey = new Map(buckets.map((bucket) => [bucket.key, bucket]))
      completed.forEach((sale) => {
        const bucket = byKey.get(startOfDay(new Date(sale.createdAt)).toDateString())
        if (bucket) bucket.amount += Number(sale.total) || 0
      })
      return buckets
    }

    // All time: last 12 months.
    const now = new Date()
    const months = Array.from({ length: 12 }, (_, index) => {
      const month = new Date(now.getFullYear(), now.getMonth() - 11 + index, 1)
      return {
        key: `${month.getFullYear()}-${month.getMonth()}`,
        label: month.toLocaleDateString([], { month: 'short' }),
        amount: 0,
      }
    })
    const byKey = new Map(months.map((bucket) => [bucket.key, bucket]))
    completed.forEach((sale) => {
      const date = new Date(sale.createdAt)
      const bucket = byKey.get(`${date.getFullYear()}-${date.getMonth()}`)
      if (bucket) bucket.amount += Number(sale.total) || 0
    })
    return months
  }, [completed, bounds, rangeFilter])

  const paymentBreakdown = useMemo(() => {
    const totals = new Map<string, { amount: number; count: number }>()
    completed.forEach((sale) => {
      const label = sale.paymentMethod || 'Other'
      const entry = totals.get(label) ?? { amount: 0, count: 0 }
      entry.amount += Number(sale.total) || 0
      entry.count += 1
      totals.set(label, entry)
    })

    const order = PAYMENT_OPTIONS.map((option) => option.label)
    return Array.from(totals, ([label, entry]) => ({ label, ...entry })).sort(
      (a, b) => b.amount - a.amount || order.indexOf(a.label) - order.indexOf(b.label),
    )
  }, [completed])

  const topProducts = useMemo(() => {
    const totals = new Map<number, { name: string; quantity: number; revenue: number }>()
    completed.forEach((sale) =>
      sale.items?.forEach((item) => {
        const entry = totals.get(item.productId) ?? { name: item.productName, quantity: 0, revenue: 0 }
        entry.quantity += Number(item.quantity) || 0
        entry.revenue += Number(item.lineTotal) || 0
        totals.set(item.productId, entry)
      }),
    )
    return Array.from(totals.values())
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5)
  }, [completed])

  const transactions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return periodSales.filter((sale) => {
      if (methodFilter && sale.paymentMethod !== methodFilter) return false
      if (!query) return true
      return (
        sale.invoiceNumber?.toLowerCase().includes(query) ||
        (sale.customerName ?? 'walk-in customer').toLowerCase().includes(query)
      )
    })
  }, [periodSales, methodFilter, searchQuery])

  /** Export exactly what the screen shows: the selected range's summary, plus the (filtered) transaction list. */
  async function runExport(format: ExportFormat) {
    if (exportingFormat) return
    setExportingFormat(format)
    try {
      const filters = [
        methodFilter ? `Payment: ${methodFilter}` : '',
        searchQuery.trim() ? `Search: "${searchQuery.trim()}"` : '',
      ]
        .filter(Boolean)
        .join(' · ')

      const result = await exportReport(
        format,
        {
          storeName: settings.storeName,
          periodLabel: periodLabel ? `${range.label} · ${periodLabel}` : range.label,
          filtersLabel: filters ? `Transactions filtered by ${filters}` : undefined,
          generatedAt: new Date(),
          currency: settings.currency || 'PHP',
          summary: [
            { label: 'Revenue', value: summary.revenue, kind: 'money' },
            { label: 'Sales', value: summary.count, kind: 'count' },
            { label: 'Average sale', value: summary.average, kind: 'money' },
            { label: 'Items sold', value: summary.itemsSold, kind: 'count' },
            { label: 'Discounts', value: summary.discount, kind: 'money' },
            { label: 'Tax collected', value: summary.tax, kind: 'money' },
            { label: 'Voided sales', value: summary.voided, kind: 'count' },
          ],
          paymentMethods: paymentBreakdown.map(({ label, count, amount }) => ({ label, count, amount })),
          topProducts: topProducts.map(({ name, quantity, revenue }) => ({ name, quantity, revenue })),
          transactions: transactions.map((sale) => toTransactionRow(sale, sale.paymentMethod || 'Other')),
        },
        rangeFilter,
      )

      if (result === 'cancelled') return
      setExportingFormat(null)
      closeExportRef.current?.()
      notify(result === 'downloaded' ? `${format.toUpperCase()} downloaded.` : `${format.toUpperCase()} report is ready.`)
    } catch (err) {
      notify(`Couldn’t export the ${format.toUpperCase()}. ${getErrorMessage(err)}`, 'error')
    } finally {
      setExportingFormat(null)
    }
  }

  async function printReceipt() {
    if (!selectedSale) return
    try {
      await sendReceiptToPrinter(selectedSale, settings)
      notify('Receipt printed.')
    } catch (err) {
      notify(printerErrorMessage(err), 'error')
    }
  }

  const isFirstLoad = loading && sales.length === 0
  const showDates = rangeFilter !== 'today' && rangeFilter !== 'yesterday'
  const hasChartData = chartData.some((bucket) => bucket.amount > 0)
  const periodLabel = formatPeriod(bounds)

  // Highlight only the bar that represents "now" — none for past-only ranges like yesterday.
  const highlightKey =
    rangeFilter === 'yesterday'
      ? null
      : rangeFilter === 'today'
      ? String(new Date().getHours())
      : chartData[chartData.length - 1]?.key ?? null

  return (
    <div className="flex min-h-full flex-col bg-white text-[#091413] antialiased">
      {/* HEADER */}
      <header className="sticky top-0 z-30 bg-white/95 px-5 pb-3 pt-4 backdrop-blur-md">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight">Reports</h1>
            <p className="mt-0.5 text-sm text-slate-500">
              {loadedAt
                ? `Updated ${loadedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
                : 'Sales performance'}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setExportOpen(true)}
            disabled={isFirstLoad || (error !== null && sales.length === 0)}
            aria-haspopup="dialog"
            className="flex h-12 items-center gap-2 rounded-full bg-[#F3F5F4] px-4 text-[15px] font-medium transition hover:bg-[#E9EEEB] active:scale-95 disabled:opacity-50"
          >
            <ExportIcon size={18} />
            Export
          </button>
          <button
            type="button"
            onClick={() => void loadSales()}
            disabled={loading}
            aria-label="Refresh report"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#F3F5F4] transition hover:bg-[#E9EEEB] active:scale-95 disabled:opacity-60"
          >
            <RefreshIcon size={20} className={loading ? 'animate-spin' : ''} />
          </button>
          </div>
        </div>

        <div
          role="group"
          aria-label="Date range"
          className="-mx-5 mt-4 flex gap-2 overflow-x-auto px-5 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {RANGES.map((option) => {
            const isActive = rangeFilter === option.value
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={isActive}
                onClick={() => setRangeFilter(option.value)}
                className={`h-11 shrink-0 rounded-full px-4 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B] focus-visible:ring-offset-2 ${
                  isActive ? 'bg-[#1F5E3B] text-white' : 'bg-[#F3F5F4] text-slate-600 active:bg-[#E9EEEB]'
                }`}
              >
                {option.label}
              </button>
            )
          })}
        </div>
      </header>

      <main className="flex-1 px-5 pb-8">
        {isFirstLoad && (
          <div className="flex h-72 items-center justify-center">
            <Spinner />
          </div>
        )}

        {error && sales.length === 0 && (
          <div className="py-10">
            <ErrorState message={error} onRetry={() => void loadSales()} />
          </div>
        )}

        {!isFirstLoad && !(error && sales.length === 0) && (
          <div className={`transition-opacity ${loading ? 'opacity-60' : ''}`}>
            {/* REVENUE — the headline answer */}
            <section aria-label="Revenue" className="mt-2 rounded-3xl bg-[#F2F8F4] p-5">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm font-medium text-[#1F5E3B]">Revenue · {range.label}</p>
                {periodLabel && <p className="shrink-0 text-xs tabular-nums text-slate-500">{periodLabel}</p>}
              </div>
              <p className="mt-2 truncate text-[40px] font-bold leading-none tracking-[-0.03em] tabular-nums">
                {money(summary.revenue)}
              </p>

              {summary.delta !== null ? (
                <p
                  className={`mt-2 text-sm ${summary.delta >= 0 ? 'text-[#1F5E3B]' : 'text-rose-600'}`}
                >
                  <span className="font-semibold">
                    {summary.delta >= 0 ? '▲' : '▼'} {Math.abs(summary.delta * 100).toFixed(0)}%
                  </span>{' '}
                  <span className="text-slate-500">vs {range.previousLabel}</span>
                </p>
              ) : (
                bounds && (
                  <p className="mt-2 text-sm text-slate-500">No sales in the {range.previousLabel} to compare</p>
                )
              )}

              <dl className="mt-5 grid grid-cols-3 divide-x divide-[#DCE9E1]">
                <Stat label="Sales" value={String(summary.count)} />
                <Stat label="Avg. sale" value={money(summary.average)} />
                <Stat label="Items" value={String(summary.itemsSold)} />
              </dl>
            </section>

            {/* TREND */}
            <Section title="Trend">
              {hasChartData ? (
                <div className="h-44 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
                      <XAxis
                        dataKey="label"
                        tickLine={false}
                        axisLine={false}
                        interval={chartData.length > 12 ? Math.ceil(chartData.length / 6) - 1 : 0}
                        tick={{ fontSize: 11, fill: '#94A3B8' }}
                      />
                      <Tooltip
                        cursor={{ fill: '#F6F8F7' }}
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
                      <Bar dataKey="amount" radius={[4, 4, 4, 4]} maxBarSize={28} minPointSize={2}>
                        {chartData.map((bucket) => (
                          <Cell
                            key={bucket.key}
                            fill={bucket.key === highlightKey ? GREEN : BAR_PAST}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <Empty text={`No sales ${rangeFilter === 'all' ? 'yet' : `for ${range.label.toLowerCase()}`}.`} />
              )}
            </Section>

            {/* PAYMENT METHODS — tap to filter transactions */}
            {paymentBreakdown.length > 0 && (
              <Section title="Payment methods">
                <ul>
                  {paymentBreakdown.map((entry) => {
                    const share = summary.revenue > 0 ? entry.amount / summary.revenue : 0
                    const isSelected = methodFilter === entry.label
                    return (
                      <li key={entry.label}>
                        <button
                          type="button"
                          onClick={() => selectMethod(isSelected ? null : entry.label)}
                          aria-pressed={isSelected}
                          className={`-mx-3 flex min-h-14 w-[calc(100%+1.5rem)] items-center gap-3 rounded-2xl px-3 py-2 text-left transition ${
                            isSelected ? 'bg-[#F2F8F4]' : 'active:bg-slate-50'
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline justify-between gap-3">
                              <span className={`text-[15px] ${isSelected ? 'font-medium text-[#1F5E3B]' : ''}`}>
                                {entry.label}
                              </span>
                              <span className="text-[15px] tabular-nums">{money(entry.amount)}</span>
                            </div>
                            <div className="mt-1.5 flex items-center gap-3">
                              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                                <div
                                  className="h-full rounded-full bg-[#1F5E3B]"
                                  style={{ width: `${Math.max(2, share * 100)}%` }}
                                />
                              </div>
                              <span className="w-24 shrink-0 text-right text-xs tabular-nums text-slate-400">
                                {(share * 100).toFixed(0)}% · {entry.count} {entry.count === 1 ? 'sale' : 'sales'}
                              </span>
                            </div>
                          </div>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </Section>
            )}

            {/* TOP PRODUCTS */}
            {topProducts.length > 0 && (
              <Section title="Top products">
                <ul>
                  {topProducts.map((product, index) => (
                    <li
                      key={`${product.name}-${index}`}
                      className="flex min-h-14 items-center gap-3 border-b border-slate-100 py-2 last:border-b-0"
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#EAF4EE] text-xs font-medium tabular-nums text-[#1F5E3B]">
                        {index + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[15px]">{product.name}</p>
                        <p className="text-xs text-slate-400">{product.quantity} sold</p>
                      </div>
                      <span className="shrink-0 text-[15px] tabular-nums">{money(product.revenue)}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {/* ADJUSTMENTS */}
            {(summary.discount > 0 || summary.tax > 0 || summary.voided > 0) && (
              <Section title="Adjustments">
                <dl className="divide-y divide-slate-100">
                  <DetailRow label="Discounts given" value={money(summary.discount)} />
                  <DetailRow label="Tax collected" value={money(summary.tax)} />
                  {summary.voided > 0 && (
                    <DetailRow label="Voided sales" value={`${summary.voided} (not counted)`} />
                  )}
                </dl>
              </Section>
            )}

            {/* TRANSACTIONS */}
            <section ref={transactionsRef} className="mt-8 scroll-mt-36">
              <div className="flex min-h-11 items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">Transactions</h2>
                <span className="text-sm tabular-nums text-slate-400">{transactions.length}</span>
              </div>

              <div className="relative mt-2">
                <Search
                  size={15}
                  className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  type="search"
                  aria-label="Search transactions"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Invoice or customer"
                  className="h-12 w-full rounded-2xl border-0 bg-[#F3F5F4] pl-11 pr-12 text-[15px] placeholder:text-slate-400 outline-none focus:bg-white focus:ring-2 focus:ring-[#1F5E3B] [&::-webkit-search-cancel-button]:hidden"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    aria-label="Clear search"
                    className="absolute right-0.5 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 active:bg-slate-200"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              {methodFilter && (
                <button
                  type="button"
                  onClick={() => setMethodFilter(null)}
                  className="mt-3 inline-flex h-9 items-center gap-2 rounded-full bg-[#1F5E3B] pl-3.5 pr-2.5 text-sm text-white"
                >
                  {methodFilter} only
                  <X size={11} />
                </button>
              )}

              {transactions.length === 0 ? (
                <div className="py-12 text-center">
                  <EmptyState
                    title="No transactions found"
                    hint={
                      searchQuery || methodFilter
                        ? 'Nothing matches your search or payment filter.'
                        : `No sales ${rangeFilter === 'all' ? 'yet' : `for ${range.label.toLowerCase()}`}.`
                    }
                  />
                  {searchQuery || methodFilter ? (
                    <button
                      type="button"
                      onClick={() => {
                        setSearchQuery('')
                        setMethodFilter(null)
                      }}
                      className="mt-4 h-11 rounded-full bg-[#F3F5F4] px-5 text-[15px] font-medium active:bg-[#E9EEEB]"
                    >
                      Clear filters
                    </button>
                  ) : (
                    rangeFilter !== 'all' && (
                      <button
                        type="button"
                        onClick={() => setRangeFilter('all')}
                        className="mt-4 h-11 rounded-full bg-[#F3F5F4] px-5 text-[15px] font-medium active:bg-[#E9EEEB]"
                      >
                        Show all time
                      </button>
                    )
                  )}
                </div>
              ) : (
                <>
                  <ul className="mt-2">
                    {transactions.slice(0, visibleCount).map((sale) => {
                      const voided = !isCompleted(sale)
                      return (
                        <li key={sale.id} className="border-b border-slate-100 last:border-b-0">
                          <button
                            type="button"
                            onClick={() => setSelectedSale(sale)}
                            className="flex min-h-[68px] w-full items-center gap-3 py-3 text-left transition active:bg-slate-50"
                          >
                            <div className="min-w-0 flex-1">
                              <p className={`truncate text-[15px] ${voided ? 'text-slate-400' : ''}`}>
                                {sale.customerName || 'Walk-in customer'}
                              </p>
                              <p className="mt-0.5 truncate text-xs text-slate-400">
                                {sale.invoiceNumber} · {formatSaleTime(sale.createdAt, showDates)} ·{' '}
                                {sale.paymentMethod}
                              </p>
                            </div>
                            <div className="shrink-0 text-right">
                              <p
                                className={`text-[15px] font-medium tabular-nums ${
                                  voided ? 'text-slate-400 line-through' : ''
                                }`}
                              >
                                {money(Number(sale.total) || 0)}
                              </p>
                              {voided && <p className="text-xs text-rose-600">Voided</p>}
                            </div>
                            <ChevronRight size={12} className="shrink-0 text-slate-300" />
                          </button>
                        </li>
                      )
                    })}
                  </ul>

                  {transactions.length > visibleCount && (
                    <button
                      type="button"
                      onClick={() => setVisibleCount((count) => count + PAGE_STEP)}
                      className="mt-3 h-12 w-full rounded-2xl bg-[#F3F5F4] text-[15px] font-medium active:bg-[#E9EEEB]"
                    >
                      Show more ({transactions.length - visibleCount} left)
                    </button>
                  )}
                </>
              )}
            </section>
          </div>
        )}
      </main>

      {/* EXPORT SHEET */}
      {exportOpen && (
        <Sheet label="Export report" onClose={closeExport}>
          <CloseOnBack
            stateKey="reportExportOpen"
            onDismiss={() => setExportOpen(false)}
            closeRef={closeExportRef}
            blocked={exportingFormat !== null}
          />
          <SheetHeader
            title="Export report"
            subtitle={
              <>
                {periodLabel ? `${range.label} · ${periodLabel}` : range.label}
                {(methodFilter || searchQuery.trim()) && (
                  <span className="block text-xs">Transactions use your current search and payment filter.</span>
                )}
              </>
            }
            onClose={closeExport}
            closeDisabled={exportingFormat !== null}
          />
          <SheetBody>
            {periodSales.length === 0 && (
              <p className="rounded-2xl bg-[#F6F8F7] px-4 py-3 text-sm text-slate-500">
                No sales for {range.label.toLowerCase()}. Choose another date range to export.
              </p>
            )}
            <div className="-mx-2 pb-[env(safe-area-inset-bottom,0px)]">
              <ExportOptions
                busyFormat={exportingFormat}
                disabled={periodSales.length === 0}
                onSelect={(format) => void runExport(format)}
              />
            </div>
          </SheetBody>
        </Sheet>
      )}

      {/* SALE DETAIL SHEET */}
      {selectedSale && (
        <div role="dialog" aria-modal="true" aria-label="Sale details" className="fixed inset-0 z-50 flex flex-col justify-end">
          <CloseOnBack stateKey="reportSaleOpen" onDismiss={() => setSelectedSale(null)} closeRef={closeSheetRef} />
          <div className="absolute inset-0 bg-black/30" onClick={closeSale} aria-hidden="true" />

          <div className="relative flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-white animate-in slide-in-from-bottom duration-200">
            <div className="flex justify-center pb-2 pt-2.5">
              <span className="h-1 w-10 rounded-full bg-slate-200" />
            </div>

            <div className="flex items-start justify-between gap-3 px-5 pb-3">
              <div className="min-w-0">
                <h2 className="truncate text-lg font-semibold">{selectedSale.invoiceNumber}</h2>
                <p className="text-sm text-slate-500">
                  {selectedSale.customerName || 'Walk-in customer'} ·{' '}
                  {formatSaleTime(selectedSale.createdAt, true)}
                </p>
              </div>
              <button
                type="button"
                onClick={closeSale}
                aria-label="Close"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#F3F5F4] text-slate-500 active:bg-[#E9EEEB]"
              >
                <X size={14} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto overscroll-contain px-5">
              {!isCompleted(selectedSale) && (
                <p className="mb-3 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  This sale was voided and is not included in revenue.
                </p>
              )}

              <ul>
                {selectedSale.items?.map((item, index) => (
                  <li
                    key={`${item.productId}-${index}`}
                    className="flex items-baseline justify-between gap-3 border-b border-slate-100 py-3 text-[15px] last:border-b-0"
                  >
                    <span className="min-w-0 truncate">
                      {item.productName}
                      <span className="text-slate-400"> × {item.quantity}</span>
                    </span>
                    <span className="shrink-0 tabular-nums">
                      {money(Number(item.lineTotal) || (Number(item.unitPrice) || 0) * (Number(item.quantity) || 0))}
                    </span>
                  </li>
                ))}
              </ul>

              <dl className="mt-1 space-y-1.5 border-t border-slate-100 py-3 text-sm">
                <SummaryRow label="Subtotal" value={money(Number(selectedSale.subtotal) || 0)} />
                {Number(selectedSale.discount) > 0 && (
                  <SummaryRow label="Discount" value={`−${money(Number(selectedSale.discount))}`} />
                )}
                <SummaryRow label="Tax" value={money(Number(selectedSale.tax) || 0)} />
                <SummaryRow label="Total" value={money(Number(selectedSale.total) || 0)} strong />
              </dl>

              <dl className="mb-4 space-y-1.5 rounded-2xl bg-[#F6F8F7] px-4 py-3 text-sm">
                <SummaryRow label="Paid with" value={selectedSale.paymentMethod} />
                {selectedSale.amountReceived != null && (
                  <SummaryRow label="Received" value={money(selectedSale.amountReceived)} />
                )}
                {selectedSale.change != null && selectedSale.change > 0 && (
                  <SummaryRow label="Change" value={money(selectedSale.change)} />
                )}
                {selectedSale.cashierName && <SummaryRow label="Cashier" value={selectedSale.cashierName} />}
              </dl>
            </div>

            <div className="border-t border-slate-100 px-5 pb-[max(1rem,env(safe-area-inset-bottom,0px))] pt-3">
              <button
                type="button"
                onClick={() => void printReceipt()}
                disabled={isPrinting || !isCompleted(selectedSale)}
                className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#1F5E3B] text-[15px] font-semibold text-white transition active:scale-[0.99] disabled:bg-slate-200 disabled:text-slate-400"
              >
                <PrinterIcon size={16} />
                {!isCompleted(selectedSale)
                  ? 'Voided sales can’t be reprinted'
                  : isPrinting
                  ? 'Printing…'
                  : lastPrintError
                  ? 'Retry printing'
                  : 'Reprint receipt'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* =============================================================
   BUILDING BLOCKS
============================================================= */

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-2 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 px-3 first:pl-0 last:pr-0">
      <dt className="text-sm text-slate-500">{label}</dt>
      <dd className="mt-1 truncate text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-3">
      <dt className="text-[15px] text-slate-600">{label}</dt>
      <dd className="text-[15px] tabular-nums">{value}</dd>
    </div>
  )
}

function SummaryRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? 'text-base font-semibold text-[#091413]' : 'text-slate-500'}`}>
      <dt>{label}</dt>
      <dd className="truncate tabular-nums">{value}</dd>
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <p className="py-8 text-center text-sm text-slate-400">{text}</p>
}

/** Mounted only while a sheet is open, so Android back closes it instead of leaving Reports. */
function CloseOnBack({
  stateKey,
  onDismiss,
  closeRef,
  blocked = false,
}: {
  stateKey: string
  onDismiss: () => void
  closeRef: { current: (() => void) | null }
  /** While true (e.g. a file is being generated) back does nothing. */
  blocked?: boolean
}) {
  const { close } = useDismissOnBack(stateKey, onDismiss, blocked)

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

function ExportIcon({ size = 16 }: { size?: number }) {
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
      aria-hidden="true"
    >
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  )
}

function RefreshIcon({ size = 14, className = '' }: { size?: number; className?: string }) {
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
      <path d="M21 12a9 9 0 1 1-9-9c2.5 0 4.9 1 6.7 2.7L21 8" />
      <path d="M21 3v5h-5" />
    </svg>
  )
}

function PrinterIcon({ size = 14 }: { size?: number }) {
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
      aria-hidden="true"
    >
      <polyline points="6 9 6 2 18 2 18 9" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" />
    </svg>
  )
}

export default MobileReports
