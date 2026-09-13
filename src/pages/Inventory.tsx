import { useState } from 'react'
import {
  History,
  PackagePlus,
  Search,
} from '../components/ui/Icons'

import { inventoryApi } from '../api/inventoryApi'

import {
  Badge,
  stockTone,
} from '../components/ui/Badge'

import { Button } from '../components/ui/Button'
import { Field, Input } from '../components/ui/Field'
import { Modal } from '../components/ui/Modal'
import { PageHeader } from '../components/ui/Page'
import { Pagination } from '../components/ui/Pagination'

import {
  EmptyState,
  ErrorState,
  Spinner,
} from '../components/ui/States'

import { useToast } from '../context/ToastContext'
import { useAsync } from '../hooks/useAsync'
import type { InventoryItem } from '../types'
import { getErrorMessage } from '../utils/errors'
import { formatDateTime } from '../utils/format'

// Import Mobile Component from subfolder
import { MobileInventory } from './mobile/MobileInventory'

type StockFilter = '' | 'In Stock' | 'Low Stock' | 'Out of Stock'

/* =============================================================
   MAIN EXPORT: 100% PURE RESPONSIVE CSS
============================================================= */

export function InventoryPage() {
  return (
    <div className="w-full">
      {/* 📱 Mobile: Shows only on screens < 768px */}
      <div className="block md:hidden">
        <MobileInventory />
      </div>

      {/* 💻 Desktop: Shows only on screens ≥ 768px */}
      <div className="hidden md:block">
        <DesktopInventory />
      </div>
    </div>
  )
}

/* =============================================================
   DESKTOP INVENTORY IMPLEMENTATION
============================================================= */

function DesktopInventory() {
  const { notify } = useToast()

  const [search, setSearch] = useState('')
  const [stock, setStock] = useState<StockFilter>('')
  const [page, setPage] = useState(1)
  const [historyPage, setHistoryPage] = useState(1)

  const [adjust, setAdjust] = useState<InventoryItem | null>(null)
  const [type, setType] = useState<number>(1)
  const [quantity, setQuantity] = useState(1)
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
            pageSize: 8,
          })
        : Promise.resolve(null),
    [historyPage, showHistory],
  )

  const items: InventoryItem[] = list.data?.items ?? []
  const totalCount = list.data?.totalCount ?? items.length
  const inStockCount = items.filter((item) => item.stockStatus === 'In Stock').length
  const lowStockCount = items.filter((item) => item.stockStatus === 'Low Stock').length
  const outOfStockCount = items.filter((item) => item.stockStatus === 'Out of Stock').length

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

      notify('Stock quantity successfully adjusted.')
      setAdjust(null)
      setReason('')
      setQuantity(1)

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

  return (
    <div className="min-h-screen bg-[#F6F8F7] text-[#091413] pb-24 antialiased selection:bg-[#285A48] selection:text-white">
      <div className="mx-auto max-w-7xl px-3.5 pt-4 sm:px-6 sm:pt-6 md:px-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between pb-2">
          <PageHeader
            title="Inventory"
            subtitle="Real-time stock ledger, reorder levels, and log history"
          />
          <button
            type="button"
            onClick={() => setShowHistory(true)}
            className="inline-flex min-h-11 items-center justify-center gap-2 self-start rounded-2xl border border-[#E5EBE7] bg-white px-4 py-2.5 text-xs font-bold text-[#285A48] shadow-2xs transition-all hover:bg-[#EAF1EE] active:scale-95 touch-manipulation sm:self-auto"
          >
            <History size={16} />
            <span>Movement History</span>
          </button>
        </div>

        {/* KPI METRICS */}
        <div className="mt-2 grid grid-cols-2 gap-2.5 sm:gap-3 md:grid-cols-4">
          <MetricCard
            label="Total SKUs"
            value={totalCount}
            isSelected={stock === ''}
            onClick={() => handleFilterStatus('')}
          />
          <MetricCard
            label="In Stock"
            value={inStockCount}
            indicator="emerald"
            isSelected={stock === 'In Stock'}
            onClick={() => handleFilterStatus('In Stock')}
          />
          <MetricCard
            label="Low Stock"
            value={lowStockCount}
            indicator="amber"
            isSelected={stock === 'Low Stock'}
            onClick={() => handleFilterStatus('Low Stock')}
          />
          <MetricCard
            label="Out of Stock"
            value={outOfStockCount}
            indicator="rose"
            isSelected={stock === 'Out of Stock'}
            onClick={() => handleFilterStatus('Out of Stock')}
          />
        </div>

        {/* TOOLBAR */}
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-1 rounded-2xl border border-[#E5EBE7] bg-white p-1 self-start sm:self-auto shadow-2xs">
            <button
              type="button"
              onClick={() => handleFilterStatus('')}
              className={`rounded-xl px-3.5 py-1.5 text-xs font-bold transition-all active:scale-95 touch-manipulation ${
                stock === ''
                  ? 'bg-[#285A48] text-white shadow-xs'
                  : 'text-slate-500 hover:text-[#091413]'
              }`}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => handleFilterStatus('In Stock')}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-bold transition-all active:scale-95 touch-manipulation ${
                stock === 'In Stock'
                  ? 'bg-[#285A48] text-white shadow-xs'
                  : 'text-slate-500 hover:text-[#091413]'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${stock === 'In Stock' ? 'bg-emerald-300' : 'bg-emerald-500'}`} />
              In Stock
            </button>
            <button
              type="button"
              onClick={() => handleFilterStatus('Low Stock')}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-bold transition-all active:scale-95 touch-manipulation ${
                stock === 'Low Stock'
                  ? 'bg-[#285A48] text-white shadow-xs'
                  : 'text-slate-500 hover:text-[#091413]'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${stock === 'Low Stock' ? 'bg-amber-300' : 'bg-amber-500'}`} />
              Low Stock
            </button>
            <button
              type="button"
              onClick={() => handleFilterStatus('Out of Stock')}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-bold transition-all active:scale-95 touch-manipulation ${
                stock === 'Out of Stock'
                  ? 'bg-[#285A48] text-white shadow-xs'
                  : 'text-slate-500 hover:text-[#091413]'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${stock === 'Out of Stock' ? 'bg-rose-300' : 'bg-rose-500'}`} />
              Depleted
            </button>
          </div>

          <div className="flex items-center gap-2 flex-1 sm:max-w-xs md:max-w-sm sm:justify-end">
            <div className="relative w-full">
              <Search
                size={16}
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                value={search}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  setSearch(e.target.value)
                  setPage(1)
                }}
                placeholder="Search product or SKU..."
                className="h-11 w-full rounded-2xl border border-[#E5EBE7] bg-white pl-10 pr-9 text-xs font-semibold text-[#091413] placeholder-slate-400 outline-none transition focus:border-[#285A48] focus:ring-2 focus:ring-[#285A48]/15"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => {
                    setSearch('')
                    setPage(1)
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1 text-slate-400 hover:text-slate-700"
                  title="Clear search"
                >
                  <ClearIcon size={14} />
                </button>
              )}
            </div>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={resetFilters}
                className="flex h-11 shrink-0 items-center justify-center rounded-2xl border border-[#E5EBE7] bg-white px-3.5 text-xs font-bold text-slate-600 shadow-2xs hover:bg-[#F0F5F2] hover:text-[#091413] active:scale-95 touch-manipulation"
              >
                Reset
              </button>
            )}
          </div>
        </div>

        {/* DESKTOP TABLE */}
        <div className="mt-4 overflow-hidden rounded-3xl border border-[#E5EBE7] bg-white shadow-sm">
          {list.loading && (
            <div className="py-20 flex flex-col items-center justify-center text-center">
              <Spinner />
              <p className="mt-3 text-xs font-semibold text-slate-400">
                Updating inventory levels...
              </p>
            </div>
          )}

          {list.error && (
            <div className="p-6">
              <ErrorState message={list.error} onRetry={() => void list.reload()} />
            </div>
          )}

          {!list.loading && !list.error && items.length === 0 && (
            <div className="p-10 text-center">
              <EmptyState
                title="No inventory records found"
                hint={
                  hasActiveFilters
                    ? 'Try adjusting your search criteria or resetting filters.'
                    : 'Add products to begin tracking stock levels.'
                }
              />
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-[#285A48] underline hover:text-[#1a3b2f]"
                >
                  Clear active filters
                </button>
              )}
            </div>
          )}

          {!list.loading && !list.error && items.length > 0 && (
            <>
              <div className="w-full overflow-x-auto">
                <table className="w-full text-left text-xs text-slate-600">
                  <thead className="border-b border-[#E5EBE7] bg-[#FBFDFB] text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    <tr>
                      <th className="py-3.5 pl-6 pr-3">Product</th>
                      <th className="py-3.5 px-3 text-right">Stock On Hand</th>
                      <th className="py-3.5 px-3 text-right">Par Level</th>
                      <th className="py-3.5 px-3 text-center">Status</th>
                      <th className="py-3.5 px-3">Last Updated</th>
                      <th className="py-3.5 pl-3 pr-6 text-right">Action</th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-slate-100">
                    {items.map((row) => (
                      <tr key={row.productId} className="transition-colors hover:bg-[#F9FAF9]">
                        <td className="py-3.5 pl-6 pr-3">
                          <div className="flex flex-col">
                            <span className="font-bold text-slate-900 text-xs">
                              {row.productName}
                            </span>
                            <span className="text-[11px] font-semibold text-slate-400 mt-0.5">
                              {row.sku}
                            </span>
                          </div>
                        </td>
                        <td className="py-3.5 px-3 text-right">
                          <span
                            className={`font-black text-sm ${
                              row.stockQuantity <= 0
                                ? 'text-rose-600'
                                : row.stockStatus === 'Low Stock'
                                ? 'text-amber-600'
                                : 'text-slate-900'
                            }`}
                          >
                            {row.stockQuantity}
                          </span>
                        </td>
                        <td className="py-3.5 px-3 text-right text-xs font-semibold text-slate-500">
                          {row.reorderLevel}
                        </td>
                        <td className="py-3.5 px-3 text-center">
                          <Badge tone={stockTone(row.stockStatus)}>
                            {row.stockStatus}
                          </Badge>
                        </td>
                        <td className="py-3.5 px-3 text-xs text-slate-400 font-medium">
                          {formatDateTime(row.lastUpdated)}
                        </td>
                        <td className="py-3.5 pl-3 pr-6 text-right">
                          <button
                            type="button"
                            onClick={() => {
                              setAdjust(row)
                              setType(1)
                              setQuantity(1)
                              setReason('')
                            }}
                            title={`Adjust stock for ${row.productName}`}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[#E5EBE7] bg-white text-[#285A48] shadow-2xs hover:bg-[#EAF1EE] active:scale-95 transition-all touch-manipulation"
                          >
                            <PackagePlus size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="border-t border-[#E5EBE7] bg-[#FBFDFB] px-4 py-3 sm:px-6">
                <Pagination
                  page={list.data?.page ?? 1}
                  totalPages={list.data?.totalPages ?? 1}
                  onPage={setPage}
                />
              </div>
            </>
          )}
        </div>
      </div>

      {/* ADJUST MODAL */}
      {adjust && (
        <Modal
          title="Stock Adjustment"
          onClose={() => setAdjust(null)}
          footer={
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end w-full">
              <Button variant="secondary" onClick={() => setAdjust(null)}>
                Cancel
              </Button>
              <Button
                onClick={() => void submitAdjust()}
                disabled={busy || quantity < 1}
              >
                {busy ? 'Saving...' : 'Confirm Adjustment'}
              </Button>
            </div>
          }
        >
          <div className="rounded-2xl border border-[#E5EBE7] bg-[#F6F8F7] p-3.5">
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              Selected Item
            </p>
            <div className="mt-1 flex items-baseline justify-between">
              <div>
                <p className="font-extrabold text-sm text-[#091413]">{adjust.productName}</p>
                <p className="text-[10px] font-semibold text-slate-400">{adjust.sku}</p>
              </div>
              <div className="text-right">
                <span className="text-xs text-slate-400">Current Stock</span>
                <p className="text-xl font-black text-[#285A48]">{adjust.stockQuantity}</p>
              </div>
            </div>
          </div>

          <div className="mt-4 space-y-4 text-xs">
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block mb-1.5">
                Adjustment Action
              </label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setType(1)}
                  className={`flex min-h-11 items-center justify-center rounded-2xl text-xs font-bold transition-all active:scale-95 ${
                    type === 1
                      ? 'bg-[#285A48] text-white shadow-sm'
                      : 'border border-[#E5EBE7] bg-white text-slate-600 hover:bg-[#F0F5F2]'
                  }`}
                >
                  + Add Stock
                </button>
                <button
                  type="button"
                  onClick={() => setType(2)}
                  className={`flex min-h-11 items-center justify-center rounded-2xl text-xs font-bold transition-all active:scale-95 ${
                    type === 2
                      ? 'bg-rose-600 text-white shadow-sm'
                      : 'border border-[#E5EBE7] bg-white text-slate-600 hover:bg-[#F0F5F2]'
                  }`}
                >
                  - Deduct
                </button>
                <button
                  type="button"
                  onClick={() => setType(3)}
                  className={`flex min-h-11 items-center justify-center rounded-2xl text-xs font-bold transition-all active:scale-95 ${
                    type === 3
                      ? 'bg-slate-800 text-white shadow-sm'
                      : 'border border-[#E5EBE7] bg-white text-slate-600 hover:bg-[#F0F5F2]'
                  }`}
                >
                  = Count Fix
                </button>
              </div>
            </div>

            <div>
              <Field label="Quantity Units">
                <Input
                  type="number"
                  min={1}
                  value={quantity}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuantity(Math.max(1, Number(e.target.value)))}
                />
              </Field>

              <div className="mt-2 flex gap-1.5">
                {[1, 5, 10, 25, 50].map((num) => (
                  <button
                    key={num}
                    type="button"
                    onClick={() => setQuantity(num)}
                    className={`flex-1 rounded-xl py-1 text-[11px] font-bold transition-colors ${
                      quantity === num
                        ? 'bg-[#285A48] text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    +{num}
                  </button>
                ))}
              </div>
            </div>

            <Field label="Audit Reason / Note">
              <Input
                value={reason}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setReason(e.target.value)}
                placeholder="e.g. New delivery, supplier return, physical discrepancy"
              />
            </Field>
          </div>
        </Modal>
      )}

      {/* MOVEMENT HISTORY MODAL */}
      {showHistory && (
        <Modal
          title="Stock Movement History"
          wide
          onClose={() => setShowHistory(false)}
        >
          {history.loading && (
            <div className="py-16 flex flex-col items-center justify-center">
              <Spinner />
              <p className="mt-2 text-xs font-semibold text-slate-400">Loading audit history...</p>
            </div>
          )}

          {history.error && (
            <div className="p-4">
              <ErrorState message={history.error} onRetry={() => void history.reload()} />
            </div>
          )}

          {!history.loading && (history.data?.items ?? []).length === 0 && (
            <div className="py-12 text-center">
              <EmptyState title="No stock movements logged yet" />
            </div>
          )}

          {(history.data?.items ?? []).length > 0 && (
            <div className="overflow-hidden rounded-2xl border border-[#E5EBE7]">
              <div className="w-full overflow-x-auto">
                <table className="w-full text-left text-xs text-slate-600">
                  <thead className="border-b border-[#E5EBE7] bg-[#FBFDFB] text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    <tr>
                      <th className="py-3 px-3.5">Timestamp</th>
                      <th className="py-3 px-3">Product</th>
                      <th className="py-3 px-3">Type</th>
                      <th className="py-3 px-3 text-right">Change</th>
                      <th className="py-3 px-3 text-right">Resulting Stock</th>
                      <th className="py-3 px-3.5">Reason</th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-slate-100">
                    {(history.data?.items ?? []).map((row: any) => (
                      <tr key={row.id} className="hover:bg-[#F9FAF9]">
                        <td className="py-3 px-3.5 text-[11px] text-slate-400 font-medium">
                          {formatDateTime(row.createdAt)}
                        </td>
                        <td className="py-3 px-3 font-bold text-slate-900">
                          {row.productName}
                        </td>
                        <td className="py-3 px-3 text-slate-600 font-semibold">{row.type}</td>
                        <td
                          className={`py-3 px-3 text-right font-black ${
                            row.quantityChange < 0
                              ? 'text-rose-600'
                              : 'text-[#285A48]'
                          }`}
                        >
                          {row.quantityChange > 0
                            ? `+${row.quantityChange}`
                            : row.quantityChange}
                        </td>
                        <td className="py-3 px-3 text-right font-black text-slate-900">
                          {row.quantityAfter}
                        </td>
                        <td className="py-3 px-3.5 text-slate-500 italic">
                          {row.reason || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="border-t border-[#E5EBE7] bg-[#FBFDFB] px-4 py-2.5">
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

function MetricCard({
  label,
  value,
  indicator,
  isSelected = false,
  onClick,
}: {
  label: string
  value: string | number
  indicator?: 'emerald' | 'amber' | 'rose'
  isSelected?: boolean
  onClick: () => void
}) {
  const dotColor =
    indicator === 'emerald'
      ? 'bg-emerald-500'
      : indicator === 'amber'
      ? 'bg-amber-500'
      : indicator === 'rose'
      ? 'bg-rose-500'
      : null

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative rounded-3xl border p-4 text-left transition-all active:scale-[0.98] touch-manipulation ${
        isSelected
          ? 'border-[#285A48] bg-white ring-2 ring-[#285A48]/20 shadow-sm'
          : 'border-[#E5EBE7] bg-white hover:border-slate-300'
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
          {label}
        </span>
        {dotColor && <span className={`h-2 w-2 rounded-full ${dotColor} animate-pulse`} />}
      </div>
      <p className="mt-2 text-xl font-black tracking-tight text-[#091413] sm:text-2xl">
        {value}
      </p>
    </button>
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
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

export default InventoryPage