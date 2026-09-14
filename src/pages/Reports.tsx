import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { salesApi } from '../api/salesApi'

import { Button } from '../components/ui/Button'
import { Modal } from '../components/ui/Modal'
import { PageHeader } from '../components/ui/Page'

import { useSettings } from '../context/SettingsContext'
import { useToast } from '../context/ToastContext'
import { useReceiptPrinter } from '../hooks/useReceiptPrinter'
import { useIsMobile } from '../hooks/useIsMobile'

import { printerErrorMessage } from '../services/printer'
import type { Sale } from '../types'
import { getErrorMessage } from '../utils/errors'
import { formatMoney } from '../utils/format'
import { PAYMENT_OPTIONS } from '../utils/pos'
import { MobileReports } from './mobile/MobileReports'

type DateRangeFilter = 'today' | 'yesterday' | '7days' | '30days' | 'all' | 'custom'

type TrendGranularity = 'day' | 'week' | 'month'

function formatSigned(amount: number, symbol: string): string {
  const abs = formatMoney(Math.abs(amount), symbol)
  if (amount > 0) return `+${abs}`
  if (amount < 0) return `-${abs}`
  return abs
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0)
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

// Compact currency for chart axis ticks only ("₱1.2k") - every other money
// value on this page still uses the full formatMoney() precision.
function formatCompactMoney(amount: number, symbol: string): string {
  if (Math.abs(amount) >= 1000) {
    return `${symbol}${(amount / 1000).toLocaleString('en-PH', { maximumFractionDigits: 1 })}k`
  }
  return `${symbol}${Math.round(amount).toLocaleString('en-PH')}`
}

export function ReportsPage() {
  const isMobile = useIsMobile()
  if (isMobile) return <MobileReports />
  return <DesktopReportsPage />
}

function DesktopReportsPage() {
  const { notify } = useToast()
  const { settings } = useSettings()

  const {
    printReceipt: sendReceiptToPrinter,
    isPrinting,
    lastPrintError,
  } = useReceiptPrinter()

  const [sales, setSales] = useState<Sale[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isMounted, setIsMounted] = useState(false)

  const [rangeFilter, setRangeFilter] =
    useState<DateRangeFilter>('7days')

  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')

  const [methodFilter, setMethodFilter] = useState<string>('all')

  const [searchQuery, setSearchQuery] = useState('')

  const [selectedSale, setSelectedSale] = useState<Sale | null>(null)

  const [trendGranularity, setTrendGranularity] =
    useState<TrendGranularity>('day')

  // Cash reconciliation has no backing API/table (no drawer-count ledger exists
  // yet) - these are session-only manual entries so the End-of-Day summary can
  // still compute Expected/Difference from real cash sales, without persisting
  // or inventing anything server-side.
  const [openingCash, setOpeningCash] = useState('')
  const [actualCash, setActualCash] = useState('')

  /*
   * ================================================================
   * INITIAL ANIMATION
   * ================================================================
   */

  useEffect(() => {
    const id = window.setTimeout(() => {
      setIsMounted(true)
    }, 40)

    return () => window.clearTimeout(id)
  }, [])

  /*
   * ================================================================
   * PAYMENT METHOD
   * ================================================================
   *
   * Backend returns:
   *
   * Cash
   * Card
   * GCash
   * Other
   *
   * because SaleService does:
   *
   * PaymentMethod = s.Payment?.Method.ToString()
   *
   * Frontend PAYMENT_OPTIONS uses enum numbers:
   *
   * 0 = Cash
   * 1 = Card
   * 2 = GCash
   * 3 = Other
   *
   * This function supports BOTH formats.
   */

  function resolvePaymentMethod(methodValue: unknown): {
    value: string
    label: string
  } {
    if (methodValue === null || methodValue === undefined) {
      return {
        value: 'other',
        label: 'Other',
      }
    }

    const raw = String(methodValue).trim()
    const normalized = raw.toLowerCase()

    const found = PAYMENT_OPTIONS.find((option) => {
      return (
        String(option.value).toLowerCase() === normalized ||
        option.label.toLowerCase() === normalized
      )
    })

    if (found) {
      return {
        value: String(found.value),
        label: found.label,
      }
    }

    return {
      value: normalized,
      label: raw,
    }
  }

  function getPaymentLabel(methodValue: unknown): string {
    return resolvePaymentMethod(methodValue).label
  }

  /*
   * ================================================================
   * LOAD SALES
   * ================================================================
   *
   * Important:
   *
   * Backend has:
   *
   * pageSize = Math.Clamp(pageSize, 1, 100)
   *
   * Therefore we request 100, not 1000.
   *
   * We then load every page so the Reports page can work with
   * all available sales.
   */

  async function loadSales() {
    try {
      setLoading(true)
      setError(null)

      const firstResponse = await salesApi.list({
        page: 1,
        pageSize: 100,
      })

      const firstItems = Array.isArray(firstResponse?.items)
        ? firstResponse.items
        : []

      const totalPages =
        Number(firstResponse?.totalPages) ||
        Math.ceil(
          Number(firstResponse?.totalCount || firstItems.length) / 100,
        ) ||
        1

      /*
       * If there is only one page, we're done.
       */
      if (totalPages <= 1) {
        setSales(firstItems)
        return
      }

      /*
       * Load remaining pages.
       */
      const pageNumbers = Array.from(
        { length: totalPages - 1 },
        (_, index) => index + 2,
      )

      const remainingResponses = await Promise.all(
        pageNumbers.map((page) =>
          salesApi.list({
            page,
            pageSize: 100,
          }),
        ),
      )

      const remainingItems = remainingResponses.flatMap((response) =>
        Array.isArray(response?.items) ? response.items : [],
      )

      setSales([...firstItems, ...remainingItems])
    } catch (err) {
      const message = getErrorMessage(err)

      setError(message)

      notify(message, 'error')

      setSales([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadSales()
  }, [])

  /*
   * ================================================================
   * DATE FILTER
   * ================================================================
   */

  function matchesDateRange(
    createdAt: string | number | Date | undefined,
    filter: DateRangeFilter,
  ): boolean {
    if (filter === 'all') {
      return true
    }

    if (!createdAt) {
      return false
    }

    const date = new Date(createdAt)

    if (Number.isNaN(date.getTime())) {
      return false
    }

    const now = new Date()

    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      0,
      0,
      0,
      0,
    )

    const startOfTomorrow = new Date(startOfToday)
    startOfTomorrow.setDate(startOfTomorrow.getDate() + 1)

    const startOfYesterday = new Date(startOfToday)
    startOfYesterday.setDate(startOfYesterday.getDate() - 1)

    if (filter === 'today') {
      return date >= startOfToday && date < startOfTomorrow
    }

    if (filter === 'yesterday') {
      return date >= startOfYesterday && date < startOfToday
    }

    if (filter === '7days') {
      const start = new Date(startOfToday)
      start.setDate(start.getDate() - 6)

      return date >= start && date < startOfTomorrow
    }

    if (filter === '30days') {
      const start = new Date(startOfToday)
      start.setDate(start.getDate() - 29)

      return date >= start && date < startOfTomorrow
    }

    if (filter === 'custom') {
      if (customStart) {
        const start = startOfDay(new Date(customStart))
        if (date < start) return false
      }

      if (customEnd) {
        const end = addDays(startOfDay(new Date(customEnd)), 1)
        if (date >= end) return false
      }

      return true
    }

    return true
  }

  /*
   * ================================================================
   * PREVIOUS-PERIOD WINDOW (for the "vs previous period" comparison)
   * ================================================================
   *
   * Only defined for the fixed-length quick ranges - "All Time" and
   * "Custom" have no unambiguous "previous period", so callers should
   * treat a null return as "don't show a comparison".
   */

  function getComparisonWindows(): {
    current: [Date, Date]
    previous: [Date, Date]
  } | null {
    const now = new Date()
    const today0 = startOfDay(now)
    const tomorrow0 = addDays(today0, 1)

    if (rangeFilter === 'today') {
      return {
        current: [today0, tomorrow0],
        previous: [addDays(today0, -1), today0],
      }
    }

    if (rangeFilter === 'yesterday') {
      return {
        current: [addDays(today0, -1), today0],
        previous: [addDays(today0, -2), addDays(today0, -1)],
      }
    }

    if (rangeFilter === '7days') {
      return {
        current: [addDays(today0, -6), tomorrow0],
        previous: [addDays(today0, -13), addDays(today0, -6)],
      }
    }

    if (rangeFilter === '30days') {
      return {
        current: [addDays(today0, -29), tomorrow0],
        previous: [addDays(today0, -59), addDays(today0, -29)],
      }
    }

    return null
  }

  /*
   * ================================================================
   * FILTERED SALES
   * ================================================================
   */

  const filteredSales = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()

    return sales.filter((sale) => {
      /*
       * Date
       */
      if (!matchesDateRange(sale.createdAt, rangeFilter)) {
        return false
      }

      /*
       * Payment method
       */
      if (methodFilter !== 'all') {
        const resolved = resolvePaymentMethod(sale.paymentMethod)

        if (resolved.value !== methodFilter) {
          return false
        }
      }

      /*
       * Search invoice/customer.
       *
       * Reference is intentionally NOT used here because
       * your Sale type and SaleDto currently do not contain it.
       */
      if (query) {
        const invoiceMatch =
          sale.invoiceNumber?.toLowerCase().includes(query) ?? false

        const customerMatch =
          sale.customerName?.toLowerCase().includes(query) ?? false

        if (!invoiceMatch && !customerMatch) {
          return false
        }
      }

      return true
    })
  }, [sales, rangeFilter, methodFilter, searchQuery])

  /*
   * ================================================================
   * COMPLETED / VOIDED SPLIT
   * ================================================================
   *
   * Voided sales must never count toward revenue, AOV, payment
   * breakdown, or top products - they're kept separate and rolled up
   * into "Refunds" instead. This is the only reversal state the
   * schema actually has (see salesApi.ts statusLabel()); there is no
   * dedicated refunds ledger, so "Refunds" here means voided sales.
   */

  const completedSales = useMemo(
    () => filteredSales.filter((sale) => sale.status === 'Completed'),
    [filteredSales],
  )

  const voidedSales = useMemo(
    () => filteredSales.filter((sale) => sale.status === 'Voided'),
    [filteredSales],
  )

  /*
   * ================================================================
   * METRICS
   * ================================================================
   */

  const metrics = useMemo(() => {
    let grossSales = 0
    let totalDiscount = 0
    let totalTax = 0
    let totalItemsSold = 0

    const methodTotals: Record<string, number> = {}

    for (const sale of completedSales) {
      const saleTotal = Number(sale.total) || 0

      grossSales += saleTotal
      totalDiscount += Number(sale.discount) || 0
      totalTax += Number(sale.tax) || 0

      const itemCount =
        sale.items?.reduce(
          (sum, item) => sum + (Number(item.quantity) || 0),
          0,
        ) ?? 0

      totalItemsSold += itemCount

      const payment = resolvePaymentMethod(sale.paymentMethod)

      methodTotals[payment.value] =
        (methodTotals[payment.value] || 0) + saleTotal
    }

    const refundsTotal = voidedSales.reduce(
      (sum, sale) => sum + (Number(sale.total) || 0),
      0,
    )

    const transactionCount = completedSales.length
    const netSales = grossSales - refundsTotal

    const averageOrderValue =
      transactionCount > 0
        ? grossSales / transactionCount
        : 0

    return {
      grossSales,
      netSales,
      totalDiscount,
      totalTax,
      totalItemsSold,
      transactionCount,
      averageOrderValue,
      methodTotals,
      refundsTotal,
      refundsCount: voidedSales.length,
    }
  }, [completedSales, voidedSales])

  /*
   * ================================================================
   * PERIOD-OVER-PERIOD COMPARISON
   * ================================================================
   *
   * Computed off the full, unfiltered `sales` list (date-window only -
   * the search/payment filters shouldn't change what "vs previous
   * period" means), so it stays meaningful even while other filters
   * are narrowing the table below.
   */

  const periodComparison = useMemo(() => {
    const windows = getComparisonWindows()
    if (!windows) return null

    const sumInWindow = ([start, end]: [Date, Date]) =>
      sales.reduce((sum, sale) => {
        if (sale.status !== 'Completed' || !sale.createdAt) return sum
        const date = new Date(sale.createdAt)
        if (Number.isNaN(date.getTime())) return sum
        if (date < start || date >= end) return sum
        return sum + (Number(sale.total) || 0)
      }, 0)

    const current = sumInWindow(windows.current)
    const previous = sumInWindow(windows.previous)

    if (previous === 0 && current === 0) return null

    if (previous === 0) {
      return { current, previous, percent: null }
    }

    return {
      current,
      previous,
      percent: ((current - previous) / previous) * 100,
    }
  }, [sales, rangeFilter, customStart, customEnd])

  /*
   * ================================================================
   * TOP SELLING PRODUCTS
   * ================================================================
   *
   * Derived purely from the items already embedded in each completed
   * sale (salesApi already joins product name/qty/line_total) - no new
   * endpoint or invented numbers, just aggregation of real records.
   */

  const topProducts = useMemo(() => {
    const byProduct = new Map<
      number,
      { productId: number; name: string; quantitySold: number; revenue: number }
    >()

    for (const sale of completedSales) {
      for (const item of sale.items ?? []) {
        const existing = byProduct.get(item.productId)
        const quantity = Number(item.quantity) || 0
        const lineTotal = Number(item.lineTotal) || 0

        if (existing) {
          existing.quantitySold += quantity
          existing.revenue += lineTotal
        } else {
          byProduct.set(item.productId, {
            productId: item.productId,
            name: item.productName || 'Unknown product',
            quantitySold: quantity,
            revenue: lineTotal,
          })
        }
      }
    }

    return Array.from(byProduct.values())
      .sort((a, b) => b.quantitySold - a.quantitySold)
      .slice(0, 5)
  }, [completedSales])

  /*
   * ================================================================
   * SALES TREND (daily / weekly / monthly buckets)
   * ================================================================
   */

  const trendBuckets = useMemo(() => {
    const buckets = new Map<string, { key: string; label: string; amount: number; sortKey: number }>()

    for (const sale of completedSales) {
      if (!sale.createdAt) continue
      const date = new Date(sale.createdAt)
      if (Number.isNaN(date.getTime())) continue

      let key: string
      let label: string

      if (trendGranularity === 'day') {
        key = date.toISOString().slice(0, 10)
        label = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      } else if (trendGranularity === 'week') {
        const day = (date.getDay() + 6) % 7 // Monday = 0
        const weekStart = addDays(startOfDay(date), -day)
        key = weekStart.toISOString().slice(0, 10)
        label = weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      } else {
        key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
        label = date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
      }

      const existing = buckets.get(key)
      const saleTotal = Number(sale.total) || 0

      if (existing) {
        existing.amount += saleTotal
      } else {
        buckets.set(key, { key, label, amount: saleTotal, sortKey: date.getTime() })
      }
    }

    return Array.from(buckets.values()).sort((a, b) => a.sortKey - b.sortKey)
  }, [completedSales, trendGranularity])

  /*
   * ================================================================
   * FILTER HELPERS
   * ================================================================
   */

  // First-load only - once any sales have arrived, subsequent refreshes just
  // update numbers in place instead of blanking the page back to skeletons.
  const initialLoading = loading && sales.length === 0

  const hasActiveFilters =
    rangeFilter !== '7days' ||
    methodFilter !== 'all' ||
    searchQuery.trim() !== ''

  function resetFilters() {
    setRangeFilter('7days')
    setMethodFilter('all')
    setSearchQuery('')
    setCustomStart('')
    setCustomEnd('')
  }

  /*
   * ================================================================
   * CSV EXPORT
   * ================================================================
   */

  function exportCSV() {
    if (filteredSales.length === 0) {
      notify('No data available to export', 'error')
      return
    }

    const headers = [
      'Invoice Number',
      'Date',
      'Customer',
      'Cashier',
      'Payment Method',
      'Items Count',
      'Subtotal',
      'Tax',
      'Discount',
      'Total',
    ]

    const rows = filteredSales.map((sale) => {
      const invoice = `"${String(
        sale.invoiceNumber || '',
      ).replace(/"/g, '""')}"`

      const date = `"${sale.createdAt
        ? new Date(sale.createdAt).toLocaleString()
        : ''
        }"`

      const customer = `"${String(
        sale.customerName || '',
      ).replace(/"/g, '""')}"`

      const cashier = `"${String(
        sale.cashierName || '',
      ).replace(/"/g, '""')}"`

      const method = `"${getPaymentLabel(
        sale.paymentMethod,
      ).replace(/"/g, '""')}"`

      const itemsCount =
        sale.items?.reduce(
          (sum, item) => sum + (Number(item.quantity) || 0),
          0,
        ) ?? 0

      const subtotal = (Number(sale.subtotal) || 0).toFixed(2)
      const tax = (Number(sale.tax) || 0).toFixed(2)
      const discount = (Number(sale.discount) || 0).toFixed(2)
      const total = (Number(sale.total) || 0).toFixed(2)

      return [
        invoice,
        date,
        customer,
        cashier,
        method,
        itemsCount,
        subtotal,
        tax,
        discount,
        total,
      ]
    })

    const csvContent = [
      headers.join(','),
      ...rows.map((row) => row.join(',')),
    ].join('\r\n')

    const blob = new Blob([csvContent], {
      type: 'text/csv;charset=utf-8;',
    })

    const url = URL.createObjectURL(blob)

    const link = document.createElement('a')

    link.href = url

    link.download = `sales_report_${rangeFilter}_${new Date()
      .toISOString()
      .slice(0, 10)}.csv`

    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)

    URL.revokeObjectURL(url)

    notify('Report exported as CSV.')
  }

  /*
   * ================================================================
   * PRINT RECEIPT
   * ================================================================
   */

  async function printReceipt() {
    if (!selectedSale) {
      return
    }

    try {
      await sendReceiptToPrinter(selectedSale, settings)

      notify('Receipt printed successfully.')
    } catch (err) {
      notify(printerErrorMessage(err), 'error')
    }
  }

  /*
   * ================================================================
   * PRINT REPORT
   * ================================================================
   *
   * This is a distinct action from the thermal-receipt printer above -
   * it opens the browser's native print dialog over the current report
   * view (filters/actions are hidden via print:hidden) rather than
   * reusing the ESC/POS receipt pipeline, which is only for a single
   * sale on 58/80mm paper.
   */

  function printReport() {
    window.print()
  }

  /*
   * ================================================================
   * RENDER
   * ================================================================
   */

  return (
    <div className="min-h-screen bg-[#091413]/2 text-[#091413] antialiased">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 md:px-8">

        {/* =========================================================
            HEADER
        ========================================================= */}

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between print:hidden">
          <PageHeader
            title="Sales Report"
            subtitle="Analyze revenue, transactions, and store performance"
          />

          <div className="flex flex-wrap items-center gap-2">

            <button
              type="button"
              onClick={() => void loadSales()}
              disabled={loading}
              className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-[#091413]/15 bg-white px-3 py-2 text-xs font-medium text-[#091413]/80 shadow-xs transition-colors hover:bg-[#091413]/3 hover:text-[#091413] active:scale-[0.98] disabled:opacity-50"
            >
              <RefreshCwIcon
                size={14}
                className={loading ? 'animate-spin' : ''}
              />

              <span>Refresh</span>
            </button>

            <button
              type="button"
              onClick={printReport}
              className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-[#091413]/15 bg-white px-3 py-2 text-xs font-medium text-[#091413]/80 shadow-xs transition-colors hover:bg-[#091413]/3 hover:text-[#091413] active:scale-[0.98]"
            >
              <PrinterIcon size={14} />

              <span>Print Report</span>
            </button>

            <button
              type="button"
              onClick={exportCSV}
              disabled={filteredSales.length === 0}
              className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg bg-[#285A48] px-3.5 py-2 text-xs font-medium text-white shadow-xs transition-colors hover:bg-[#1e4537] active:scale-[0.98] disabled:opacity-50"
            >
              <DownloadIcon size={14} />

              <span>Export CSV</span>
            </button>
          </div>
        </div>

        {/* =========================================================
            BODY
        ========================================================= */}

        <div
          className={`mt-4 space-y-5 transition-all duration-300 ease-out ${
            isMounted
              ? 'translate-y-0 opacity-100'
              : 'translate-y-2 opacity-0'
          }`}
        >

          {/* =======================================================
              ERROR
          ======================================================= */}

          {error && (
            <div className="flex flex-col items-start justify-between gap-2 rounded-xl border border-rose-200 bg-rose-50/70 p-4 text-xs text-rose-800 sm:flex-row sm:items-center print:hidden">
              <div>
                <p className="font-semibold">Unable to load sales report</p>
                <p className="mt-0.5 text-rose-700/80">{error}</p>
              </div>

              <button
                type="button"
                onClick={() => void loadSales()}
                className="inline-flex min-h-9 shrink-0 items-center justify-center rounded-lg border border-rose-300 bg-white px-3.5 py-2 font-semibold text-rose-700 transition-colors hover:bg-rose-100"
              >
                Retry
              </button>
            </div>
          )}

          {/* =======================================================
              FILTERS
          ======================================================= */}

          <div className="flex flex-col gap-3 rounded-xl border border-[#091413]/10 bg-white p-3.5 shadow-xs print:hidden">

            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">

              <div className="flex flex-wrap items-center gap-1.5">
                {[
                  { label: 'Today', value: 'today' },
                  { label: 'Yesterday', value: 'yesterday' },
                  { label: 'Last 7 Days', value: '7days' },
                  { label: 'Last 30 Days', value: '30days' },
                  { label: 'All Time', value: 'all' },
                  { label: 'Custom', value: 'custom' },
                ].map((tab) => (
                  <button
                    key={tab.value}
                    type="button"
                    onClick={() =>
                      setRangeFilter(
                        tab.value as DateRangeFilter,
                      )
                    }
                    className={`min-h-9 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                      rangeFilter === tab.value
                        ? 'bg-[#285A48] text-white shadow-xs'
                        : 'border border-[#091413]/10 bg-[#091413]/2 text-[#091413]/60 hover:bg-[#091413]/5 hover:text-[#091413]'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">

                {/* SEARCH */}

                <div className="relative flex-1 sm:w-64">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(event) =>
                      setSearchQuery(event.target.value)
                    }
                    placeholder="Search invoice or customer..."
                    className="h-9 w-full rounded-lg border border-[#091413]/15 bg-[#091413]/2 pl-8 pr-7 text-xs text-[#091413] placeholder-[#091413]/40 outline-none transition-colors focus:border-[#285A48] focus:bg-white focus:ring-1 focus:ring-[#285A48]"
                  />

                  <SearchIcon
                    size={13}
                    className="pointer-events-none absolute left-2.5 top-3 text-[#091413]/40"
                  />

                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2 top-2.5 rounded p-0.5 text-[#091413]/40 hover:text-[#091413]"
                      title="Clear search"
                    >
                      <ClearIcon size={12} />
                    </button>
                  )}
                </div>

                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="inline-flex min-h-9 shrink-0 items-center justify-center rounded-lg border border-[#091413]/15 bg-white px-2.5 py-1.5 text-xs font-medium text-[#091413]/70 transition-colors hover:bg-[#091413]/3 hover:text-[#091413]"
                  >
                    Reset
                  </button>
                )}
              </div>
            </div>

            {/* CUSTOM DATE RANGE */}

            {rangeFilter === 'custom' && (
              <div className="flex flex-wrap items-center gap-2 border-t border-[#091413]/10 pt-3">
                <label className="flex items-center gap-1.5 text-xs text-[#091413]/60">
                  From
                  <input
                    type="date"
                    value={customStart}
                    onChange={(event) => setCustomStart(event.target.value)}
                    className="h-9 rounded-lg border border-[#091413]/15 bg-[#091413]/2 px-2.5 text-xs text-[#091413] outline-none transition-colors focus:border-[#285A48] focus:bg-white focus:ring-1 focus:ring-[#285A48]"
                  />
                </label>
                <label className="flex items-center gap-1.5 text-xs text-[#091413]/60">
                  To
                  <input
                    type="date"
                    value={customEnd}
                    onChange={(event) => setCustomEnd(event.target.value)}
                    className="h-9 rounded-lg border border-[#091413]/15 bg-[#091413]/2 px-2.5 text-xs text-[#091413] outline-none transition-colors focus:border-[#285A48] focus:bg-white focus:ring-1 focus:ring-[#285A48]"
                  />
                </label>
                {!customStart && !customEnd && (
                  <span className="text-[11px] text-[#091413]/40">Pick a start and/or end date to narrow the report.</span>
                )}
              </div>
            )}

            {/* PAYMENT METHOD */}

            <div className="flex flex-wrap items-center gap-1.5 border-t border-[#091413]/10 pt-3">
              <span className="mr-1 text-[11px] font-semibold uppercase tracking-wider text-[#091413]/40">
                Payment
              </span>

              <button
                type="button"
                onClick={() => setMethodFilter('all')}
                className={`min-h-9 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  methodFilter === 'all'
                    ? 'bg-[#285A48] text-white shadow-xs'
                    : 'border border-[#091413]/10 bg-[#091413]/2 text-[#091413]/60 hover:bg-[#091413]/5 hover:text-[#091413]'
                }`}
              >
                All
              </button>

              {PAYMENT_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setMethodFilter(String(option.value))}
                  className={`min-h-9 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    methodFilter === String(option.value)
                      ? 'bg-[#285A48] text-white shadow-xs'
                      : 'border border-[#091413]/10 bg-[#091413]/2 text-[#091413]/60 hover:bg-[#091413]/5 hover:text-[#091413]'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {/* =======================================================
              KPI SUMMARY
          ======================================================= */}

          {initialLoading ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <KpiSkeleton key={i} />
              ))}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">

                <KpiCard
                  label="Gross Sales"
                  value={formatMoney(metrics.grossSales, settings.currencySymbol)}
                  description="Total sales before deductions"
                  icon={<TrendingUpIcon size={14} />}
                  accent="brand"
                  comparisonPercent={periodComparison?.percent ?? null}
                />

                <KpiCard
                  label="Net Sales"
                  value={formatMoney(metrics.netSales, settings.currencySymbol)}
                  description="Gross sales minus refunds"
                  icon={<WalletIcon size={14} />}
                  accent="brand"
                />

                <KpiCard
                  label="Transactions"
                  value={String(metrics.transactionCount)}
                  description="Completed checkouts"
                  icon={<ReceiptIcon size={14} />}
                  accent="neutral"
                />

                <KpiCard
                  label="Average Order"
                  value={formatMoney(metrics.averageOrderValue, settings.currencySymbol)}
                  description="Per transaction"
                  icon={<BarChartIcon size={14} />}
                  accent="neutral"
                />

                <KpiCard
                  label="Items Sold"
                  value={String(metrics.totalItemsSold)}
                  description="Units across all sales"
                  icon={<BoxIcon size={14} />}
                  accent="neutral"
                />

                <KpiCard
                  label="Refunds"
                  value={formatMoney(metrics.refundsTotal, settings.currencySymbol)}
                  description={
                    metrics.refundsCount > 0
                      ? `${metrics.refundsCount} voided transaction${metrics.refundsCount === 1 ? '' : 's'}`
                      : 'No voided transactions'
                  }
                  icon={<UndoIcon size={14} />}
                  accent={metrics.refundsTotal > 0 ? 'rose' : 'neutral'}
                />
              </div>

              <p className="text-[11px] text-[#091413]/40">
                Discounts applied: {formatMoney(metrics.totalDiscount, settings.currencySymbol)}
                {' · '}
                Tax collected: {formatMoney(metrics.totalTax, settings.currencySymbol)}
              </p>
            </>
          )}

          {/* =======================================================
              SALES TREND
          ======================================================= */}

          <div className="rounded-xl border border-[#091413]/10 bg-white p-4 shadow-xs">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[#091413]/50">
                  Sales Trend
                </h3>
                {periodComparison && (
                  <p className={`mt-0.5 text-[11px] font-medium ${
                    periodComparison.percent === null
                      ? 'text-[#091413]/50'
                      : periodComparison.percent >= 0
                      ? 'text-[#285A48]'
                      : 'text-rose-600'
                  }`}>
                    {periodComparison.percent === null
                      ? 'No sales in the previous period to compare against.'
                      : `Sales ${periodComparison.percent >= 0 ? 'increased' : 'decreased'} ${Math.abs(periodComparison.percent).toFixed(1)}% compared with the previous period`}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-1 rounded-lg border border-[#091413]/10 bg-[#091413]/2 p-0.5 print:hidden">
                {(['day', 'week', 'month'] as TrendGranularity[]).map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setTrendGranularity(g)}
                    className={`min-h-8 rounded-md px-2.5 text-[11px] font-medium capitalize transition-colors ${
                      trendGranularity === g
                        ? 'bg-white text-[#091413] shadow-xs'
                        : 'text-[#091413]/50 hover:text-[#091413]'
                    }`}
                  >
                    {g === 'day' ? 'Daily' : g === 'week' ? 'Weekly' : 'Monthly'}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-3">
              {initialLoading ? (
                <div className="h-56 animate-pulse rounded-lg bg-[#091413]/5" />
              ) : trendBuckets.length === 0 ? (
                <div className="flex h-56 flex-col items-center justify-center text-center">
                  <p className="text-xs font-medium text-[#091413]">No sales found</p>
                  <p className="mt-1 text-[11px] text-[#091413]/40">
                    No completed sales in this period to plot.
                  </p>
                </div>
              ) : (
                <div className="h-56 w-full min-w-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={trendBuckets} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 11, fill: '#091413', fillOpacity: 0.6 }}
                        tickLine={false}
                        axisLine={{ stroke: '#091413', opacity: 0.1 }}
                        interval="preserveStartEnd"
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: '#091413', fillOpacity: 0.6 }}
                        tickLine={false}
                        axisLine={false}
                        width={56}
                        tickFormatter={(value) => formatCompactMoney(Number(value), settings.currencySymbol)}
                        allowDecimals={false}
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
                      <Bar dataKey="amount" fill="#285A48" radius={[4, 4, 0, 0]} maxBarSize={40} minPointSize={2} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>

          {/* =======================================================
              PAYMENT BREAKDOWN
          ======================================================= */}

          <div className="rounded-xl border border-[#091413]/10 bg-white p-4 shadow-xs">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#091413]/50">
              Payment Breakdown
            </h3>

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {PAYMENT_OPTIONS.map((option) => {
                const total =
                  metrics.methodTotals[
                    String(option.value)
                  ] || 0

                const percent =
                  metrics.grossSales > 0
                    ? Math.round(
                        (total / metrics.grossSales) * 100,
                      )
                    : 0

                return (
                  <div
                    key={option.value}
                    className="flex flex-col justify-between rounded-lg border border-[#091413]/10 bg-[#091413]/2 p-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-[#091413]">
                        {option.label}
                      </span>

                      <span className="font-mono text-xs font-semibold text-[#091413]/50">
                        {percent}%
                      </span>
                    </div>

                    <div className="mt-2">
                      <p className="font-mono text-base font-bold text-[#091413]">
                        {formatMoney(
                          total,
                          settings.currencySymbol,
                        )}
                      </p>

                      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[#091413]/10">
                        <div
                          className="h-full rounded-full bg-[#285A48] transition-all duration-500"
                          style={{
                            width: `${percent}%`,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* =======================================================
              TOP SELLING PRODUCTS
          ======================================================= */}

          <div className="overflow-hidden rounded-xl border border-[#091413]/10 bg-white shadow-xs">
            <div className="border-b border-[#091413]/10 p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[#091413]/50">
                Top Products
              </h3>
              <p className="mt-0.5 text-[11px] text-[#091413]/40">Best sellers by units, in the current filter</p>
            </div>

            {initialLoading ? (
              <div className="space-y-0 divide-y divide-[#091413]/5">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 p-4">
                    <div className="h-7 w-7 shrink-0 animate-pulse rounded-lg bg-[#091413]/5" />
                    <div className="h-3 flex-1 animate-pulse rounded bg-[#091413]/5" />
                    <div className="h-3 w-16 animate-pulse rounded bg-[#091413]/5" />
                  </div>
                ))}
              </div>
            ) : topProducts.length === 0 ? (
              <div className="flex h-40 flex-col items-center justify-center p-6 text-center">
                <p className="text-xs font-medium text-[#091413]">No sales found</p>
                <p className="mt-1 text-[11px] text-[#091413]/40">No products sold in this period yet.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-[#091413]/10 bg-[#091413]/2 text-[11px] font-semibold uppercase tracking-wider text-[#091413]/50">
                      <th className="py-2.5 pl-4 pr-3">Rank</th>
                      <th className="px-3 py-2.5">Product</th>
                      <th className="px-3 py-2.5 text-right">Quantity Sold</th>
                      <th className="py-2.5 pl-3 pr-4 text-right">Revenue</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#091413]/5">
                    {topProducts.map((product, index) => (
                      <tr key={product.productId} className="transition-colors hover:bg-[#285A48]/3">
                        <td className="py-3 pl-4 pr-3">
                          <span className="flex h-6 w-6 items-center justify-center rounded-lg border border-[#285A48]/20 bg-[#285A48]/10 font-mono text-[11px] font-semibold text-[#285A48]">
                            {index + 1}
                          </span>
                        </td>
                        <td className="px-3 py-3 font-medium text-[#091413]">{product.name}</td>
                        <td className="px-3 py-3 text-right font-mono text-[#091413]/80">{product.quantitySold}</td>
                        <td className="py-3 pl-3 pr-4 text-right font-mono font-semibold text-[#091413]">
                          {formatMoney(product.revenue, settings.currencySymbol)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* =======================================================
              SALES TABLE
          ======================================================= */}

          <section className="overflow-hidden rounded-xl border border-[#091413]/10 bg-white shadow-xs">

            <div className="flex items-center justify-between border-b border-[#091413]/10 p-4">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[#091413]/50">
                  Sales Transactions
                </h3>

                <p className="mt-0.5 text-xs text-[#091413]/40">
                  Showing {filteredSales.length} record
                  {filteredSales.length !== 1 ? 's' : ''}
                </p>
              </div>
            </div>

            {initialLoading ? (
              <div className="divide-y divide-[#091413]/5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-4 px-4 py-3.5">
                    <div className="h-3 w-20 animate-pulse rounded bg-[#091413]/10" />
                    <div className="h-3 w-24 animate-pulse rounded bg-[#091413]/5" />
                    <div className="h-3 flex-1 animate-pulse rounded bg-[#091413]/5" />
                    <div className="h-3 w-16 animate-pulse rounded bg-[#091413]/5" />
                  </div>
                ))}
              </div>
            ) : filteredSales.length === 0 ? (
              <div className="flex h-48 flex-col items-center justify-center p-6 text-center">
                <FileTextIcon
                  size={28}
                  className="text-[#091413]/20"
                />

                <p className="mt-2 text-xs font-medium text-[#091413]">
                  No sales found
                </p>

                <p className="text-[11px] text-[#091413]/40">
                  Try adjusting the date range, payment method,
                  or search query.
                </p>

                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="mt-3 text-xs font-medium text-[#285A48] underline hover:text-[#1e4537]"
                  >
                    Reset all filters
                  </button>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left">

                  <thead>
                    <tr className="border-b border-[#091413]/10 bg-[#091413]/2 text-[11px] font-semibold uppercase tracking-wider text-[#091413]/50">
                      <th className="py-3 pl-4 pr-3">
                        Invoice
                      </th>

                      <th className="px-3 py-3">
                        Date & Time
                      </th>

                      <th className="px-3 py-3">
                        Customer
                      </th>

                      <th className="px-3 py-3">
                        Cashier
                      </th>

                      <th className="px-3 py-3">
                        Method
                      </th>

                      <th className="px-3 py-3 text-right">
                        Items
                      </th>

                      <th className="px-3 py-3 text-right">
                        Discount
                      </th>

                      <th className="px-3 py-3 text-right">
                        Tax
                      </th>

                      <th className="px-3 py-3 text-right">
                        Total
                      </th>

                      <th className="py-3 pl-3 pr-4 text-center print:hidden">
                        Receipt
                      </th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-[#091413]/5 text-xs">

                    {filteredSales.map((sale) => {
                      const totalQty =
                        sale.items?.reduce(
                          (sum, item) =>
                            sum +
                            (Number(item.quantity) || 0),
                          0,
                        ) ?? 0

                      const discountValue =
                        Number(sale.discount) || 0

                      const taxValue =
                        Number(sale.tax) || 0

                      const totalValue =
                        Number(sale.total) || 0

                      const isVoided = sale.status === 'Voided'

                      const payment = resolvePaymentMethod(sale.paymentMethod)

                      return (
                        <tr
                          key={sale.id}
                          className={`transition-colors hover:bg-[#285A48]/3 ${isVoided ? 'opacity-60' : ''}`}
                        >

                          <td className="py-3.5 pl-4 pr-3 font-mono font-medium text-[#091413]">
                            #{sale.invoiceNumber}
                            {isVoided && (
                              <span className="ml-1.5 inline-block rounded-md border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-600">
                                Voided
                              </span>
                            )}
                          </td>

                          <td className="px-3 py-3.5 text-[#091413]/70">
                            {sale.createdAt ? (
                              <>
                                {new Date(
                                  sale.createdAt,
                                ).toLocaleDateString([], {
                                  month: 'short',
                                  day: 'numeric',
                                  year: 'numeric',
                                })}{' '}

                                <span className="text-[11px] text-[#091413]/40">
                                  {new Date(
                                    sale.createdAt,
                                  ).toLocaleTimeString([], {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })}
                                </span>
                              </>
                            ) : (
                              '—'
                            )}
                          </td>

                          <td className="px-3 py-3.5 text-[#091413]/70">
                            {sale.customerName || 'Walk-in Customer'}
                          </td>

                          <td className="px-3 py-3.5 text-[#091413]/70">
                            {sale.cashierName || '—'}
                          </td>

                          <td className="px-3 py-3.5">
                            <span className="inline-flex items-center gap-1.5 rounded-md border border-[#091413]/10 bg-[#091413]/4 px-2 py-1 text-[11px] font-medium text-[#091413]/80">
                              <span
                                className={`h-1.5 w-1.5 rounded-full ${
                                  payment.value === '0' || payment.value === 'cash'
                                    ? 'bg-[#285A48]'
                                    : 'bg-[#091413]/25'
                                }`}
                              />
                              {getPaymentLabel(
                                sale.paymentMethod,
                              )}
                            </span>
                          </td>

                          <td className="px-3 py-3.5 text-right font-mono text-[#091413]/80">
                            {totalQty}
                          </td>

                          <td className="px-3 py-3.5 text-right font-mono text-[#091413]/50">
                            {discountValue > 0
                              ? `-${formatMoney(
                                  discountValue,
                                  settings.currencySymbol,
                                )}`
                              : '—'}
                          </td>

                          <td className="px-3 py-3.5 text-right font-mono text-[#091413]/50">
                            {formatMoney(
                              taxValue,
                              settings.currencySymbol,
                            )}
                          </td>

                          <td className="px-3 py-3.5 text-right font-mono font-bold text-[#091413]">
                            {formatMoney(
                              totalValue,
                              settings.currencySymbol,
                            )}
                          </td>

                          <td className="py-3.5 pl-3 pr-4 text-center print:hidden">
                            <button
                              type="button"
                              onClick={() =>
                                setSelectedSale(sale)
                              }
                              className="inline-flex min-h-9 items-center gap-1 rounded-md border border-[#091413]/15 bg-white px-2.5 py-1.5 text-[11px] font-medium text-[#091413]/70 transition-colors hover:border-[#285A48]/40 hover:text-[#285A48] active:scale-[0.98]"
                            >
                              <EyeIcon size={12} />

                              <span>View</span>
                            </button>
                          </td>
                        </tr>
                      )
                    })}

                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* =======================================================
              END-OF-DAY CASH SUMMARY
          ======================================================= */}

          <CashSummarySection
            cashSales={metrics.methodTotals['0'] ?? metrics.methodTotals['cash'] ?? 0}
            cashRefunds={voidedSales.reduce((sum, sale) => {
              const payment = resolvePaymentMethod(sale.paymentMethod)
              if (payment.value !== '0' && payment.value !== 'cash') return sum
              return sum + (Number(sale.total) || 0)
            }, 0)}
            openingCash={openingCash}
            setOpeningCash={setOpeningCash}
            actualCash={actualCash}
            setActualCash={setActualCash}
            currencySymbol={settings.currencySymbol}
          />
        </div>
      </div>

      {/* ===========================================================
          RECEIPT MODAL
      =========================================================== */}

      {selectedSale && (
        <Modal
          title={`Invoice #${selectedSale.invoiceNumber}`}
          onClose={() => setSelectedSale(null)}
          footer={
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">

              <Button
                variant="secondary"
                onClick={() => setSelectedSale(null)}
              >
                Close
              </Button>

              <button
                type="button"
                onClick={() => void printReceipt()}
                disabled={isPrinting}
                className="inline-flex items-center justify-center rounded-lg bg-[#285A48] px-4 py-2 text-xs font-medium text-white shadow-xs transition-colors hover:bg-[#1e4537] disabled:opacity-50"
              >
                {isPrinting ? (
                  'Printing...'
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    <PrinterIcon size={14} />

                    <span>
                      {lastPrintError
                        ? 'Retry Print'
                        : 'Reprint Receipt'}
                    </span>
                  </span>
                )}
              </button>
            </div>
          }
        >
          <div className="space-y-3 text-xs">

            {/* STORE INFO */}

            <div className="space-y-1 border-b border-[#091413]/10 pb-3 text-center">

              {settings.showLogoOnReceipt && (
                <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-[#285A48] font-mono text-sm font-bold text-white shadow-xs">
                  {settings.storeName?.slice(0, 1).toUpperCase() || 'S'}
                </div>
              )}

              <h3 className="text-sm font-bold text-[#091413]">
                {settings.storeName || 'Store'}
              </h3>

              {(settings.phone ||
                settings.email ||
                settings.address) && (
                <div className="space-y-0.5 text-[11px] text-[#091413]/50">

                  {settings.address && (
                    <p>{settings.address}</p>
                  )}

                  {settings.phone && (
                    <p>{settings.phone}</p>
                  )}

                  {settings.email && (
                    <p>{settings.email}</p>
                  )}

                </div>
              )}

              <p className="pt-1 font-mono text-[11px] text-[#091413]/40">
                Date:{' '}
                {selectedSale.createdAt
                  ? new Date(
                      selectedSale.createdAt,
                    ).toLocaleString()
                  : '—'}
              </p>
            </div>

            {/* ITEMS */}

            <div className="divide-y divide-[#091413]/5 py-1">
              {selectedSale.items?.map(
                (item, index) => {
                  const unitPrice =
                    Number(item.unitPrice) || 0

                  const quantity =
                    Number(item.quantity) || 0

                  const lineTotal =
                    Number(item.lineTotal) ||
                    unitPrice * quantity

                  return (
                    <div
                      key={`${item.productId}-${index}`}
                      className="flex justify-between py-1.5"
                    >
                      <span className="text-[#091413]/80">
                        {item.productName}{' '}

                        <span className="text-[#091413]/40">
                          × {quantity}
                        </span>
                      </span>

                      <span className="font-mono font-medium text-[#091413]">
                        {formatMoney(
                          lineTotal,
                          settings.currencySymbol,
                        )}
                      </span>
                    </div>
                  )
                },
              )}
            </div>

            {/* TOTALS */}

            <div className="space-y-1 border-t border-[#091413]/10 pt-2 text-[#091413]/60">

              <div className="flex justify-between">
                <span>Subtotal</span>

                <span className="font-mono text-[#091413]">
                  {formatMoney(
                    Number(selectedSale.subtotal) || 0,
                    settings.currencySymbol,
                  )}
                </span>
              </div>

              <div className="flex justify-between">
                <span>Discount</span>

                <span className="font-mono text-[#091413]">
                  {formatMoney(
                    Number(selectedSale.discount) || 0,
                    settings.currencySymbol,
                  )}
                </span>
              </div>

              <div className="flex justify-between">
                <span>Tax</span>

                <span className="font-mono text-[#091413]">
                  {formatMoney(
                    Number(selectedSale.tax) || 0,
                    settings.currencySymbol,
                  )}
                </span>
              </div>

              <div className="flex justify-between border-t border-[#091413]/10 pt-1.5 font-semibold text-[#091413]">
                <span>Total</span>

                <span className="font-mono text-[#285A48]">
                  {formatMoney(
                    Number(selectedSale.total) || 0,
                    settings.currencySymbol,
                  )}
                </span>
              </div>
            </div>

            {/* PAYMENT INFO */}

            <div className="space-y-1 rounded-lg bg-[#091413]/3 p-2.5 text-[11px] text-[#091413]/60">

              <div className="flex justify-between">
                <span>Payment Method</span>

                <span className="font-medium text-[#091413]">
                  {getPaymentLabel(
                    selectedSale.paymentMethod,
                  )}
                </span>
              </div>

              {selectedSale.amountReceived != null && (
                <div className="flex justify-between">
                  <span>Amount Tendered</span>

                  <span className="font-mono text-[#091413]">
                    {formatMoney(
                      Number(
                        selectedSale.amountReceived,
                      ),
                      settings.currencySymbol,
                    )}
                  </span>
                </div>
              )}

              {selectedSale.change != null && (
                <div className="flex justify-between">
                  <span>Change Given</span>

                  <span className="font-mono text-[#091413]">
                    {formatMoney(
                      Number(selectedSale.change),
                      settings.currencySymbol,
                    )}
                  </span>
                </div>
              )}

            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

/*
 * ================================================================
 * EXPORTS
 * ================================================================
 */

export { ReportsPage as Reports }

export default ReportsPage

/*
 * ================================================================
 * SVG ICONS
 * ================================================================
 */

function RefreshCwIcon({
  size = 14,
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
    >
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  )
}

function DownloadIcon({ size = 14 }: { size?: number }) {
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
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  )
}

function SearchIcon({
  size = 14,
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
    >
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}

function TrendingUpIcon({ size = 14 }: { size?: number }) {
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
    >
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
      <polyline points="17 6 23 6 23 12" />
    </svg>
  )
}

function ReceiptIcon({ size = 14 }: { size?: number }) {
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
    >
      <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" />
      <path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8" />
      <path d="M12 17.5v.5" />
      <path d="M12 6v.5" />
    </svg>
  )
}

function BarChartIcon({ size = 14 }: { size?: number }) {
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
    >
      <line x1="12" y1="20" x2="12" y2="10" />
      <line x1="18" y1="20" x2="18" y2="4" />
      <line x1="6" y1="20" x2="6" y2="16" />
    </svg>
  )
}

function FileTextIcon({
  size = 14,
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
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  )
}

function EyeIcon({ size = 14 }: { size?: number }) {
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
    >
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
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
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="6 9 6 2 18 2 18 9" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" />
    </svg>
  )
}

function ClearIcon({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

function WalletIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2" />
      <path d="M21 12h-4a2 2 0 0 0 0 4h4v-4Z" />
    </svg>
  )
}

function BoxIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m21 8-9 5-9-5" />
      <path d="m3 8 9-5 9 5v8l-9 5-9-5V8Z" />
      <path d="M12 13v8" />
    </svg>
  )
}

function UndoIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </svg>
  )
}

/*
 * ================================================================
 * KPI CARD
 * ================================================================
 */

function KpiCard({
  label,
  value,
  description,
  icon,
  accent = 'neutral',
  comparisonPercent,
}: {
  label: string
  value: string
  description: string
  icon: ReactNode
  accent?: 'brand' | 'neutral' | 'rose'
  comparisonPercent?: number | null
}) {
  const iconStyles =
    accent === 'brand'
      ? 'bg-[#285A48]/10 text-[#285A48]'
      : accent === 'rose'
      ? 'bg-rose-50 text-rose-600'
      : 'bg-[#091413]/5 text-[#091413]/70'

  return (
    <div className="rounded-xl border border-[#091413]/10 bg-white p-3.5 shadow-xs sm:p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[#091413]/50 sm:text-[11px]">
          {label}
        </span>

        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${iconStyles}`}>
          {icon}
        </span>
      </div>

      <p className="mt-2 truncate font-mono text-lg font-bold tracking-tight text-[#091413] sm:text-xl">
        {value}
      </p>

      <div className="mt-1 flex items-center gap-1.5">
        <p className="truncate text-[11px] text-[#091413]/40">{description}</p>

        {typeof comparisonPercent === 'number' && (
          <span className={`shrink-0 text-[11px] font-semibold ${comparisonPercent >= 0 ? 'text-[#285A48]' : 'text-rose-600'}`}>
            {comparisonPercent >= 0 ? '+' : ''}
            {comparisonPercent.toFixed(1)}%
          </span>
        )}
      </div>
    </div>
  )
}

function KpiSkeleton() {
  return (
    <div className="rounded-xl border border-[#091413]/10 bg-white p-3.5 shadow-xs sm:p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="h-2.5 w-16 animate-pulse rounded bg-[#091413]/10" />
        <div className="h-7 w-7 shrink-0 animate-pulse rounded-lg bg-[#091413]/5" />
      </div>
      <div className="mt-3 h-5 w-20 animate-pulse rounded bg-[#091413]/10" />
      <div className="mt-2 h-2.5 w-24 animate-pulse rounded bg-[#091413]/5" />
    </div>
  )
}

/*
 * ================================================================
 * END-OF-DAY CASH SUMMARY
 * ================================================================
 *
 * Cash Sales / Cash Refunds come from real sale + payment records.
 * Opening Cash and Actual Cash have no backing table anywhere in this
 * schema (no drawer-count ledger exists yet), so they're session-only
 * manual entries - nothing here is persisted or invented, and the
 * component degrades to just showing the real cash totals if left
 * blank.
 */

function CashSummarySection({
  cashSales,
  cashRefunds,
  openingCash,
  setOpeningCash,
  actualCash,
  setActualCash,
  currencySymbol,
}: {
  cashSales: number
  cashRefunds: number
  openingCash: string
  setOpeningCash: (value: string) => void
  actualCash: string
  setActualCash: (value: string) => void
  currencySymbol: string
}) {
  const opening = Number(openingCash) || 0
  const expected = opening + cashSales - cashRefunds
  const hasActualEntry = actualCash.trim() !== ''
  const actual = Number(actualCash) || 0
  const difference = hasActualEntry ? actual - expected : 0

  return (
    <div className="rounded-xl border border-[#091413]/10 bg-white p-4 shadow-xs">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[#091413]/50">
          End-of-Day Cash Summary
        </h3>
        <p className="mt-0.5 text-[11px] text-[#091413]/40">
          Cash sales and refunds are from your records. Opening and actual counts are entered manually per session.
        </p>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-2.5 text-xs">
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="opening-cash" className="text-[#091413]/60">Opening Cash</label>
            <div className="relative">
              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#091413]/40">{currencySymbol}</span>
              <input
                id="opening-cash"
                type="number"
                inputMode="decimal"
                min={0}
                value={openingCash}
                onChange={(event) => setOpeningCash(event.target.value)}
                placeholder="0.00"
                className="h-9 w-32 rounded-lg border border-[#091413]/15 bg-[#091413]/2 py-1.5 pl-6 pr-2.5 text-right font-mono text-xs text-[#091413] outline-none transition-colors focus:border-[#285A48] focus:bg-white focus:ring-1 focus:ring-[#285A48]"
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <span className="text-[#091413]/60">Cash Sales</span>
            <span className="font-mono font-medium text-[#285A48]">{formatSigned(cashSales, currencySymbol)}</span>
          </div>

          <div className="flex items-center justify-between gap-3">
            <span className="text-[#091413]/60">Cash Refunds</span>
            <span className="font-mono font-medium text-rose-600">
              {cashRefunds > 0 ? formatSigned(-cashRefunds, currencySymbol) : formatMoney(0, currencySymbol)}
            </span>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-[#091413]/10 pt-2.5 font-semibold text-[#091413]">
            <span>Expected Cash</span>
            <span className="font-mono">{formatMoney(expected, currencySymbol)}</span>
          </div>

          <div className="flex items-center justify-between gap-3">
            <label htmlFor="actual-cash" className="text-[#091413]/60">Actual Cash (counted)</label>
            <div className="relative">
              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#091413]/40">{currencySymbol}</span>
              <input
                id="actual-cash"
                type="number"
                inputMode="decimal"
                min={0}
                value={actualCash}
                onChange={(event) => setActualCash(event.target.value)}
                placeholder="0.00"
                className="h-9 w-32 rounded-lg border border-[#091413]/15 bg-[#091413]/2 py-1.5 pl-6 pr-2.5 text-right font-mono text-xs text-[#091413] outline-none transition-colors focus:border-[#285A48] focus:bg-white focus:ring-1 focus:ring-[#285A48]"
              />
            </div>
          </div>
        </div>

        <div className="flex flex-col items-center justify-center rounded-lg border border-[#091413]/10 bg-[#091413]/2 p-5 text-center">
          {hasActualEntry ? (
            <>
              <p className={`font-mono text-2xl font-bold tracking-tight ${
                difference === 0 ? 'text-[#285A48]' : difference > 0 ? 'text-amber-600' : 'text-rose-600'
              }`}>
                {formatSigned(difference, currencySymbol)}
              </p>
              <p className={`mt-1 text-[11px] font-semibold uppercase tracking-wider ${
                difference === 0 ? 'text-[#285A48]' : difference > 0 ? 'text-amber-600' : 'text-rose-600'
              }`}>
                {difference === 0 ? 'Balanced' : difference > 0 ? 'Over' : 'Short'}
              </p>
            </>
          ) : (
            <>
              <p className="font-mono text-2xl font-bold tracking-tight text-[#091413]/20">—</p>
              <p className="mt-1 max-w-[220px] text-[11px] text-[#091413]/40">
                Enter your actual counted cash to see the difference.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}