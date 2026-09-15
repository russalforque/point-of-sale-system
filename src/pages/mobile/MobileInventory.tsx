import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import { inventoryApi } from '../../api/inventoryApi'

import {
  ChevronLeft,
  ChevronRight,
  History,
  Minus,
  Plus,
  Search,
  X,
} from '../../components/ui/Icons'
import { Pagination } from '../../components/ui/Pagination'
import { EmptyState, ErrorState, Spinner } from '../../components/ui/States'

import { useToast } from '../../context/ToastContext'
import { useAsync } from '../../hooks/useAsync'
import { useDebounced } from '../../hooks/useDebounced'
import type { InventoryHistory, InventoryItem } from '../../types'
import { getErrorMessage } from '../../utils/errors'
import { formatDateTime } from '../../utils/format'

type StockFilter = '' | 'In Stock' | 'Low Stock' | 'Out of Stock'

/** Matches the adjustment `type` values understood by inventoryApi.adjust. */
type AdjustType = 1 | 2 | 3

const ADJUST_TYPES: { value: AdjustType; label: string }[] = [
  { value: 1, label: 'Add' },
  { value: 2, label: 'Remove' },
  { value: 3, label: 'Set count' },
]

const QUICK_AMOUNTS = [1, 5, 10, 25, 50]

const REASONS: Record<AdjustType, string[]> = {
  1: ['Delivery', 'Customer return'],
  2: ['Damaged', 'Expired', 'Lost'],
  3: ['Stock count'],
}

const PAGE_SIZE = 20

const safeFormatDateTime = (date: string | Date | null | undefined): string => {
  if (!date) return ''
  const val = date instanceof Date ? date.toISOString() : String(date)
  return formatDateTime(val)
}

function statusStyle(status: string) {
  if (status === 'Out of Stock') return { text: 'text-rose-600', bar: 'bg-rose-500', label: 'Out of stock' }
  if (status === 'Low Stock') return { text: 'text-amber-700', bar: 'bg-amber-400', label: 'Low stock' }
  return { text: 'text-[#091413]', bar: 'bg-[#1F5E3B]', label: 'In stock' }
}

function projectStock(current: number, type: AdjustType, quantity: number) {
  if (type === 1) return current + quantity
  if (type === 2) return Math.max(0, current - quantity)
  return quantity
}

export function MobileInventory() {
  const { notify } = useToast()

  const [search, setSearch] = useState('')
  const [stock, setStock] = useState<StockFilter>('')
  const [page, setPage] = useState(1)
  const [historyPage, setHistoryPage] = useState(1)
  const [showHistory, setShowHistory] = useState(false)

  const [adjust, setAdjust] = useState<InventoryItem | null>(null)
  const [type, setType] = useState<AdjustType>(1)
  const [quantity, setQuantity] = useState(1)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const q = useDebounced(search).trim()

  const list = useAsync(
    () =>
      inventoryApi.list({
        search: q || undefined,
        stockStatus: stock || undefined,
        page,
        pageSize: PAGE_SIZE,
      }),
    [q, stock, page],
  )

  // Accurate totals across the whole catalog (respecting search), not just the visible page.
  const counts = useAsync(async () => {
    const count = (stockStatus?: string) =>
      inventoryApi
        .list({ search: q || undefined, stockStatus, page: 1, pageSize: 1 })
        .then((result) => result.totalCount)

    const [all, low, out] = await Promise.all([count(), count('Low Stock'), count('Out of Stock')])
    return { all, low, out, inStock: Math.max(0, all - low - out) }
  }, [q])

  const history = useAsync(
    () =>
      showHistory
        ? inventoryApi.history({ page: historyPage, pageSize: PAGE_SIZE })
        : Promise.resolve(null),
    [historyPage, showHistory],
  )

  const productHistory = useAsync(
    () =>
      adjust
        ? inventoryApi.history({ productId: adjust.productId, page: 1, pageSize: 3 })
        : Promise.resolve(null),
    [adjust?.productId],
  )

  const items: InventoryItem[] = list.data?.items ?? []
  const historyItems: InventoryHistory[] = history.data?.items ?? []
  const isFirstLoad = list.loading && !list.data
  const hasActiveFilters = q !== '' || stock !== ''

  // Reset to page 1 whenever the (debounced) search changes.
  useEffect(() => {
    setPage(1)
  }, [q])

  // Escape closes the top-most layer (never mid-save).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || busy) return
      if (adjust) setAdjust(null)
      else if (showHistory) setShowHistory(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [adjust, showHistory, busy])

  function selectFilter(status: StockFilter) {
    setStock(status)
    setPage(1)
  }

  function resetFilters() {
    setSearch('')
    setStock('')
    setPage(1)
  }

  function openAdjust(item: InventoryItem) {
    setAdjust(item)
    setType(1)
    setQuantity(1)
    setReason('')
  }

  function changeType(next: AdjustType) {
    setType(next)
    setReason('')
    // "Set count" starts from the current count so the cashier only corrects the difference.
    if (next === 3 && adjust) setQuantity(adjust.stockQuantity)
    else if (type === 3) setQuantity(1)
  }

  const minQuantity = type === 3 ? 0 : 1
  const projectedStock = adjust ? projectStock(adjust.stockQuantity, type, quantity) : 0
  const isNoChange = adjust ? projectedStock === adjust.stockQuantity : true
  const removesMoreThanStock = adjust !== null && type === 2 && quantity > adjust.stockQuantity
  const willBeLow = adjust !== null && projectedStock > 0 && projectedStock <= adjust.reorderLevel

  const saveLabel = busy
    ? 'Saving…'
    : type === 1
    ? `Add ${quantity} ${quantity === 1 ? 'unit' : 'units'}`
    : type === 2
    ? `Remove ${Math.min(quantity, adjust?.stockQuantity ?? quantity)} ${quantity === 1 ? 'unit' : 'units'}`
    : `Set count to ${quantity}`

  async function submitAdjust() {
    if (!adjust || busy || isNoChange || quantity < minQuantity) return

    setBusy(true)

    try {
      await inventoryApi.adjust({
        productId: adjust.productId,
        type,
        quantity,
        reason: reason.trim(),
      })

      notify(`${adjust.productName}: ${adjust.stockQuantity} → ${projectedStock}`)
      setAdjust(null)

      await Promise.all([
        list.reload(),
        counts.reload(),
        showHistory ? history.reload() : Promise.resolve(),
      ])
    } catch (err) {
      notify(getErrorMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  const filters: { key: StockFilter; label: string; count?: number; tone: string }[] = [
    { key: '', label: 'All', count: counts.data?.all, tone: 'text-slate-400' },
    { key: 'Low Stock', label: 'Low', count: counts.data?.low, tone: 'text-amber-600' },
    { key: 'Out of Stock', label: 'Out', count: counts.data?.out, tone: 'text-rose-600' },
    { key: 'In Stock', label: 'In stock', count: counts.data?.inStock, tone: 'text-slate-400' },
  ]

  return (
    <div className="flex min-h-full flex-col bg-white text-[#091413] antialiased">
      {/* HEADER */}
      <header className="sticky top-0 z-30 bg-white/95 px-5 pb-3 pt-4 backdrop-blur-md">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight">Inventory</h1>
            <p className="mt-0.5 text-sm text-slate-500">
              {counts.data
                ? counts.data.low + counts.data.out > 0
                  ? `${counts.data.low + counts.data.out} products need restocking`
                  : 'All products are well stocked'
                : 'Tap a product to update its stock.'}
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              setHistoryPage(1)
              setShowHistory(true)
            }}
            className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full bg-[#F3F5F4] px-4 text-sm font-medium transition hover:bg-[#E9EEEB] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B]"
          >
            <History size={15} className="text-[#1F5E3B]" />
            History
          </button>
        </div>

        {/* Search */}
        <div className="relative mt-4">
          <Search
            size={16}
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            type="search"
            inputMode="search"
            enterKeyHint="search"
            aria-label="Search products or SKU"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products or SKU"
            className="h-12 w-full rounded-2xl border-0 bg-[#F3F5F4] pl-11 pr-12 text-[15px] placeholder:text-slate-400 outline-none transition focus:bg-white focus:ring-2 focus:ring-[#1F5E3B] [&::-webkit-search-cancel-button]:hidden"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label="Clear search"
              className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 active:bg-slate-200"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Status filter — one control, real counts */}
        <div
          role="tablist"
          aria-label="Stock status"
          className="-mx-5 mt-3 flex gap-2 overflow-x-auto px-5 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {filters.map((filter) => {
            const isActive = stock === filter.key
            return (
              <button
                key={filter.key || 'all'}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => selectFilter(filter.key)}
                className={`inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B] focus-visible:ring-offset-2 ${
                  isActive ? 'bg-[#1F5E3B] text-white' : 'bg-[#F3F5F4] text-slate-600 active:bg-[#E9EEEB]'
                }`}
              >
                {filter.label}
                {filter.count !== undefined && (
                  <span
                    className={`tabular-nums ${
                      isActive ? 'text-white/70' : filter.count > 0 ? filter.tone : 'text-slate-400'
                    }`}
                  >
                    {filter.count}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </header>

      {/* LIST */}
      <main className="flex-1 px-5 pb-6">
        {isFirstLoad && (
          <div className="flex h-56 items-center justify-center">
            <Spinner />
          </div>
        )}

        {!list.loading && list.error && (
          <div className="py-8">
            <ErrorState message={list.error} onRetry={() => void list.reload()} />
          </div>
        )}

        {!list.loading && !list.error && items.length === 0 && (
          <div className="py-16 text-center">
            <EmptyState
              title="No products found"
              hint={q ? `Nothing matches “${q}”.` : 'No products have this stock status.'}
            />
            {hasActiveFilters && (
              <button
                type="button"
                onClick={resetFilters}
                className="mt-4 h-11 rounded-full bg-[#F3F5F4] px-5 text-sm font-medium active:bg-[#E9EEEB]"
              >
                Clear filters
              </button>
            )}
          </div>
        )}

        {!list.error && items.length > 0 && (
          <>
            <ul className={`transition-opacity ${list.loading ? 'opacity-60' : ''}`}>
              {items.map((row) => (
                <li key={row.productId} className="border-b border-slate-100 last:border-b-0">
                  <InventoryRow item={row} onSelect={() => openAdjust(row)} />
                </li>
              ))}
            </ul>

            {(list.data?.totalPages ?? 1) > 1 && (
              <div className="pt-4">
                <Pagination
                  page={list.data?.page ?? 1}
                  totalPages={list.data?.totalPages ?? 1}
                  onPage={setPage}
                />
              </div>
            )}
          </>
        )}
      </main>

      {/* ADJUST SHEET */}
      {adjust && (
        <Sheet label={`Update stock for ${adjust.productName}`} onClose={() => !busy && setAdjust(null)}>
          <div className="flex items-start justify-between gap-3 px-5 pb-2">
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold">{adjust.productName}</h2>
              <p className="text-sm text-slate-500">
                SKU {adjust.sku} · Low at {adjust.reorderLevel}
              </p>
            </div>
            <CloseButton onClick={() => setAdjust(null)} disabled={busy} label="Close" />
          </div>

          <div className="flex-1 overflow-y-auto overscroll-contain px-5">
            {/* Live before → after preview */}
            <div className="mt-2 flex items-center justify-center gap-5 rounded-3xl bg-[#F2F8F4] py-5">
              <div className="text-center">
                <p className="text-xs text-slate-500">Now</p>
                <p className="text-3xl font-semibold tabular-nums text-slate-400">{adjust.stockQuantity}</p>
              </div>
              <ChevronRight size={14} className="text-slate-300" />
              <div className="text-center">
                <p className="text-xs text-[#1F5E3B]">After</p>
                <p
                  aria-live="polite"
                  className={`text-4xl font-bold tabular-nums ${
                    projectedStock === 0 ? 'text-rose-600' : willBeLow ? 'text-amber-700' : 'text-[#091413]'
                  }`}
                >
                  {projectedStock}
                </p>
              </div>
            </div>

            {(removesMoreThanStock || willBeLow || projectedStock === 0) && !isNoChange && (
              <p className="mt-2 text-center text-sm text-amber-700">
                {removesMoreThanStock
                  ? `Only ${adjust.stockQuantity} in stock — count will be set to 0.`
                  : projectedStock === 0
                  ? 'This product will be out of stock.'
                  : 'Still at or below the low-stock level.'}
              </p>
            )}

            {/* Type */}
            <div
              role="radiogroup"
              aria-label="Adjustment type"
              className="mt-5 grid grid-cols-3 rounded-full bg-[#F1F4F3] p-1"
            >
              {ADJUST_TYPES.map((option) => {
                const isSelected = type === option.value
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => changeType(option.value)}
                    className={`min-h-11 rounded-full text-sm font-medium transition ${
                      isSelected ? 'bg-[#1F5E3B] text-white shadow-sm' : 'text-slate-600'
                    }`}
                  >
                    {option.label}
                  </button>
                )
              })}
            </div>

            {/* Quantity */}
            <label htmlFor="adjust-quantity" className="mt-5 block text-sm font-medium">
              {type === 3 ? 'Counted quantity' : 'Quantity'}
            </label>
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setQuantity((prev) => Math.max(minQuantity, prev - 1))}
                disabled={quantity <= minQuantity}
                aria-label="Decrease quantity"
                className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#F3F5F4] active:bg-[#E9EEEB] disabled:opacity-40"
              >
                <Minus size={13} />
              </button>
              <input
                id="adjust-quantity"
                type="number"
                inputMode="numeric"
                min={minQuantity}
                value={quantity}
                onChange={(e) => {
                  const next = Math.floor(Number(e.target.value))
                  setQuantity(Number.isFinite(next) ? Math.max(minQuantity, next) : minQuantity)
                }}
                onFocus={(e) => e.target.select()}
                className="h-14 min-w-0 flex-1 rounded-2xl border-0 bg-[#F3F5F4] text-center text-2xl font-semibold tabular-nums outline-none focus:bg-white focus:ring-2 focus:ring-[#1F5E3B]"
              />
              <button
                type="button"
                onClick={() => setQuantity((prev) => prev + 1)}
                aria-label="Increase quantity"
                className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#F3F5F4] active:bg-[#E9EEEB]"
              >
                <Plus size={13} />
              </button>
            </div>

            {type !== 3 && (
              <div className="mt-2 grid grid-cols-5 gap-2">
                {QUICK_AMOUNTS.map((amount) => (
                  <button
                    key={amount}
                    type="button"
                    onClick={() => setQuantity(amount)}
                    aria-pressed={quantity === amount}
                    className={`h-10 rounded-xl text-sm font-medium tabular-nums transition ${
                      quantity === amount ? 'bg-[#1F5E3B] text-white' : 'bg-[#E6F1EA] text-[#1F5E3B]'
                    }`}
                  >
                    {amount}
                  </button>
                ))}
              </div>
            )}

            {/* Reason */}
            <label htmlFor="adjust-reason" className="mt-5 block text-sm font-medium">
              Reason <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <div className="mt-2 flex flex-wrap gap-2">
              {REASONS[type].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setReason((prev) => (prev === preset ? '' : preset))}
                  aria-pressed={reason === preset}
                  className={`h-9 rounded-full px-3.5 text-sm transition ${
                    reason === preset ? 'bg-[#1F5E3B] text-white' : 'bg-[#F3F5F4] text-slate-600'
                  }`}
                >
                  {preset}
                </button>
              ))}
            </div>
            <input
              id="adjust-reason"
              type="text"
              maxLength={200}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Add a note"
              className="mt-2 h-12 w-full rounded-2xl border-0 bg-[#F3F5F4] px-4 text-[15px] placeholder:text-slate-400 outline-none focus:bg-white focus:ring-2 focus:ring-[#1F5E3B]"
            />

            {/* Recent changes for context */}
            {productHistory.data && productHistory.data.items.length > 0 && (
              <div className="mb-4 mt-6">
                <p className="text-sm font-medium">Recent changes</p>
                <ul className="mt-1">
                  {productHistory.data.items.map((entry) => (
                    <li
                      key={entry.id}
                      className="flex items-baseline justify-between gap-3 border-b border-slate-100 py-2.5 text-sm last:border-b-0"
                    >
                      <span className="min-w-0 truncate text-slate-500">
                        {entry.reason || entry.type} · {safeFormatDateTime(entry.createdAt)}
                      </span>
                      <ChangeAmount value={entry.quantityChange} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="border-t border-slate-100 px-5 pb-[max(1rem,env(safe-area-inset-bottom,0px))] pt-3">
            <button
              type="button"
              onClick={() => void submitAdjust()}
              disabled={busy || isNoChange}
              className="flex h-14 w-full items-center justify-center rounded-2xl bg-[#1F5E3B] text-[15px] font-semibold text-white transition active:scale-[0.99] disabled:bg-slate-200 disabled:text-slate-400"
            >
              {isNoChange && !busy ? 'No change to save' : saveLabel}
            </button>
          </div>
        </Sheet>
      )}

      {/* HISTORY — full-screen page */}
      {showHistory && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Stock history"
          className="fixed inset-0 z-50 flex flex-col bg-white pt-[env(safe-area-inset-top,0px)] animate-in slide-in-from-right duration-200"
        >
          <div className="flex items-center gap-2 px-2 pt-2">
            <button
              type="button"
              onClick={() => setShowHistory(false)}
              aria-label="Back to inventory"
              className="flex h-11 w-11 items-center justify-center rounded-full active:bg-slate-100"
            >
              <ChevronLeft size={16} />
            </button>
            <div>
              <h2 className="text-lg font-semibold">Stock history</h2>
              <p className="text-xs text-slate-500">{history.data?.totalCount ?? 0} changes</p>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto overscroll-contain px-5 pt-2">
            {history.loading && !history.data && (
              <div className="py-16 text-center">
                <Spinner />
              </div>
            )}

            {!history.loading && history.error && (
              <div className="py-8">
                <ErrorState message={history.error} onRetry={() => void history.reload()} />
              </div>
            )}

            {!history.loading && !history.error && historyItems.length === 0 && (
              <div className="py-16 text-center">
                <EmptyState title="No stock changes yet" hint="Adjustments you make will appear here." />
              </div>
            )}

            <ul className={history.loading ? 'opacity-60' : ''}>
              {historyItems.map((row) => (
                <li
                  key={row.id}
                  className="flex min-h-[72px] items-center gap-3 border-b border-slate-100 py-3 last:border-b-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px]">{row.productName}</p>
                    <p className="mt-0.5 truncate text-xs text-slate-400">
                      {row.type}
                      {row.reason ? ` · ${row.reason}` : ''} · {safeFormatDateTime(row.createdAt)}
                    </p>
                  </div>

                  <div className="shrink-0 text-right">
                    <ChangeAmount value={row.quantityChange} />
                    <p className="text-xs tabular-nums text-slate-400">now {row.quantityAfter}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {history.data && history.data.totalPages > 1 && (
            <div className="border-t border-slate-100 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))]">
              <Pagination
                page={history.data.page}
                totalPages={history.data.totalPages}
                onPage={setHistoryPage}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* =============================================================
   BUILDING BLOCKS
============================================================= */

function InventoryRow({ item, onSelect }: { item: InventoryItem; onSelect: () => void }) {
  const style = statusStyle(item.stockStatus)
  const fill =
    item.reorderLevel > 0
      ? Math.min(100, (item.stockQuantity / (item.reorderLevel * 2)) * 100)
      : item.stockQuantity > 0
      ? 100
      : 0

  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex min-h-[76px] w-full items-center gap-4 py-3 text-left transition active:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#1F5E3B]"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px]">{item.productName}</p>
        <p className="mt-0.5 truncate text-xs text-slate-400">SKU {item.sku}</p>

        {/* Bar scale: the low-stock level sits at the midpoint */}
        <div
          className="mt-2 h-1 w-full max-w-40 overflow-hidden rounded-full bg-slate-100"
          role="progressbar"
          aria-label={`${item.productName} stock level`}
          aria-valuenow={item.stockQuantity}
          aria-valuemin={0}
          aria-valuemax={item.reorderLevel * 2 || item.stockQuantity}
        >
          <div className={`h-full rounded-full ${style.bar}`} style={{ width: `${fill}%` }} />
        </div>
      </div>

      <div className="shrink-0 text-right">
        <p className={`text-xl font-semibold leading-tight tabular-nums ${style.text}`}>
          {item.stockQuantity}
        </p>
        <p className={`text-xs ${item.stockStatus === 'In Stock' ? 'text-slate-400' : style.text}`}>
          {item.stockStatus === 'In Stock' ? `low at ${item.reorderLevel}` : style.label}
        </p>
      </div>

      <ChevronRight size={12} className="shrink-0 text-slate-300" />
    </button>
  )
}

function ChangeAmount({ value }: { value: number }) {
  return (
    <span
      className={`text-[15px] font-medium tabular-nums ${
        value > 0 ? 'text-[#1F5E3B]' : value < 0 ? 'text-rose-600' : 'text-slate-400'
      }`}
    >
      {value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : '0'}
    </span>
  )
}

function Sheet({
  label,
  onClose,
  children,
}: {
  label: string
  onClose: () => void
  children: ReactNode
}) {
  return (
    <div role="dialog" aria-modal="true" aria-label={label} className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden="true" />

      <div className="relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-white animate-in slide-in-from-bottom duration-200">
        <div className="flex justify-center pb-2 pt-2.5">
          <span className="h-1 w-10 rounded-full bg-slate-200" />
        </div>
        {children}
      </div>
    </div>
  )
}

function CloseButton({
  onClick,
  label,
  disabled,
}: {
  onClick: () => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#F3F5F4] text-slate-500 active:bg-[#E9EEEB] disabled:opacity-40"
    >
      <X size={14} />
    </button>
  )
}

// Typo-safe aliases & exports
export { MobileInventory as MobileInvetory }
export default MobileInventory
