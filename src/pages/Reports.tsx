import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { salesApi } from '../api/salesApi'
import { DataCard, DesktopPage, DesktopSearch, FilterPills, SecondaryButton, SectionCard, Th } from '../components/ui/DesktopKit'
import { ChevronRight } from '../components/ui/Icons'
import { PrimaryButton, TextButton } from '../components/ui/MobileKit'
import { Modal } from '../components/ui/Modal'
import { EmptyState, ErrorState, Spinner } from '../components/ui/States'
import { useSettings } from '../context/SettingsContext'
import { useToast } from '../context/ToastContext'
import { useIsMobile } from '../hooks/useIsMobile'
import { useReceiptPrinter } from '../hooks/useReceiptPrinter'
import { printerErrorMessage } from '../services/printer'
import type { Sale } from '../types'
import { getErrorMessage } from '../utils/errors'
import { formatDateTime, formatMoney } from '../utils/format'
import { PAYMENT_OPTIONS } from '../utils/pos'
import { exportReport, toTransactionRow, type ExportFormat } from '../utils/reportExport'
import { ExportOptions } from '../components/reports/ExportOptions'
import { MobileReports } from './mobile/MobileReports'

type DateRangeFilter = 'today' | 'yesterday' | '7days' | '30days' | 'all' | 'custom'
type TrendGranularity = 'day' | 'week' | 'month'

const RANGE_OPTIONS: { key: DateRangeFilter; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: '7days', label: '7 days' },
  { key: '30days', label: '30 days' },
  { key: 'all', label: 'All time' },
  { key: 'custom', label: 'Custom' },
]

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

/** Local calendar key — toISOString() would shift evening sales into the next (UTC) day. */
function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function formatCompactMoney(amount: number, symbol: string): string {
  if (Math.abs(amount) >= 1000) {
    return `${symbol}${(amount / 1000).toLocaleString('en-PH', { maximumFractionDigits: 1 })}k`
  }
  return `${symbol}${Math.round(amount).toLocaleString('en-PH')}`
}

function formatSigned(amount: number, symbol: string): string {
  const abs = formatMoney(Math.abs(amount), symbol)
  if (amount > 0) return `+${abs}`
  if (amount < 0) return `−${abs}`
  return abs
}

/** Accepts either payment labels ("Cash") or enum values ("0") and normalizes to the enum value. */
function resolvePaymentMethod(methodValue: unknown): { value: string; label: string } {
  if (methodValue === null || methodValue === undefined) return { value: 'other', label: 'Other' }
  const raw = String(methodValue).trim()
  const normalized = raw.toLowerCase()
  const found = PAYMENT_OPTIONS.find(
    (option) => String(option.value).toLowerCase() === normalized || option.label.toLowerCase() === normalized,
  )
  return found ? { value: String(found.value), label: found.label } : { value: normalized, label: raw }
}

function rangeWindow(filter: DateRangeFilter, customStart: string, customEnd: string): { start: Date | null; end: Date | null } {
  const today = startOfDay(new Date())
  const tomorrow = addDays(today, 1)
  switch (filter) {
    case 'today':
      return { start: today, end: tomorrow }
    case 'yesterday':
      return { start: addDays(today, -1), end: today }
    case '7days':
      return { start: addDays(today, -6), end: tomorrow }
    case '30days':
      return { start: addDays(today, -29), end: tomorrow }
    case 'custom':
      return {
        start: customStart ? parseLocalDate(customStart) : null,
        end: customEnd ? addDays(parseLocalDate(customEnd), 1) : null,
      }
    default:
      return { start: null, end: null }
  }
}

const itemCount = (sale: Sale) => sale.items?.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0) ?? 0

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
  const { printReceipt: sendReceiptToPrinter, isPrinting, lastPrintError } = useReceiptPrinter()
  const money = (value: number) => formatMoney(value, settings.currencySymbol)

  const [sales, setSales] = useState<Sale[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loadedAt, setLoadedAt] = useState<Date | null>(null)

  const [rangeFilter, setRangeFilter] = useState<DateRangeFilter>('7days')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [methodFilter, setMethodFilter] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [trendGranularity, setTrendGranularity] = useState<TrendGranularity>('day')
  const [visibleCount, setVisibleCount] = useState(PAGE_STEP)
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null)

  // Cash reconciliation has no backing table — these are session-only manual entries.
  const [openingCash, setOpeningCash] = useState('')
  const [actualCash, setActualCash] = useState('')

  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const [exportingFormat, setExportingFormat] = useState<ExportFormat | null>(null)
  const exportMenuRef = useRef<HTMLDivElement | null>(null)

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
     LOAD (all pages; the API caps page size at 100)
  ------------------------------------------------------------------ */

  async function loadSales() {
    try {
      setLoading(true)
      setError(null)

      const first = await salesApi.list({ page: 1, pageSize: 100 })
      const firstItems = Array.isArray(first?.items) ? first.items : []
      const totalPages = Number(first?.totalPages) || 1

      const rest =
        totalPages > 1
          ? await Promise.all(Array.from({ length: totalPages - 1 }, (_, index) => salesApi.list({ page: index + 2, pageSize: 100 })))
          : []

      setSales([...firstItems, ...rest.flatMap((response) => response?.items ?? [])])
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
  }, [])

  useEffect(() => {
    setVisibleCount(PAGE_STEP)
  }, [rangeFilter, customStart, customEnd, methodFilter, searchQuery])

  /* ------------------------------------------------------------------
     DERIVED DATA
  ------------------------------------------------------------------ */

  const filteredSales = useMemo(() => {
    const { start, end } = rangeWindow(rangeFilter, customStart, customEnd)
    const query = searchQuery.trim().toLowerCase()

    return sales.filter((sale) => {
      if (start || end) {
        const time = new Date(sale.createdAt).getTime()
        if (Number.isNaN(time)) return false
        if (start && time < start.getTime()) return false
        if (end && time >= end.getTime()) return false
      }
      if (methodFilter !== 'all' && resolvePaymentMethod(sale.paymentMethod).value !== methodFilter) return false
      if (query) {
        const invoiceMatch = sale.invoiceNumber?.toLowerCase().includes(query) ?? false
        const customerMatch = (sale.customerName ?? 'walk-in customer').toLowerCase().includes(query)
        if (!invoiceMatch && !customerMatch) return false
      }
      return true
    })
  }, [sales, rangeFilter, customStart, customEnd, methodFilter, searchQuery])

  const completedSales = useMemo(() => filteredSales.filter((sale) => sale.status === 'Completed'), [filteredSales])
  const voidedSales = useMemo(() => filteredSales.filter((sale) => sale.status === 'Voided'), [filteredSales])

  const metrics = useMemo(() => {
    let salesTotal = 0
    let discount = 0
    let tax = 0
    let itemsSold = 0
    const methodTotals: Record<string, number> = {}
    const methodCounts: Record<string, number> = {}

    for (const sale of completedSales) {
      const total = Number(sale.total) || 0
      salesTotal += total
      discount += Number(sale.discount) || 0
      tax += Number(sale.tax) || 0
      itemsSold += itemCount(sale)
      const method = resolvePaymentMethod(sale.paymentMethod).value
      methodTotals[method] = (methodTotals[method] ?? 0) + total
      methodCounts[method] = (methodCounts[method] ?? 0) + 1
    }

    return {
      // Voided sales are excluded here — they are reported separately, never subtracted again.
      salesTotal,
      discount,
      tax,
      itemsSold,
      count: completedSales.length,
      average: completedSales.length > 0 ? salesTotal / completedSales.length : 0,
      methodTotals,
      methodCounts,
      voidedTotal: voidedSales.reduce((sum, sale) => sum + (Number(sale.total) || 0), 0),
      voidedCount: voidedSales.length,
    }
  }, [completedSales, voidedSales])

  /** Sales vs the equally long previous period (fixed ranges only; date window only, other filters ignored). */
  const comparison = useMemo(() => {
    if (!['today', 'yesterday', '7days', '30days'].includes(rangeFilter)) return null
    const { start, end } = rangeWindow(rangeFilter, '', '')
    if (!start || !end) return null
    const length = end.getTime() - start.getTime()
    const sumBetween = (from: number, to: number) =>
      sales.reduce((sum, sale) => {
        if (sale.status !== 'Completed') return sum
        const time = new Date(sale.createdAt).getTime()
        return time >= from && time < to ? sum + (Number(sale.total) || 0) : sum
      }, 0)
    const current = sumBetween(start.getTime(), end.getTime())
    const previous = sumBetween(start.getTime() - length, start.getTime())
    if (previous === 0) return current === 0 ? null : { percent: null as number | null }
    return { percent: ((current - previous) / previous) * 100 }
  }, [sales, rangeFilter, loadedAt])

  const topProducts = useMemo(() => {
    const byProduct = new Map<number, { productId: number; name: string; quantity: number; revenue: number }>()
    for (const sale of completedSales) {
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
  }, [completedSales])

  const trendBuckets = useMemo(() => {
    const buckets = new Map<string, { key: string; label: string; amount: number; sortKey: number }>()
    for (const sale of completedSales) {
      const date = new Date(sale.createdAt)
      if (Number.isNaN(date.getTime())) continue

      let bucketStart: Date
      let label: string
      if (trendGranularity === 'day') {
        bucketStart = startOfDay(date)
        label = bucketStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      } else if (trendGranularity === 'week') {
        bucketStart = addDays(startOfDay(date), -((date.getDay() + 6) % 7)) // Monday
        label = bucketStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      } else {
        bucketStart = new Date(date.getFullYear(), date.getMonth(), 1)
        label = bucketStart.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
      }

      const key = localDayKey(bucketStart)
      const existing = buckets.get(key)
      if (existing) existing.amount += Number(sale.total) || 0
      else buckets.set(key, { key, label, amount: Number(sale.total) || 0, sortKey: bucketStart.getTime() })
    }
    return Array.from(buckets.values()).sort((a, b) => a.sortKey - b.sortKey)
  }, [completedSales, trendGranularity])

  const isDefaultFilters = rangeFilter === '7days' && methodFilter === 'all' && searchQuery.trim() === ''
  const initialLoading = loading && sales.length === 0
  const rangeLabel = RANGE_OPTIONS.find((option) => option.key === rangeFilter)?.label ?? ''
  const methodLabel = methodFilter === 'all' ? null : PAYMENT_OPTIONS.find((o) => String(o.value) === methodFilter)?.label

  function resetFilters() {
    setRangeFilter('7days')
    setMethodFilter('all')
    setSearchQuery('')
    setCustomStart('')
    setCustomEnd('')
  }

  /* ------------------------------------------------------------------
     ACTIONS
  ------------------------------------------------------------------ */

  /** "7 days · Sep 9, 2026 – Sep 15, 2026" for the current date filter. */
  function describePeriod(): string {
    if (rangeFilter === 'all') return 'All time'
    const { start, end } = rangeWindow(rangeFilter, customStart, customEnd)
    const format = (date: Date) => date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    const last = end ? addDays(end, -1) : null
    const dates =
      start && last
        ? start.getTime() === last.getTime()
          ? format(start)
          : `${format(start)} – ${format(last)}`
        : start
        ? `From ${format(start)}`
        : last
        ? `Until ${format(last)}`
        : ''
    return [rangeLabel, dates].filter(Boolean).join(' · ')
  }

  /** Export what the page shows: the filtered sales and the metrics already calculated from them. */
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
          label: PAYMENT_OPTIONS.find((option) => String(option.value) === key)?.label ?? resolvePaymentMethod(key).label,
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

  const cashKey = String(PAYMENT_OPTIONS.find((o) => o.label === 'Cash')?.value ?? '0')
  const cashSales = metrics.methodTotals[cashKey] ?? 0
  const voidedCash = voidedSales.reduce(
    (sum, sale) => (resolvePaymentMethod(sale.paymentMethod).value === cashKey ? sum + (Number(sale.total) || 0) : sum),
    0,
  )

  return (
    <DesktopPage
      title="Reports"
      subtitle={loadedAt ? `Updated ${loadedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Sales performance'}
      actions={
        <>
          <SecondaryButton onClick={() => void loadSales()} disabled={loading}>
            <RefreshIcon spinning={loading} />
            Refresh
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
                className="absolute right-0 top-full z-40 mt-2 w-72 rounded-2xl bg-white p-1.5 text-left shadow-[0_12px_32px_rgba(9,20,19,0.12)] ring-1 ring-slate-100"
              >
                <p className="truncate px-3 pb-1 pt-2 text-xs text-slate-500">{describePeriod()}</p>
                <ExportOptions asMenu busyFormat={exportingFormat} onSelect={(format) => void runExport(format)} />
              </div>
            )}
          </div>
        </>
      }
    >
      {/* FILTERS */}
      <div className="mt-6 space-y-3 rounded-2xl bg-white p-4 ring-1 ring-slate-100 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <FilterPills label="Date range" value={rangeFilter} onChange={setRangeFilter} options={RANGE_OPTIONS} />
          <DesktopSearch value={searchQuery} onChange={setSearchQuery} placeholder="Invoice or customer" label="Search transactions" />
        </div>

        {rangeFilter === 'custom' && (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2 text-slate-500">
              From
              <input
                type="date"
                value={customStart}
                max={customEnd || undefined}
                onChange={(e) => setCustomStart(e.target.value)}
                className="h-10 rounded-xl border-0 bg-[#F3F5F4] px-3 text-[#091413] outline-none focus:ring-2 focus:ring-[#1F5E3B]"
              />
            </label>
            <label className="flex items-center gap-2 text-slate-500">
              To
              <input
                type="date"
                value={customEnd}
                min={customStart || undefined}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="h-10 rounded-xl border-0 bg-[#F3F5F4] px-3 text-[#091413] outline-none focus:ring-2 focus:ring-[#1F5E3B]"
              />
            </label>
            {!customStart && !customEnd && <span className="text-xs text-slate-400">Pick a start and/or end date.</span>}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-slate-500">Paid with</span>
          {[{ value: 'all', label: 'Any' }, ...PAYMENT_OPTIONS.map((o) => ({ value: String(o.value), label: o.label }))].map((option) => {
            const active = methodFilter === option.value
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setMethodFilter(option.value)}
                aria-pressed={active}
                className={`h-9 rounded-full px-3.5 text-sm transition ${active ? 'bg-[#1F5E3B] text-white' : 'bg-[#F3F5F4] text-slate-600 hover:bg-[#E9EEEB]'}`}
              >
                {option.label}
              </button>
            )
          })}
          {!isDefaultFilters && (
            <TextButton onClick={resetFilters} className="ml-auto h-9">
              Reset filters
            </TextButton>
          )}
        </div>
      </div>

      {error && sales.length > 0 && (
        <p className="mt-4 rounded-2xl bg-rose-50 px-5 py-3 text-sm text-rose-700 print:hidden">
          Couldn’t refresh: {error}. Showing the last loaded data.
        </p>
      )}

      {initialLoading ? (
        <div className="py-24">
          <Spinner />
        </div>
      ) : error && sales.length === 0 ? (
        <div className="mt-6">
          <ErrorState message={error} onRetry={() => void loadSales()} />
        </div>
      ) : (
        <div className={`mt-6 space-y-6 transition-opacity ${loading ? 'opacity-60' : ''}`}>
          {/* KPIs */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label={`Sales · ${rangeLabel}${methodLabel ? ` · ${methodLabel}` : ''}`}
              value={money(metrics.salesTotal)}
              highlight
              footer={
                comparison ? (
                  comparison.percent === null ? (
                    <span className="text-slate-500">No sales in the previous period</span>
                  ) : (
                    <span className={comparison.percent >= 0 ? 'text-[#1F5E3B]' : 'text-rose-600'}>
                      {comparison.percent >= 0 ? '▲' : '▼'} {Math.abs(comparison.percent).toFixed(1)}%{' '}
                      <span className="text-slate-500">vs previous period</span>
                    </span>
                  )
                ) : undefined
              }
            />
            <KpiCard label="Transactions" value={String(metrics.count)} footer={<span className="text-slate-500">Completed sales</span>} />
            <KpiCard label="Average sale" value={money(metrics.average)} footer={<span className="text-slate-500">Per transaction</span>} />
            <KpiCard label="Items sold" value={String(metrics.itemsSold)} footer={<span className="text-slate-500">Units</span>} />
          </div>

          <p className="text-sm text-slate-500">
            Discounts {money(metrics.discount)} · Tax collected {money(metrics.tax)}
            {metrics.voidedCount > 0 && (
              <span className="text-rose-600">
                {' '}
                · {metrics.voidedCount} voided ({money(metrics.voidedTotal)}, not counted)
              </span>
            )}
          </p>

          {/* TREND */}
          <SectionCard
            title="Sales trend"
            action={
              <div className="flex rounded-full bg-[#F1F4F3] p-1 print:hidden">
                {(['day', 'week', 'month'] as TrendGranularity[]).map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setTrendGranularity(g)}
                    aria-pressed={trendGranularity === g}
                    className={`h-8 rounded-full px-3 text-xs font-medium transition ${trendGranularity === g ? 'bg-white text-[#091413] shadow-sm' : 'text-slate-500'}`}
                  >
                    {g === 'day' ? 'Daily' : g === 'week' ? 'Weekly' : 'Monthly'}
                  </button>
                ))}
              </div>
            }
          >
            {trendBuckets.length === 0 ? (
              <div className="flex h-56 items-center justify-center text-sm text-slate-400">No completed sales in this period.</div>
            ) : (
              <div className="h-60 w-full min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={trendBuckets} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#64748B' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
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
                    <Bar dataKey="amount" fill="#1F5E3B" radius={[4, 4, 0, 0]} maxBarSize={40} minPointSize={2} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </SectionCard>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* PAYMENT METHODS — click to filter */}
            <SectionCard title="Payment methods" description="Click one to filter the report.">
              <ul className="space-y-1">
                {PAYMENT_OPTIONS.map((option) => {
                  const key = String(option.value)
                  const total = metrics.methodTotals[key] ?? 0
                  const count = metrics.methodCounts[key] ?? 0
                  const share = metrics.salesTotal > 0 ? total / metrics.salesTotal : 0
                  const active = methodFilter === key
                  return (
                    <li key={key}>
                      <button
                        type="button"
                        onClick={() => setMethodFilter(active ? 'all' : key)}
                        aria-pressed={active}
                        className={`-mx-3 w-[calc(100%+1.5rem)] rounded-2xl px-3 py-2.5 text-left transition ${active ? 'bg-[#F2F8F4]' : 'hover:bg-slate-50'}`}
                      >
                        <div className="flex items-baseline justify-between gap-3">
                          <span className={`text-sm ${active ? 'font-semibold text-[#1F5E3B]' : 'font-medium'}`}>{option.label}</span>
                          <span className="text-sm tabular-nums">{money(total)}</span>
                        </div>
                        <div className="mt-1.5 flex items-center gap-3">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                            <div className="h-full rounded-full bg-[#1F5E3B]" style={{ width: `${share * 100}%` }} />
                          </div>
                          <span className="w-28 shrink-0 text-right text-xs tabular-nums text-slate-400">
                            {Math.round(share * 100)}% · {count} {count === 1 ? 'sale' : 'sales'}
                          </span>
                        </div>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </SectionCard>

            {/* TOP PRODUCTS */}
            <SectionCard title="Top products" description="Best sellers by units in this report.">
              {topProducts.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-400">No products sold in this period.</p>
              ) : (
                <ul>
                  {topProducts.map((product, index) => (
                    <li key={product.productId} className="flex min-h-12 items-center gap-3 border-b border-slate-100 py-2 last:border-b-0">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#EAF4EE] text-xs font-medium tabular-nums text-[#1F5E3B]">
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm">{product.name}</span>
                      <span className="shrink-0 text-sm tabular-nums text-slate-500">{product.quantity} sold</span>
                      <span className="w-24 shrink-0 text-right text-sm tabular-nums">{money(product.revenue)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          </div>

          {/* TRANSACTIONS */}
          <DataCard>
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-6 py-4">
              <h2 className="text-base font-semibold">Transactions</h2>
              <span className="text-sm tabular-nums text-slate-500">{filteredSales.length} records</span>
            </div>

            {filteredSales.length === 0 ? (
              <div className="px-6 py-14 text-center">
                <EmptyState title="No sales found" hint="Try a different date range, payment method or search." />
                {!isDefaultFilters && (
                  <button type="button" onClick={resetFilters} className="mt-4 h-10 rounded-full bg-[#F3F5F4] px-5 text-sm font-medium hover:bg-[#E9EEEB]">
                    Reset filters
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-slate-100 text-xs text-slate-500">
                      <tr>
                        <Th className="pl-6">Invoice</Th>
                        <Th>Date</Th>
                        <Th>Customer</Th>
                        <Th className="hidden xl:table-cell">Cashier</Th>
                        <Th>Paid with</Th>
                        <Th align="right">Items</Th>
                        <Th align="right">Total</Th>
                        <Th className="pr-6 print:hidden">
                          <span className="sr-only">Open</span>
                        </Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredSales.slice(0, visibleCount).map((sale) => {
                        const voided = sale.status === 'Voided'
                        return (
                          <tr key={sale.id} onClick={() => setSelectedSale(sale)} className={`cursor-pointer hover:bg-slate-50 ${voided ? 'text-slate-400' : ''}`}>
                            <td className="py-3 pl-6 pr-3">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setSelectedSale(sale)
                                }}
                                className="font-medium focus-visible:underline focus-visible:outline-none"
                              >
                                {sale.invoiceNumber}
                              </button>
                              {voided && <span className="ml-2 rounded-full bg-rose-50 px-2 py-0.5 text-xs text-rose-600">Voided</span>}
                            </td>
                            <td className="whitespace-nowrap px-3 py-3 text-slate-500">{formatDateTime(sale.createdAt)}</td>
                            <td className="max-w-48 truncate px-3 py-3">{sale.customerName || 'Walk-in customer'}</td>
                            <td className="hidden max-w-40 truncate px-3 py-3 text-slate-500 xl:table-cell">{sale.cashierName || '—'}</td>
                            <td className="px-3 py-3">{resolvePaymentMethod(sale.paymentMethod).label}</td>
                            <td className="px-3 py-3 text-right tabular-nums">{itemCount(sale)}</td>
                            <td className={`px-3 py-3 text-right font-medium tabular-nums ${voided ? 'line-through' : ''}`}>{money(Number(sale.total) || 0)}</td>
                            <td className="py-3 pl-3 pr-6 text-right print:hidden">
                              <ChevronRight size={12} className="inline text-slate-300" />
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                {filteredSales.length > visibleCount && (
                  <div className="border-t border-slate-100 px-6 py-3 print:hidden">
                    <button
                      type="button"
                      onClick={() => setVisibleCount((count) => count + PAGE_STEP)}
                      className="h-10 w-full rounded-full bg-[#F3F5F4] text-sm font-medium hover:bg-[#E9EEEB]"
                    >
                      Show more ({filteredSales.length - visibleCount} left)
                    </button>
                  </div>
                )}
              </>
            )}
          </DataCard>

          {/* CASH COUNT */}
          <CashCountCard
            cashSales={cashSales}
            voidedCash={voidedCash}
            openingCash={openingCash}
            setOpeningCash={setOpeningCash}
            actualCash={actualCash}
            setActualCash={setActualCash}
            currencySymbol={settings.currencySymbol}
          />
        </div>
      )}

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

function KpiCard({ label, value, footer, highlight = false }: { label: string; value: string; footer?: ReactNode; highlight?: boolean }) {
  return (
    <div className={`rounded-2xl p-5 ring-1 ${highlight ? 'bg-[#F2F8F4] ring-[#DCE9E1]' : 'bg-white ring-slate-100'}`}>
      <p className={`truncate text-sm ${highlight ? 'font-medium text-[#1F5E3B]' : 'text-slate-500'}`}>{label}</p>
      <p className="mt-1 truncate text-2xl font-bold tabular-nums tracking-tight">{value}</p>
      {footer && <p className="mt-1 truncate text-xs">{footer}</p>}
    </div>
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

/**
 * End-of-day cash count. Cash sales come from completed sale records; opening and
 * counted cash are session-only manual entries (there's no drawer ledger table).
 * Voided sales are already excluded from cash sales, so they're shown for reference only.
 */
function CashCountCard({
  cashSales,
  voidedCash,
  openingCash,
  setOpeningCash,
  actualCash,
  setActualCash,
  currencySymbol,
}: {
  cashSales: number
  voidedCash: number
  openingCash: string
  setOpeningCash: (value: string) => void
  actualCash: string
  setActualCash: (value: string) => void
  currencySymbol: string
}) {
  const expected = (Number(openingCash) || 0) + cashSales
  const hasCount = actualCash.trim() !== ''
  const difference = hasCount ? (Number(actualCash) || 0) - expected : 0
  const tone = difference === 0 ? 'text-[#1F5E3B]' : difference > 0 ? 'text-amber-700' : 'text-rose-600'

  return (
    <SectionCard
      title="Cash count"
      description="Compare the cash in your drawer with what the sales say. Counts aren’t saved."
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <dl className="space-y-3 text-sm">
          <CashInput id="opening-cash" label="Opening cash" value={openingCash} onChange={setOpeningCash} symbol={currencySymbol} />
          <div className="flex items-center justify-between">
            <dt className="text-slate-500">Cash sales</dt>
            <dd className="font-medium tabular-nums text-[#1F5E3B]">{formatSigned(cashSales, currencySymbol)}</dd>
          </div>
          {voidedCash > 0 && (
            <div className="flex items-center justify-between text-xs text-slate-400">
              <dt>Voided cash sales (already excluded)</dt>
              <dd className="tabular-nums">{formatMoney(voidedCash, currencySymbol)}</dd>
            </div>
          )}
          <div className="flex items-center justify-between border-t border-slate-100 pt-3 font-semibold">
            <dt>Expected in drawer</dt>
            <dd className="tabular-nums">{formatMoney(expected, currencySymbol)}</dd>
          </div>
          <CashInput id="actual-cash" label="Counted cash" value={actualCash} onChange={setActualCash} symbol={currencySymbol} />
        </dl>

        <div className="flex flex-col items-center justify-center rounded-2xl bg-[#F6F8F7] p-6 text-center">
          {hasCount ? (
            <>
              <p className={`text-3xl font-bold tabular-nums ${tone}`}>{formatSigned(difference, currencySymbol)}</p>
              <p className={`mt-1 text-sm font-medium ${tone}`}>{difference === 0 ? 'Balanced' : difference > 0 ? 'Over' : 'Short'}</p>
            </>
          ) : (
            <p className="max-w-56 text-sm text-slate-400">Enter the cash you counted to see if the drawer balances.</p>
          )}
        </div>
      </div>
    </SectionCard>
  )
}

function CashInput({
  id,
  label,
  value,
  onChange,
  symbol,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  symbol: string
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt>
        <label htmlFor={id} className="text-slate-500">
          {label}
        </label>
      </dt>
      <dd className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">{symbol}</span>
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0.00"
          className="h-10 w-36 rounded-xl border-0 bg-[#F3F5F4] pl-8 pr-3 text-right tabular-nums outline-none focus:bg-white focus:ring-2 focus:ring-[#1F5E3B]"
        />
      </dd>
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
