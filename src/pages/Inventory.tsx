import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { inventoryApi } from '../api/inventoryApi'
import {
  ActionMenu,
  DataCard,
  DesktopPage,
  DesktopSearch,
  EmptyRow,
  ErrorRow,
  FilterPills,
  LoadingRow,
  Th,
  Toolbar,
} from '../components/ui/DesktopKit'
import { Check, ChevronRight, Minus, Plus, TriangleWarning } from '../components/ui/Icons'
import { PrimaryButton, TextButton } from '../components/ui/MobileKit'
import { Modal } from '../components/ui/Modal'
import { Pagination } from '../components/ui/Pagination'
import { EmptyState, ErrorState, Spinner } from '../components/ui/States'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useAsync } from '../hooks/useAsync'
import { useDebounced } from '../hooks/useDebounced'
import { useIsMobile } from '../hooks/useIsMobile'
import type { InventoryHistory, InventoryItem } from '../types'
import { ADJUSTMENT_REASONS, MIN_ADJUSTMENT_REASON } from '../services/inventoryMovements'
import { getErrorMessage } from '../utils/errors'
import { formatDateTime } from '../utils/format'
import { MobileInventory } from './mobile/MobileInventory'

type StockFilter = '' | 'Low Stock' | 'Out of Stock' | 'In Stock'

/** Matches the adjustment `type` values understood by inventoryApi.adjust. */
type AdjustType = 1 | 2 | 3

const ADJUST_TYPES: { value: AdjustType; label: string; symbol: string }[] = [
  { value: 1, label: 'Add', symbol: '+' },
  { value: 2, label: 'Remove', symbol: '−' },
  { value: 3, label: 'Set count', symbol: '=' },
]

const ADJUST_HINTS: Record<AdjustType, string> = {
  1: 'Received more units, e.g. a delivery or a customer return.',
  2: 'Take units out, e.g. damaged, expired or lost stock.',
  3: 'Replace the count with what you physically counted.',
}

const QUICK_AMOUNTS = [1, 5, 10, 25, 50]

const REASONS = ADJUSTMENT_REASONS

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
  const { can } = useAuth()
  const [search, setSearch] = useState('')
  const [stock, setStock] = useState<StockFilter>('')
  const [page, setPage] = useState(1)
  const [showHistory, setShowHistory] = useState(false)
  const navigate = useNavigate()
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
        <>
          <ActionMenu
            label="More"
            items={[
              { label: 'Stock history', description: 'Every adjustment, sale and delivery', onSelect: () => setShowHistory(true) },
              ...(can('inventory.count')
                ? [{ label: 'Stock count', description: 'Count shelves and fix differences', onSelect: () => navigate('/stock-count') }]
                : []),
            ]}
          />
          {can('inventory.receive') && (
            <Link
              to="/receive-stock"
              className="inline-flex h-11 items-center gap-2 rounded-full bg-[#1F5E3B] px-5 text-sm font-medium text-white transition hover:bg-[#194D30] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B] focus-visible:ring-offset-2"
            >
              <Plus size={12} />
              Receive stock
            </Link>
          )}
        </>
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
            <div className="@container overflow-x-auto">
              <table className={`w-full text-left text-sm transition-opacity ${list.loading ? 'opacity-60' : ''}`}>
                <thead className="border-b border-slate-100 text-xs text-slate-500">
                  <tr>
                    <Th className="pl-6">Product</Th>
                    <Th align="right">On hand</Th>
                    <Th>Level</Th>
                    <Th className="hidden @4xl:table-cell">Last updated</Th>
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
                            className="block max-w-56 truncate text-left font-medium @4xl:max-w-80 focus-visible:underline focus-visible:outline-none"
                          >
                            {row.productName}
                          </button>
                          <span className="text-xs text-slate-400">SKU {row.sku}</span>
                        </td>
                        <td className="px-3 py-3 text-right">
                          <span className={`text-base font-semibold tabular-nums ${style.text}`}>{row.stockQuantity}</span>
                          <span className="block whitespace-nowrap text-xs text-slate-400">low at {row.reorderLevel}</span>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-3">
                            <div
                              className="hidden h-1.5 w-28 shrink-0 overflow-hidden rounded-full bg-slate-100 @3xl:block"
                              role="progressbar"
                              aria-label={`${row.productName} stock level`}
                              aria-valuenow={row.stockQuantity}
                              aria-valuemin={0}
                              aria-valuemax={row.reorderLevel * 2 || row.stockQuantity}
                            >
                              <div className={`h-full rounded-full ${style.bar}`} style={{ width: `${fill}%` }} />
                            </div>
                            <span className={`whitespace-nowrap text-xs ${style.labelClass}`}>{style.label}</span>
                          </div>
                        </td>
                        <td className="hidden whitespace-nowrap px-3 py-3 text-slate-500 @4xl:table-cell">{formatDateTime(row.lastUpdated)}</td>
                        <td className="py-3 pl-3 pr-6 text-right">
                          <span className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-sm font-medium text-[#1F5E3B] group-hover:bg-[#F2F8F4]">
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
  // Kept as text so the field can be cleared and retyped without snapping back to a minimum.
  const [quantityText, setQuantityText] = useState('1')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const typeButtonsRef = useRef<(HTMLButtonElement | null)[]>([])

  const recent = useAsync(
    () => inventoryApi.history({ productId: item.productId, page: 1, pageSize: 5 }),
    [item.productId],
  )

  const onHand = item.stockQuantity
  const minQuantity = type === 3 ? 0 : 1
  // Stock never goes below zero (inventoryApi removes at most what is on hand), so Remove is
  // capped here too — the cashier never asks for more than will actually be taken off.
  const maxQuantity = type === 2 ? onHand : 999999
  const hasQuantity = quantityText !== ''
  const quantity = hasQuantity ? Number(quantityText) : 0
  const isValidQuantity = hasQuantity && quantity >= minQuantity && quantity <= maxQuantity
  const projected = projectStock(onHand, type, quantity)
  const delta = projected - onHand
  const isNoChange = isValidQuantity && delta === 0
  const hasReason = reason.trim().length >= MIN_ADJUSTMENT_REASON
  const canSave = !busy && isValidQuantity && !isNoChange && hasReason
  const nothingToRemove = type === 2 && onHand === 0

  const after = stockLevel(projected, item.reorderLevel)

  function setQuantity(next: number) {
    setQuantityText(String(Math.min(maxQuantity, Math.max(minQuantity, Math.floor(next)))))
    setSaveError(null)
  }

  function changeType(next: AdjustType) {
    setType(next)
    setReason('')
    setSaveError(null)
    // "Set count" starts from the current count so only the difference needs correcting.
    if (next === 3) setQuantityText(String(onHand))
    else if (next === 2) setQuantityText(onHand > 0 ? '1' : '0')
    else setQuantityText('1')
  }

  // Radio-group arrow key navigation.
  function handleTypeKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(event.key)) return
    event.preventDefault()
    const index = ADJUST_TYPES.findIndex((option) => option.value === type)
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1
    const nextIndex = (index + step + ADJUST_TYPES.length) % ADJUST_TYPES.length
    const next = ADJUST_TYPES[nextIndex]
    if (!next) return
    changeType(next.value)
    typeButtonsRef.current[nextIndex]?.focus()
  }

  async function save() {
    if (!canSave) return
    setBusy(true)
    setSaveError(null)
    try {
      await inventoryApi.adjust({ productId: item.productId, type, quantity, reason: reason.trim() })
      notify(`${item.productName}: ${onHand} → ${projected}`)
      await onSaved()
      onClose()
    } catch (err) {
      setSaveError(getErrorMessage(err))
      setBusy(false)
    }
  }

  const unit = (n: number) => `${n} ${n === 1 ? 'unit' : 'units'}`
  const saveLabel = busy
    ? 'Saving…'
    : nothingToRemove
    ? 'Nothing to remove'
    : !hasQuantity
    ? 'Enter a quantity'
    : !isValidQuantity
    ? type === 2
      ? `Only ${unit(onHand)} on hand`
      : 'Enter at least 1'
    : isNoChange
    ? 'No change to save'
    : !hasReason
    ? 'Choose a reason'
    : type === 1
    ? `Add ${unit(quantity)}`
    : type === 2
    ? `Remove ${unit(quantity)}`
    : `Set count to ${quantity}`

  const quickAmounts =
    type === 1 ? QUICK_AMOUNTS : type === 2 ? QUICK_AMOUNTS.filter((amount) => amount < onHand) : []

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
          <PrimaryButton type="submit" form="adjust-stock-form" disabled={!canSave} className="h-12 flex-none px-8">
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
          {/* Live before → after, with the change and the resulting stock level */}
          <div className="grid grid-cols-[1fr_auto_1fr] items-center rounded-3xl bg-[#F2F8F4] px-4 py-4">
            <div className="text-center">
              <p className="text-xs text-slate-500">On hand</p>
              <p className="text-3xl font-semibold tabular-nums text-slate-400">{onHand}</p>
              <p className={`mt-0.5 text-xs ${stockLevel(onHand, item.reorderLevel).className}`}>
                {stockLevel(onHand, item.reorderLevel).label}
              </p>
            </div>
            <div className="flex flex-col items-center gap-1 px-2">
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${
                  delta > 0 ? 'bg-[#DCEBE2] text-[#1F5E3B]' : delta < 0 ? 'bg-rose-100 text-rose-700' : 'bg-white text-slate-400'
                }`}
              >
                {delta > 0 ? `+${delta}` : delta < 0 ? `−${Math.abs(delta)}` : '±0'}
              </span>
              <ChevronRight size={14} className="text-slate-300" />
            </div>
            <div className="text-center" aria-live="polite">
              <p className="text-xs font-medium text-[#1F5E3B]">After</p>
              <p className={`text-4xl font-bold tabular-nums ${after.valueClassName}`}>{projected}</p>
              <p className={`mt-0.5 text-xs font-medium ${after.className}`}>{after.label}</p>
            </div>
          </div>

          <div>
            <div
              role="radiogroup"
              aria-label="Adjustment type"
              onKeyDown={handleTypeKeyDown}
              className="grid grid-cols-3 gap-1 rounded-2xl bg-[#F1F4F3] p-1"
            >
              {ADJUST_TYPES.map((option, index) => {
                const selected = type === option.value
                return (
                  <button
                    key={option.value}
                    ref={(element) => {
                      typeButtonsRef.current[index] = element
                    }}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => changeType(option.value)}
                    className={`flex h-11 items-center justify-center gap-2 rounded-xl text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B] ${
                      selected ? 'bg-[#1F5E3B] text-white shadow-sm' : 'text-slate-600 hover:bg-white/60'
                    }`}
                  >
                    <span aria-hidden="true" className="text-base leading-none">
                      {option.symbol}
                    </span>
                    {option.label}
                  </button>
                )
              })}
            </div>
            <p className="mt-2 text-xs text-slate-500">{ADJUST_HINTS[type]}</p>
          </div>

          <div>
            <label htmlFor="adjust-quantity" className="block text-sm font-medium">
              {type === 3 ? 'Counted quantity' : type === 2 ? 'Units to remove' : 'Units to add'}
            </label>
            <div className="mt-1.5 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setQuantity(quantity - 1)}
                disabled={busy || quantity <= minQuantity}
                aria-label="Decrease quantity"
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#F3F5F4] transition hover:bg-[#E9EEEB] active:scale-95 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B]"
              >
                <Minus size={12} />
              </button>
              <input
                id="adjust-quantity"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
                enterKeyHint="done"
                value={quantityText}
                autoFocus
                disabled={busy || nothingToRemove}
                aria-invalid={hasQuantity && !isValidQuantity}
                aria-describedby="adjust-quantity-hint"
                onFocus={(e) => e.target.select()}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, '').slice(0, 6)
                  // Remove can't exceed what's on hand — clamp as they type instead of erroring on save.
                  setQuantityText(digits === '' ? '' : String(Math.min(Number(digits), maxQuantity)))
                  setSaveError(null)
                }}
                className={`h-12 min-w-0 flex-1 rounded-2xl border-0 bg-[#F3F5F4] text-center text-xl font-semibold tabular-nums outline-none transition focus:bg-white focus:ring-2 disabled:opacity-50 ${
                  hasQuantity && !isValidQuantity ? 'ring-2 ring-rose-300 focus:ring-rose-400' : 'focus:ring-[#1F5E3B]'
                }`}
              />
              <button
                type="button"
                onClick={() => setQuantity(quantity + 1)}
                disabled={busy || quantity >= maxQuantity}
                aria-label="Increase quantity"
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#F3F5F4] transition hover:bg-[#E9EEEB] active:scale-95 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B]"
              >
                <Plus size={12} />
              </button>
            </div>

            {(quickAmounts.length > 0 || (type === 2 && onHand > 0)) && (
              <div className="mt-2 grid grid-cols-5 gap-2">
                {quickAmounts.map((amount) => (
                  <QuickChip key={amount} selected={quantity === amount} onClick={() => setQuantity(amount)}>
                    {type === 1 ? `+${amount}` : `−${amount}`}
                  </QuickChip>
                ))}
                {type === 2 && onHand > 0 && (
                  <QuickChip selected={quantity === onHand} onClick={() => setQuantity(onHand)} wide={quickAmounts.length === 0}>
                    All {onHand}
                  </QuickChip>
                )}
              </div>
            )}

            <p id="adjust-quantity-hint" className="mt-2 min-h-4 text-xs text-slate-500">
              {nothingToRemove
                ? 'There is no stock on hand to remove.'
                : type === 2
                ? `Up to ${unit(onHand)} can be removed.`
                : type === 3
                ? 'Enter the number of units you physically counted.'
                : ''}
            </p>
          </div>

          {!isNoChange && isValidQuantity && (projected === 0 || projected <= item.reorderLevel) && (
            <Notice tone={projected === 0 ? 'danger' : 'warning'}>
              {projected === 0
                ? 'This product will be out of stock and can’t be sold until restocked.'
                : `Still at or below the low-stock alert (${item.reorderLevel}).`}
            </Notice>
          )}
        </div>

        <div className="space-y-5">
          <div>
            <label htmlFor="adjust-reason" className="block text-sm font-medium">
              Reason
            </label>
            <p className="text-xs text-slate-500">Required, so every stock change can be traced.</p>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {REASONS[type].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setReason((prev) => (prev === preset ? '' : preset))}
                  aria-pressed={reason === preset}
                  className={`inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B] ${
                    reason === preset ? 'bg-[#1F5E3B] text-white' : 'bg-[#F3F5F4] text-slate-600 hover:bg-[#E9EEEB]'
                  }`}
                >
                  {reason === preset && <Check size={10} />}
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
              placeholder="Or type the reason, e.g. water damage in storage"
              className="mt-2 h-11 w-full rounded-2xl border-0 bg-[#F3F5F4] px-4 text-sm placeholder:text-slate-400 outline-none transition focus:bg-white focus:ring-2 focus:ring-[#1F5E3B]"
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
                  <li key={entry.id} className="flex items-center justify-between gap-3 border-b border-slate-100 py-2 text-sm last:border-b-0">
                    <span className="min-w-0">
                      <span className="block truncate text-[#091413]">{entry.reason || entry.type}</span>
                      <span className="block truncate text-xs text-slate-400">{formatDateTime(entry.createdAt)}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <ChangeAmount value={entry.quantityChange} />
                      <span className="block text-xs tabular-nums text-slate-400">→ {entry.quantityAfter}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 py-2 text-sm text-slate-400">No changes recorded yet.</p>
            )}
          </div>
        </div>

        {saveError && (
          <div className="md:col-span-2">
            <Notice tone="danger" role="alert">
              Couldn’t update stock: {saveError}
            </Notice>
          </div>
        )}
      </form>
    </Modal>
  )
}

function QuickChip({
  selected,
  onClick,
  wide = false,
  children,
}: {
  selected: boolean
  onClick: () => void
  wide?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`h-11 truncate rounded-xl px-1 text-sm font-medium tabular-nums transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B] ${
        wide ? 'col-span-2' : ''
      } ${selected ? 'bg-[#1F5E3B] text-white' : 'bg-[#E6F1EA] text-[#1F5E3B] hover:bg-[#D3E6DB]'}`}
    >
      {children}
    </button>
  )
}

function Notice({
  tone,
  role,
  children,
}: {
  tone: 'warning' | 'danger'
  role?: 'alert'
  children: ReactNode
}) {
  return (
    <p
      role={role}
      className={`flex items-start gap-2.5 rounded-2xl px-4 py-3 text-sm ${
        tone === 'danger' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-800'
      }`}
    >
      <TriangleWarning size={13} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  )
}

/** Stock status for a quantity, matching the list's Out / Low / In stock wording and colours. */
function stockLevel(quantity: number, reorderLevel: number) {
  if (quantity <= 0) return { label: 'Out of stock', className: 'text-rose-600', valueClassName: 'text-rose-600' }
  if (quantity <= reorderLevel) return { label: 'Low stock', className: 'text-amber-700', valueClassName: 'text-amber-700' }
  return { label: 'In stock', className: 'text-slate-500', valueClassName: 'text-[#091413]' }
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
