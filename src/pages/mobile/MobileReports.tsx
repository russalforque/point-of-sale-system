import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faArrowTrendUp, faPercent, faReceipt } from '@fortawesome/free-solid-svg-icons'

import { salesApi } from '../../api/salesApi'

import { BarChart3 } from '../../components/ui/Icons'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { MobileEmpty, MobileError, StickyToolbar } from '../../components/ui/MobileStates'

import { useSettings } from '../../context/SettingsContext'
import { useToast } from '../../context/ToastContext'
import { useReceiptPrinter } from '../../hooks/useReceiptPrinter'
import { printerErrorMessage } from '../../services/printer'

import type { Sale } from '../../types'
import { getErrorMessage } from '../../utils/errors'
import { formatMoney } from '../../utils/format'
import { PAYMENT_OPTIONS } from '../../utils/pos'

type DateRangeFilter = 'today' | 'yesterday' | '7days' | '30days' | 'all'

export function MobileReports() {
  const { notify } = useToast()
  const { settings } = useSettings()
  const { printReceipt: sendReceiptToPrinter, isPrinting, lastPrintError } = useReceiptPrinter()

  const [sales, setSales] = useState<Sale[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [rangeFilter, setRangeFilter] = useState<DateRangeFilter>('7days')
  const [methodFilter, setMethodFilter] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null)

  function resolvePaymentMethod(methodValue: unknown): { value: string; label: string } {
    if (methodValue === null || methodValue === undefined) return { value: 'other', label: 'Other' }
    const raw = String(methodValue).trim()
    const normalized = raw.toLowerCase()
    const found = PAYMENT_OPTIONS.find(
      (option) => String(option.value).toLowerCase() === normalized || option.label.toLowerCase() === normalized,
    )
    if (found) return { value: String(found.value), label: found.label }
    return { value: normalized, label: raw }
  }

  function getPaymentLabel(methodValue: unknown): string {
    return resolvePaymentMethod(methodValue).label
  }

  async function loadSales() {
    try {
      setLoading(true)
      setError(null)

      const firstResponse = await salesApi.list({ page: 1, pageSize: 100 })
      const firstItems = Array.isArray(firstResponse?.items) ? firstResponse.items : []
      const totalPages =
        Number(firstResponse?.totalPages) || Math.ceil(Number(firstResponse?.totalCount || firstItems.length) / 100) || 1

      if (totalPages <= 1) {
        setSales(firstItems)
        return
      }

      const pageNumbers = Array.from({ length: totalPages - 1 }, (_, index) => index + 2)
      const remainingResponses = await Promise.all(pageNumbers.map((page) => salesApi.list({ page, pageSize: 100 })))
      const remainingItems = remainingResponses.flatMap((response) => (Array.isArray(response?.items) ? response.items : []))

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function matchesDateRange(createdAt: string | number | Date | undefined, filter: DateRangeFilter): boolean {
    if (filter === 'all') return true
    if (!createdAt) return false
    const date = new Date(createdAt)
    if (Number.isNaN(date.getTime())) return false

    const now = new Date()
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
    const startOfTomorrow = new Date(startOfToday)
    startOfTomorrow.setDate(startOfTomorrow.getDate() + 1)
    const startOfYesterday = new Date(startOfToday)
    startOfYesterday.setDate(startOfYesterday.getDate() - 1)

    if (filter === 'today') return date >= startOfToday && date < startOfTomorrow
    if (filter === 'yesterday') return date >= startOfYesterday && date < startOfToday
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
    return true
  }

  const filteredSales = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return sales.filter((sale) => {
      if (!matchesDateRange(sale.createdAt, rangeFilter)) return false
      if (methodFilter !== 'all') {
        const resolved = resolvePaymentMethod(sale.paymentMethod)
        if (resolved.value !== methodFilter) return false
      }
      if (query) {
        const invoiceMatch = sale.invoiceNumber?.toLowerCase().includes(query) ?? false
        const customerMatch = sale.customerName?.toLowerCase().includes(query) ?? false
        if (!invoiceMatch && !customerMatch) return false
      }
      return true
    })
  }, [sales, rangeFilter, methodFilter, searchQuery])

  const metrics = useMemo(() => {
    let totalRevenue = 0
    let totalDiscount = 0
    let totalTax = 0
    let totalItemsSold = 0

    for (const sale of filteredSales) {
      const saleTotal = Number(sale.total) || 0
      totalRevenue += saleTotal
      totalDiscount += Number(sale.discount) || 0
      totalTax += Number(sale.tax) || 0
      totalItemsSold += sale.items?.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0) ?? 0
    }

    const transactionCount = filteredSales.length
    const averageOrderValue = transactionCount > 0 ? totalRevenue / transactionCount : 0

    return { totalRevenue, totalDiscount, totalTax, totalItemsSold, transactionCount, averageOrderValue }
  }, [filteredSales])

  const hasActiveFilters = rangeFilter !== '7days' || methodFilter !== 'all' || searchQuery.trim() !== ''

  function resetFilters() {
    setRangeFilter('7days')
    setMethodFilter('all')
    setSearchQuery('')
  }

  async function printReceipt() {
    if (!selectedSale) return
    try {
      await sendReceiptToPrinter(selectedSale, settings)
      notify('Receipt printed successfully.')
    } catch (err) {
      notify(printerErrorMessage(err), 'error')
    }
  }

  return (
    <div className="min-h-screen bg-[#F6F8F7] pb-28 pt-[max(0.75rem,env(safe-area-inset-top,0px))] text-[#091413] antialiased">
      <main className="mx-auto w-full max-w-2xl px-4 sm:px-6">
        <header className="flex items-center justify-between gap-3 pb-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-black tracking-tight text-[#091413]">Sales Report</h1>
            <p className="mt-0.5 text-xs text-slate-500">Revenue &amp; transaction breakdown</p>
          </div>
          <button
            type="button"
            onClick={() => void loadSales()}
            disabled={loading}
            aria-label="Refresh"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[#E5EBE7] bg-white text-[#285A48] active:scale-95 touch-manipulation disabled:opacity-50"
          >
            <RefreshIcon size={18} className={loading ? 'animate-spin' : ''} />
          </button>
        </header>

        <StickyToolbar>
          {/* Date range chips */}
          <div className="mt-2 flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
            {[
              { label: 'Today', value: 'today' },
              { label: 'Yesterday', value: 'yesterday' },
              { label: 'Last 7 Days', value: '7days' },
              { label: 'Last 30 Days', value: '30days' },
              { label: 'All Time', value: 'all' },
            ].map((tab) => (
              <button
                key={tab.value}
                type="button"
                onClick={() => setRangeFilter(tab.value as DateRangeFilter)}
                className={`shrink-0 rounded-full px-4 py-2 text-xs font-bold transition-all active:scale-95 touch-manipulation ${
                  rangeFilter === tab.value ? 'bg-[#091413] text-white shadow-xs' : 'border border-[#E5EBE7] bg-white text-slate-600'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Search + payment filter */}
          <div className="mt-2.5 space-y-2.5">
            <div className="relative">
              <SearchIcon size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search invoice or customer..."
                className="h-12 w-full rounded-2xl border border-[#E5EBE7] bg-white pl-10 pr-9 text-sm font-medium text-[#091413] placeholder-slate-400 shadow-2xs outline-none transition focus:border-[#285A48] focus:ring-2 focus:ring-[#285A48]/15"
              />
            </div>
            <select
              value={methodFilter}
              onChange={(e) => setMethodFilter(e.target.value)}
              className="h-12 w-full rounded-2xl border border-[#E5EBE7] bg-white px-3.5 text-sm font-medium text-[#091413] outline-none focus:border-[#285A48] focus:ring-2 focus:ring-[#285A48]/15"
            >
              <option value="all">All Payment Methods</option>
              {PAYMENT_OPTIONS.map((option) => (
                <option key={option.value} value={String(option.value)}>
                  {option.label}
                </option>
              ))}
            </select>
            {hasActiveFilters && (
              <button type="button" onClick={resetFilters} className="text-xs font-bold text-[#285A48]">
                Reset filters
              </button>
            )}
          </div>
        </StickyToolbar>

        {error && <div className="mt-2"><MobileError message={error} onRetry={() => void loadSales()} /></div>}

        {/* Metrics */}
        <section className="mt-4 grid grid-cols-2 gap-2.5">
          <MetricTile
            icon={<FontAwesomeIcon icon={faArrowTrendUp} style={{ width: 14, height: 14 }} />}
            label="Total Revenue"
            value={formatMoney(metrics.totalRevenue, settings.currencySymbol)}
          />
          <MetricTile
            icon={<FontAwesomeIcon icon={faReceipt} style={{ width: 14, height: 14 }} />}
            label="Transactions"
            value={String(metrics.transactionCount)}
            sub={`${metrics.totalItemsSold} items sold`}
          />
          <MetricTile
            icon={<BarChart3 size={14} />}
            label="Avg. Order"
            value={formatMoney(metrics.averageOrderValue, settings.currencySymbol)}
          />
          <MetricTile
            icon={<FontAwesomeIcon icon={faPercent} style={{ width: 14, height: 14 }} />}
            label="Discounts"
            value={formatMoney(metrics.totalDiscount, settings.currencySymbol)}
            sub={`Tax: ${formatMoney(metrics.totalTax, settings.currencySymbol)}`}
          />
        </section>

        {/* Sales list */}
        <section className="mt-4">
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">
            {filteredSales.length} record{filteredSales.length !== 1 ? 's' : ''}
          </h2>

          {loading ? (
            <div className="flex flex-col items-center justify-center rounded-3xl border border-[#E5EBE7] bg-white py-16 text-center shadow-xs">
              <RefreshIcon size={20} className="animate-spin text-[#285A48]" />
              <p className="mt-2 text-xs text-slate-500">Loading sales records...</p>
            </div>
          ) : filteredSales.length === 0 ? (
            <MobileEmpty
              icon={<FontAwesomeIcon icon={faReceipt} style={{ width: 22, height: 22 }} />}
              title="No transactions match your criteria"
              hint="Try adjusting the date range, payment method, or search query."
              action={
                hasActiveFilters ? (
                  <Button variant="secondary" onClick={resetFilters} className="min-h-12 w-full text-sm">
                    Reset all filters
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="space-y-3">
              {filteredSales.map((sale) => {
                const totalQty = sale.items?.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0) ?? 0
                const totalValue = Number(sale.total) || 0

                return (
                  <button
                    key={sale.id}
                    type="button"
                    onClick={() => setSelectedSale(sale)}
                    className="w-full rounded-3xl border border-[#E5EBE7] bg-white p-4 text-left shadow-xs active:scale-[0.99] touch-manipulation"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-mono text-sm font-bold text-[#091413]">#{sale.invoiceNumber}</p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {sale.createdAt
                            ? new Date(sale.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                            : '—'}
                        </p>
                      </div>
                      <span className="shrink-0 font-mono text-base font-black text-[#091413]">
                        {formatMoney(totalValue, settings.currencySymbol)}
                      </span>
                    </div>

                    <div className="mt-2.5 flex items-center justify-between border-t border-slate-100 pt-2.5 text-xs">
                      <span className="text-slate-500 truncate max-w-40">{sale.customerName || 'Walk-in Customer'}</span>
                      <div className="flex items-center gap-2">
                        <span className="rounded-md border border-[#E5EBE7] bg-[#F6F8F7] px-2 py-0.5 font-medium text-slate-600">
                          {getPaymentLabel(sale.paymentMethod)}
                        </span>
                        <span className="font-mono text-slate-400">{totalQty} items</span>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </section>
      </main>

      {selectedSale && (
        <Modal
          title={`Invoice #${selectedSale.invoiceNumber}`}
          onClose={() => setSelectedSale(null)}
          footer={
            <div className="flex flex-col-reverse gap-2 w-full">
              <Button variant="secondary" onClick={() => setSelectedSale(null)} className="min-h-12 text-sm">
                Close
              </Button>
              <Button onClick={() => void printReceipt()} disabled={isPrinting} className="min-h-12 text-sm">
                {isPrinting ? 'Printing...' : lastPrintError ? 'Retry Print' : 'Reprint Receipt'}
              </Button>
            </div>
          }
        >
          <div className="space-y-3 text-sm">
            <div className="space-y-1 border-b border-[#091413]/10 pb-3 text-center">
              {settings.showLogoOnReceipt && (
                <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-[#285A48] font-mono text-sm font-bold text-white shadow-xs">
                  {settings.storeName?.slice(0, 1).toUpperCase() || 'S'}
                </div>
              )}
              <h3 className="text-sm font-bold text-[#091413]">{settings.storeName || 'Store'}</h3>
              <p className="pt-1 font-mono text-[11px] text-[#091413]/40">
                {selectedSale.createdAt ? new Date(selectedSale.createdAt).toLocaleString() : '—'}
              </p>
            </div>

            <div className="divide-y divide-[#091413]/5 py-1">
              {selectedSale.items?.map((item, index) => {
                const unitPrice = Number(item.unitPrice) || 0
                const quantity = Number(item.quantity) || 0
                const lineTotal = Number(item.lineTotal) || unitPrice * quantity

                return (
                  <div key={`${item.productId}-${index}`} className="flex justify-between py-1.5">
                    <span className="text-[#091413]/80">
                      {item.productName} <span className="text-[#091413]/40">× {quantity}</span>
                    </span>
                    <span className="font-mono font-medium text-[#091413]">{formatMoney(lineTotal, settings.currencySymbol)}</span>
                  </div>
                )
              })}
            </div>

            <div className="flex justify-between border-t border-[#091413]/10 pt-2 font-semibold text-[#091413]">
              <span>Total</span>
              <span className="font-mono text-[#285A48]">{formatMoney(Number(selectedSale.total) || 0, settings.currencySymbol)}</span>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

function MetricTile({
  label,
  value,
  sub,
  icon,
}: {
  label: string
  value: string
  sub?: string
  icon?: ReactNode
}) {
  return (
    <div className="rounded-2xl border border-[#E5EBE7] bg-white p-3.5 shadow-xs">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
        {icon && (
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[#EAF1EE] text-[#285A48]">
            {icon}
          </span>
        )}
      </div>
      <p className="mt-1.5 font-mono text-lg font-black tracking-tight text-[#091413]">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>}
    </div>
  )
}

function RefreshIcon({ size = 14, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  )
}

function SearchIcon({ size = 14, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}

export default MobileReports
