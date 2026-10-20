import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { batchApi } from '../../api/batchApi'
import { productApi } from '../../api/productApi'
import { StockShortageNotice } from '../../components/pos/StockShortageNotice'
import { Modal } from '../../components/ui/Modal'
import { PrimaryButton, TextAreaField, TextButton } from '../../components/ui/MobileKit'
import { Pagination } from '../../components/ui/Pagination'
import { EmptyState, ErrorState, Spinner } from '../../components/ui/States'
import { Panel, QuantityStepper } from '../../components/ui/WorkPage'
import { useAuth } from '../../context/AuthContext'
import { useSettings } from '../../context/SettingsContext'
import { useToast } from '../../context/ToastContext'
import { useAsync } from '../../hooks/useAsync'
import { useDebounced } from '../../hooks/useDebounced'
import { useDismissOnBack } from '../../hooks/useDismissOnBack'
import { formatQty } from '../../services/units'
import type { Product } from '../../types'
import { getErrorMessage } from '../../utils/errors'
import { formatDateTime, formatMoney } from '../../utils/format'

/**
 * Prepared products made ahead (cold brew, brewed tea, pastries). Recording a batch adds ready
 * servings and uses up the batch recipe; the register then sells servings down.
 */
export function BatchesPanel({ initialProductId }: { initialProductId: number | null }) {
  const { can } = useAuth()
  const { settings } = useSettings()
  const money = (value: number) => formatMoney(value, settings.currencySymbol)
  const products = useAsync(() => productApi.catalog({ mode: 'batch' }), [])
  const [page, setPage] = useState(1)
  const history = useAsync(() => batchApi.list({ page, pageSize: 10 }), [page])
  const [making, setMaking] = useState<Product | null>(null)

  // Opened from a product's details ("Record a batch →").
  useEffect(() => {
    if (!initialProductId || !products.data) return
    const product = products.data.find((candidate) => candidate.id === initialProductId)
    if (product) setMaking(product)
  }, [initialProductId, products.data])

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Prepared products" description="Servings ready to sell right now.">
        {products.loading && !products.data && (
          <div className="py-10">
            <Spinner />
          </div>
        )}
        {products.error && <ErrorState message={products.error} onRetry={() => void products.reload()} />}
        {products.data && products.data.length === 0 && (
          <div className="py-8 text-center">
            <EmptyState title="No batch products yet" hint="Edit a product and choose “Batch / prepared” under Inventory tracking." />
            {can('products.manage') && (
              <Link to="/products" className="mt-3 inline-flex h-11 items-center rounded-full px-4 text-sm font-semibold text-[#1F5E3B] hover:bg-[#F2F8F4]">
                Go to Products
              </Link>
            )}
          </div>
        )}
        <ul className="divide-y divide-slate-100">
          {(products.data ?? []).map((product) => (
            <li key={product.id} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-medium">{product.name}</p>
                <p className={`text-xs ${product.stockStatus === 'In Stock' ? 'text-slate-500' : product.stockStatus === 'Low Stock' ? 'text-amber-700' : 'text-rose-600'}`}>
                  {product.stockQuantity} {product.stockQuantity === 1 ? 'serving' : 'servings'} ready
                  {product.batchYield ? ` · ${product.batchYield} per batch` : ''}
                </p>
              </div>
              <PrimaryButton onClick={() => setMaking(product)} className="h-11 flex-none px-4 text-sm">
                Make batch
              </PrimaryButton>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Recent batches">
        {history.loading && !history.data && (
          <div className="py-10">
            <Spinner />
          </div>
        )}
        {history.error && <ErrorState message={history.error} onRetry={() => void history.reload()} />}
        {history.data && history.data.items.length === 0 && <p className="py-6 text-sm text-slate-500">No batches recorded yet.</p>}
        <ul className="divide-y divide-slate-100">
          {(history.data?.items ?? []).map((batch) => (
            <li key={batch.id} className="flex items-start justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {batch.productName} · {batch.servings} servings
                </p>
                <p className="truncate text-xs text-slate-500">
                  {batch.batchNumber} · {batch.createdBy} · {formatDateTime(batch.createdAt)}
                  {batch.notes ? ` · ${batch.notes}` : ''}
                </p>
              </div>
              <p className="shrink-0 text-sm tabular-nums text-slate-600">{money(batch.ingredientCost)}</p>
            </li>
          ))}
        </ul>
        {(history.data?.totalPages ?? 1) > 1 && (
          <div className="mt-3">
            <Pagination page={history.data!.page} totalPages={history.data!.totalPages} onPage={setPage} />
          </div>
        )}
      </Panel>

      {making && (
        <MakeBatchDialog
          product={making}
          money={money}
          onClose={() => setMaking(null)}
          onMade={() => {
            void products.reload()
            void history.reload()
          }}
        />
      )}
    </div>
  )
}

function MakeBatchDialog({ product, money, onClose, onMade }: { product: Product; money: (value: number) => string; onClose: () => void; onMade: () => void }) {
  const { notify } = useToast()
  const { settings } = useSettings()
  const perBatch = product.batchYield && product.batchYield > 0 ? product.batchYield : 1
  const [batches, setBatches] = useState(1)
  const [servingsText, setServingsText] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const { close } = useDismissOnBack('makeBatchOpen', onClose, busy)
  const debouncedBatches = useDebounced(batches, 200)
  const preview = useAsync(() => batchApi.preview(product.id, Math.max(debouncedBatches, 1)), [product.id, debouncedBatches])
  const servings = servingsText.trim() ? Number(servingsText) : batches * perBatch
  const servingsValid = Number.isInteger(servings) && servings >= 1
  const blocked = Boolean(preview.data?.shortages.length) && !settings.allowNegativeStock

  async function make() {
    if (busy || !servingsValid || blocked) return
    setBusy(true)
    try {
      const batch = await batchApi.make({ productId: product.id, batches, servings: servingsText.trim() ? servings : undefined, notes })
      notify(`${batch.batchNumber}: ${batch.servings} ${product.name} ready.`)
      onMade()
      close()
    } catch (err) {
      notify(getErrorMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={`Make ${product.name}`}
      description={`${product.stockQuantity} servings ready now`}
      size="md"
      mobileFullScreen
      onClose={close}
      preventClose={busy}
      footer={
        <div className="flex w-full items-center gap-3">
          <div className="flex-1" />
          <TextButton onClick={close} disabled={busy} className="h-12">
            Cancel
          </TextButton>
          <PrimaryButton onClick={() => void make()} disabled={busy || !servingsValid || blocked} className="h-12 flex-none px-6">
            {busy ? 'Saving…' : `Add ${servingsValid ? servings : ''} servings`}
          </PrimaryButton>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Batches made</p>
            <p className="text-xs text-slate-500">{perBatch} servings each</p>
          </div>
          <QuantityStepper label="Batches made" value={batches} min={1} max={1000} onChange={setBatches} disabled={busy} />
        </div>
        <div>
          <label htmlFor="batch-servings" className="block text-sm font-medium">
            Servings made <span className="font-normal text-slate-400">(if different)</span>
          </label>
          <input
            id="batch-servings"
            inputMode="numeric"
            value={servingsText}
            onChange={(e) => setServingsText(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder={String(batches * perBatch)}
            className="mt-1.5 h-12 w-full rounded-2xl border-0 bg-[#F3F5F4] px-4 text-[15px] tabular-nums outline-none focus:bg-white focus:ring-2 focus:ring-[#1F5E3B] sm:max-w-48"
          />
        </div>

        <div className="rounded-2xl bg-[#F6F8F7] p-4">
          <p className="text-sm font-semibold">Uses</p>
          {preview.loading && !preview.data ? (
            <div className="py-4">
              <Spinner />
            </div>
          ) : preview.data && preview.data.uses.length === 0 ? (
            <p className="mt-1 text-sm text-slate-500">No batch recipe: only the servings are added. Add ingredients on the product to deduct them.</p>
          ) : (
            <ul className="mt-1 space-y-1 text-sm">
              {(preview.data?.uses ?? []).map((use) => (
                <li key={use.name} className="flex justify-between gap-3">
                  <span>{use.name}</span>
                  <span className="tabular-nums">{formatQty(use.quantity, use.baseUnit)}</span>
                </li>
              ))}
            </ul>
          )}
          {preview.data && preview.data.cost > 0 && (
            <p className="mt-2 border-t border-slate-200 pt-2 text-sm text-slate-600">
              Ingredient cost {money(preview.data.cost)}
              {servingsValid && ` · ${money(preview.data.cost / servings)} per serving`}
            </p>
          )}
        </div>
        {preview.data && <StockShortageNotice shortages={preview.data.shortages} blocked={blocked} />}

        <TextAreaField label="Notes" optional value={notes} onChange={setNotes} placeholder="e.g. Morning brew, 12-hour steep" />
      </div>
    </Modal>
  )
}
