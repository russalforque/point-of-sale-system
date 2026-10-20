import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { inventoryApi } from '../../api/inventoryApi'
import { productApi } from '../../api/productApi'
import { purchaseOrderApi } from '../../api/purchaseOrderApi'
import { stockApi } from '../../api/stockApi'
import { supplierApi } from '../../api/supplierApi'
import { Badge } from '../../components/ui/Badge'
import { AmountInput } from '../../components/ui/AmountInput'
import { Check, Plus, Trash2 } from '../../components/ui/Icons'
import { DateField, PickerField, TextField } from '../../components/ui/MobileKit'
import { ConfirmDialog, Modal } from '../../components/ui/Modal'
import { Pagination } from '../../components/ui/Pagination'
import { EmptyState, ErrorState, Spinner } from '../../components/ui/States'
import { BackLayer, Panel, PillGroup, QuantityStepper, ReasonField, SearchBox, WorkPage } from '../../components/ui/WorkPage'
import { useAuth } from '../../context/AuthContext'
import { useSettings } from '../../context/SettingsContext'
import { useToast } from '../../context/ToastContext'
import { useAsync } from '../../hooks/useAsync'
import { useDebounced } from '../../hooks/useDebounced'
import type { PurchaseOrder, PurchaseOrderStatus } from '../../types'
import { roundMoney, sumMoney } from '../../utils/amount'
import { getErrorMessage } from '../../utils/errors'
import { formatDate, formatDateTime, formatMoney } from '../../utils/format'

type Filter = 'open' | PurchaseOrderStatus | 'all'
type Group = 'open' | 'Received' | 'Cancelled' | 'all'

const OPEN_STATUSES: PurchaseOrderStatus[] = ['Draft', 'Ordered', 'Partially received']

const GROUPS: { key: Group; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'Received', label: 'Received' },
  { key: 'Cancelled', label: 'Cancelled' },
  { key: 'all', label: 'All' },
]

const OPEN_STEPS: { key: Filter; label: string }[] = [
  { key: 'open', label: 'All open' },
  { key: 'Draft', label: 'Drafts' },
  { key: 'Ordered', label: 'Awaiting delivery' },
  { key: 'Partially received', label: 'Partly received' },
]

function statusTone(status: PurchaseOrderStatus): 'green' | 'amber' | 'red' | 'gray' | 'blue' {
  if (status === 'Received') return 'green'
  if (status === 'Partially received') return 'amber'
  if (status === 'Ordered') return 'blue'
  if (status === 'Cancelled') return 'red'
  return 'gray'
}

function todayKey(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** Ordered (fully or partly outstanding) and the expected delivery day has passed. */
function isOverdue(order: PurchaseOrder): boolean {
  if (order.status !== 'Ordered' && order.status !== 'Partially received') return false
  return Boolean(order.expectedDate && order.expectedDate.slice(0, 10) < todayKey())
}

function tracksDelivery(status: PurchaseOrderStatus): boolean {
  return status === 'Ordered' || status === 'Partially received' || status === 'Received'
}

function ReceiveProgress({ received, ordered, compact }: { received: number; ordered: number; compact?: boolean }) {
  const share = ordered > 0 ? Math.min(1, received / ordered) : 0
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span
        role="progressbar"
        aria-label="Units received"
        aria-valuemin={0}
        aria-valuemax={ordered}
        aria-valuenow={received}
        className={`flex-1 overflow-hidden rounded-full bg-slate-100 ${compact ? 'h-1.5' : 'h-2'}`}
      >
        <span className={`block h-full rounded-full ${share >= 1 ? 'bg-brand' : 'bg-amber-500'}`} style={{ width: `${share * 100}%` }} />
      </span>
      <span className="shrink-0 text-xs tabular-nums text-slate-500">
        {received}/{ordered}
      </span>
    </span>
  )
}

type EditorTarget = { mode: 'new'; lowStock?: boolean; supplierId?: number } | { mode: 'edit'; order: PurchaseOrder }

export function PurchaseOrdersPage() {
  const { settings } = useSettings()
  const [params, setParams] = useSearchParams()
  const money = (value: number) => formatMoney(value, settings.currencySymbol)
  const [filter, setFilter] = useState<Filter>('open')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [openedId, setOpenedId] = useState<number | null>(null)
  const [editor, setEditor] = useState<EditorTarget | null>(null)
  const [editorDirty, setEditorDirty] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const q = useDebounced(search)

  // Deep links: /purchase-orders?new=low-stock (from reports) or ?supplier=ID (from a supplier).
  useEffect(() => {
    const kind = params.get('new')
    const supplier = Number(params.get('supplier')) || undefined
    if (kind || supplier) {
      setEditor({ mode: 'new', lowStock: kind === 'low-stock', supplierId: supplier })
      setParams({}, { replace: true })
    }
  }, [params, setParams])

  const list = useAsync(
    () => purchaseOrderApi.list({ status: filter === 'all' ? undefined : filter, search: q || undefined, page, pageSize: 15 }),
    [filter, q, page],
  )
  const counts = useAsync(() => purchaseOrderApi.counts(), [])

  async function refresh() {
    await Promise.all([list.reload(), counts.reload()])
  }

  const countFor = (key: Filter): number | undefined => {
    if (!counts.data) return undefined
    if (key === 'all') return Object.values(counts.data).reduce((sum, value) => sum + value, 0)
    if (key === 'open') return counts.data.Draft + counts.data.Ordered + counts.data['Partially received']
    return counts.data[key]
  }

  function changeFilter(next: Filter) {
    setFilter(next)
    setPage(1)
  }

  function closeDialogs() {
    setOpenedId(null)
    setEditor(null)
    setEditorDirty(false)
    setConfirmDiscard(false)
  }

  const group: Group = filter === 'open' || OPEN_STATUSES.includes(filter as PurchaseOrderStatus) ? 'open' : (filter as Group)
  const items = list.data?.items ?? []
  const openLabel = OPEN_STEPS.find((step) => step.key === filter)?.label.toLowerCase()

  return (
    <WorkPage
      title="Purchase orders"
      subtitle="Order stock from suppliers, then receive it when the delivery arrives."
      maxWidth="max-w-6xl"
      actions={
        <button
          type="button"
          onClick={() => setEditor({ mode: 'new' })}
          className="inline-flex h-11 items-center gap-2 rounded-full bg-brand px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-hover active:scale-95"
        >
          <Plus size={12} />
          New order
        </button>
      }
    >
      <Panel className="@container/list mt-5">
        {/* Narrow: status → stage → search, so the stage sits right under the filter it refines.
            Wide: status and search share a row, the stage goes below. */}
        <div className="flex flex-col gap-3 @3xl/list:flex-row @3xl/list:flex-wrap @3xl/list:items-center">
          <PillGroup
            label="Order status"
            options={GROUPS.map((option) => ({ ...option, count: countFor(option.key) }))}
            value={group}
            onChange={(next) => changeFilter(next)}
          />
          {group === 'open' && (
            <div className="@3xl/list:order-last @3xl/list:basis-full">
              <PillGroup
                size="sm"
                label="Open order stage"
                options={OPEN_STEPS.map((option) => ({ ...option, count: countFor(option.key) }))}
                value={filter}
                onChange={changeFilter}
              />
            </div>
          )}
          <SearchBox
            label="Search purchase orders"
            value={search}
            onChange={(next) => {
              setSearch(next)
              setPage(1)
            }}
            placeholder="PO number or supplier"
            className="@3xl/list:ml-auto @3xl/list:w-80"
          />
        </div>

        {items.length > 0 && (
          <div
            aria-hidden="true"
            className="mt-4 hidden grid-cols-[minmax(0,1fr)_9.5rem_10rem_8.5rem_8rem] gap-4 border-b border-slate-100 px-2 pb-2 text-xs font-medium text-slate-400 @3xl/list:grid"
          >
            <span>Order</span>
            <span>Status</span>
            <span>Received</span>
            <span>Expected</span>
            <span className="text-right">Total</span>
          </div>
        )}

        <div className={`mt-2 transition-opacity ${list.loading && list.data ? 'opacity-60' : ''}`} aria-busy={list.loading}>
          {list.loading && !list.data && (
            <div className="py-16">
              <Spinner label="Loading orders…" />
            </div>
          )}
          {list.error && !list.data && <ErrorState message={list.error} onRetry={() => void list.reload()} />}
          {list.error && list.data && (
            <p role="alert" className="mb-2 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
              Couldn’t refresh — showing the last loaded orders.{' '}
              <button type="button" onClick={() => void list.reload()} className="font-semibold underline">
                Try again
              </button>
            </p>
          )}
          {list.data && items.length === 0 && (
            <div className="py-10 text-center">
              {q ? (
                <>
                  <EmptyState title="No matching orders" hint={`Nothing matches “${q}”. Try a PO number or supplier name.`} />
                  <button type="button" onClick={() => setSearch('')} className="h-11 rounded-full bg-field px-5 text-sm font-medium text-ink active:bg-line">
                    Clear search
                  </button>
                </>
              ) : (
                <>
                  <EmptyState
                    title={group === 'open' ? `No ${openLabel === 'all open' ? 'open orders' : openLabel ?? 'open orders'}` : 'No purchase orders here'}
                    hint="Create an order for a supplier. Items that are running low can be added in one tap."
                  />
                  <button
                    type="button"
                    onClick={() => setEditor({ mode: 'new' })}
                    className="h-11 rounded-full bg-brand px-5 text-sm font-semibold text-white active:scale-95"
                  >
                    New order
                  </button>
                </>
              )}
            </div>
          )}

          <ul>
            {items.map((order) => (
              <li key={order.id} className="border-b border-slate-100 last:border-b-0">
                <OrderRow order={order} money={money} onOpen={() => setOpenedId(order.id)} />
              </li>
            ))}
          </ul>
          {list.data && list.data.totalPages > 1 && (
            <div className="mt-2 border-t border-slate-100">
              <Pagination page={list.data.page} totalPages={list.data.totalPages} onPage={setPage} />
            </div>
          )}
        </div>
      </Panel>

      {/* One back-stack layer for both dialogs, so detail → edit → detail stays a single back step. */}
      {(openedId !== null || editor) && (
        <BackLayer name="purchaseOrderDialog" onBack={closeDialogs} blocked={editorDirty} onBlocked={() => setConfirmDiscard(true)}>
          {(close) => (
            <>
              {openedId !== null && (
                <OrderDetail
                  orderId={openedId}
                  onClose={close}
                  onEdit={(order) => {
                    setOpenedId(null)
                    setEditor({ mode: 'edit', order })
                  }}
                  onChanged={refresh}
                />
              )}
              {editor && (
                <OrderEditor
                  target={editor}
                  onClose={() => (editorDirty ? setConfirmDiscard(true) : close())}
                  onDirtyChange={setEditorDirty}
                  onSaved={async (order) => {
                    setEditorDirty(false)
                    setEditor(null)
                    setOpenedId(order.id)
                    await refresh()
                  }}
                />
              )}
              {confirmDiscard && (
                <ConfirmDialog
                  title={editor?.mode === 'edit' ? 'Discard your changes?' : 'Discard this order?'}
                  message="It hasn’t been saved. Tip: “Save draft” keeps it for later without sending anything."
                  confirmLabel="Discard"
                  danger
                  onCancel={() => setConfirmDiscard(false)}
                  onConfirm={() => {
                    setConfirmDiscard(false)
                    setEditorDirty(false)
                    close()
                  }}
                />
              )}
            </>
          )}
        </BackLayer>
      )}
    </WorkPage>
  )
}

/* ------------------------------------------------------------------
   LIST ROW — stacked on narrow widths, a table row on wide ones
------------------------------------------------------------------ */

function OrderRow({ order, money, onOpen }: { order: PurchaseOrder; money: (value: number) => string; onOpen: () => void }) {
  const overdue = isOverdue(order)
  const closed = order.status === 'Received' || order.status === 'Cancelled'
  const expected = order.expectedDate ? formatDate(order.expectedDate) : null

  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full rounded-xl px-2 py-3 text-left transition hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand active:bg-field @3xl/list:grid @3xl/list:min-h-16 @3xl/list:grid-cols-[minmax(0,1fr)_9.5rem_10rem_8.5rem_8rem] @3xl/list:items-center @3xl/list:gap-4"
    >
      {/* Narrow layout */}
      <span className="flex items-start gap-3 @3xl/list:hidden">
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-semibold">{order.poNumber}</span>
            <Badge tone={statusTone(order.status)}>{order.status}</Badge>
            {overdue && <Badge tone="red">Overdue</Badge>}
          </span>
          <span className="mt-0.5 block truncate text-sm text-slate-600">{order.supplierName}</span>
          <span className="block truncate text-xs text-slate-500">
            {order.lineCount} {order.lineCount === 1 ? 'product' : 'products'}
            {expected && !closed && ` · expected ${expected}`}
          </span>
        </span>
        <span className="shrink-0 pt-0.5 text-[15px] font-semibold tabular-nums">{money(order.totalCost)}</span>
      </span>
      {order.status === 'Partially received' && (
        <span className="mt-2 block max-w-xs @3xl/list:hidden">
          <ReceiveProgress received={order.unitsReceived} ordered={order.unitsOrdered} compact />
        </span>
      )}

      {/* Wide layout: table cells */}
      <span className="hidden min-w-0 @3xl/list:block">
        <span className="block text-[15px] font-semibold">{order.poNumber}</span>
        <span className="block truncate text-sm text-slate-500">
          {order.supplierName} · {order.lineCount} {order.lineCount === 1 ? 'product' : 'products'}
        </span>
      </span>
      <span className="hidden @3xl/list:block">
        <Badge tone={statusTone(order.status)}>{order.status}</Badge>
      </span>
      <span className="hidden @3xl/list:block">
        {tracksDelivery(order.status) ? (
          <ReceiveProgress received={order.unitsReceived} ordered={order.unitsOrdered} compact />
        ) : (
          <span className="text-sm text-slate-300">—</span>
        )}
      </span>
      <span className={`hidden text-sm tabular-nums @3xl/list:block ${overdue ? 'font-medium text-rose-600' : 'text-slate-600'}`}>
        {closed ? <span className="text-slate-300">—</span> : expected ?? <span className="text-slate-300">Not set</span>}
        {overdue && <span className="block text-xs">Overdue</span>}
      </span>
      <span className="hidden text-right text-[15px] font-semibold tabular-nums @3xl/list:block">{money(order.totalCost)}</span>
    </button>
  )
}

/* ------------------------------------------------------------------
   DETAIL
------------------------------------------------------------------ */

function Fact({ label, children, tone }: { label: string; children: ReactNode; tone?: 'danger' }) {
  return (
    <div className="min-w-0 rounded-xl bg-canvas px-3.5 py-2.5">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className={`mt-0.5 truncate text-sm font-medium ${tone === 'danger' ? 'text-rose-600' : ''}`}>{children}</dd>
    </div>
  )
}

function OrderDetail({
  orderId,
  onClose,
  onEdit,
  onChanged,
}: {
  orderId: number
  onClose: () => void
  onEdit: (order: PurchaseOrder) => void
  onChanged: () => Promise<void>
}) {
  const { notify } = useToast()
  const { settings } = useSettings()
  const { can } = useAuth()
  const navigate = useNavigate()
  const money = (value: number) => formatMoney(value, settings.currencySymbol)
  const detail = useAsync(() => purchaseOrderApi.get(orderId), [orderId])
  const deliveries = useAsync(() => stockApi.receipts({ purchaseOrderId: orderId, pageSize: 20 }), [orderId])
  const [busy, setBusy] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string | null>(null)
  const order = detail.data

  async function run(action: () => Promise<PurchaseOrder>, message: string) {
    if (busy) return
    setBusy(true)
    try {
      const updated = await action()
      detail.setData(updated)
      notify(message)
      setCancelling(false)
      await onChanged()
    } catch (err) {
      notify(getErrorMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  const open = order && (order.status === 'Ordered' || order.status === 'Partially received')
  const canReceive = open && can('inventory.receive')
  const overdue = order ? isOverdue(order) : false

  let footer = null
  if (order && cancelling) {
    footer = (
      <div className="flex w-full gap-2">
        <button
          type="button"
          onClick={() => setCancelling(false)}
          disabled={busy}
          className="h-12 flex-1 rounded-2xl text-[15px] font-medium text-slate-600 active:bg-slate-100 sm:flex-none sm:px-5"
        >
          Keep order
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (reason.trim().length < 3) {
              setReasonError('Enter a reason for cancelling.')
              return
            }
            void run(() => purchaseOrderApi.cancel(order.id, reason), `${order.poNumber} cancelled.`)
          }}
          className="h-12 flex-1 rounded-2xl bg-rose-600 px-6 text-[15px] font-semibold text-white disabled:opacity-50 sm:flex-none"
        >
          {busy ? 'Cancelling…' : order.status === 'Partially received' ? 'Cancel the rest' : 'Cancel order'}
        </button>
      </div>
    )
  } else if (order && order.status !== 'Received' && order.status !== 'Cancelled') {
    footer = (
      <div className="flex w-full flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setCancelling(true)}
          disabled={busy}
          className="h-12 rounded-2xl px-4 text-[15px] font-medium text-rose-600 active:bg-rose-50 disabled:opacity-50"
        >
          {order.status === 'Partially received' ? 'Cancel the rest…' : 'Cancel order…'}
        </button>
        <div className="flex flex-1 justify-end gap-2">
          {order.status === 'Draft' && (
            <>
              <button
                type="button"
                onClick={() => onEdit(order)}
                disabled={busy}
                className="h-12 flex-1 rounded-2xl px-5 text-[15px] font-medium text-brand ring-1 ring-slate-200 active:bg-brand-tint sm:flex-none"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => void run(() => purchaseOrderApi.markOrdered(order.id), `${order.poNumber} marked as ordered.`)}
                disabled={busy}
                className="h-12 flex-2 rounded-2xl bg-brand px-6 text-[15px] font-semibold text-white hover:bg-brand-hover disabled:opacity-50 sm:flex-none"
              >
                {busy ? 'Saving…' : 'Mark as ordered'}
              </button>
            </>
          )}
          {canReceive && (
            <button
              type="button"
              // Replace the dialog's history entry so back from receiving returns straight to this list.
              onClick={() => navigate(`/receive-stock?po=${order.id}`, { replace: true })}
              className="h-12 flex-1 rounded-2xl bg-brand px-6 text-[15px] font-semibold text-white hover:bg-brand-hover sm:flex-none"
            >
              Receive delivery
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <Modal
      title={order ? order.poNumber : 'Purchase order'}
      description={order?.supplierName}
      onClose={onClose}
      preventClose={busy}
      size="xl"
      mobileFullScreen
      panelClassName="max-h-[min(92dvh,54rem)] max-w-3xl"
      footer={footer ?? undefined}
    >
      {detail.loading && !order && (
        <div className="py-12">
          <Spinner label="Loading order…" />
        </div>
      )}
      {detail.error && !order && <ErrorState message={detail.error} onRetry={() => void detail.reload()} />}
      {order && (
        <div className="@container/po">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={statusTone(order.status)}>{order.status}</Badge>
                {overdue && <Badge tone="red">Overdue</Badge>}
              </div>
              <p className="mt-2 text-3xl font-bold tracking-tight tabular-nums">{money(order.totalCost)}</p>
              <p className="text-sm text-slate-500">
                {order.lineCount} {order.lineCount === 1 ? 'product' : 'products'} · {order.unitsOrdered} units
              </p>
            </div>
            {tracksDelivery(order.status) && (
              <div className="w-full @md/po:w-64">
                <p className="mb-1 text-xs text-slate-500">
                  {order.unitsReceived >= order.unitsOrdered ? 'Everything received' : `${order.unitsReceived} of ${order.unitsOrdered} units received`}
                </p>
                <ReceiveProgress received={order.unitsReceived} ordered={order.unitsOrdered} />
              </div>
            )}
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-2 @xl/po:grid-cols-4">
            <Fact label="Expected delivery" tone={overdue ? 'danger' : undefined}>
              {order.expectedDate ? formatDate(order.expectedDate) : <span className="text-slate-400">Not set</span>}
            </Fact>
            <Fact label="Ordered">{order.orderedAt ? formatDate(order.orderedAt) : <span className="text-slate-400">Not yet</span>}</Fact>
            <Fact label="Created">{formatDate(order.createdAt)}</Fact>
            <Fact label="Created by">{order.createdBy}</Fact>
          </dl>
          <p className="sr-only">Created {formatDateTime(order.createdAt)}</p>

          {order.notes && (
            <div className="mt-3 rounded-xl bg-amber-50/60 px-3.5 py-2.5 text-sm text-slate-700 ring-1 ring-amber-100">
              <span className="block text-xs font-medium text-amber-800">Notes</span>
              <span className="whitespace-pre-line">{order.notes}</span>
            </div>
          )}

          <h3 className="mt-5 text-sm font-semibold">Products</h3>
          {/* Table once there's room for four columns; cards below that. */}
          <div className="mt-2 hidden overflow-hidden rounded-2xl ring-1 ring-slate-100 @lg/po:block">
            <table className="w-full table-fixed text-left text-sm">
              <thead className="bg-canvas text-xs text-slate-500">
                <tr>
                  <th scope="col" className="w-[42%] px-4 py-2.5 font-medium">
                    Product
                  </th>
                  <th scope="col" className="px-2 py-2.5 text-right font-medium">
                    Received
                  </th>
                  <th scope="col" className="px-2 py-2.5 text-right font-medium">
                    Unit cost
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {order.items.map((item) => (
                  <tr key={item.id}>
                    <td className="px-4 py-3">
                      <span className="block truncate">{item.productName}</span>
                      <span className="block text-xs text-slate-400">{item.sku}</span>
                    </td>
                    <td
                      className={`px-2 py-3 text-right tabular-nums ${
                        item.quantityReceived >= item.quantityOrdered ? 'text-brand' : item.quantityReceived > 0 ? 'text-amber-700' : ''
                      }`}
                    >
                      {item.quantityReceived} / {item.quantityOrdered}
                    </td>
                    <td className="px-2 py-3 text-right tabular-nums">{money(item.unitCost)}</td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums">{money(item.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="mt-2 divide-y divide-slate-100 rounded-2xl ring-1 ring-slate-100 @lg/po:hidden">
            {order.items.map((item) => (
              <li key={item.id} className="px-4 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-[15px]">{item.productName}</span>
                  <span className="shrink-0 text-[15px] font-medium tabular-nums">{money(item.lineTotal)}</span>
                </div>
                <div className="mt-0.5 flex items-center justify-between gap-3 text-xs text-slate-500">
                  <span className="truncate">
                    {item.sku} · {item.quantityOrdered} × {money(item.unitCost)}
                  </span>
                  <span
                    className={`shrink-0 tabular-nums ${
                      item.quantityReceived >= item.quantityOrdered ? 'text-brand' : item.quantityReceived > 0 ? 'text-amber-700' : ''
                    }`}
                  >
                    {item.quantityReceived}/{item.quantityOrdered} in
                  </span>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex justify-between px-1 text-[15px] font-semibold">
            <span>Order total</span>
            <span className="tabular-nums">{money(order.totalCost)}</span>
          </div>

          {deliveries.data && deliveries.data.items.length > 0 && (
            <div className="mt-5">
              <h3 className="text-sm font-semibold">Deliveries</h3>
              <ul className="mt-1 divide-y divide-slate-100">
                {deliveries.data.items.map((receipt) => (
                  <li key={receipt.id} className="flex min-h-12 items-center justify-between gap-3 py-2.5 text-sm">
                    <span className="min-w-0">
                      <span className="block font-medium">{receipt.receiptNumber}</span>
                      <span className="block truncate text-xs text-slate-500">
                        {formatDate(receipt.receivedDate)} · {receipt.createdBy}
                      </span>
                    </span>
                    <span className="shrink-0 tabular-nums">{money(receipt.totalCost)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {cancelling && (
            <div className="mt-5 rounded-2xl bg-canvas p-4">
              <ReasonField
                label={order.status === 'Partially received' ? 'Why cancel the rest of this order?' : 'Why cancel this order?'}
                value={reason}
                onChange={(value) => {
                  setReason(value)
                  setReasonError(null)
                }}
                suggestions={['Supplier can’t deliver', 'Ordered by mistake', 'Found another supplier']}
                error={reasonError}
                disabled={busy}
              />
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}

/* ------------------------------------------------------------------
   EDITOR (drafts)
------------------------------------------------------------------ */

type Line = { productId: number; name: string; sku: string; stock: number; quantity: number; unitCost: string }

function OrderEditor({
  target,
  onClose,
  onSaved,
  onDirtyChange,
}: {
  target: EditorTarget
  onClose: () => void
  onSaved: (order: PurchaseOrder) => Promise<void>
  onDirtyChange: (dirty: boolean) => void
}) {
  const { notify } = useToast()
  const { settings } = useSettings()
  const money = (value: number) => formatMoney(value, settings.currencySymbol)
  const editing = target.mode === 'edit' ? target.order : null

  const suppliers = useAsync(() => supplierApi.list({ isActive: true }), [])
  const [supplierId, setSupplierId] = useState(
    editing ? String(editing.supplierId) : target.mode === 'new' && target.supplierId ? String(target.supplierId) : '',
  )
  const [expectedDate, setExpectedDate] = useState(editing?.expectedDate ?? '')
  const [notes, setNotes] = useState(editing?.notes ?? '')
  const [lines, setLines] = useState<Line[]>(
    editing
      ? editing.items.map((item) => ({
          productId: item.productId,
          name: item.productName,
          sku: item.sku,
          stock: 0,
          quantity: item.quantityOrdered,
          unitCost: String(item.unitCost),
        }))
      : [],
  )
  const [busy, setBusy] = useState(false)
  const [loadingLow, setLoadingLow] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  // Only changes the user makes count as unsaved work (not the automatic low-stock fill).
  const [touched, setTouched] = useState(false)
  const q = useDebounced(search)
  const results = useAsync(() => (q.trim() ? productApi.catalog({ search: q.trim(), stockedOnly: true }) : Promise.resolve([])), [q])

  useEffect(() => onDirtyChange(touched), [touched, onDirtyChange])

  const total = useMemo(() => sumMoney(lines.map((line) => roundMoney((Number(line.unitCost) || 0) * line.quantity))), [lines])
  const units = lines.reduce((sum, line) => sum + line.quantity, 0)

  async function addLowStock() {
    if (loadingLow) return
    setLoadingLow(true)
    try {
      const suggestions = await inventoryApi.reorderSuggestions({ supplierId: supplierId ? Number(supplierId) : undefined })
      if (suggestions.length === 0) {
        notify(supplierId ? 'None of this supplier’s products are low on stock.' : 'Nothing is at or below its reorder level.')
        return
      }
      setLines((prev) => {
        const next = [...prev]
        for (const item of suggestions) {
          if (next.some((line) => line.productId === item.productId)) continue
          next.push({
            productId: item.productId,
            name: item.name,
            sku: item.sku,
            stock: item.stockQuantity,
            quantity: item.suggestedQuantity,
            unitCost: String(item.costPrice),
          })
        }
        return next
      })
      // One supplier per order: take the supplier of the suggestions when none was chosen yet.
      if (!supplierId) {
        const first = suggestions.find((item) => item.supplierId)
        if (first?.supplierId) setSupplierId(String(first.supplierId))
      }
      setError(null)
    } catch (err) {
      notify(getErrorMessage(err), 'error')
    } finally {
      setLoadingLow(false)
    }
  }

  // Opened from the reports' low-stock list: fill the order straight away.
  useEffect(() => {
    if (target.mode === 'new' && target.lowStock) void addLowStock()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function updateLine(productId: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((line) => (line.productId === productId ? { ...line, ...patch } : line)))
    setTouched(true)
    setError(null)
  }

  async function save(markOrdered: boolean) {
    if (busy) return
    if (!supplierId) {
      setError('Choose the supplier.')
      return
    }
    if (lines.length === 0) {
      setError('Add at least one product.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const payload = {
        supplierId: Number(supplierId),
        expectedDate: expectedDate || null,
        notes,
        items: lines.map((line) => ({ productId: line.productId, quantity: line.quantity, unitCost: Number(line.unitCost) || 0 })),
      }
      let order = editing ? await purchaseOrderApi.update(editing.id, payload) : await purchaseOrderApi.create(payload)
      if (markOrdered) order = await purchaseOrderApi.markOrdered(order.id)
      notify(markOrdered ? `${order.poNumber} saved and marked as ordered.` : `${order.poNumber} saved as a draft.`)
      await onSaved(order)
    } catch (err) {
      setError(getErrorMessage(err))
      setBusy(false)
    }
  }

  const supplierOptions = (suppliers.data ?? []).map((supplier) => ({ value: String(supplier.id), label: supplier.companyName, hint: supplier.supplierCode }))
  const matches = (results.data ?? []).slice(0, 8)

  return (
    <Modal
      title={editing ? `Edit ${editing.poNumber}` : 'New purchase order'}
      onClose={onClose}
      preventClose={busy}
      size="2xl"
      mobileFullScreen
      panelClassName="max-h-[min(94dvh,60rem)] max-w-4xl"
      footer={
        <div className="flex w-full flex-wrap items-center gap-2">
          {error ? (
            <p role="alert" className="basis-full text-sm font-medium text-rose-600 sm:mr-auto sm:basis-auto">
              {error}
            </p>
          ) : (
            <p className="basis-full text-sm text-slate-500 sm:mr-auto sm:basis-auto">
              {lines.length} {lines.length === 1 ? 'product' : 'products'} · {units} units ·{' '}
              <span className="font-semibold text-ink tabular-nums">{money(total)}</span>
            </p>
          )}
          <button
            type="button"
            onClick={() => void save(false)}
            disabled={busy}
            className="h-12 flex-1 rounded-2xl px-5 text-[15px] font-medium text-brand ring-1 ring-slate-200 active:bg-brand-tint disabled:opacity-50 sm:flex-none"
          >
            Save draft
          </button>
          <button
            type="button"
            onClick={() => void save(true)}
            disabled={busy}
            className="h-12 flex-2 rounded-2xl bg-brand px-6 text-[15px] font-semibold text-white hover:bg-brand-hover disabled:opacity-50 sm:flex-none"
          >
            {busy ? 'Saving…' : 'Save & mark ordered'}
          </button>
        </div>
      }
    >
      <div className="@container/ed space-y-6">
        {/* Step 1 — who and when. The supplier comes first: low-stock suggestions are scoped to it. */}
        <section aria-labelledby="po-supplier-heading">
          <h3 id="po-supplier-heading" className="mb-3 text-sm font-semibold text-slate-500">
            Supplier &amp; delivery
          </h3>
          <div className="grid gap-4 @2xl/ed:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.2fr)]">
            <PickerField
              label="Supplier"
              value={supplierId}
              onChange={(value) => {
                setSupplierId(value)
                setTouched(true)
                setError(null)
              }}
              options={supplierOptions}
              placeholder={suppliers.loading ? 'Loading suppliers…' : 'Choose supplier'}
              emptyText="No active suppliers yet. Add one under Suppliers."
            />
            <DateField
              label="Expected delivery"
              value={expectedDate}
              min={todayKey()}
              onChange={(value) => {
                setExpectedDate(value)
                setTouched(true)
              }}
            />
            <TextField
              label="Notes"
              optional
              value={notes}
              onChange={(value) => {
                setNotes(value)
                setTouched(true)
              }}
              placeholder="e.g. deliver before 10am"
              maxLength={200}
            />
          </div>
        </section>

        {/* Step 2 — what */}
        <section aria-labelledby="po-products-heading">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 id="po-products-heading" className="text-sm font-semibold text-slate-500">
              Products{lines.length > 0 && <span className="ml-1.5 tabular-nums text-slate-400">{lines.length}</span>}
            </h3>
            <button
              type="button"
              onClick={() => {
                setTouched(true)
                void addLowStock()
              }}
              disabled={loadingLow}
              className="h-11 shrink-0 rounded-full bg-brand-soft px-4 text-sm font-semibold text-brand active:bg-brand-tint disabled:opacity-50"
            >
              {loadingLow ? 'Adding…' : 'Add low-stock items'}
            </button>
          </div>

          <SearchBox label="Find a product to add" value={search} onChange={setSearch} placeholder="Search name, SKU or barcode" />
          {q.trim() && (
            <ul className="mt-2 max-h-72 overflow-y-auto rounded-2xl bg-white shadow-[0_8px_24px_rgba(9,20,19,0.08)] ring-1 ring-slate-100">
              {results.loading && <li className="px-4 py-3 text-sm text-slate-400">Searching…</li>}
              {!results.loading && matches.length === 0 && <li className="px-4 py-3 text-sm text-slate-500">No product matches “{q}”.</li>}
              {matches.map((product) => {
                const inOrder = lines.find((line) => line.productId === product.id)
                return (
                  <li key={product.id} className="border-b border-slate-100 last:border-b-0">
                    <button
                      type="button"
                      onClick={() => {
                        setLines((prev) =>
                          prev.some((line) => line.productId === product.id)
                            ? prev.map((line) => (line.productId === product.id ? { ...line, quantity: line.quantity + 1 } : line))
                            : [
                                ...prev,
                                { productId: product.id, name: product.name, sku: product.sku, stock: product.stockQuantity, quantity: 1, unitCost: String(product.costPrice) },
                              ],
                        )
                        setSearch('')
                        setTouched(true)
                        setError(null)
                      }}
                      className="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-2 text-left hover:bg-canvas active:bg-field"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[15px]">{product.name}</span>
                        <span className="block truncate text-xs text-slate-500">
                          {product.sku} · {product.stockQuantity} in stock{product.supplierName ? ` · ${product.supplierName}` : ''}
                        </span>
                      </span>
                      {inOrder ? (
                        <span className="flex shrink-0 items-center gap-2.5">
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500">
                            <Check size={11} className="text-brand" />
                            {inOrder.quantity} in order
                          </span>
                          <span className="inline-flex h-9 items-center rounded-full bg-field px-3.5 text-sm font-semibold text-brand">+1</span>
                        </span>
                      ) : (
                        <span className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-brand-soft px-3.5 text-sm font-semibold text-brand">
                          <Plus size={10} />
                          Add
                        </span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}

          {lines.length === 0 ? (
            <p className="mt-3 rounded-2xl bg-canvas px-4 py-10 text-center text-sm text-slate-500">
              Search for products above, or tap <span className="font-medium text-brand">Add low-stock items</span> to fill the order with everything
              that’s running low.
            </p>
          ) : (
            <>
              <div
                aria-hidden="true"
                className="mt-4 hidden grid-cols-[minmax(0,1fr)_8.25rem_9.5rem_7rem_2.75rem] items-center gap-3 border-b border-slate-100 pb-2 text-xs font-medium text-slate-400 @2xl/ed:grid"
              >
                <span>Product</span>
                <span>Quantity</span>
                <span>Unit cost</span>
                <span className="text-right">Line total</span>
                <span />
              </div>
              <ul className="mt-1">
                {lines.map((line) => (
                  <li
                    key={line.productId}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-b border-slate-100 py-3 last:border-b-0 @2xl/ed:grid-cols-[minmax(0,1fr)_8.25rem_9.5rem_7rem_2.75rem]"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[15px]">{line.name}</p>
                      <p className="text-xs text-slate-500">
                        {line.sku}
                        {line.stock > 0 || !editing ? ` · ${line.stock} in stock` : ''}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setLines((prev) => prev.filter((entry) => entry.productId !== line.productId))
                        setTouched(true)
                      }}
                      aria-label={`Remove ${line.name}`}
                      className="flex h-11 w-11 items-center justify-center rounded-full text-slate-400 hover:bg-rose-50 hover:text-rose-600 active:bg-rose-50 @2xl/ed:order-last"
                    >
                      <Trash2 size={13} />
                    </button>
                    <div className="col-span-2 flex flex-wrap items-center gap-2 @2xl/ed:contents">
                      <QuantityStepper label={`${line.name} quantity`} value={line.quantity} min={1} onChange={(quantity) => updateLine(line.productId, { quantity })} />
                      <label className="flex h-11 min-w-0 items-center gap-1 rounded-xl bg-field px-3 text-sm text-slate-500 focus-within:bg-white focus-within:ring-2 focus-within:ring-brand">
                        <span aria-hidden="true">{settings.currencySymbol}</span>
                        <AmountInput
                          aria-label={`${line.name} unit cost`}
                          value={line.unitCost}
                          onChange={(unitCost) => updateLine(line.productId, { unitCost })}
                          className="h-11 w-24 min-w-0 flex-1 bg-transparent text-right text-[15px] tabular-nums text-ink outline-none"
                        />
                      </label>
                      <span className="ml-auto text-right text-[15px] font-semibold tabular-nums @2xl/ed:ml-0">
                        {money(roundMoney((Number(line.unitCost) || 0) * line.quantity))}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
    </Modal>
  )
}

export default PurchaseOrdersPage
