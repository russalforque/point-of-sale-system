
import {
  ChevronDown,
  History,
  PackagePlus,
  Search,
} from 'lucide-react'
import { useState } from 'react'

import { inventoryApi } from '../api/inventoryApi'

import {
  Badge,
  stockTone,
} from '../components/ui/Badge'

import { Button } from '../components/ui/Button'

import {
  Field,
  Input,
  Select,
} from '../components/ui/Field'

import { Modal } from '../components/ui/Modal'

import { Card, PageHeader } from '../components/ui/Page'

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

export function InventoryPage() {
  const { notify } = useToast()

  const [search, setSearch] = useState('')
  const [stock, setStock] = useState('')
  const [page, setPage] = useState(1)
  const [historyPage, setHistoryPage] = useState(1)

  const [adjust, setAdjust] = useState<InventoryItem | null>(null)
  const [type, setType] = useState(1)
  const [quantity, setQuantity] = useState(1)
  const [reason, setReason] = useState('')

  const [busy, setBusy] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  const list = useAsync(
    () =>
      inventoryApi.list({
        search: search || undefined,
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

  async function submitAdjust() {
    if (!adjust) return

    setBusy(true)

    try {
      await inventoryApi.adjust({
        productId: adjust.productId,
        type,
        quantity,
        reason,
      })

      notify('Stock updated.')
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

  function resetFilters() {
    setSearch('')
    setStock('')
    setPage(1)
  }

  const stats = [
    {
      label: 'Total products',
      value: String(list.data?.totalCount ?? 0),
      accent: 'slate',
    },
    {
      label: 'In stock',
      value: String(
        list.data?.items.filter((item) => item.stockStatus === 'In Stock').length ?? 0,
      ),
      accent: 'emerald',
    },
    {
      label: 'Low stock',
      value: String(
        list.data?.items.filter((item) => item.stockStatus === 'Low Stock').length ?? 0,
      ),
      accent: 'amber',
    },
    {
      label: 'Out of stock',
      value: String(
        list.data?.items.filter((item) => item.stockStatus === 'Out of Stock').length ?? 0,
      ),
      accent: 'rose',
    },
  ]

  return (
    <div className="min-h-full bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-7xl px-4 pb-6 pt-4 sm:px-5 lg:px-6">
        <PageHeader
          title="Inventory"
          subtitle="Stock levels and product movement"
          actions={
            <button
              type="button"
              onClick={() => setShowHistory(true)}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-700 shadow-sm shadow-slate-200/50 transition-all duration-150 hover:-translate-y-0.5 hover:border-slate-300 hover:bg-slate-50 active:translate-y-0"
            >
              <History size={16} />
              <span>History</span>
            </button>
          }
        />

        <section className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {stats.map((stat) => (
            <Card
              key={stat.label}
              className="overflow-hidden border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/50 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  {stat.label}
                </p>
                <span
                  className={`h-2.5 w-2.5 rounded-full ${
                    stat.accent === 'slate'
                      ? 'bg-slate-400'
                      : stat.accent === 'emerald'
                        ? 'bg-emerald-400'
                        : stat.accent === 'amber'
                          ? 'bg-amber-400'
                          : 'bg-rose-400'
                  } shadow-sm`}
                />
              </div>

              <p className="mt-4 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
                {stat.value}
              </p>

              <div className="mt-3 flex items-center gap-2 text-[11px] text-slate-500">
                <span
                  className={`rounded-full px-2 py-1 font-medium ${
                    stat.accent === 'slate'
                      ? 'bg-slate-100 text-slate-600'
                      : stat.accent === 'emerald'
                        ? 'bg-emerald-100 text-emerald-700'
                        : stat.accent === 'amber'
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-rose-100 text-rose-700'
                  }`}
                >
                  Live
                </span>
                <span>Updated now</span>
              </div>
            </Card>
          ))}
        </section>

        <Card className="mb-4 overflow-hidden border border-slate-200 bg-white shadow-sm shadow-slate-200/50">
          <div className="flex flex-col gap-3 p-3 sm:p-4 md:flex-row md:items-center">
            <div className="relative min-w-0 flex-1">
              <Search
                size={18}
                className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
              />

              <input
                autoFocus
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  setPage(1)
                }}
                placeholder="Search product or SKU..."
                className="h-12 w-full rounded-full border border-slate-200 bg-slate-50 pl-11 pr-4 text-sm text-slate-700 outline-none transition-all duration-150 placeholder:text-slate-400 focus:border-slate-900 focus:bg-white focus:ring-2 focus:ring-slate-200"
              />
            </div>

            <div className="relative w-full md:w-52">
              <label className="sr-only">Stock status</label>
              <Select
                value={stock}
                onChange={(e) => {
                  setStock(e.target.value)
                  setPage(1)
                }}
                className="h-12 w-full appearance-none rounded-full border border-slate-900 bg-white pr-10 text-sm text-slate-700 shadow-sm shadow-slate-200/60 outline-none transition-all duration-150 focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
              >
                <option value="">All inventory</option>
                <option value="In Stock">In stock</option>
                <option value="Low Stock">Low stock</option>
                <option value="Out of Stock">Out of stock</option>
              </Select>
              <ChevronDown
                size={16}
                className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-slate-600"
              />
            </div>

            {(search || stock) && (
              <button
                type="button"
                onClick={resetFilters}
                className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-600 transition-all duration-150 hover:border-slate-300 hover:bg-slate-50"
              >
                Clear
              </button>
            )}
          </div>
        </Card>

        <main className="min-w-0">
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/50">
            <div className="flex flex-col gap-2 border-b border-slate-200 bg-slate-50/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Inventory records
                </p>
                <h2 className="mt-1 text-lg font-semibold text-slate-900">Product stock</h2>
              </div>

              {list.data && (
                <div className="inline-flex items-center rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-600 shadow-sm ring-1 ring-slate-200">
                  {list.data.items.length} shown
                </div>
              )}
            </div>

            <div className="p-2 sm:p-3">
              {list.loading && (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6">
                  <Spinner />
                </div>
              )}

              {list.error && (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <ErrorState
                    message={list.error}
                    onRetry={() => void list.reload()}
                  />
                </div>
              )}

              {!list.loading && !list.error && list.data && list.data.items.length === 0 && (
                <div className="rounded-2xl border border-slate-200 bg-slate-50">
                  <EmptyState
                    title="No inventory records"
                    hint="Try another product, SKU, or stock status."
                  />
                </div>
              )}

              {!list.loading && !list.error && list.data && list.data.items.length > 0 && (
                <div className="overflow-hidden rounded-2xl border border-slate-200">
                  <div className="hidden min-h-10 grid-cols-[minmax(180px,2fr)_120px_100px_100px_130px_155px_90px] items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 xl:grid">
                    <div>Product</div>
                    <div>SKU</div>
                    <div className="text-right">Stock</div>
                    <div className="text-right">Reorder</div>
                    <div>Status</div>
                    <div>Updated</div>
                    <div />
                  </div>

                  <div>
                    {list.data.items.map((row) => (
                      <InventoryRow
                        key={row.productId}
                        row={row}
                        onAdjust={() => setAdjust(row)}
                      />
                    ))}
                  </div>

                  <div className="border-t border-slate-200 bg-slate-50/60 px-2 py-2 sm:px-3">
                    <Pagination
                      page={list.data.page}
                      totalPages={list.data.totalPages}
                      onPage={setPage}
                    />
                  </div>
                </div>
              )}
            </div>
          </section>
        </main>
      </div>

      {adjust && (
        <Modal
          title={`Adjust stock · ${adjust.productName}`}
          onClose={() => setAdjust(null)}
          footer={
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setAdjust(null)}>
                Cancel
              </Button>

              <Button
                onClick={() => void submitAdjust()}
                disabled={busy || quantity < 1 || !reason.trim()}
              >
                {busy ? 'Saving...' : 'Apply adjustment'}
              </Button>
            </div>
          }
        >
          <div className="border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-[0.18em] text-slate-500">
                Current stock
              </span>
              <span className="text-xl font-bold text-slate-900">{adjust.stockQuantity}</span>
            </div>
          </div>

          <div className="mt-3 space-y-3">
            <Field label="Adjustment type">
              <Select
                value={type}
                onChange={(e) => setType(Number(e.target.value))}
              >
                <option value={1}>Increase</option>
                <option value={2}>Decrease</option>
                <option value={3}>Adjustment (+)</option>
              </Select>
            </Field>

            <Field label="Quantity">
              <Input
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))}
              />
            </Field>

            <Field label="Reason">
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Delivery, count correction, damage..."
              />
            </Field>
          </div>
        </Modal>
      )}

      {showHistory && (
        <Modal
          title="Inventory history"
          wide
          onClose={() => setShowHistory(false)}
        >
          {history.loading && <Spinner />}

          {history.error && (
            <ErrorState
              message={history.error}
              onRetry={() => void history.reload()}
            />
          )}

          {!history.loading && history.data && history.data.items.length === 0 && (
            <EmptyState title="No movements yet" />
          )}

          {history.data && history.data.items.length > 0 && (
            <div className="overflow-hidden rounded-2xl border border-slate-200">
              <div className="overflow-x-auto">
                <table className="w-full min-w-162.5 border-collapse text-sm">
                  <thead className="bg-slate-50 text-[10px] uppercase tracking-[0.18em] text-slate-500">
                    <tr className="border-b border-slate-200">
                      <th className="px-3 py-2 text-left">When</th>
                      <th className="px-3 py-2 text-left">Product</th>
                      <th className="px-3 py-2 text-left">Type</th>
                      <th className="px-3 py-2 text-right">Change</th>
                      <th className="px-3 py-2 text-right">After</th>
                      <th className="px-3 py-2 text-left">Reason</th>
                    </tr>
                  </thead>

                  <tbody>
                    {history.data.items.map((row) => (
                      <tr key={row.id} className="border-b border-slate-200 last:border-b-0">
                        <td className="px-3 py-3 text-xs text-slate-500">
                          {formatDateTime(row.createdAt)}
                        </td>
                        <td className="px-3 py-3 font-medium text-slate-800">{row.productName}</td>
                        <td className="px-3 py-3 text-slate-600">{row.type}</td>
                        <td
                          className={`px-3 py-3 text-right font-bold ${
                            row.quantityChange < 0 ? 'text-red-700' : 'text-green-700'
                          }`}
                        >
                          {row.quantityChange > 0 ? `+${row.quantityChange}` : row.quantityChange}
                        </td>
                        <td className="px-3 py-3 text-right font-semibold text-slate-800">
                          {row.quantityAfter}
                        </td>
                        <td className="px-3 py-3 text-slate-600">{row.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="border-t border-slate-200 bg-slate-50/60 px-3 py-2">
                <Pagination
                  page={history.data.page}
                  totalPages={history.data.totalPages}
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

function InventoryRow({ row, onAdjust }: { row: InventoryItem; onAdjust: () => void }) {
  return (
    <div className="border-b border-slate-200 last:border-b-0 transition-colors duration-150 hover:bg-slate-50/80">
      <div className="hidden min-h-12 grid-cols-[minmax(180px,2fr)_120px_100px_100px_130px_155px_90px] items-center gap-2 px-3 xl:grid">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">{row.productName}</p>
        </div>

        <div className="font-mono text-xs text-slate-500">{row.sku}</div>
        <div className="text-right text-sm font-bold text-slate-900">{row.stockQuantity}</div>
        <div className="text-right text-sm text-slate-600">{row.reorderLevel}</div>

        <div>
          <Badge tone={stockTone(row.stockStatus)}>{row.stockStatus}</Badge>
        </div>

        <div className="text-xs text-slate-500">{formatDateTime(row.lastUpdated)}</div>

        <div className="flex justify-end">
          <AdjustButton onClick={onAdjust} />
        </div>
      </div>

      <div className="flex min-h-14 items-center gap-3 px-3 py-2 xl:hidden">
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="line-clamp-2 text-sm font-semibold leading-5 text-slate-900">
                {row.productName}
              </p>
              <p className="mt-0.5 truncate font-mono text-[11px] text-slate-500">{row.sku}</p>
            </div>

            <Badge tone={stockTone(row.stockStatus)}>{row.stockStatus}</Badge>
          </div>

          <div className="mt-1.5 flex items-center gap-4 text-xs text-slate-600">
            <span>
              Stock:
              <strong className="ml-1 text-slate-900">{row.stockQuantity}</strong>
            </span>
            <span>
              Reorder:
              <strong className="ml-1 text-slate-900">{row.reorderLevel}</strong>
            </span>
            <span className="hidden sm:inline">{formatDateTime(row.lastUpdated)}</span>
          </div>
        </div>

        <AdjustButton onClick={onAdjust} />
      </div>
    </div>
  )
}

function AdjustButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Adjust stock"
      aria-label="Adjust stock"
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition-all duration-150 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 active:scale-[0.98]"
    >
      <PackagePlus size={17} />
    </button>
  )
}

