import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { Link } from 'react-router-dom'

import { reportsApi, type BusinessReport } from '../api/reportsApi'
import { salesApi } from '../api/salesApi'
import { DateInput } from '../components/ui/DateInput'
import { DataCard, DesktopPage, DesktopSearch, DesktopSelect, FilterPills, SecondaryButton, Th } from '../components/ui/DesktopKit'
import { ChevronRight } from '../components/ui/Icons'
import { PrimaryButton, TextButton } from '../components/ui/MobileKit'
import { Modal } from '../components/ui/Modal'
import { EmptyState, ErrorState, Spinner } from '../components/ui/States'
import { useAuth } from '../context/AuthContext'
import { useSettings } from '../context/SettingsContext'
import { useToast } from '../context/ToastContext'
import { useIsMobile } from '../hooks/useIsMobile'
import { useReceiptPrinter } from '../hooks/useReceiptPrinter'
import { printerErrorMessage } from '../services/printer'
import type { Sale } from '../types'
import { getErrorMessage } from '../utils/errors'
import { formatDateTime, formatMoney } from '../utils/format'
import { ALL_TENDER_OPTIONS, CHARGE_OPTION, PAYMENT_OPTIONS } from '../utils/pos'
import { exportReport, toTransactionRow, type ExportFormat } from '../utils/reportExport'
import { ProfitLossStatement, ReportBreakdowns } from '../components/reports/BusinessReport'
import { ExportOptions } from '../components/reports/ExportOptions'
import { MobileReports } from './mobile/MobileReports'

type DateRangeFilter = 'today' | 'yesterday' | 'week' | 'month' | 'all' | 'custom'
type TrendGranularity = 'hour' | 'day' | 'week' | 'month'

const RANGE_OPTIONS: { key: DateRangeFilter; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
  { key: 'all', label: 'All time' },
  { key: 'custom', label: 'Custom' },
]

const DEFAULT_RANGE: DateRangeFilter = 'week'

const PAGE_STEP = 25

/* =============================================================
   HELPERS
============================================================= */

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

/** "2026-09-15" from a date input, as local midnight (not UTC). */
function parseLocalDate(value: string): Date {
  const [year = 0, month = 1, day = 1] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function formatCompactMoney(amount: number, symbol: string): string {
  if (Math.abs(amount) >= 1000) {
    return `${symbol}${(amount / 1000).toLocaleString('en-PH', { maximumFractionDigits: 1 })}k`
  }
  return `${symbol}${Math.round(amount).toLocaleString('en-PH')}`
}

/** Accepts either payment labels ("Cash") or enum values ("0") and normalizes to the enum value. */
function resolvePaymentMethod(methodValue: unknown): { value: string; label: string } {
  if (methodValue === null || methodValue === undefined) return { value: 'other', label: 'Other' }
  const raw = String(methodValue).trim()
  const normalized = raw.toLowerCase()
  const found = ALL_TENDER_OPTIONS.find(
    (option) => String(option.value).toLowerCase() === normalized || option.label.toLowerCase() === normalized,
  )
  return found ? { value: String(found.value), label: found.label } : { value: normalized, label: raw }
}

/** Tender lines of a sale (several for split payments); falls back to the summary method. */
function saleTenders(sale: Sale): { key: string; amount: number }[] {
  if (sale.payments?.length) return sale.payments.map((payment) => ({ key: String(payment.method), amount: Number(payment.amount) || 0 }))
  return [{ key: resolvePaymentMethod(sale.paymentMethod).value, amount: Number(sale.total) || 0 }]
}

function rangeWindow(filter: DateRangeFilter, customStart: string, customEnd: string): { start: Date | null; end: Date | null } {
  const today = startOfDay(new Date())
  const tomorrow = addDays(today, 1)
  switch (filter) {
    case 'today':
      return { start: today, end: tomorrow }
    case 'yesterday':
      return { start: addDays(today, -1), end: today }
    case 'week':
      // Weeks start on Monday.
      return { start: addDays(today, -((today.getDay() + 6) % 7)), end: tomorrow }
    case 'month':
      return { start: new Date(today.getFullYear(), today.getMonth(), 1), end: tomorrow }
    case 'custom':
      return {
        start: customStart ? parseLocalDate(customStart) : null,
        end: customEnd ? addDays(parseLocalDate(customEnd), 1) : null,
      }
    default:
      return { start: null, end: null }
  }
}

/**
 * The period a fixed range is compared with: the day before, the same days of last week, or
 * the same days of last month. Null for "all time" and custom ranges.
 */
function previousWindow(filter: DateRangeFilter, start: Date, end: Date): { start: Date; end: Date } | null {
  if (filter === 'today' || filter === 'yesterday') return { start: addDays(start, -1), end: addDays(end, -1) }
  if (filter === 'week') return { start: addDays(start, -7), end: addDays(end, -7) }
  if (filter === 'month') {
    const prevStart = new Date(start.getFullYear(), start.getMonth() - 1, 1)
    const days = Math.round((end.getTime() - start.getTime()) / 86_400_000)
    const lastOfPrev = new Date(start.getFullYear(), start.getMonth(), 0).getDate()
    return { start: prevStart, end: addDays(prevStart, Math.min(days, lastOfPrev)) }
  }
  return null
}

const itemCount = (sale: Sale) => sale.items?.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0) ?? 0

/** What a fixed range is compared with, in words. */
const COMPARISON_LABEL: Partial<Record<DateRangeFilter, string>> = {
  today: 'vs yesterday',
  yesterday: 'vs the day before',
  week: 'vs same days last week',
  month: 'vs same days last month',
}

type Metrics = ReturnType<typeof computeMetrics>

/** Totals for a set of sales. Voided sales are reported separately, never subtracted again. */
function computeMetrics(sales: Sale[]) {
  let salesTotal = 0
  let discount = 0
  let tax = 0
  let itemsSold = 0
  let refunded = 0
  let refundedCount = 0
  let count = 0
  let voidedTotal = 0
  let voidedCount = 0
  const methodTotals: Record<string, number> = {}
  const methodCounts: Record<string, number> = {}

  for (const sale of sales) {
    const total = Number(sale.total) || 0
    if (sale.status === 'Voided') {
      voidedTotal += total
      voidedCount += 1
      continue
    }
    if (sale.status !== 'Completed') continue
    count += 1
    salesTotal += total
    discount += Number(sale.discount) || 0
    tax += Number(sale.tax) || 0
    itemsSold += itemCount(sale)
    if (sale.refundedAmount > 0) {
      refunded += sale.refundedAmount
      refundedCount += 1
    }
    // Split payments count toward each tender they used.
    for (const tender of saleTenders(sale)) {
      methodTotals[tender.key] = (methodTotals[tender.key] ?? 0) + tender.amount
      methodCounts[tender.key] = (methodCounts[tender.key] ?? 0) + 1
    }
  }

  return {
    salesTotal,
    discount,
    tax,
    itemsSold,
    count,
    average: count > 0 ? salesTotal / count : 0,
    methodTotals,
    methodCounts,
    voidedTotal,
    voidedCount,
    refunded,
    refundedCount,
    netTotal: salesTotal - refunded,
  }
}

/* ---------- trend buckets ---------- */

function bucketFloor(date: Date, granularity: TrendGranularity): Date {
  switch (granularity) {
    case 'hour':
      return new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours())
    case 'day':
      return startOfDay(date)
    case 'week':
      return addDays(startOfDay(date), -((date.getDay() + 6) % 7)) // Monday
    default:
      return new Date(date.getFullYear(), date.getMonth(), 1)
  }
}

function bucketNext(date: Date, granularity: TrendGranularity): Date {
  switch (granularity) {
    case 'hour':
      return new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours() + 1)
    case 'day':
      return addDays(date, 1)
    case 'week':
      return addDays(date, 7)
    default:
      return new Date(date.getFullYear(), date.getMonth() + 1, 1)
  }
}

function bucketLabels(date: Date, granularity: TrendGranularity): { label: string; title: string } {
  const short = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  switch (granularity) {
    case 'hour': {
      const hour = (value: Date) => value.toLocaleTimeString('en-US', { hour: 'numeric' })
      return { label: hour(date), title: `${hour(date)} – ${hour(bucketNext(date, 'hour'))}` }
    }
    case 'day':
      return { label: short, title: date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) }
    case 'week':
      return { label: short, title: `Week of ${short}` }
    default:
      return {
        label: date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
        title: date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
      }
  }
}

/** Bucket size that gives a readable number of bars for a span of days. */
function autoGranularity(days: number): TrendGranularity {
  if (days <= 1) return 'hour'
  if (days <= 35) return 'day'
  if (days <= 150) return 'week'
  return 'month'
}

const GRANULARITY_LABEL: Record<TrendGranularity, string> = { hour: 'Hourly', day: 'Daily', week: 'Weekly', month: 'Monthly' }

/* =============================================================
   PAGE
============================================================= */

export function ReportsPage() {
  const isMobile = useIsMobile()
  if (isMobile) return <MobileReports />
  return <DesktopReportsPage />
}

function DesktopReportsPage() {
  const { notify } = useToast()
  const { settings } = useSettings()
  const { can } = useAuth()
  const { printReceipt: sendReceiptToPrinter, isPrinting, lastPrintError } = useReceiptPrinter()
  const money = (value: number) => formatMoney(value, settings.currencySymbol)

  const [sales, setSales] = useState<Sale[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loadedAt, setLoadedAt] = useState<Date | null>(null)

  const [rangeFilter, setRangeFilter] = useState<DateRangeFilter>(DEFAULT_RANGE)
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [methodFilter, setMethodFilter] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  /** Null = pick a bucket size from the period's length. */
  const [trendChoice, setTrendChoice] = useState<TrendGranularity | null>(null)
  const [visibleCount, setVisibleCount] = useState(PAGE_STEP)
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null)

  const [business, setBusiness] = useState<BusinessReport | null>(null)
  const [businessError, setBusinessError] = useState<string | null>(null)

  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const [exportingFormat, setExportingFormat] = useState<ExportFormat | null>(null)
  const exportMenuRef = useRef<HTMLDivElement | null>(null)
  const transactionsRef = useRef<HTMLDivElement | null>(null)

  // Close the export menu on outside click or Escape (but never mid-export).
  useEffect(() => {
    if (!exportMenuOpen) return
    const handlePointerDown = (event: MouseEvent) => {
      if (!exportingFormat && !exportMenuRef.current?.contains(event.target as Node)) setExportMenuOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !exportingFormat) setExportMenuOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [exportMenuOpen, exportingFormat])

  /* ------------------------------------------------------------------
     LOAD — only the selected period (plus the one it's compared with), in bulk.
     The profit & loss figures are aggregated by SQLite itself.
  ------------------------------------------------------------------ */

  async function loadSales() {
    const { start, end } = rangeWindow(rangeFilter, customStart, customEnd)
    const previous = start && end ? previousWindow(rangeFilter, start, end) : null
    const from = previous?.start ?? start
    try {
      setLoading(true)
      setError(null)
      setBusinessError(null)
      const [loaded, report] = await Promise.all([
        salesApi.listInRange({ from: from?.toISOString(), to: end?.toISOString() }),
        reportsApi.business({ start, end }).catch((err: unknown) => {
          setBusinessError(getErrorMessage(err))
          return null
        }),
      ])
      setSales(loaded)
      if (report) setBusiness(report)
      setLoadedAt(new Date())
    } catch (err) {
      // Keep the last loaded numbers on screen; just report the failure.
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
  }, [rangeFilter, customStart, customEnd])

  useEffect(() => {
    setTrendChoice(null)
  }, [rangeFilter, customStart, customEnd])

  useEffect(() => {
    setVisibleCount(PAGE_STEP)
  }, [rangeFilter, customStart, customEnd, methodFilter, searchQuery])

  /* ------------------------------------------------------------------
     DERIVED DATA
     The period drives the whole page. Payment method and search only narrow the
     transaction list (and what gets exported).
  ------------------------------------------------------------------ */

  const period = useMemo(() => rangeWindow(rangeFilter, customStart, customEnd), [rangeFilter, customStart, customEnd])

  const periodSales = useMemo(
    () =>
      sales.filter((sale) => {
        if (!period.start && !period.end) return true
        const time = new Date(sale.createdAt).getTime()
        if (Number.isNaN(time)) return false
        if (period.start && time < period.start.getTime()) return false
        if (period.end && time >= period.end.getTime()) return false
        return true
      }),
    [sales, period],
  )

  const filteredSales = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (methodFilter === 'all' && !query) return periodSales
    return periodSales.filter((sale) => {
      if (methodFilter !== 'all' && !saleTenders(sale).some((tender) => tender.key === methodFilter)) return false
      if (query) {
        const invoiceMatch = sale.invoiceNumber?.toLowerCase().includes(query) ?? false
        const customerMatch = (sale.customerName ?? 'walk-in customer').toLowerCase().includes(query)
        if (!invoiceMatch && !customerMatch) return false
      }
      return true
    })
  }, [periodSales, methodFilter, searchQuery])

  const periodMetrics = useMemo(() => computeMetrics(periodSales), [periodSales])
  const metrics: Metrics = useMemo(
    () => (filteredSales === periodSales ? periodMetrics : computeMetrics(filteredSales)),
    [filteredSales, periodSales, periodMetrics],
  )

  /** Sales vs the matching previous period (fixed ranges only). */
  const comparison = useMemo(() => {
    const { start, end } = rangeWindow(rangeFilter, '', '')
    if (!start || !end) return null
    const previousRange = previousWindow(rangeFilter, start, end)
    if (!previousRange) return null
    const sumBetween = (from: number, to: number) =>
      sales.reduce((sum, sale) => {
        if (sale.status !== 'Completed') return sum
        const time = new Date(sale.createdAt).getTime()
        return time >= from && time < to ? sum + (Number(sale.total) || 0) : sum
      }, 0)
    const current = sumBetween(start.getTime(), end.getTime())
    const previous = sumBetween(previousRange.start.getTime(), previousRange.end.getTime())
    if (previous === 0) return current === 0 ? null : { percent: null as number | null }
    return { percent: ((current - previous) / previous) * 100 }
  }, [sales, rangeFilter, loadedAt])

  /** Top sellers of the exported rows (the on-screen list comes from SQLite). */
  const topProducts = useMemo(() => {
    const byProduct = new Map<number, { productId: number; name: string; quantity: number; revenue: number }>()
    for (const sale of filteredSales) {
      if (sale.status !== 'Completed') continue
      for (const item of sale.items ?? []) {
        const entry = byProduct.get(item.productId) ?? { productId: item.productId, name: item.productName || 'Unknown product', quantity: 0, revenue: 0 }
        entry.quantity += Number(item.quantity) || 0
        entry.revenue += Number(item.lineTotal) || 0
        byProduct.set(item.productId, entry)
      }
    }
    return Array.from(byProduct.values())
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 5)
  }, [filteredSales])

  // Bucket size: hourly for a single day; otherwise the user's pick, or one that fits the span.
  const completedTimes = useMemo(
    () =>
      periodSales
        .filter((sale) => sale.status === 'Completed')
        .map((sale) => new Date(sale.createdAt).getTime())
        .filter((time) => !Number.isNaN(time)),
    [periodSales],
  )
  const spanDays = useMemo(() => {
    const from = period.start?.getTime() ?? (completedTimes.length ? Math.min(...completedTimes) : Date.now())
    const to = Math.min(period.end?.getTime() ?? Date.now(), Date.now())
    return Math.max(1, Math.ceil((to - from) / 86_400_000))
  }, [period, completedTimes])
  const singleDay = period.start !== null && period.end !== null && period.end.getTime() - period.start.getTime() <= 86_400_000
  const granularity: TrendGranularity = singleDay ? 'hour' : trendChoice ?? (autoGranularity(spanDays) === 'hour' ? 'day' : autoGranularity(spanDays))

  /** Every bucket in the period, including the ones with no sales (a gap is information too). */
  const trendBuckets = useMemo(() => {
    if (completedTimes.length === 0) return []
    const amounts = new Map<number, { amount: number; count: number }>()
    for (const sale of periodSales) {
      if (sale.status !== 'Completed') continue
      const date = new Date(sale.createdAt)
      if (Number.isNaN(date.getTime())) continue
      const key = bucketFloor(date, granularity).getTime()
      const entry = amounts.get(key) ?? { amount: 0, count: 0 }
      entry.amount += Number(sale.total) || 0
      entry.count += 1
      amounts.set(key, entry)
    }

    const first = Math.min(...completedTimes)
    const last = Math.max(...completedTimes)
    // Hourly charts span the trading hours; longer ones span the whole period (up to today).
    const from = granularity === 'hour' ? new Date(first) : period.start ?? new Date(first)
    const to = granularity === 'hour' ? new Date(last + 1) : new Date(Math.max(last + 1, Math.min(period.end?.getTime() ?? Date.now(), Date.now())))

    const buckets: { key: number; label: string; title: string; amount: number; count: number }[] = []
    for (let cursor = bucketFloor(from, granularity); cursor < to && buckets.length < 400; cursor = bucketNext(cursor, granularity)) {
      const entry = amounts.get(cursor.getTime())
      buckets.push({ key: cursor.getTime(), ...bucketLabels(cursor, granularity), amount: entry?.amount ?? 0, count: entry?.count ?? 0 })
    }
    return buckets
  }, [periodSales, completedTimes, granularity, period])

  const trendStats = useMemo(() => {
    if (trendBuckets.length === 0) return null
    const peak = trendBuckets.reduce((best, bucket) => (bucket.amount > best.amount ? bucket : best))
    const average = trendBuckets.reduce((sum, bucket) => sum + bucket.amount, 0) / trendBuckets.length
    return { peak, average }
  }, [trendBuckets])

  const transactionFiltersOn = methodFilter !== 'all' || searchQuery.trim() !== ''
  const initialLoading = loading && sales.length === 0 && !loadedAt
  const rangeLabel = RANGE_OPTIONS.find((option) => option.key === rangeFilter)?.label ?? ''
  const methodLabel = methodFilter === 'all' ? null : ALL_TENDER_OPTIONS.find((o) => String(o.value) === methodFilter)?.label

  function resetTransactionFilters() {
    setMethodFilter('all')
    setSearchQuery('')
  }

  /** Narrow the transaction list to one tender and bring it into view. */
  function showMethodTransactions(key: string) {
    setMethodFilter(key)
    requestAnimationFrame(() => transactionsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  /* ------------------------------------------------------------------
     ACTIONS
  ------------------------------------------------------------------ */

  /** "Sep 9, 2026 – Sep 15, 2026" for the current date filter. */
  function periodDates(): string {
    if (rangeFilter === 'all') return 'Every sale on this device'
    const { start, end } = period
    const format = (date: Date) => date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    const last = end ? addDays(end, -1) : null
    if (start && last) return start.getTime() === last.getTime() ? format(start) : `${format(start)} – ${format(last)}`
    if (start) return `From ${format(start)}`
    if (last) return `Until ${format(last)}`
    return 'Pick a start and/or end date'
  }

  /** "This week · Sep 9, 2026 – Sep 15, 2026". */
  function describePeriod(): string {
    if (rangeFilter === 'all') return 'All time'
    return [rangeLabel, periodDates()].filter(Boolean).join(' · ')
  }

  /** Export what the transaction list shows: its filtered sales and the totals calculated from them. */
  async function runExport(format: ExportFormat) {
    if (exportingFormat) return
    if (filteredSales.length === 0) {
      notify('No sales match these filters, so there is nothing to export.', 'error')
      return
    }

    setExportingFormat(format)
    try {
      const filters = [methodLabel ? `Payment: ${methodLabel}` : '', searchQuery.trim() ? `Search: "${searchQuery.trim()}"` : '']
        .filter(Boolean)
        .join(' · ')

      const paymentMethods = Object.entries(metrics.methodTotals)
        .map(([key, amount]) => ({
          label: ALL_TENDER_OPTIONS.find((option) => String(option.value) === key)?.label ?? resolvePaymentMethod(key).label,
          count: metrics.methodCounts[key] ?? 0,
          amount,
        }))
        .sort((a, b) => b.amount - a.amount)

      const result = await exportReport(
        format,
        {
          storeName: settings.storeName,
          periodLabel: describePeriod(),
          filtersLabel: filters ? `Filtered by ${filters}` : undefined,
          generatedAt: new Date(),
          currency: settings.currency || 'PHP',
          summary: [
            { label: 'Revenue', value: metrics.salesTotal, kind: 'money' },
            { label: 'Sales', value: metrics.count, kind: 'count' },
            { label: 'Average sale', value: metrics.average, kind: 'money' },
            { label: 'Items sold', value: metrics.itemsSold, kind: 'count' },
            { label: 'Discounts', value: metrics.discount, kind: 'money' },
            { label: 'Tax collected', value: metrics.tax, kind: 'money' },
            { label: 'Voided sales', value: metrics.voidedCount, kind: 'count' },
            { label: 'Voided amount', value: metrics.voidedTotal, kind: 'money' },
            { label: 'Refunded amount', value: metrics.refunded, kind: 'money' },
            { label: 'Net revenue', value: metrics.netTotal, kind: 'money' },
          ],
          paymentMethods,
          topProducts: topProducts.map(({ name, quantity, revenue }) => ({ name, quantity, revenue })),
          transactions: filteredSales.map((sale) => toTransactionRow(sale, resolvePaymentMethod(sale.paymentMethod).label)),
        },
        rangeFilter,
      )

      if (result === 'cancelled') return
      setExportMenuOpen(false)
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

  /* ------------------------------------------------------------------
     RENDER
  ------------------------------------------------------------------ */

  // "Charge" only appears once customer credit is on (or when charged sales are in this period).
  const tenderOptions =
    settings.creditEnabled || (periodMetrics.methodTotals[String(CHARGE_OPTION.value)] ?? 0) > 0 ? ALL_TENDER_OPTIONS : PAYMENT_OPTIONS
  const businessPending = business ? null : businessError ? 'Couldn’t load' : 'Loading…'
  const stockAlerts = business ? business.inventory.lowStock + business.inventory.outOfStock : 0

  return (
    <DesktopPage
      title="Reports"
      subtitle={loadedAt ? `Updated ${loadedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Sales performance'}
      actions={
        <>
          <SecondaryButton onClick={() => void loadSales()} disabled={loading} aria-label="Refresh" title="Refresh" className="w-11 justify-center px-0">
            <RefreshIcon spinning={loading} />
          </SecondaryButton>
          <SecondaryButton onClick={() => window.print()}>Print</SecondaryButton>
          <div ref={exportMenuRef} className="relative print:hidden">
            <button
              type="button"
              onClick={() => !exportingFormat && setExportMenuOpen((open) => !open)}
              disabled={filteredSales.length === 0}
              title={filteredSales.length === 0 ? 'No sales match these filters' : undefined}
              aria-haspopup="menu"
              aria-expanded={exportMenuOpen}
              className="inline-flex h-11 items-center gap-2 rounded-full bg-[#1F5E3B] px-5 text-sm font-medium text-white transition active:scale-95 disabled:bg-slate-200 disabled:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B] focus-visible:ring-offset-2"
            >
              {exportingFormat ? 'Exporting…' : 'Export'}
              <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`transition-transform ${exportMenuOpen ? 'rotate-180' : ''}`}>
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>

            {exportMenuOpen && (
              <div
                role="menu"
                aria-label="Export format"
                className="absolute right-0 top-full z-40 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-2xl bg-white p-1.5 text-left shadow-[0_12px_32px_rgba(9,20,19,0.12)] ring-1 ring-slate-100"
              >
                <p className="truncate px-3 pb-1 pt-2 text-xs text-slate-500">{describePeriod()}</p>
                {transactionFiltersOn && <p className="truncate px-3 pb-1 text-xs text-[#1F5E3B]">Only the {filteredSales.length} filtered transactions</p>}
                <ExportOptions asMenu busyFormat={exportingFormat} onSelect={(format) => void runExport(format)} />
              </div>
            )}
          </div>
        </>
      }
    >
      {/* Layout follows the content width (sidebar rail or expanded, portrait or landscape), not the screen. */}
      <div className="@container">
        {/* PERIOD — drives everything below. Sticks to the top on tall (portrait) screens. */}
        <div className="z-20 -mx-6 mt-4 bg-[#F6F8F7]/95 px-6 py-3 backdrop-blur print:static [@media(min-height:900px)]:sticky [@media(min-height:900px)]:top-0">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="hidden @2xl:block pointer-coarse:[&_button]:h-11">
              <FilterPills label="Report period" value={rangeFilter} onChange={setRangeFilter} options={RANGE_OPTIONS} />
            </div>
            <div className="@2xl:hidden">
              <DesktopSelect
                label="Period"
                value={rangeFilter}
                onChange={(value) => setRangeFilter(value as DateRangeFilter)}
                options={RANGE_OPTIONS.map((option) => ({ value: option.key, label: option.label }))}
              />
            </div>
            <p className="ml-auto whitespace-nowrap text-sm text-slate-500" aria-live="polite">
              <CalendarIcon />
              {periodDates()}
            </p>
          </div>

          {rangeFilter === 'custom' && (
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
              <label className="flex items-center gap-2 text-slate-500">
                From
                <DateInput
                  value={customStart}
                  max={customEnd || undefined}
                  onChange={setCustomStart}
                  placeholder="Start date"
                  className="h-11 w-44 rounded-xl bg-white ring-1 ring-slate-200"
                />
              </label>
              <label className="flex items-center gap-2 text-slate-500">
                To
                <DateInput
                  value={customEnd}
                  min={customStart || undefined}
                  onChange={setCustomEnd}
                  placeholder="End date"
                  className="h-11 w-44 rounded-xl bg-white ring-1 ring-slate-200"
                />
              </label>
            </div>
          )}
        </div>

        {error && sales.length > 0 && (
          <p className="mt-3 rounded-2xl bg-rose-50 px-5 py-3 text-sm text-rose-700 print:hidden">
            Couldn’t refresh: {error}. Showing the last loaded data.
          </p>
        )}

        {initialLoading ? (
          <div className="py-24">
            <Spinner />
          </div>
        ) : error && sales.length === 0 ? (
          <div className="mt-4">
            <ErrorState message={error} onRetry={() => void loadSales()} />
          </div>
        ) : (
          <div className={`mt-3 space-y-4 transition-opacity @4xl:space-y-6 ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
            {/* HEADLINE NUMBERS */}
            <div className="grid grid-cols-2 gap-3 @2xl:gap-4 @4xl:grid-cols-4">
              <div className="flex min-w-0 flex-col rounded-2xl bg-[#1F5E3B] p-5 text-white">
                <p className="truncate text-sm text-white/75">Total sales</p>
                <p className="mt-1 truncate text-2xl font-bold tabular-nums tracking-tight @2xl:text-[1.75rem]">{money(periodMetrics.salesTotal)}</p>
                <p className="mt-1.5 flex min-w-0 items-center gap-2 text-xs">
                  {comparison ? (
                    comparison.percent === null ? (
                      <span className="truncate text-white/75">First sales in the comparison window</span>
                    ) : (
                      <>
                        <span className="shrink-0 rounded-full bg-white/15 px-2 py-0.5 font-semibold tabular-nums">
                          {comparison.percent >= 0 ? '▲' : '▼'} {Math.abs(comparison.percent).toFixed(1)}%
                        </span>
                        <span className="truncate text-white/75">{COMPARISON_LABEL[rangeFilter]}</span>
                      </>
                    )
                  ) : (
                    <span className="truncate text-white/75">
                      {periodMetrics.count} completed {periodMetrics.count === 1 ? 'sale' : 'sales'}
                    </span>
                  )}
                </p>
                <Sparkline values={trendBuckets.map((bucket) => bucket.amount)} />
              </div>

              <KpiCard
                label="Gross profit"
                value={business ? money(business.grossProfit) : '—'}
                footer={businessPending ?? (business?.grossMargin !== null ? `${business?.grossMargin}% margin on net sales` : 'No net sales yet')}
              >
                {business?.grossMargin != null && (
                  <div className="mt-auto pt-3" aria-hidden="true">
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-[#1F5E3B]" style={{ width: `${Math.max(0, Math.min(100, business.grossMargin))}%` }} />
                    </div>
                  </div>
                )}
              </KpiCard>

              <KpiCard
                label={business && business.netProfit < 0 ? 'Net loss (est.)' : 'Net profit (est.)'}
                value={business ? money(business.netProfit) : '—'}
                tone={business && business.netProfit < 0 ? 'bad' : undefined}
                footer={businessPending ?? `After ${money(business?.expenses ?? 0)} in expenses`}
              />

              <KpiCard
                label="Transactions"
                value={periodMetrics.count.toLocaleString()}
                footer={`Avg ${money(periodMetrics.average)} · ${periodMetrics.itemsSold.toLocaleString()} items`}
              />
            </div>

            {/* SIGNALS — the smaller numbers worth a glance */}
            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-slate-100 ring-1 ring-slate-100 @xl:grid-cols-3 @5xl:grid-cols-6">
              <Signal label="Discounts" value={money(periodMetrics.discount)} hint={periodMetrics.discount > 0 ? 'Given on completed sales' : 'None given'} />
              <Signal
                label="Refunds"
                value={money(periodMetrics.refunded)}
                hint={periodMetrics.refundedCount > 0 ? `On ${periodMetrics.refundedCount} ${periodMetrics.refundedCount === 1 ? 'sale' : 'sales'}` : 'None'}
                tone={periodMetrics.refunded > 0 ? 'warn' : undefined}
              />
              <Signal label="Tax collected" value={money(periodMetrics.tax)} hint="Included in sales" />
              <Signal
                label="Voided"
                value={periodMetrics.voidedCount.toLocaleString()}
                hint={periodMetrics.voidedCount > 0 ? `${money(periodMetrics.voidedTotal)} · not counted` : 'None'}
                tone={periodMetrics.voidedCount > 0 ? 'bad' : undefined}
              />
              <Signal
                label="Stock alerts"
                value={business ? stockAlerts.toLocaleString() : '—'}
                hint={business ? `${business.inventory.lowStock} low · ${business.inventory.outOfStock} out` : businessPending ?? ''}
                tone={business?.inventory.outOfStock ? 'bad' : business?.inventory.lowStock ? 'warn' : undefined}
                to={can('inventory.manage') && stockAlerts > 0 ? '/inventory' : undefined}
              />
              <Signal
                label="Owed by customers"
                value={business ? money(business.receivables.total) : '—'}
                hint={
                  business
                    ? business.receivables.customers > 0
                      ? `${business.receivables.customers} ${business.receivables.customers === 1 ? 'customer' : 'customers'}`
                      : 'Nothing outstanding'
                    : businessPending ?? ''
                }
                tone={business && business.receivables.total > 0 ? 'warn' : undefined}
                to={can('customers.view') && (business?.receivables.total ?? 0) > 0 ? '/customers' : undefined}
              />
            </dl>

            {/* TREND + PAYMENT MIX */}
            <div className="grid min-w-0 gap-4 @4xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] @4xl:gap-6">
              <section className="min-w-0 rounded-2xl bg-white p-5 ring-1 ring-slate-100 @2xl:p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold">Sales trend</h2>
                    <p className="mt-0.5 truncate text-sm text-slate-500">
                      {trendStats && trendStats.peak.amount > 0
                        ? `Best ${granularity === 'hour' ? 'hour' : granularity}: ${trendStats.peak.title} · ${money(trendStats.peak.amount)}`
                        : 'Completed sales over the period'}
                    </p>
                  </div>
                  {singleDay ? (
                    <span className="flex h-10 items-center rounded-full bg-[#F1F4F3] px-4 text-xs font-medium text-slate-600">By hour</span>
                  ) : (
                    <div className="flex rounded-full bg-[#F1F4F3] p-1 print:hidden" role="group" aria-label="Group sales by">
                      {(['day', 'week', 'month'] as TrendGranularity[]).map((option) => (
                        <button
                          key={option}
                          type="button"
                          onClick={() => setTrendChoice(option)}
                          aria-pressed={granularity === option}
                          className={`h-8 rounded-full px-3 text-xs font-medium transition pointer-coarse:h-10 pointer-coarse:px-4 ${
                            granularity === option ? 'bg-white text-[#091413] shadow-sm' : 'text-slate-500 hover:text-[#091413]'
                          }`}
                        >
                          {GRANULARITY_LABEL[option]}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {trendBuckets.length === 0 ? (
                  <div className="mt-4 flex h-56 items-center justify-center rounded-2xl bg-[#F6F8F7] text-sm text-slate-400">No completed sales in this period.</div>
                ) : (
                  <div className="mt-4 h-56 w-full min-w-0 @4xl:h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={trendBuckets} margin={{ top: 12, right: 4, left: 0, bottom: 0 }} barCategoryGap="18%">
                        <CartesianGrid vertical={false} stroke="#EEF2F0" />
                        <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#64748B' }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={16} />
                        <YAxis
                          tick={{ fontSize: 12, fill: '#94A3B8' }}
                          tickLine={false}
                          axisLine={false}
                          width={52}
                          tickFormatter={(value) => formatCompactMoney(Number(value), settings.currencySymbol)}
                          allowDecimals={false}
                        />
                        <Tooltip
                          cursor={{ fill: '#F1F4F3' }}
                          content={({ active, payload }) => {
                            const bucket = active ? (payload?.[0]?.payload as (typeof trendBuckets)[number] | undefined) : undefined
                            return bucket ? (
                              <div className="rounded-xl bg-[#091413] px-3 py-2 text-white shadow-lg">
                                <p className="text-[11px] text-white/60">{bucket.title}</p>
                                <p className="text-sm font-semibold tabular-nums">{money(bucket.amount)}</p>
                                <p className="text-[11px] text-white/60">
                                  {bucket.count} {bucket.count === 1 ? 'sale' : 'sales'}
                                </p>
                              </div>
                            ) : null
                          }}
                        />
                        {trendStats && trendBuckets.length > 1 && (
                          <ReferenceLine
                            y={trendStats.average}
                            stroke="#94A3B8"
                            strokeDasharray="4 4"
                            label={{ value: 'Avg', position: 'insideTopRight', fill: '#64748B', fontSize: 11 }}
                          />
                        )}
                        <Bar dataKey="amount" fill="#1F5E3B" radius={[4, 4, 0, 0]} maxBarSize={36} minPointSize={2} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </section>

              {/* PAYMENT MIX — tap one to see its transactions */}
              <section className="min-w-0 rounded-2xl bg-white p-5 ring-1 ring-slate-100 @2xl:p-6">
                <h2 className="text-base font-semibold">Payment mix</h2>
                <p className="mt-0.5 text-sm text-slate-500">Tap one to see its transactions.</p>
                <ul className="mt-3 grid gap-x-10 gap-y-0.5 @xl:grid-cols-2 @4xl:grid-cols-1">
                  {tenderOptions.map((option) => {
                    const key = String(option.value)
                    const total = periodMetrics.methodTotals[key] ?? 0
                    const count = periodMetrics.methodCounts[key] ?? 0
                    const share = periodMetrics.salesTotal > 0 ? total / periodMetrics.salesTotal : 0
                    const active = methodFilter === key
                    return (
                      <li key={key}>
                        <button
                          type="button"
                          onClick={() => (active ? setMethodFilter('all') : showMethodTransactions(key))}
                          aria-pressed={active}
                          aria-label={`${option.label}: ${money(total)}, ${count} ${count === 1 ? 'sale' : 'sales'}. ${active ? 'Showing its transactions' : 'Show its transactions'}`}
                          className={`-mx-3 w-[calc(100%+1.5rem)] rounded-2xl px-3 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B] ${
                            active ? 'bg-[#F2F8F4]' : 'hover:bg-slate-50'
                          }`}
                        >
                          <div className="flex items-baseline justify-between gap-3">
                            <span className={`text-sm ${active ? 'font-semibold text-[#1F5E3B]' : 'font-medium'}`}>{option.label}</span>
                            <span className="text-sm font-medium tabular-nums">{money(total)}</span>
                          </div>
                          <div className="mt-1.5 flex items-center gap-3">
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                              <div className="h-full rounded-full bg-[#1F5E3B]" style={{ width: `${share * 100}%` }} />
                            </div>
                            <span className="shrink-0 text-right text-xs tabular-nums text-slate-400">
                              {Math.round(share * 100)}% · {count}
                            </span>
                          </div>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </section>
            </div>

            {/* PROFIT & LOSS + BREAKDOWNS — aggregated by SQLite for the selected dates */}
            {business ? (
              <div className={`grid min-w-0 items-start gap-4 @4xl:grid-cols-[minmax(0,1fr)_minmax(0,1.45fr)] @4xl:gap-6 ${loading ? 'opacity-90' : ''}`}>
                <section className="rounded-2xl bg-white p-5 ring-1 ring-slate-100 @2xl:p-6">
                  <ProfitLossStatement report={business} money={money} />
                </section>
                <section className="min-w-0 rounded-2xl bg-white pt-2 ring-1 ring-slate-100">
                  <ReportBreakdowns report={business} money={money} />
                </section>
              </div>
            ) : (
              <section className="rounded-2xl bg-white p-6 ring-1 ring-slate-100">
                {businessError ? <ErrorState message={businessError} onRetry={() => void loadSales()} /> : <Spinner />}
              </section>
            )}

            {/* TRANSACTIONS — payment and search filters live here and only narrow this list */}
            <div ref={transactionsRef} className="scroll-mt-24">
              <DataCard className="@container">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-5 pt-5 @xl:px-6">
                  <h2 className="text-base font-semibold">Transactions</h2>
                  <span className="text-sm tabular-nums text-slate-500" aria-live="polite">
                    {filteredSales.length.toLocaleString()} {filteredSales.length === 1 ? 'sale' : 'sales'}
                    {metrics.count > 0 && <> · {money(metrics.salesTotal)}</>}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 pb-4 pt-3 print:hidden @xl:px-6">
                  <DesktopSearch value={searchQuery} onChange={setSearchQuery} placeholder="Invoice or customer" label="Search transactions" className="min-w-48 flex-1" />
                  <DesktopSelect
                    label="Paid with"
                    value={methodFilter}
                    onChange={setMethodFilter}
                    clearValue="all"
                    options={[
                      { value: 'all', label: 'Any', meta: String(periodMetrics.count + periodMetrics.voidedCount) },
                      ...tenderOptions.map((option) => ({
                        value: String(option.value),
                        label: option.label,
                        meta: String(periodMetrics.methodCounts[String(option.value)] ?? 0),
                      })),
                    ]}
                  />
                </div>

                {filteredSales.length === 0 ? (
                  <div className="px-6 py-14 text-center">
                    <EmptyState
                      title={transactionFiltersOn ? 'No matching sales' : 'No sales in this period'}
                      hint={transactionFiltersOn ? 'Try another payment method or search.' : 'Pick a different period above.'}
                    />
                    {transactionFiltersOn && (
                      <button type="button" onClick={resetTransactionFilters} className="mt-4 h-11 rounded-full bg-[#F3F5F4] px-5 text-sm font-medium hover:bg-[#E9EEEB]">
                        Clear filters
                      </button>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead className="border-b border-slate-100 text-xs text-slate-500">
                          <tr>
                            <Th className="pl-5 @xl:pl-6">Invoice</Th>
                            <Th className="hidden @3xl:table-cell">Date</Th>
                            <Th>Customer</Th>
                            <Th className="hidden @[60rem]:table-cell">Cashier</Th>
                            <Th>Paid with</Th>
                            <Th align="right" className="hidden @xl:table-cell">Items</Th>
                            <Th align="right" className="pr-5 @xl:pr-3">Total</Th>
                            <Th className="hidden pr-6 @xl:table-cell print:hidden">
                              <span className="sr-only">Open</span>
                            </Th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {filteredSales.slice(0, visibleCount).map((sale) => {
                            const voided = sale.status === 'Voided'
                            return (
                              <tr key={sale.id} onClick={() => setSelectedSale(sale)} className={`cursor-pointer hover:bg-slate-50 ${voided ? 'text-slate-400' : ''}`}>
                                <td className="py-3 pl-5 pr-3 @xl:pl-6">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setSelectedSale(sale)
                                    }}
                                    className="whitespace-nowrap font-medium focus-visible:underline focus-visible:outline-none"
                                  >
                                    {sale.invoiceNumber}
                                  </button>
                                  {voided && <span className="ml-2 whitespace-nowrap rounded-full bg-rose-50 px-2 py-0.5 text-xs text-rose-600">Voided</span>}
                                  {/* Narrow card (portrait): the date moves under the invoice instead of its own column. */}
                                  <span className="block whitespace-nowrap text-xs text-slate-400 @3xl:hidden">{formatDateTime(sale.createdAt)}</span>
                                </td>
                                <td className="hidden whitespace-nowrap px-3 py-3 text-slate-500 @3xl:table-cell">{formatDateTime(sale.createdAt)}</td>
                                <td className="max-w-32 truncate px-3 py-3 @xl:max-w-48">{sale.customerName || 'Walk-in customer'}</td>
                                <td className="hidden max-w-40 truncate px-3 py-3 text-slate-500 @[60rem]:table-cell">{sale.cashierName || '—'}</td>
                                <td className="whitespace-nowrap px-3 py-3">
                                  {resolvePaymentMethod(sale.paymentMethod).label}
                                  {sale.orderType && <span className="block text-xs text-slate-400">{sale.orderType}</span>}
                                </td>
                                <td className="hidden px-3 py-3 text-right tabular-nums @xl:table-cell">{itemCount(sale)}</td>
                                <td className="whitespace-nowrap py-3 pl-3 pr-5 text-right tabular-nums @xl:pr-3">
                                  <span className={`font-medium ${voided ? 'line-through' : ''}`}>{money(Number(sale.total) || 0)}</span>
                                  {/* Narrowest card: the item count rides under the total instead of its own column. */}
                                  <span className="block text-xs text-slate-400 @xl:hidden">
                                    {itemCount(sale)} {itemCount(sale) === 1 ? 'item' : 'items'}
                                  </span>
                                </td>
                                <td className="hidden py-3 pl-3 pr-6 text-right @xl:table-cell print:hidden">
                                  <ChevronRight size={12} className="inline text-slate-300" />
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                    {filteredSales.length > visibleCount && (
                      <div className="border-t border-slate-100 px-5 py-3 print:hidden @xl:px-6">
                        <button
                          type="button"
                          onClick={() => setVisibleCount((count) => count + PAGE_STEP)}
                          className="h-11 w-full rounded-full bg-[#F3F5F4] text-sm font-medium hover:bg-[#E9EEEB]"
                        >
                          Show more ({filteredSales.length - visibleCount} left)
                        </button>
                      </div>
                    )}
                  </>
                )}
              </DataCard>
            </div>

            {/* Drawer counts are saved with each shift (expected vs counted, over/short). */}
            {can('shifts.manage') && (
              <p className="text-sm text-slate-500 print:hidden">
                Cash drawer counts are recorded when each shift is closed.{' '}
                <Link to="/shift-history" className="font-medium text-[#1F5E3B] underline-offset-2 hover:underline">
                  See shift history
                </Link>
              </p>
            )}
          </div>
        )}
      </div>

      {/* SALE DETAILS */}
      {selectedSale && (
        <Modal
          title={selectedSale.invoiceNumber}
          description={`${selectedSale.customerName || 'Walk-in customer'} · ${formatDateTime(selectedSale.createdAt)}`}
          size="lg"
          onClose={() => setSelectedSale(null)}
          footer={
            <div className="flex w-full items-center justify-end gap-2">
              <TextButton onClick={() => setSelectedSale(null)} className="h-12">
                Close
              </TextButton>
              <PrimaryButton onClick={() => void printReceipt()} disabled={isPrinting} className="h-12 flex-none px-6">
                {isPrinting ? 'Printing…' : lastPrintError ? 'Retry print' : 'Reprint receipt'}
              </PrimaryButton>
            </div>
          }
        >
          <div className="space-y-4">
            {selectedSale.status === 'Voided' && (
              <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">This sale was voided and isn’t included in the totals.</p>
            )}
            <ul className="rounded-2xl px-4 ring-1 ring-slate-100">
              {selectedSale.items?.map((item, index) => (
                <li key={`${item.productId}-${index}`} className="flex items-baseline justify-between gap-3 border-b border-slate-100 py-3 text-sm last:border-b-0">
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
            <dl className="space-y-1.5 text-sm">
              <SummaryRow label="Subtotal" value={money(Number(selectedSale.subtotal) || 0)} />
              {Number(selectedSale.discount) > 0 && <SummaryRow label="Discount" value={`−${money(Number(selectedSale.discount))}`} />}
              <SummaryRow label="Tax" value={money(Number(selectedSale.tax) || 0)} />
              <SummaryRow label="Total" value={money(Number(selectedSale.total) || 0)} strong />
            </dl>
            <dl className="space-y-1.5 rounded-2xl bg-[#F6F8F7] px-4 py-3 text-sm">
              {selectedSale.orderType && <SummaryRow label="Order type" value={selectedSale.orderType} />}
              <SummaryRow label="Paid with" value={resolvePaymentMethod(selectedSale.paymentMethod).label} />
              {selectedSale.amountReceived != null && <SummaryRow label="Received" value={money(Number(selectedSale.amountReceived))} />}
              {selectedSale.change != null && Number(selectedSale.change) > 0 && <SummaryRow label="Change" value={money(Number(selectedSale.change))} />}
              {selectedSale.cashierName && <SummaryRow label="Cashier" value={selectedSale.cashierName} />}
            </dl>
          </div>
        </Modal>
      )}
    </DesktopPage>
  )
}

export { ReportsPage as Reports }
export default ReportsPage

/* =============================================================
   PIECES
============================================================= */

function KpiCard({
  label,
  value,
  footer,
  tone,
  children,
}: {
  label: string
  value: string
  footer?: ReactNode
  tone?: 'bad'
  children?: ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col rounded-2xl bg-white p-5 ring-1 ring-slate-100">
      <p className="truncate text-sm text-slate-500">{label}</p>
      <p className={`mt-1 truncate text-2xl font-bold tabular-nums tracking-tight @2xl:text-[1.75rem] ${tone === 'bad' ? 'text-rose-600' : ''}`}>{value}</p>
      {footer && <p className="mt-1.5 truncate text-xs text-slate-500">{footer}</p>}
      {children}
    </div>
  )
}

function Signal({ label, value, hint, tone, to }: { label: string; value: string; hint?: string; tone?: 'warn' | 'bad'; to?: string }) {
  const color = tone === 'bad' ? 'text-rose-600' : tone === 'warn' ? 'text-amber-700' : 'text-[#091413]'
  const body = (
    <>
      <dt className="flex items-center justify-between gap-2 truncate text-xs text-slate-500">
        {label}
        {to && <ChevronRight size={10} className="shrink-0 text-slate-300" />}
      </dt>
      <dd className={`mt-0.5 truncate text-lg font-semibold tabular-nums ${color}`}>{value}</dd>
      {hint && <dd className="truncate text-xs text-slate-400">{hint}</dd>}
    </>
  )
  return to ? (
    <Link to={to} className="block min-w-0 bg-white px-4 py-3.5 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#1F5E3B]">
      {body}
    </Link>
  ) : (
    <div className="min-w-0 bg-white px-4 py-3.5">{body}</div>
  )
}

/** Tiny trend line for the headline card (decorative; the full chart is below). */
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null
  const max = Math.max(...values, 1)
  const step = 100 / (values.length - 1)
  const points = values.map((value, index) => `${(index * step).toFixed(2)},${(30 - (value / max) * 26).toFixed(2)}`)
  return (
    <svg viewBox="0 0 100 32" preserveAspectRatio="none" className="mt-auto h-9 w-full pt-2" aria-hidden="true">
      <polygon points={`0,32 ${points.join(' ')} 100,32`} fill="rgba(255,255,255,0.12)" />
      <polyline points={points.join(' ')} fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function SummaryRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? 'text-base font-semibold text-[#091413]' : 'text-slate-500'}`}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  )
}

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={spinning ? 'animate-spin' : ''} aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-9-9c2.5 0 4.9 1 6.7 2.7L21 8" />
      <path d="M21 3v5h-5" />
    </svg>
  )
}

function CalendarIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mr-1.5 inline -translate-y-px">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  )
}
