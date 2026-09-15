import { useEffect, useState } from 'react'

import { inventoryApi } from '../api/inventoryApi'
import {
  DataCard,
  DesktopPage,
  DesktopSearch,
  EmptyRow,
  ErrorRow,
  FilterPills,
  LoadingRow,
  SecondaryButton,
  Th,
  Toolbar,
} from '../components/ui/DesktopKit'
import { ChevronRight, History, Minus, Plus } from '../components/ui/Icons'
import { PrimaryButton, TextButton } from '../components/ui/MobileKit'
import { Modal } from '../components/ui/Modal'
import { Pagination } from '../components/ui/Pagination'
import { EmptyState, ErrorState, Spinner } from '../components/ui/States'
import { useToast } from '../context/ToastContext'
import { useAsync } from '../hooks/useAsync'
import { useDebounced } from '../hooks/useDebounced'
import { useIsMobile } from '../hooks/useIsMobile'
import type { InventoryHistory, InventoryItem } from '../types'
import { getErrorMessage } from '../utils/errors'
import { formatDateTime } from '../utils/format'
import { MobileInventory } from './mobile/MobileInventory'

type StockFilter = '' | 'Low Stock' | 'Out of Stock' | 'In Stock'

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

function projectStock(current: number, type: AdjustType, quantity: number) {
  if (type === 1) return current + quantity
  if (type === 2) return Math.max(0, current - quantity)
  return quantity
}

function stockStyle(status: string) {
  if (status === 'Out of Stock') return { text: 'text-rose-600', bar: 'bg-rose-500', label: 'Out of stock', labelClass: 'text-rose-600' }
  if (status === 'Low Stock') return { text: 'text-amber-700', bar: 'bg-amber-400', label: 'Low stock', labelClass: 'text-amber-700' }
  return { text: 'text-[#091413]', bar: 'bg-[#1F5E3B]', label: 'In stock', labelClass: 'text-slate-500' }
}

export function InventoryPage() {
  // Render exactly one layout: the old CSS switch mounted both, doubling every request.
  const isMobile = useIsMobile()
  if (isMobile) return <MobileInventory />
  return <DesktopInventory />
}

function DesktopInventory() {
  const [search, setSearch] = useState('')
  const [stock, setStock] = useState<StockFilter>('')
  const [page, setPage] = useState(1)
  const [showHistory, setShowHistory] = useState(false)
  const [adjust, setAdjust] = useState<InventoryItem | null>(null)

  const q = useDebounced(search).trim()

  const list = useAsync(
    () => inventoryApi.list({ search: q || undefined, stockStatus: stock || undefined, page, pageSize: PAGE_SIZE }),
    [q, stock, page],
  )

  // Real totals across all products (respecting search), not just the visible page.
  const counts = useAsync(async () => {
    const count = (stockStatus?: string) =>
      inventoryApi.list({ search: q || undefined, stockStatus, page: 1, pageSize: 1 }).then((r) => r.totalCount)
    const [all, low, out] = await Promise.all([count(), count('Low Stock'), count('Out of Stock')])
    return { all, low, out, inStock: Math.max(0, all - low - out) }
  }, [q])

  useEffect(() => {
    setPage(1)
  }, [q])

  const items = list.data?.items ?? []
  const needRestock = counts.data ? counts.data.low + counts.data.out : 0
  const hasFilters = q !== '' || stock !== ''

  return (
    <DesktopPage
      title="Inventory"
      subtitle={
        counts.data
          ? needRestock > 0
            ? `${needRestock} ${needRestock === 1 ? 'product needs' : 'products need'} restocking`
            : 'All products are well stocked'
          : 'Stock levels and adjustments'
      }
      actions={
        <SecondaryButton onClick={() => setShowHistory(true)}>
          <History size={14} className="text-[#1F5E3B]" />
          Stock history
        </SecondaryButton>
      }
    >
      <Toolbar>
        <DesktopSearch value={search} onChange={setSearch} placeholder="Search product name or SKU" label="Search inventory" />
        <FilterPills
          label="Stock status"
          value={stock}
          onChange={(value) => {
            setStock(value)
            setPage(1)
          }}
          options={[
            { key: '', label: 'All', count: counts.data?.all },
            { key: 'Low Stock', label: 'Low', count: counts.data?.low, attention: true },
            { key: 'Out of Stock', label: 'Out', count: counts.data?.out, attention: true },
            { key: 'In Stock', label: 'In stock', count: counts.data?.inStock },
          ]}
        />
      </Toolbar>

      <DataCard className="mt-4">
        {list.loading && !list.data && <LoadingRow />}
        {!list.loading && list.error && <ErrorRow message={list.error} onRetry={() => void list.reload()} />}
        {!list.loading && !list.error && items.length === 0 && (
          <EmptyRow
            title="No products found"
            hint={q ? `Nothing matches “${q}”.` : hasFilters ? 'No products have this stock status.' : 'Add products to start tracking stock.'}
            actionLabel={hasFilters ? 'Clear filters' : undefined}
            secondary
            onAction={() => {
              setSearch('')
              setStock('')
              setPage(1)
            }}
          />
        )}

        {!list.error && items.length > 0 && (
          <>
            <div className="overflow-x-auto">
              <table className={`w-full text-left text-sm transition-opacity ${list.loading ? 'opacity-60' : ''}`}>
                <thead className="border-b border-slate-100 text-xs text-slate-500">
                  <tr>
                    <Th className="pl-6">Product</Th>
                    <Th align="right">On hand</Th>
                    <Th>Level</Th>
                    <Th>Last updated</Th>
                    <Th className="pr-6">
                      <span className="sr-only">Actions</span>
                    </Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((row) => {
                    const style = stockStyle(row.stockStatus)
                    const fill =
                      row.reorderLevel > 0
                        ? Math.min(100, (row.stockQuantity / (row.reorderLevel * 2)) * 100)
                        : row.stockQuantity > 0
                        ? 100
                        : 0
                    return (
                      <tr key={row.productId} onClick={() => setAdjust(row)} className="group cursor-pointer hover:bg-slate-50">
                        <td className="py-3 pl-6 pr-3">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              setAdjust(row)
                            }}
                            className="block max-w-80 truncate text-left font-medium focus-visible:underline focus-visible:outline-none"
                          >
                            {row.productName}
                          </button>
                          <span className="text-xs text-slate-400">SKU {row.sku}</span>
                        </td>
                        <td className="px-3 py-3 text-right">
                          <span className={`text-base font-semibold tabular-nums ${style.text}`}>{row.stockQuantity}</span>
                          <span className="block text-xs text-slate-400">low at {row.reorderLevel}</span>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-3">
                            <div
                              className="h-1.5 w-28 overflow-hidden rounded-full bg-slate-100"
                              role="progressbar"
                              aria-label={`${row.productName} stock level`}
                              aria-valuenow={row.stockQuantity}
                              aria-valuemin={0}
                              aria-valuemax={row.reorderLevel * 2 || row.stockQuantity}
                            >
                              <div className={`h-full rounded-full ${style.bar}`} style={{ width: `${fill}%` }} />
                            </div>
                            <span className={`text-xs ${style.labelClass}`}>{style.label}</span>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-slate-500">{formatDateTime(row.lastUpdated)}</td>
                        <td className="py-3 pl-3 pr-6 text-right">
                          <span className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-[#1F5E3B] group-hover:bg-[#F2F8F4]">
                            Update stock
                            <ChevronRight size={10} />
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {(list.data?.totalPages ?? 1) > 1 && (
              <div className="border-t border-slate-100 px-6 py-3">
                <Pagination page={list.data?.page ?? 1} totalPages={list.data?.totalPages ?? 1} onPage={setPage} />
              </div>
            )}
          </>
        )}
      </DataCard>

      {adjust && (
        <AdjustStockModal
          item={adjust}
          onClose={() => setAdjust(null)}
          onSaved={async () => {
            await Promise.all([list.reload(), counts.reload()])
          }}
        />
      )}

      {showHistory && <StockHistoryModal onClose={() => setShowHistory(false)} />}
    </DesktopPage>
  )
}

/* =============================================================
   UPDATE STOCK
============================================================= */

function AdjustStockModal({
  item,
  onClose,
  onSaved,
}: {
  item: InventoryItem
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const { notify } = useToast()
  const [type, setType] = useState<AdjustType>(1)
  const [quantity, setQuantity] = useState(1)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const recent = useAsync(
    () => inventoryApi.history({ productId: item.productId, page: 1, pageSize: 5 }),
    [item.productId],
  )

  const minQuantity = type === 3 ? 0 : 1
  const projected = projectStock(item.stockQuantity, type, quantity)
  const isNoChange = projected === item.stockQuantity
  const removesMoreThanStock = type === 2 && quantity > item.stockQuantity
  const willBeLow = projected > 0 && projected <= item.reorderLevel

  function changeType(next: AdjustType) {
    setType(next)
    setReason('')
    // "Set count" starts from the current count so only the difference needs correcting.
    if (next === 3) setQuantity(item.stockQuantity)
    else if (type === 3) setQuantity(1)
  }

  async function save() {
    if (busy || isNoChange || quantity < minQuantity) return
    setBusy(true)
    try {
      await inventoryApi.adjust({ productId: item.productId, type, quantity, reason: reason.trim() })
      notify(`${item.productName}: ${item.stockQuantity} → ${projected}`)
      await onSaved()
      onClose()
    } catch (err) {
      notify(getErrorMessage(err), 'error')
      setBusy(false)
    }
  }

  const saveLabel = busy
    ? 'Saving…'
    : isNoChange
    ? 'No change to save'
    : type === 1
    ? `Add ${quantity} ${quantity === 1 ? 'unit' : 'units'}`
    : type === 2
    ? `Remove ${Math.min(quantity, item.stockQuantity)} ${quantity === 1 ? 'unit' : 'units'}`
    : `Set count to ${quantity}`

  return (
    <Modal
      title={item.productName}
      description={`SKU ${item.sku} · Low-stock alert at ${item.reorderLevel}`}
      size="xl"
      onClose={onClose}
      preventClose={busy}
      footer={
        <div className="flex w-full items-center justify-end gap-2">
          <TextButton onClick={onClose} disabled={busy} className="h-12">
            Cancel
          </TextButton>
          <PrimaryButton type="submit" form="adjust-stock-form" disabled={busy || isNoChange} className="h-12 flex-none px-8">
            {saveLabel}
          </PrimaryButton>
        </div>
      }
    >
      <form
        id="adjust-stock-form"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
        className="grid gap-6 md:grid-cols-2"
      >
        <div className="space-y-5">
          {/* Live before → after */}
          <div className="flex items-center justify-center gap-6 rounded-3xl bg-[#F2F8F4] py-5">
            <div className="text-center">
              <p className="text-xs text-slate-500">Now</p>
              <p className="text-3xl font-semibold tabular-nums text-slate-400">{item.stockQuantity}</p>
            </div>
            <ChevronRight size={14} className="text-slate-300" />
            <div className="text-center">
              <p className="text-xs text-[#1F5E3B]">After</p>
              <p
                aria-live="polite"
                className={`text-4xl font-bold tabular-nums ${
                  projected === 0 ? 'text-rose-600' : willBeLow ? 'text-amber-700' : 'text-[#091413]'
                }`}
              >
                {projected}
              </p>
            </div>
          </div>

          {!isNoChange && (removesMoreThanStock || willBeLow || projected === 0) && (
            <p className="-mt-2 text-center text-sm text-amber-700">
              {removesMoreThanStock
                ? `Only ${item.stockQuantity} in stock — the count will be set to 0.`
                : projected === 0
                ? 'This product will be out of stock.'
                : 'Still at or below the low-stock level.'}
            </p>
          )}

          <div role="radiogroup" aria-label="Adjustment type" className="grid grid-cols-3 rounded-full bg-[#F1F4F3] p-1">
            {ADJUST_TYPES.map((option) => {
              const selected = type === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => changeType(option.value)}
                  className={`h-10 rounded-full text-sm font-medium transition ${selected ? 'bg-[#1F5E3B] text-white shadow-sm' : 'text-slate-600'}`}
                >
                  {option.label}
                </button>
              )
            })}
          </div>

          <div>
            <label htmlFor="adjust-quantity" className="block text-sm font-medium">
              {type === 3 ? 'Counted quantity' : 'Quantity'}
            </label>
            <div className="mt-1.5 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setQuantity((prev) => Math.max(minQuantity, prev - 1))}
                disabled={quantity <= minQuantity}
                aria-label="Decrease quantity"
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#F3F5F4] hover:bg-[#E9EEEB] disabled:opacity-40"
              >
                <Minus size={12} />
              </button>
              <input
                id="adjust-quantity"
                type="number"
                inputMode="numeric"
                min={minQuantity}
                value={quantity}
                autoFocus
                onFocus={(e) => e.target.select()}
                onChange={(e) => {
                  const next = Math.floor(Number(e.target.value))
                  setQuantity(Number.isFinite(next) ? Math.max(minQuantity, next) : minQuantity)
                }}
                className="h-12 min-w-0 flex-1 rounded-2xl border-0 bg-[#F3F5F4] text-center text-xl font-semibold tabular-nums outline-none focus:bg-white focus:ring-2 focus:ring-[#1F5E3B]"
              />
              <button
                type="button"
                onClick={() => setQuantity((prev) => prev + 1)}
                aria-label="Increase quantity"
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#F3F5F4] hover:bg-[#E9EEEB]"
              >
                <Plus size={12} />
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
                    className={`h-9 rounded-xl text-sm font-medium tabular-nums transition ${
                      quantity === amount ? 'bg-[#1F5E3B] text-white' : 'bg-[#E6F1EA] text-[#1F5E3B] hover:bg-[#D3E6DB]'
                    }`}
                  >
                    {amount}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-5">
          <div>
            <label htmlFor="adjust-reason" className="block text-sm font-medium">
              Reason <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {REASONS[type].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setReason((prev) => (prev === preset ? '' : preset))}
                  aria-pressed={reason === preset}
                  className={`h-9 rounded-full px-3.5 text-sm transition ${
                    reason === preset ? 'bg-[#1F5E3B] text-white' : 'bg-[#F3F5F4] text-slate-600 hover:bg-[#E9EEEB]'
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
              className="mt-2 h-11 w-full rounded-2xl border-0 bg-[#F3F5F4] px-4 text-sm placeholder:text-slate-400 outline-none focus:bg-white focus:ring-2 focus:ring-[#1F5E3B]"
            />
          </div>

          <div>
            <p className="text-sm font-medium">Recent changes</p>
            {recent.loading ? (
              <div className="py-6">
                <Spinner />
              </div>
            ) : recent.data && recent.data.items.length > 0 ? (
              <ul className="mt-1">
                {recent.data.items.map((entry) => (
                  <li key={entry.id} className="flex items-baseline justify-between gap-3 border-b border-slate-100 py-2.5 text-sm last:border-b-0">
                    <span className="min-w-0 truncate text-slate-500">
                      {entry.reason || entry.type} · {formatDateTime(entry.createdAt)}
                    </span>
                    <ChangeAmount value={entry.quantityChange} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 py-2 text-sm text-slate-400">No changes recorded yet.</p>
            )}
          </div>
        </div>
      </form>
    </Modal>
  )
}

/* =============================================================
   STOCK HISTORY
============================================================= */

function StockHistoryModal({ onClose }: { onClose: () => void }) {
  const [page, setPage] = useState(1)
  const history = useAsync(() => inventoryApi.history({ page, pageSize: PAGE_SIZE }), [page])
  const items: InventoryHistory[] = history.data?.items ?? []

  return (
    <Modal
      title="Stock history"
      description={history.data ? `${history.data.totalCount} changes recorded` : undefined}
      size="2xl"
      onClose={onClose}
    >
      {history.loading && !history.data && (
        <div className="py-16">
          <Spinner />
        </div>
      )}
      {!history.loading && history.error && <ErrorState message={history.error} onRetry={() => void history.reload()} />}
      {!history.loading && !history.error && items.length === 0 && (
        <div className="py-12 text-center">
          <EmptyState title="No stock changes yet" hint="Adjustments and sales will appear here." />
        </div>
      )}

      {items.length > 0 && (
        <>
          <div className={`overflow-x-auto rounded-2xl ring-1 ring-slate-100 ${history.loading ? 'opacity-60' : ''}`}>
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-100 text-xs text-slate-500">
                <tr>
                  <Th className="pl-4">Product</Th>
                  <Th>Change</Th>
                  <Th align="right">Change</Th>
                  <Th align="right">Stock after</Th>
                  <Th className="pr-4">When</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((row) => (
                  <tr key={row.id}>
                    <td className="py-3 pl-4 pr-3">
                      <span className="block max-w-56 truncate font-medium">{row.productName}</span>
                      <span className="text-xs text-slate-400">SKU {row.sku}</span>
                    </td>
                    <td className="px-3 py-3 text-slate-600">
                      {row.type}
                      {row.reason && <span className="block max-w-56 truncate text-xs text-slate-400">{row.reason}</span>}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <ChangeAmount value={row.quantityChange} />
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{row.quantityAfter}</td>
                    <td className="py-3 pl-3 pr-4 whitespace-nowrap text-slate-500">{formatDateTime(row.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {history.data && history.data.totalPages > 1 && (
            <div className="mt-3">
              <Pagination page={history.data.page} totalPages={history.data.totalPages} onPage={setPage} />
            </div>
          )}
        </>
      )}
    </Modal>
  )
}

function ChangeAmount({ value }: { value: number }) {
  return (
    <span className={`font-medium tabular-nums ${value > 0 ? 'text-[#1F5E3B]' : value < 0 ? 'text-rose-600' : 'text-slate-400'}`}>
      {value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : '0'}
    </span>
  )
}

export default InventoryPage
