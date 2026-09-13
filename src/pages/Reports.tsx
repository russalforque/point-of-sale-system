import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { salesApi } from '../api/salesApi'

import { Button } from '../components/ui/Button'
import { Modal } from '../components/ui/Modal'
import { PageHeader } from '../components/ui/Page'

import { useSettings } from '../context/SettingsContext'
import { useToast } from '../context/ToastContext'
import { useReceiptPrinter } from '../hooks/useReceiptPrinter'

import type { Sale } from '../types'
import { getErrorMessage } from '../utils/errors'
import { formatMoney } from '../utils/format'
import { PAYMENT_OPTIONS } from '../utils/pos'

type DateRangeFilter = 'today' | 'yesterday' | '7days' | '30days' | 'all'

type SaleRecord = Sale & {
  reference?: string
  paymentReference?: string
}

export function ReportsPage() {
  const navigate = useNavigate()
  const { notify } = useToast()
  const { settings } = useSettings()
  const { printReceipt: sendReceiptToPrinter, isPrinting, lastPrintError } =
    useReceiptPrinter()

  const [sales, setSales] = useState<SaleRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isMounted, setIsMounted] = useState(false)

  // Filters
  const [rangeFilter, setRangeFilter] = useState<DateRangeFilter>('7days')
  const [methodFilter, setMethodFilter] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')

  // Receipt inspection modal
  const [selectedSale, setSelectedSale] = useState<SaleRecord | null>(null)

  useEffect(() => {
    const id = window.setTimeout(() => setIsMounted(true), 40)
    return () => window.clearTimeout(id)
  }, [])

  async function loadSales() {
    try {
      setLoading(true)
      setError(null)
      const response = await salesApi.list({ page: 1, pageSize: 1000 })
      const records =
        (response as any)?.items ??
        (response as any)?.data ??
        (Array.isArray(response) ? response : [])

      setSales(records as SaleRecord[])
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
  }, [])

  // Safely normalize payment method identifiers between label, name, and enum values
  function resolvePaymentMethod(methodValue: any) {
    if (methodValue === null || methodValue === undefined) {
      return { value: 'other', label: 'Other' }
    }
    const strVal = String(methodValue).trim().toLowerCase()
    const found = PAYMENT_OPTIONS.find(
      (opt) =>
        String(opt.value).toLowerCase() === strVal ||
        opt.label.toLowerCase() === strVal,
    )
    if (found) {
      return { value: String(found.value), label: found.label }
    }
    return { value: strVal, label: String(methodValue) }
  }

  function getPaymentLabel(methodValue: any) {
    return resolvePaymentMethod(methodValue).label
  }

  // Exact calendar boundary comparison
  function matchesDateRange(createdAt: string | number | Date | undefined, filter: DateRangeFilter) {
    if (filter === 'all') return true
    if (!createdAt) return false

    const date = new Date(createdAt)
    if (isNaN(date.getTime())) return false

    const now = new Date()
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)

    const startOfYesterday = new Date(startOfToday)
    startOfYesterday.setDate(startOfYesterday.getDate() - 1)

    if (filter === 'today') {
      return date >= startOfToday && date <= endOfToday
    }
    if (filter === 'yesterday') {
      return date >= startOfYesterday && date < startOfToday
    }
    if (filter === '7days') {
      const past7 = new Date(startOfToday)
      past7.setDate(past7.getDate() - 6)
      return date >= past7 && date <= endOfToday
    }
    if (filter === '30days') {
      const past30 = new Date(startOfToday)
      past30.setDate(past30.getDate() - 29)
      return date >= past30 && date <= endOfToday
    }
    return true
  }

  const filteredSales = useMemo(() => {
    return sales.filter((sale) => {
      const matchesDate = matchesDateRange(sale.createdAt, rangeFilter)
      if (!matchesDate) return false

      if (methodFilter !== 'all') {
        const resolved = resolvePaymentMethod(sale.paymentMethod)
        if (resolved.value !== methodFilter) {
          return false
        }
      }

      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim()
        const invoiceMatch = sale.invoiceNumber?.toLowerCase().includes(query)
        const refMatch =
          sale.reference?.toLowerCase().includes(query) ||
          sale.paymentReference?.toLowerCase().includes(query)
        if (!invoiceMatch && !refMatch) return false
      }

      return true
    })
  }, [sales, rangeFilter, methodFilter, searchQuery])

  const metrics = useMemo(() => {
    let totalGrossRevenue = 0
    let totalDiscount = 0
    let totalTax = 0
    let totalItemsSold = 0

    const methodTotals: Record<string, number> = {}

    for (const sale of filteredSales) {
      const saleTotal = Number(sale.total) || 0
      totalGrossRevenue += saleTotal
      totalDiscount += Number(sale.discount) || 0
      totalTax += Number(sale.tax) || 0

      const itemCount =
        sale.items?.reduce((acc, item) => acc + (Number(item.quantity) || 0), 0) || 0
      totalItemsSold += itemCount

      const resolved = resolvePaymentMethod(sale.paymentMethod)
      methodTotals[resolved.value] = (methodTotals[resolved.value] || 0) + saleTotal
    }

    const transactionCount = filteredSales.length
    const averageOrderValue =
      transactionCount > 0 ? totalGrossRevenue / transactionCount : 0

    return {
      totalGrossRevenue,
      totalDiscount,
      totalTax,
      totalItemsSold,
      transactionCount,
      averageOrderValue,
      methodTotals,
    }
  }, [filteredSales])

  const hasActiveFilters = rangeFilter !== '7days' || methodFilter !== 'all' || searchQuery.trim() !== ''

  function resetFilters() {
    setRangeFilter('7days')
    setMethodFilter('all')
    setSearchQuery('')
  }

  function exportCSV() {
    if (filteredSales.length === 0) {
      notify('No data available to export', 'error')
      return
    }

    const headers = [
      'Invoice Number',
      'Date',
      'Payment Method',
      'Reference',
      'Items Count',
      'Subtotal',
      'Tax',
      'Discount',
      'Total',
    ]

    const rows = filteredSales.map((s) => {
      const invoice = `"${(s.invoiceNumber || '').replace(/"/g, '""')}"`
      const date = `"${s.createdAt ? new Date(s.createdAt).toLocaleString() : '—'}"`
      const method = `"${getPaymentLabel(s.paymentMethod).replace(/"/g, '""')}"`
      const ref = `"${(s.reference ?? s.paymentReference ?? '').replace(/"/g, '""')}"`
      const itemsCount = s.items?.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0) || 0
      const subtotal = Number(s.subtotal || 0).toFixed(2)
      const tax = Number(s.tax || 0).toFixed(2)
      const discount = Number(s.discount || 0).toFixed(2)
      const total = Number(s.total || 0).toFixed(2)

      return [invoice, date, method, ref, itemsCount, subtotal, tax, discount, total]
    })

    const csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\r\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)

    const link = document.createElement('a')
    link.setAttribute('href', url)
    link.setAttribute(
      'download',
      `sales_report_${rangeFilter}_${new Date().toISOString().slice(0, 10)}.csv`,
    )
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)

    notify('Report exported as CSV.')
  }

  async function printReceipt() {
    if (!selectedSale) return
    try {
      await sendReceiptToPrinter(selectedSale, settings)
      notify('Receipt printed successfully.')
    } catch (err) {
      notify('Receipt print failed: ' + getErrorMessage(err), 'error')
    }
  }

  return (
    <div className="min-h-screen bg-[#091413]/[0.02] text-[#091413] antialiased">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 md:px-8">
        {/* Page Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <PageHeader
            title="Sales Report"
            subtitle="Analyze revenue, transaction volume, and payment breakdowns"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void loadSales()}
              disabled={loading}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#091413]/15 bg-white px-3 py-2 text-xs font-medium text-[#091413]/80 shadow-xs transition-colors hover:bg-[#091413]/[0.03] hover:text-[#091413] active:scale-[0.98] disabled:opacity-50"
            >
              <RefreshCwIcon size={14} className={loading ? 'animate-spin' : ''} />
              <span>Refresh</span>
            </button>
            <button
              type="button"
              onClick={exportCSV}
              disabled={filteredSales.length === 0}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#285A48] px-3.5 py-2 text-xs font-medium text-white shadow-xs transition-colors hover:bg-[#1e4537] active:scale-[0.98] disabled:opacity-50"
            >
              <DownloadIcon size={14} />
              <span>Export CSV</span>
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div
          className={`mt-4 space-y-5 transition-all duration-300 ease-out ${
            isMounted ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
          }`}
        >
          {/* Error Notice */}
          {error && (
            <div className="flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50/70 p-4 text-xs text-rose-800">
              <p>Failed to load sales data: {error}</p>
              <button
                type="button"
                onClick={() => void loadSales()}
                className="font-medium underline hover:text-rose-900"
              >
                Retry
              </button>
            </div>
          )}

          {/* Filters Bar */}
          <div className="flex flex-col gap-3 rounded-xl border border-[#091413]/10 bg-white p-3.5 shadow-xs lg:flex-row lg:items-center lg:justify-between">
            {/* Range Pills */}
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { label: 'Today', value: 'today' },
                  { label: 'Yesterday', value: 'yesterday' },
                  { label: 'Last 7 Days', value: '7days' },
                  { label: 'Last 30 Days', value: '30days' },
                  { label: 'All Time', value: 'all' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.value}
                  type="button"
                  onClick={() => setRangeFilter(tab.value)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    rangeFilter === tab.value
                      ? 'bg-[#285A48] text-white shadow-xs'
                      : 'border border-[#091413]/10 bg-[#091413]/[0.02] text-[#091413]/60 hover:bg-[#091413]/[0.05] hover:text-[#091413]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Method, Search & Reset */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <div className="relative flex-1 sm:w-56">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search invoice or ref…"
                  className="h-8 w-full rounded-lg border border-[#091413]/15 bg-[#091413]/[0.02] pl-8 pr-7 text-xs text-[#091413] placeholder-[#091413]/40 outline-none transition-colors focus:border-[#285A48] focus:bg-white focus:ring-1 focus:ring-[#285A48]"
                />
                <SearchIcon
                  size={13}
                  className="pointer-events-none absolute left-2.5 top-2.5 text-[#091413]/40"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 top-2 rounded p-0.5 text-[#091413]/40 hover:text-[#091413]"
                    title="Clear search"
                  >
                    <ClearIcon size={12} />
                  </button>
                )}
              </div>

              <select
                value={methodFilter}
                onChange={(e) => setMethodFilter(e.target.value)}
                className="h-8 rounded-lg border border-[#091413]/15 bg-[#091413]/[0.02] px-2.5 text-xs text-[#091413] outline-none transition-colors focus:border-[#285A48] focus:bg-white focus:ring-1 focus:ring-[#285A48]"
              >
                <option value="all">All Payment Methods</option>
                {PAYMENT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={String(opt.value)}>
                    {opt.label}
                  </option>
                ))}
              </select>

              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="shrink-0 rounded-lg border border-[#091413]/15 bg-white px-2.5 py-1.5 text-xs font-medium text-[#091413]/70 transition-colors hover:bg-[#091413]/[0.03] hover:text-[#091413]"
                >
                  Reset
                </button>
              )}
            </div>
          </div>

          {/* Metric Summary Cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-[#091413]/10 bg-white p-4 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[#091413]/50">
                  Total Revenue
                </span>
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#285A48]/10 text-[#285A48]">
                  <TrendingUpIcon size={14} />
                </span>
              </div>
              <p className="mt-2 font-mono text-xl font-bold tracking-tight text-[#091413] sm:text-2xl">
                {formatMoney(metrics.totalGrossRevenue, settings.currencySymbol)}
              </p>
              <p className="mt-1 text-[11px] text-[#091413]/40">
                Gross sales in period
              </p>
            </div>

            <div className="rounded-xl border border-[#091413]/10 bg-white p-4 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[#091413]/50">
                  Transactions
                </span>
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#091413]/[0.05] text-[#091413]">
                  <ReceiptIcon size={14} />
                </span>
              </div>
              <p className="mt-2 font-mono text-xl font-bold tracking-tight text-[#091413] sm:text-2xl">
                {metrics.transactionCount}
              </p>
              <p className="mt-1 text-[11px] text-[#091413]/40">
                {metrics.totalItemsSold} items sold
              </p>
            </div>

            <div className="rounded-xl border border-[#091413]/10 bg-white p-4 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[#091413]/50">
                  Avg. Order Value
                </span>
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#285A48]/10 text-[#285A48]">
                  <BarChartIcon size={14} />
                </span>
              </div>
              <p className="mt-2 font-mono text-xl font-bold tracking-tight text-[#091413] sm:text-2xl">
                {formatMoney(metrics.averageOrderValue, settings.currencySymbol)}
              </p>
              <p className="mt-1 text-[11px] text-[#091413]/40">Per checkout ticket</p>
            </div>

            <div className="rounded-xl border border-[#091413]/10 bg-white p-4 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[#091413]/50">
                  Discounts & Tax
                </span>
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#091413]/[0.05] text-[#091413]/70">
                  <PercentIcon size={14} />
                </span>
              </div>
              <p className="mt-2 font-mono text-xl font-bold tracking-tight text-[#091413] sm:text-2xl">
                {formatMoney(metrics.totalDiscount, settings.currencySymbol)}
              </p>
              <p className="mt-1 text-[11px] text-[#091413]/40">
                Tax: {formatMoney(metrics.totalTax, settings.currencySymbol)}
              </p>
            </div>
          </div>

          {/* Payment Method Breakdown */}
          <div className="rounded-xl border border-[#091413]/10 bg-white p-4 shadow-xs">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#091413]/50">
              Payment Breakdown
            </h3>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {PAYMENT_OPTIONS.map((opt) => {
                const total = metrics.methodTotals[String(opt.value)] || 0
                const percent =
                  metrics.totalGrossRevenue > 0
                    ? Math.round((total / metrics.totalGrossRevenue) * 100)
                    : 0

                return (
                  <div
                    key={opt.value}
                    className="flex flex-col justify-between rounded-lg border border-[#091413]/10 bg-[#091413]/[0.02] p-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-[#091413]">
                        {opt.label}
                      </span>
                      <span className="font-mono text-xs font-semibold text-[#091413]/50">
                        {percent}%
                      </span>
                    </div>
                    <div className="mt-2">
                      <p className="font-mono text-base font-bold text-[#091413]">
                        {formatMoney(total, settings.currencySymbol)}
                      </p>
                      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[#091413]/10">
                        <div
                          className="h-full rounded-full bg-[#285A48] transition-all duration-500"
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Transactions Table Section */}
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

            {loading ? (
              <div className="flex h-48 items-center justify-center text-xs text-[#091413]/50">
                <RefreshCwIcon size={16} className="mr-2 animate-spin text-[#285A48]" />
                <span>Loading sales records…</span>
              </div>
            ) : filteredSales.length === 0 ? (
              <div className="flex h-48 flex-col items-center justify-center p-6 text-center">
                <FileTextIcon size={28} className="text-[#091413]/20" />
                <p className="mt-2 text-xs font-medium text-[#091413]">
                  No transactions match your criteria
                </p>
                <p className="text-[11px] text-[#091413]/40">
                  Try adjusting the date range, payment method, or search query.
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
                    <tr className="border-b border-[#091413]/10 bg-[#091413]/[0.02] text-[11px] font-semibold uppercase tracking-wider text-[#091413]/50">
                      <th className="py-2.5 pl-4 pr-3">Invoice</th>
                      <th className="px-3 py-2.5">Date & Time</th>
                      <th className="px-3 py-2.5">Method</th>
                      <th className="px-3 py-2.5">Reference</th>
                      <th className="px-3 py-2.5 text-right">Items</th>
                      <th className="px-3 py-2.5 text-right">Discount</th>
                      <th className="px-3 py-2.5 text-right">Total</th>
                      <th className="py-2.5 pl-3 pr-4 text-center">Receipt</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#091413]/5 text-xs">
                    {filteredSales.map((sale) => {
                      const totalQty =
                        sale.items?.reduce(
                          (s, i) => s + (Number(i.quantity) || 0),
                          0,
                        ) || 0
                      const ref = sale.reference ?? sale.paymentReference ?? '—'
                      const discountVal = Number(sale.discount) || 0
                      const totalVal = Number(sale.total) || 0

                      return (
                        <tr
                          key={sale.id || sale.invoiceNumber}
                          className="transition-colors hover:bg-[#285A48]/[0.03]"
                        >
                          <td className="py-3 pl-4 pr-3 font-mono font-medium text-[#091413]">
                            #{sale.invoiceNumber}
                          </td>
                          <td className="px-3 py-3 text-[#091413]/70">
                            {sale.createdAt ? (
                              <>
                                {new Date(sale.createdAt).toLocaleDateString([], {
                                  month: 'short',
                                  day: 'numeric',
                                  year: 'numeric',
                                })}{' '}
                                <span className="text-[11px] text-[#091413]/40">
                                  {new Date(sale.createdAt).toLocaleTimeString([], {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })}
                                </span>
                              </>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="px-3 py-3">
                            <span className="inline-block rounded-md border border-[#091413]/10 bg-[#091413]/[0.04] px-2 py-0.5 text-[11px] font-medium text-[#091413]/80">
                              {getPaymentLabel(sale.paymentMethod)}
                            </span>
                          </td>
                          <td className="px-3 py-3 font-mono text-[11px] text-[#091413]/50">
                            {ref}
                          </td>
                          <td className="px-3 py-3 text-right font-mono text-[#091413]/80">
                            {totalQty}
                          </td>
                          <td className="px-3 py-3 text-right font-mono text-[#091413]/50">
                            {discountVal > 0
                              ? `-${formatMoney(discountVal, settings.currencySymbol)}`
                              : '—'}
                          </td>
                          <td className="px-3 py-3 text-right font-mono font-bold text-[#091413]">
                            {formatMoney(totalVal, settings.currencySymbol)}
                          </td>
                          <td className="py-3 pl-3 pr-4 text-center">
                            <button
                              type="button"
                              onClick={() => setSelectedSale(sale)}
                              className="inline-flex items-center gap-1 rounded-md border border-[#091413]/15 bg-white px-2 py-1 text-[11px] font-medium text-[#091413]/70 transition-colors hover:border-[#285A48]/40 hover:text-[#285A48]"
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
        </div>
      </div>

      {/* Inspection Modal */}
      {selectedSale && (
        <Modal
          title={`Invoice #${selectedSale.invoiceNumber}`}
          onClose={() => setSelectedSale(null)}
          footer={
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="secondary" onClick={() => setSelectedSale(null)}>
                Close
              </Button>
              <button
                type="button"
                onClick={() => void printReceipt()}
                disabled={isPrinting}
                className="inline-flex items-center justify-center rounded-lg bg-[#285A48] px-4 py-2 text-xs font-medium text-white shadow-xs transition-colors hover:bg-[#1e4537] disabled:opacity-50"
              >
                {isPrinting ? (
                  'Printing…'
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    <PrinterIcon size={14} />
                    <span>{lastPrintError ? 'Retry print' : 'Print receipt'}</span>
                  </span>
                )}
              </button>
            </div>
          }
        >
          <div className="space-y-3 text-xs">
            <div className="space-y-1 border-b border-[#091413]/10 pb-3 text-center">
              {settings.showLogoOnReceipt && (
                <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-[#285A48] font-mono text-sm font-bold text-white shadow-xs">
                  {settings.storeName?.slice(0, 1).toUpperCase() || 'S'}
                </div>
              )}
              <h3 className="text-sm font-bold text-[#091413]">
                {settings.storeName || 'Store'}
              </h3>
              {(settings.phone || settings.email || settings.address) && (
                <div className="space-y-0.5 text-[11px] text-[#091413]/50">
                  {settings.address && <p>{settings.address}</p>}
                  {settings.phone && <p>{settings.phone}</p>}
                  {settings.email && <p>{settings.email}</p>}
                </div>
              )}
              <p className="pt-1 font-mono text-[11px] text-[#091413]/40">
                Date:{' '}
                {selectedSale.createdAt
                  ? new Date(selectedSale.createdAt).toLocaleString()
                  : '—'}
              </p>
            </div>

            <div className="divide-y divide-[#091413]/5 py-1">
              {selectedSale.items?.map((item, idx) => {
                const itemAny = item as any
                const unitPrice = Number(itemAny.unitPrice ?? itemAny.price ?? 0)
                const lineTotal =
                  item.lineTotal != null
                    ? Number(item.lineTotal)
                    : (Number(item.quantity) || 1) * unitPrice

                return (
                  <div
                    key={item.productId || idx}
                    className="flex justify-between py-1.5"
                  >
                    <span className="text-[#091413]/80">
                      {item.productName}{' '}
                      <span className="text-[#091413]/40">
                        × {item.quantity || 1}
                      </span>
                    </span>
                    <span className="font-mono font-medium text-[#091413]">
                      {formatMoney(lineTotal, settings.currencySymbol)}
                    </span>
                  </div>
                )
              })}
            </div>

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

            <div className="space-y-1 rounded-lg bg-[#091413]/[0.03] p-2.5 text-[11px] text-[#091413]/60">
              <div className="flex justify-between">
                <span>Payment Method</span>
                <span className="font-medium text-[#091413]">
                  {getPaymentLabel(selectedSale.paymentMethod)}
                </span>
              </div>
              {(selectedSale.reference || selectedSale.paymentReference) && (
                <div className="flex justify-between">
                  <span>Reference</span>
                  <span className="font-mono text-[#091413]">
                    {selectedSale.reference ?? selectedSale.paymentReference}
                  </span>
                </div>
              )}
              {selectedSale.amountReceived != null && (
                <div className="flex justify-between">
                  <span>Amount Tendered</span>
                  <span className="font-mono text-[#091413]">
                    {formatMoney(
                      Number(selectedSale.amountReceived),
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

export { ReportsPage as Reports }
export default ReportsPage

/* ===============================================================
   SVG ICONS
   =============================================================== */

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
      <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" />
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

function PercentIcon({ size = 14 }: { size?: number }) {
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
      <line x1="19" y1="5" x2="5" y2="19" />
      <circle cx="6.5" cy="6.5" r="2.5" />
      <circle cx="17.5" cy="17.5" r="2.5" />
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