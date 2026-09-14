import { useState } from 'react'

import { inventoryApi } from '../../api/inventoryApi'

import {
  Badge,
  stockTone,
} from '../../components/ui/Badge'

import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { Pagination } from '../../components/ui/Pagination'

import {
  EmptyState,
  ErrorState,
  Spinner,
} from '../../components/ui/States'

import { useToast } from '../../context/ToastContext'
import { useAsync } from '../../hooks/useAsync'
import type { InventoryItem } from '../../types'
import { getErrorMessage } from '../../utils/errors'
import { formatDateTime } from '../../utils/format'

type StockFilter = '' | 'In Stock' | 'Low Stock' | 'Out of Stock'

interface HistoryRow {
  id: string | number
  createdAt: string | Date
  productName: string
  type: string
  quantityChange: number
  quantityAfter: number
  reason?: string | null
}

const safeFormatDateTime = (date: string | Date | null | undefined): string => {
  if (!date) return ''
  const val = date instanceof Date ? date.toISOString() : String(date)
  return formatDateTime(val)
}

export function MobileInventory() {
  const { notify } = useToast()

  const [search, setSearch] = useState('')
  const [stock, setStock] = useState<StockFilter>('')
  const [page, setPage] = useState(1)
  const [historyPage, setHistoryPage] = useState(1)

  const [adjust, setAdjust] = useState<InventoryItem | null>(null)
  const [type, setType] = useState<number>(1) // 1: Increase (+), 2: Decrease (-), 3: Count Correction (=)
  const [quantity, setQuantity] = useState(5)
  const [reason, setReason] = useState('')

  const [busy, setBusy] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  const list = useAsync(
    () =>
      inventoryApi.list({
        search: search.trim() || undefined,
        stockStatus: stock || undefined,
        page,
        pageSize: 10,
      }),
    [search, stock, page],
  )

  const history = useAsync(
    () =>
      showHistory
        ? inventoryApi.history({
            page: historyPage,
            pageSize: 10,
          })
        : Promise.resolve(null),
    [historyPage, showHistory],
  )

  const items: InventoryItem[] = list.data?.items ?? []
  const totalCount = list.data?.totalCount ?? items.length
  const inStockCount = items.filter((item) => item.stockStatus === 'In Stock').length
  const lowStockCount = items.filter((item) => item.stockStatus === 'Low Stock').length
  const outOfStockCount = items.filter((item) => item.stockStatus === 'Out of Stock').length

  const historyItems: HistoryRow[] = (history.data?.items as HistoryRow[]) ?? []
  const hasActiveFilters = search.trim() !== '' || stock !== ''

  function handleFilterStatus(status: StockFilter) {
    setStock((prev) => (prev === status ? '' : status))
    setPage(1)
  }

  function resetFilters() {
    setSearch('')
    setStock('')
    setPage(1)
  }

  async function submitAdjust() {
    if (!adjust) return

    setBusy(true)

    try {
      await inventoryApi.adjust({
        productId: adjust.productId,
        type,
        quantity,
        reason: reason.trim(),
      })

      notify('Stock count updated successfully.')
      setAdjust(null)
      setReason('')
      setQuantity(5)

      await list.reload()
      if (showHistory) {
        await history.reload()
      }
    } catch (err) {
      notify(getErrorMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  // Live preview calculations for Adjustment Sheet
  const projectedStock = adjust
    ? type === 1
      ? adjust.stockQuantity + quantity
      : type === 2
      ? Math.max(0, adjust.stockQuantity - quantity)
      : quantity
    : 0

  return (
    <div className="min-h-screen bg-[#F6F8F7] text-[#091413] pb-32 pt-[max(1rem,env(safe-area-inset-top,0px))] font-sans antialiased selection:bg-[#285A48] selection:text-white">
      <main className="mx-auto w-full max-w-md px-4 sm:px-6">

        {/* =========================================================
            HEADER BAR
        ========================================================= */}
        <header className="flex items-start justify-between gap-3 pb-2 pt-1">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-[#091413]">
              Inventory
            </h1>
            <p className="mt-0.5 text-xs text-slate-500">
              Track stock levels and product availability
            </p>
          </div>

          <button
            type="button"
            onClick={() => setShowHistory(true)}
            aria-label="View Movement History Logs"
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-[#E5EBE7] bg-white px-3.5 text-xs font-semibold text-[#091413] shadow-xs transition hover:bg-[#EAF1EE] hover:text-[#285A48] active:scale-95 touch-manipulation"
          >
            <HistoryIcon size={14} />
            <span>History</span>
          </button>
        </header>

        {/* =========================================================
            KPI METRIC SUMMARY CARDS (MATCHING DESIGN LAYOUT)
        ========================================================= */}
        <section aria-label="Stock Metrics" className="mt-3">
          <div className="grid grid-cols-4 gap-2">
            {/* TOTAL */}
            <button
              type="button"
              onClick={() => handleFilterStatus('')}
              className={`flex flex-col items-center justify-center rounded-2xl border py-2.5 px-1 text-center transition-all active:scale-95 touch-manipulation ${
                stock === ''
                  ? 'border-[#285A48] bg-white shadow-xs ring-1 ring-[#285A48]'
                  : 'border-[#E5EBE7] bg-white hover:bg-slate-50'
              }`}
            >
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Total
              </span>
              <span className="mt-1 text-xl font-black tabular-nums text-[#091413]">
                {totalCount}
              </span>
            </button>

            {/* IN STOCK */}
            <button
              type="button"
              onClick={() => handleFilterStatus('In Stock')}
              className={`flex flex-col items-center justify-center rounded-2xl border py-2.5 px-1 text-center transition-all active:scale-95 touch-manipulation ${
                stock === 'In Stock'
                  ? 'border-[#285A48] bg-[#EAF1EE]/40 shadow-xs ring-1 ring-[#285A48]'
                  : 'border-[#E5EBE7] bg-white hover:bg-emerald-50/40'
              }`}
            >
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#285A48]">
                In Stock
              </span>
              <span className="mt-1 text-xl font-black tabular-nums text-[#285A48]">
                {inStockCount}
              </span>
            </button>

            {/* LOW */}
            <button
              type="button"
              onClick={() => handleFilterStatus('Low Stock')}
              className={`flex flex-col items-center justify-center rounded-2xl border py-2.5 px-1 text-center transition-all active:scale-95 touch-manipulation ${
                stock === 'Low Stock'
                  ? 'border-amber-500 bg-amber-50/50 shadow-xs ring-1 ring-amber-500'
                  : 'border-[#E5EBE7] bg-white hover:bg-amber-50/30'
              }`}
            >
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600">
                Low
              </span>
              <span className="mt-1 text-xl font-black tabular-nums text-amber-600">
                {lowStockCount}
              </span>
            </button>

            {/* OUT */}
            <button
              type="button"
              onClick={() => handleFilterStatus('Out of Stock')}
              className={`flex flex-col items-center justify-center rounded-2xl border py-2.5 px-1 text-center transition-all active:scale-95 touch-manipulation ${
                stock === 'Out of Stock'
                  ? 'border-rose-500 bg-rose-50/50 shadow-xs ring-1 ring-rose-500'
                  : 'border-[#E5EBE7] bg-white hover:bg-rose-50/30'
              }`}
            >
              <span className="text-[10px] font-bold uppercase tracking-wider text-rose-600">
                Out
              </span>
              <span className="mt-1 text-xl font-black tabular-nums text-rose-600">
                {outOfStockCount}
              </span>
            </button>
          </div>
        </section>

        {/* =========================================================
            SEARCH FIELD
        ========================================================= */}
        <section aria-label="Search" className="mt-3.5">
          <div className="relative">
            <SearchIcon
              size={17}
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              type="search"
              aria-label="Search products or SKU"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
              placeholder="Search products or SKU"
              className="h-11 w-full rounded-2xl border border-[#E5EBE7] bg-white pl-10 pr-9 text-xs font-semibold text-[#091413] placeholder-slate-400 shadow-2xs outline-none transition focus:border-[#285A48] focus:ring-2 focus:ring-[#285A48]/15"
            />
            {search && (
              <button
                type="button"
                onClick={() => {
                  setSearch('')
                  setPage(1)
                }}
                aria-label="Clear search input"
                className="absolute right-2.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <ClearIcon size={13} />
              </button>
            )}
          </div>
        </section>

        {/* =========================================================
            FILTER CHIPS RAIL / ACTIVE BADGES
        ========================================================= */}
        <section aria-label="Stock Filter Pills" className="mt-3">
          {/* Default filter pill row when not actively searching */}
          {!search.trim() ? (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
              {(
                [
                  { key: '', label: 'All' },
                  { key: 'In Stock', label: 'In Stock' },
                  { key: 'Low Stock', label: 'Low Stock' },
                  { key: 'Out of Stock', label: 'Out of Stock' },
                ] as const
              ).map((tab) => {
                const isActive = stock === tab.key
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => handleFilterStatus(tab.key)}
                    className={`inline-flex h-8 shrink-0 items-center justify-center rounded-full px-4 text-xs font-bold transition-all active:scale-95 touch-manipulation ${
                      isActive
                        ? 'bg-[#091413] text-white shadow-xs'
                        : 'border border-[#E5EBE7] bg-white text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    {tab.label}
                  </button>
                )
              })}
            </div>
          ) : (
            /* Active search and filter chips indicator strip */
            <div className="flex items-center justify-between gap-2 pt-0.5">
              <div className="flex flex-wrap items-center gap-1.5">
                {stock && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[#285A48] px-3 py-1 text-[11px] font-bold text-white shadow-2xs">
                    <span>{stock}</span>
                    <button
                      type="button"
                      onClick={() => handleFilterStatus('')}
                      aria-label={`Clear ${stock} filter`}
                      className="hover:opacity-80"
                    >
                      ×
                    </button>
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-200/80 px-3 py-1 text-[11px] font-bold text-[#091413]">
                  <span>&ldquo;{search.trim()}&rdquo;</span>
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    aria-label="Clear search"
                    className="hover:opacity-80"
                  >
                    ×
                  </button>
                </span>
              </div>

              <button
                type="button"
                onClick={resetFilters}
                className="shrink-0 text-xs font-bold text-[#285A48] hover:underline"
              >
                Clear all
              </button>
            </div>
          )}
        </section>

        {/* =========================================================
            INVENTORY CARDS LIST / LOADING / ERROR / EMPTY STATES
        ========================================================= */}
        <section aria-label="Product Inventory List" className="mt-4">
          {/* Loading State (from screenshot) */}
          {list.loading && (
            <div className="flex flex-col items-center justify-center rounded-3xl border border-[#E5EBE7] bg-white py-20 text-center shadow-xs">
              <Spinner />
              <h3 className="mt-4 text-sm font-bold text-[#091413]">
                Loading inventory...
              </h3>
              <p className="mt-1 text-xs text-slate-400">
                Please wait a moment
              </p>
            </div>
          )}

          {/* Error State (from screenshot) */}
          {!list.loading && list.error && (
            <div className="flex flex-col items-center justify-center rounded-3xl border border-[#E5EBE7] bg-white p-8 text-center shadow-xs">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-rose-50 text-rose-500">
                <ExclamationIcon size={26} />
              </div>
              <h3 className="mt-4 text-sm font-bold text-[#091413]">
                Unable to load inventory
              </h3>
              <p className="mt-1.5 max-w-xs text-xs text-slate-500">
                {list.error || 'Something went wrong. Please check your connection and try again.'}
              </p>
              <button
                type="button"
                onClick={() => void list.reload()}
                className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-2xl bg-rose-600 px-4 text-xs font-bold text-white shadow-xs transition hover:bg-rose-700 active:scale-98"
              >
                Try Again
              </button>
            </div>
          )}

          {/* Empty State (from screenshot) */}
          {!list.loading && !list.error && items.length === 0 && (
            <div className="flex flex-col items-center justify-center rounded-3xl border border-[#E5EBE7] bg-white p-8 text-center shadow-xs">
              <div className="flex h-24 w-24 items-center justify-center">
                <EmptyBoxIllustration />
              </div>
              <h3 className="mt-2 text-base font-extrabold text-[#091413]">
                No products found
              </h3>
              <p className="mt-1 max-w-xs text-xs text-slate-400 leading-relaxed">
                Try adjusting your search or filters to find what you&apos;re looking for.
              </p>
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-2xl border border-[#E5EBE7] bg-white px-5 text-xs font-bold text-[#091413] shadow-xs transition hover:bg-[#F6F8F7] active:scale-98"
                >
                  Clear filters
                </button>
              )}
            </div>
          )}

          {/* List Cards */}
          {!list.loading && !list.error && items.length > 0 && (
            <div className="space-y-3">
              {items.map((row) => {
                const isDepleted = row.stockQuantity <= 0
                const isLow = row.stockStatus === 'Low Stock'

                const percentage =
                  row.reorderLevel > 0
                    ? Math.min(100, Math.round((row.stockQuantity / row.reorderLevel) * 100))
                    : isDepleted
                    ? 0
                    : 100

                return (
                  <article
                    key={row.productId}
                    className="rounded-3xl border border-[#E5EBE7] bg-white p-4 shadow-xs transition hover:border-slate-300"
                  >
                    {/* Top Row: Thumbnail + Info + Status Badge */}
                    <div className="flex items-start gap-3">
                      {/* Product Thumbnail / Icon */}
                      <div className="flex h-13 w-13 shrink-0 items-center justify-center rounded-2xl border border-[#E5EBE7] bg-[#F6F8F7] overflow-hidden text-[#285A48]">
                        {(row as unknown as { imageUrl?: string; image?: string }).imageUrl ||
                        (row as unknown as { imageUrl?: string; image?: string }).image ? (
                          <img
                            src={
                              (row as unknown as { imageUrl?: string; image?: string }).imageUrl ||
                              (row as unknown as { imageUrl?: string; image?: string }).image
                            }
                            alt={row.productName}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <PackageIllustration isDepleted={isDepleted} />
                        )}
                      </div>

                      {/* Title & SKU */}
                      <div className="min-w-0 flex-1">
                        <h2 className="text-sm font-black text-[#091413] leading-snug truncate">
                          {row.productName}
                        </h2>
                        <p className="mt-0.5 font-mono text-[11px] text-slate-400">
                          SKU: {row.sku}
                        </p>
                      </div>

                      {/* Pill Badge */}
                      <div className="shrink-0">
                        <CustomStockBadge status={row.stockStatus} />
                      </div>
                    </div>

                    {/* Stock Counts Row */}
                    <div className="mt-3 flex items-baseline justify-between">
                      <div className="flex items-baseline gap-1.5">
                        <span
                          className={`text-2xl font-black tabular-nums tracking-tight ${
                            isDepleted
                              ? 'text-rose-600'
                              : isLow
                              ? 'text-[#091413]'
                              : 'text-[#091413]'
                          }`}
                        >
                          {row.stockQuantity}
                        </span>
                        <span className="text-xs font-semibold text-slate-400">
                          in stock
                        </span>
                      </div>

                      <div className="text-xs font-semibold text-slate-400">
                        Par level: <span className="font-bold text-slate-700">{row.reorderLevel}</span>
                      </div>
                    </div>

                    {/* Gauge Bar with percentage label */}
                    <div className="mt-2 flex items-center gap-2.5">
                      <div
                        className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100"
                        role="progressbar"
                        aria-valuenow={row.stockQuantity}
                        aria-valuemin={0}
                        aria-valuemax={row.reorderLevel}
                      >
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${
                            isDepleted
                              ? 'bg-rose-500 w-0'
                              : isLow
                              ? 'bg-amber-500'
                              : 'bg-[#285A48]'
                          }`}
                          style={{ width: `${isDepleted ? 0 : Math.max(8, percentage)}%` }}
                        />
                      </div>
                      <span className="text-[10px] font-bold tabular-nums text-slate-400 shrink-0">
                        {percentage}%
                      </span>
                    </div>

                    {/* Card Footer: Timestamp & Adjust Button */}
                    <div className="mt-3.5 flex items-center justify-between border-t border-slate-100 pt-3">
                      <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                        <ClockIcon size={13} />
                        <span>Updated {safeFormatDateTime(row.lastUpdated)}</span>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setAdjust(row)
                          setType(1)
                          setQuantity(5)
                          setReason('')
                        }}
                        className="inline-flex h-8 items-center justify-center rounded-full border border-[#E5EBE7] bg-white px-4 text-xs font-bold text-[#091413] shadow-2xs transition hover:border-[#285A48] hover:bg-[#EAF1EE] hover:text-[#285A48] active:scale-95 touch-manipulation"
                      >
                        Adjust
                      </button>
                    </div>
                  </article>
                )
              })}

              {/* Pagination */}
              <div className="pt-2">
                <Pagination
                  page={list.data?.page ?? 1}
                  totalPages={list.data?.totalPages ?? 1}
                  onPage={setPage}
                />
              </div>
            </div>
          )}
        </section>

      </main>

      {/* =========================================================
          ADJUST STOCK MODAL / BOTTOM SHEET (MATCHING SCREENSHOT)
      ========================================================= */}
      {adjust && (
        <Modal
          title="Adjust Stock"
          onClose={() => {
            if (!busy) setAdjust(null)
          }}
          preventClose={busy}
        >
          <div className="space-y-4 text-xs pb-1">
            {/* Selected Product Hero Card */}
            <div className="flex items-center gap-3 rounded-2xl border border-[#E5EBE7] bg-[#F6F8F7] p-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[#E5EBE7] bg-white text-[#285A48]">
                <PackageIllustration isDepleted={adjust.stockQuantity <= 0} />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="font-extrabold text-sm text-[#091413] leading-snug truncate">
                  {adjust.productName}
                </h3>
                <p className="mt-0.5 font-mono text-[11px] text-slate-400">
                  SKU: {adjust.sku}
                </p>
              </div>
            </div>

            {/* Current Stock vs Par Level Card */}
            <div className="grid grid-cols-2 gap-3 rounded-2xl border border-[#E5EBE7] bg-white p-3.5 shadow-2xs">
              <div>
                <span className="block text-[11px] font-semibold text-slate-400">
                  Current Stock
                </span>
                <div className="mt-1 flex items-baseline gap-1">
                  <span className="text-2xl font-black text-[#091413] tabular-nums">
                    {adjust.stockQuantity}
                  </span>
                  <span className="text-xs font-medium text-slate-400">units</span>
                </div>
              </div>

              <div className="border-l border-slate-100 pl-3.5">
                <span className="block text-[11px] font-semibold text-slate-400">
                  Par Level
                </span>
                <div className="mt-1">
                  <span className="text-2xl font-black text-[#091413] tabular-nums">
                    {adjust.reorderLevel}
                  </span>
                </div>
              </div>
            </div>

            {/* Adjustment Type Switcher */}
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-2">
                Adjustment Type
              </label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setType(1)}
                  aria-pressed={type === 1}
                  className={`flex h-12 flex-col items-center justify-center gap-0.5 rounded-2xl border text-xs font-bold transition-all active:scale-95 touch-manipulation ${
                    type === 1
                      ? 'border-[#285A48] bg-[#285A48] text-white shadow-xs'
                      : 'border-[#E5EBE7] bg-white text-slate-600 hover:bg-[#F6F8F7]'
                  }`}
                >
                  <PlusCircleIcon size={15} />
                  <span>Add Stock</span>
                </button>

                <button
                  type="button"
                  onClick={() => setType(2)}
                  aria-pressed={type === 2}
                  className={`flex h-12 flex-col items-center justify-center gap-0.5 rounded-2xl border text-xs font-bold transition-all active:scale-95 touch-manipulation ${
                    type === 2
                      ? 'border-rose-600 bg-rose-600 text-white shadow-xs'
                      : 'border-[#E5EBE7] bg-white text-slate-600 hover:bg-[#F6F8F7]'
                  }`}
                >
                  <MinusCircleIcon size={15} />
                  <span>Deduct</span>
                </button>

                <button
                  type="button"
                  onClick={() => setType(3)}
                  aria-pressed={type === 3}
                  className={`flex h-12 flex-col items-center justify-center gap-0.5 rounded-2xl border text-xs font-bold transition-all active:scale-95 touch-manipulation ${
                    type === 3
                      ? 'border-[#091413] bg-[#091413] text-white shadow-xs'
                      : 'border-[#E5EBE7] bg-white text-slate-600 hover:bg-[#F6F8F7]'
                  }`}
                >
                  <TargetCircleIcon size={15} />
                  <span>Set Count</span>
                </button>
              </div>
            </div>

            {/* Quantity Stepper */}
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-2">
                Quantity
              </label>
              <div className="flex items-center justify-between rounded-2xl border border-[#E5EBE7] bg-[#F6F8F7] p-2">
                <button
                  type="button"
                  onClick={() => setQuantity((prev) => Math.max(1, prev - 1))}
                  aria-label="Decrease quantity by 1"
                  className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-lg font-black text-[#091413] shadow-xs active:scale-95 touch-manipulation"
                >
                  –
                </button>
                <span className="text-2xl font-black tabular-nums text-[#091413]">
                  {quantity}
                </span>
                <button
                  type="button"
                  onClick={() => setQuantity((prev) => prev + 1)}
                  aria-label="Increase quantity by 1"
                  className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-lg font-black text-[#091413] shadow-xs active:scale-95 touch-manipulation"
                >
                  +
                </button>
              </div>
            </div>

            {/* Quick Add Presets */}
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1.5">
                Quick Add
              </label>
              <div className="flex gap-2">
                {[1, 5, 10, 25, 50].map((num) => (
                  <button
                    key={num}
                    type="button"
                    onClick={() => setQuantity(num)}
                    className={`flex-1 h-9 rounded-xl border text-xs font-bold transition active:scale-95 ${
                      quantity === num
                        ? 'border-[#091413] bg-[#091413] text-white shadow-xs'
                        : 'border-[#E5EBE7] bg-white text-slate-700 hover:bg-[#F6F8F7]'
                    }`}
                  >
                    {num}
                  </button>
                ))}
              </div>
            </div>

            {/* Projected Stock Preview Card */}
            <div className="rounded-2xl border border-[#E5EBE7] bg-[#F6F8F7] p-3">
              <span className="block text-[11px] font-bold text-slate-700">
                Projected Stock
              </span>
              <div className="mt-2 grid grid-cols-3 text-center">
                <div>
                  <span className="block text-[10px] font-semibold text-slate-400">Current</span>
                  <span className="text-base font-black text-[#091413]">{adjust.stockQuantity}</span>
                </div>
                <div>
                  <span className="block text-[10px] font-semibold text-slate-400">Adjustment</span>
                  <span
                    className={`text-base font-black ${
                      type === 2
                        ? 'text-rose-600'
                        : type === 1
                        ? 'text-[#285A48]'
                        : 'text-amber-600'
                    }`}
                  >
                    {type === 1 ? `+${quantity}` : type === 2 ? `-${quantity}` : `=${quantity}`}
                  </span>
                </div>
                <div>
                  <span className="block text-[10px] font-semibold text-slate-400">New Stock</span>
                  <span className="text-base font-black text-[#285A48]">{projectedStock}</span>
                </div>
              </div>
            </div>

            {/* Reason Text Input */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label
                  htmlFor="adjust-reason-input"
                  className="text-[11px] font-bold text-slate-700"
                >
                  Reason (optional)
                </label>
                <span className="text-[10px] text-slate-400 tabular-nums">
                  {reason.length}/200
                </span>
              </div>
              <input
                id="adjust-reason-input"
                type="text"
                maxLength={200}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Delivery, damaged items, stock count..."
                className="h-11 w-full rounded-2xl border border-[#E5EBE7] bg-white px-3.5 text-xs text-[#091413] placeholder-slate-400 shadow-2xs outline-none transition focus:border-[#285A48] focus:ring-2 focus:ring-[#285A48]/15"
              />
            </div>

            {/* Save Button CTA */}
            <div className="pt-2">
              <button
                type="button"
                onClick={() => void submitAdjust()}
                disabled={busy || quantity < 1}
                className="flex h-12 w-full items-center justify-center rounded-2xl bg-[#285A48] px-4 text-sm font-bold text-white shadow-xs transition hover:bg-[#1f4738] active:scale-98 disabled:opacity-50"
              >
                {busy ? 'Saving…' : 'Save Adjustment'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* =========================================================
          STOCK MOVEMENT HISTORY MODAL (MATCHING SCREENSHOT)
      ========================================================= */}
      {showHistory && (
        <Modal
          title="Stock Movement History"
          onClose={() => setShowHistory(false)}
        >
          {history.loading && (
            <div className="flex flex-col items-center justify-center py-14 text-center">
              <Spinner />
              <p className="mt-3 text-xs font-semibold text-slate-400">
                Loading history logs...
              </p>
            </div>
          )}

          {!history.loading && history.error && (
            <div className="p-4">
              <ErrorState
                message={history.error}
                onRetry={() => void history.reload()}
              />
            </div>
          )}

          {!history.loading && !history.error && historyItems.length === 0 && (
            <div className="py-10 text-center">
              <EmptyState title="No stock movement records" />
            </div>
          )}

          {!history.loading && !history.error && historyItems.length > 0 && (
            <div className="space-y-3">
              <div className="divide-y divide-slate-100 max-h-[60vh] overflow-y-auto overscroll-contain">
                {historyItems.map((row) => {
                  const isDeduction = row.quantityChange < 0
                  const isCorrection = row.type.toLowerCase().includes('count') || row.type.toLowerCase().includes('fix')

                  return (
                    <div key={row.id} className="flex items-center justify-between py-3.5 gap-3 text-xs">
                      {/* Left icon circle */}
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white font-bold text-sm ${
                            isDeduction
                              ? 'bg-rose-600'
                              : isCorrection
                              ? 'bg-amber-500'
                              : 'bg-[#285A48]'
                          }`}
                        >
                          {isDeduction ? '–' : isCorrection ? '◎' : '+'}
                        </div>

                        <div className="min-w-0 flex-1">
                          <p className="font-extrabold text-[#091413] leading-snug">
                            {row.type || (isDeduction ? 'Deducted' : isCorrection ? 'Set Count' : 'Added')}
                          </p>
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            Current Balance: <strong className="font-semibold text-[#091413]">{row.quantityAfter}</strong>
                          </p>
                          {row.reason && (
                            <p className="text-[11px] text-slate-400 truncate mt-0.5">
                              {row.reason}
                            </p>
                          )}
                          <p className="text-[10px] text-slate-400 mt-0.5">
                            {safeFormatDateTime(row.createdAt)}
                          </p>
                        </div>
                      </div>

                      {/* Right quantity change */}
                      <div className="flex items-center gap-2 shrink-0">
                        <span
                          className={`text-sm font-black tabular-nums ${
                            isDeduction
                              ? 'text-rose-600'
                              : isCorrection
                              ? 'text-amber-600'
                              : 'text-[#285A48]'
                          }`}
                        >
                          {row.quantityChange > 0 ? `+${row.quantityChange}` : row.quantityChange}
                        </span>
                        <span className="text-slate-300 font-bold">&rsaquo;</span>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* History Pagination */}
              <div className="pt-2 border-t border-slate-100">
                <Pagination
                  page={history.data?.page ?? 1}
                  totalPages={history.data?.totalPages ?? 1}
                  onPage={setHistoryPage}
                />
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  )
}

/* =============================================================
   CUSTOM BADGES & MICRO-COMPONENTS (MATCHING SCREENSHOT)
============================================================= */

function CustomStockBadge({ status }: { status: string }) {
  if (status === 'In Stock') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[#EAF1EE] px-2.5 py-0.5 text-[10px] font-bold text-[#285A48] border border-[#285A48]/15">
        <span>+</span>
        <span>In Stock</span>
      </span>
    )
  }

  if (status === 'Low Stock') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-[10px] font-bold text-amber-700 border border-amber-200">
        <span>⚡</span>
        <span>Low Stock</span>
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-0.5 text-[10px] font-bold text-rose-600 border border-rose-200">
      <span>◆</span>
      <span>Out of Stock</span>
    </span>
  )
}

function PackageIllustration({ isDepleted }: { isDepleted?: boolean }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={isDepleted ? 'text-slate-300' : 'text-[#285A48]'}
      aria-hidden="true"
    >
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5" />
      <path d="M12 22V12" />
    </svg>
  )
}

function EmptyBoxIllustration() {
  return (
    <svg width="84" height="84" viewBox="0 0 84 84" fill="none" aria-hidden="true">
      <rect x="18" y="26" width="48" height="38" rx="8" fill="#EAF1EE" stroke="#285A48" strokeWidth="2" strokeDasharray="4 3" />
      <path d="M30 18L42 26L54 18" stroke="#285A48" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="56" cy="56" r="14" fill="white" stroke="#285A48" strokeWidth="2.5" />
      <line x1="66" y1="66" x2="76" y2="76" stroke="#285A48" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}

function SearchIcon({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}

function HistoryIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <polyline points="12 7 12 12 15 15" />
    </svg>
  )
}

function ClearIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

function ClockIcon({ size = 14 }: { size?: number }) {
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
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  )
}

function PlusCircleIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="16" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  )
}

function MinusCircleIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  )
}

function TargetCircleIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="4" />
    </svg>
  )
}

function ExclamationIcon({ size = 24 }: { size?: number }) {
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
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  )
}

// Typo-safe aliases & exports
export { MobileInventory as MobileInvetory }
export default MobileInventory