import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { productApi } from '../../api/productApi'
import { stockApi } from '../../api/stockApi'
import { supplierApi } from '../../api/supplierApi'
import { AmountInput } from '../../components/ui/AmountInput'
import { Search, Trash2 } from '../../components/ui/Icons'
import { PickerField, SwitchRow, TextField } from '../../components/ui/MobileKit'
import { Modal } from '../../components/ui/Modal'
import { Pagination } from '../../components/ui/Pagination'
import { EmptyState, ErrorState, Spinner } from '../../components/ui/States'
import { Panel, QuantityStepper, WorkPage } from '../../components/ui/WorkPage'
import { useSettings } from '../../context/SettingsContext'
import { useToast } from '../../context/ToastContext'
import { useAsync } from '../../hooks/useAsync'
import { useDebounced } from '../../hooks/useDebounced'
import type { Product } from '../../types'
import { roundMoney, sumMoney } from '../../utils/amount'
import { getErrorMessage } from '../../utils/errors'
import { formatDate, formatDateTime, formatMoney } from '../../utils/format'

type Line = { product: Product; quantity: number; unitCost: string }

/** Today's date in the device's own calendar, as yyyy-mm-dd. */
function todayKey(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export function ReceiveStockPage() {
  const [tab, setTab] = useState<'receive' | 'history'>('receive')
  const [openedId, setOpenedId] = useState<number | null>(null)

  return (
    <WorkPage
      title="Receive stock"
      subtitle="Record a delivery from a supplier. Stock goes up as soon as you save."
      actions={
        <div role="tablist" aria-label="Receive stock" className="flex rounded-full bg-white p-1 ring-1 ring-slate-200">
          {(['receive', 'history'] as const).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`h-10 rounded-full px-4 text-sm font-medium transition ${tab === key ? 'bg-[#1F5E3B] text-white' : 'text-slate-600'}`}
            >
              {key === 'receive' ? 'New delivery' : 'History'}
            </button>
          ))}
        </div>
      }
    >
      {tab === 'receive' ? (
        <ReceiveForm
          onSaved={(id) => {
            setTab('history')
            setOpenedId(id)
          }}
        />
      ) : (
        <ReceiptHistory onOpen={setOpenedId} />
      )}
      {openedId !== null && <ReceiptDetail receiptId={openedId} onClose={() => setOpenedId(null)} />}
    </WorkPage>
  )
}

/* ------------------------------------------------------------------
   NEW DELIVERY
------------------------------------------------------------------ */

function ReceiveForm({ onSaved }: { onSaved: (receiptId: number) => void }) {
  const { notify } = useToast()
  const { settings } = useSettings()
  const [params] = useSearchParams()
  const money = (value: number) => formatMoney(value, settings.currencySymbol)

  const suppliers = useAsync(() => supplierApi.list({ isActive: true }), [])
  const [supplierId, setSupplierId] = useState(params.get('supplier') ?? '')
  const [reference, setReference] = useState('')
  const [receivedDate, setReceivedDate] = useState(todayKey)
  const [notes, setNotes] = useState('')
  const [updateCosts, setUpdateCosts] = useState(true)
  const [lines, setLines] = useState<Line[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const q = useDebounced(search)
  const results = useAsync(() => (q.trim() ? productApi.catalog({ search: q.trim() }) : Promise.resolve([])), [q])

  const totals = useMemo(() => {
    const units = lines.reduce((sum, line) => sum + line.quantity, 0)
    const cost = sumMoney(lines.map((line) => roundMoney((Number(line.unitCost) || 0) * line.quantity)))
    return { units, cost }
  }, [lines])

  function addProduct(product: Product) {
    setLines((prev) =>
      prev.some((line) => line.product.id === product.id)
        ? prev.map((line) => (line.product.id === product.id ? { ...line, quantity: line.quantity + 1 } : line))
        : [...prev, { product, quantity: 1, unitCost: String(product.costPrice) }],
    )
    setSearch('')
    setError(null)
  }

  function updateLine(productId: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((line) => (line.product.id === productId ? { ...line, ...patch } : line)))
    setError(null)
  }

  async function save() {
    if (busy) return
    if (lines.length === 0) {
      setError('Add at least one product.')
      return
    }
    if (!receivedDate) {
      setError('Enter the date the stock arrived.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const receipt = await stockApi.receive({
        supplierId: supplierId ? Number(supplierId) : null,
        reference,
        receivedDate,
        notes,
        updateCostPrices: updateCosts,
        items: lines.map((line) => ({ productId: line.product.id, quantity: line.quantity, unitCost: Number(line.unitCost) || 0 })),
      })
      notify(`${receipt.receiptNumber}: ${totals.units} units added to stock.`)
      setLines([])
      setReference('')
      setNotes('')
      onSaved(receipt.id)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const supplierOptions = (suppliers.data ?? []).map((supplier) => ({
    value: String(supplier.id),
    label: supplier.companyName,
    hint: supplier.supplierCode,
  }))
  const matches = (results.data ?? []).slice(0, 8)

  return (
    <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-4">
        <Panel title="Products">
          <div className="relative">
            <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              aria-label="Find a product to add"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name or SKU to add"
              className="h-12 w-full rounded-2xl border-0 bg-[#F3F5F4] pl-11 pr-4 text-[15px] placeholder:text-slate-400 outline-none focus:bg-white focus:ring-2 focus:ring-[#1F5E3B] [&::-webkit-search-cancel-button]:hidden"
            />
          </div>
          {q.trim() && (
            <ul className="mt-2 max-h-64 overflow-y-auto rounded-2xl ring-1 ring-slate-100">
              {results.loading && <li className="px-4 py-3 text-sm text-slate-400">Searching…</li>}
              {!results.loading && matches.length === 0 && <li className="px-4 py-3 text-sm text-slate-500">No product matches “{q}”.</li>}
              {matches.map((product) => (
                <li key={product.id} className="border-b border-slate-100 last:border-b-0">
                  <button
                    type="button"
                    onClick={() => addProduct(product)}
                    className="flex min-h-12 w-full items-center justify-between gap-3 px-4 py-2 text-left active:bg-slate-50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[15px]">{product.name}</span>
                      <span className="block text-xs text-slate-500">
                        {product.sku} · {product.stockQuantity} in stock
                      </span>
                    </span>
                    <span className="shrink-0 text-sm font-medium text-[#1F5E3B]">Add</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {lines.length === 0 ? (
            <p className="mt-4 rounded-2xl bg-[#F6F8F7] px-4 py-6 text-center text-sm text-slate-500">
              Search above and add each product on the delivery.
            </p>
          ) : (
            <ul className="mt-3">
              {lines.map((line) => {
                const lineTotal = roundMoney((Number(line.unitCost) || 0) * line.quantity)
                return (
                  <li key={line.product.id} className="border-b border-slate-100 py-3 last:border-b-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-[15px]">{line.product.name}</p>
                        <p className="text-xs text-slate-500">
                          {line.product.sku} · {line.product.stockQuantity} → {line.product.stockQuantity + line.quantity}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setLines((prev) => prev.filter((entry) => entry.product.id !== line.product.id))}
                        aria-label={`Remove ${line.product.name}`}
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-400 active:bg-slate-100"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <QuantityStepper
                        label={`${line.product.name} quantity`}
                        value={line.quantity}
                        min={1}
                        onChange={(quantity) => updateLine(line.product.id, { quantity })}
                      />
                      <label className="flex h-11 items-center gap-1.5 rounded-xl bg-[#F3F5F4] px-3 text-sm text-slate-500 focus-within:ring-2 focus-within:ring-[#1F5E3B]">
                        Cost {settings.currencySymbol}
                        <AmountInput
                          aria-label={`${line.product.name} unit cost`}
                          value={line.unitCost}
                          onChange={(unitCost) => updateLine(line.product.id, { unitCost })}
                          className="h-11 w-24 bg-transparent text-right text-[15px] tabular-nums text-[#091413] outline-none"
                        />
                      </label>
                      <span className="ml-auto text-[15px] font-semibold tabular-nums">{money(lineTotal)}</span>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>
      </div>

      <div className="space-y-4">
        <Panel title="Delivery details">
          <div className="space-y-4">
            <PickerField
              label="Supplier"
              optional
              value={supplierId}
              onChange={setSupplierId}
              options={supplierOptions}
              noneLabel="No supplier"
              placeholder="Choose supplier"
              emptyText="No active suppliers yet. Add one under Suppliers."
            />
            <TextField
              label="Reference no."
              optional
              value={reference}
              onChange={setReference}
              placeholder="Delivery receipt / invoice no."
              autoCapitalize="characters"
            />
            <TextField
              label="Date received"
              type="date"
              value={receivedDate}
              max={todayKey()}
              onChange={setReceivedDate}
            />
            <TextField label="Notes" optional value={notes} onChange={setNotes} placeholder="e.g. 2 boxes damaged, returned" />
            <SwitchRow
              label="Update cost prices"
              description="Use these costs as each product’s new cost."
              checked={updateCosts}
              onChange={setUpdateCosts}
            />
          </div>
        </Panel>

        <Panel>
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between text-slate-500">
              <dt>Products</dt>
              <dd className="tabular-nums">{lines.length}</dd>
            </div>
            <div className="flex justify-between text-slate-500">
              <dt>Units</dt>
              <dd className="tabular-nums">{totals.units}</dd>
            </div>
            <div className="flex items-baseline justify-between border-t border-slate-100 pt-2">
              <dt className="font-medium">Total cost</dt>
              <dd className="text-2xl font-bold tabular-nums">{money(totals.cost)}</dd>
            </div>
          </dl>
          {error && (
            <p role="alert" className="mt-3 text-sm text-rose-600">
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy || lines.length === 0}
            className="mt-4 h-14 w-full rounded-2xl bg-[#1F5E3B] text-[15px] font-semibold text-white transition active:scale-[0.99] disabled:bg-slate-200 disabled:text-slate-500"
          >
            {busy ? 'Saving…' : lines.length === 0 ? 'Add products first' : `Receive ${totals.units} ${totals.units === 1 ? 'unit' : 'units'}`}
          </button>
        </Panel>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------
   HISTORY
------------------------------------------------------------------ */

function ReceiptHistory({ onOpen }: { onOpen: (id: number) => void }) {
  const { settings } = useSettings()
  const [page, setPage] = useState(1)
  const history = useAsync(() => stockApi.receipts({ page, pageSize: 15 }), [page])
  const money = (value: number) => formatMoney(value, settings.currencySymbol)

  return (
    <Panel className="mt-5">
      {history.loading && !history.data && (
        <div className="py-10">
          <Spinner />
        </div>
      )}
      {history.error && <ErrorState message={history.error} onRetry={() => void history.reload()} />}
      {history.data && history.data.items.length === 0 && (
        <div className="py-10 text-center">
          <EmptyState title="No deliveries yet" hint="Received stock will be listed here." />
        </div>
      )}
      <ul>
        {(history.data?.items ?? []).map((receipt) => (
          <li key={receipt.id} className="border-b border-slate-100 last:border-b-0">
            <button type="button" onClick={() => onOpen(receipt.id)} className="flex min-h-16 w-full items-center gap-3 py-3 text-left active:bg-slate-50">
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-medium">
                  {receipt.receiptNumber}
                  <span className="font-normal text-slate-500"> · {receipt.supplierName ?? 'No supplier'}</span>
                </p>
                <p className="truncate text-xs text-slate-500">
                  {formatDate(receipt.receivedDate)}
                  {receipt.reference && ` · ref ${receipt.reference}`} · {receipt.createdBy}
                </p>
              </div>
              <p className="shrink-0 text-[15px] font-medium tabular-nums">{money(receipt.totalCost)}</p>
            </button>
          </li>
        ))}
      </ul>
      {history.data && history.data.totalPages > 1 && (
        <div className="mt-3">
          <Pagination page={history.data.page} totalPages={history.data.totalPages} onPage={setPage} />
        </div>
      )}
    </Panel>
  )
}

function ReceiptDetail({ receiptId, onClose }: { receiptId: number; onClose: () => void }) {
  const { settings } = useSettings()
  const detail = useAsync(() => stockApi.getReceipt(receiptId), [receiptId])
  const receipt = detail.data
  const money = (value: number) => formatMoney(value, settings.currencySymbol)

  return (
    <Modal
      title={receipt?.receiptNumber ?? 'Delivery'}
      description={receipt ? `${receipt.supplierName ?? 'No supplier'} · received ${formatDate(receipt.receivedDate)}` : undefined}
      onClose={onClose}
      size="lg"
      mobileFullScreen
    >
      {detail.loading && (
        <div className="py-10">
          <Spinner />
        </div>
      )}
      {detail.error && <ErrorState message={detail.error} onRetry={() => void detail.reload()} />}
      {receipt && (
        <>
          <p className="text-sm text-slate-500">
            {receipt.reference && `Ref ${receipt.reference} · `}Saved {formatDateTime(receipt.createdAt)} by {receipt.createdBy}
          </p>
          {receipt.notes && <p className="mt-1 text-sm text-slate-600">{receipt.notes}</p>}
          <ul className="mt-3 rounded-2xl ring-1 ring-slate-100">
            {receipt.items.map((item) => (
              <li key={item.productId} className="flex items-baseline justify-between gap-3 border-b border-slate-100 px-4 py-2.5 text-sm last:border-b-0">
                <span className="min-w-0 truncate">
                  {item.productName}
                  <span className="text-slate-400">
                    {' '}
                    × {item.quantity} @ {money(item.unitCost)}
                  </span>
                </span>
                <span className="shrink-0 tabular-nums">{money(item.lineTotal)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex justify-between text-[15px] font-semibold">
            <span>Total cost</span>
            <span className="tabular-nums">{money(receipt.totalCost)}</span>
          </div>
        </>
      )}
    </Modal>
  )
}

export default ReceiveStockPage
