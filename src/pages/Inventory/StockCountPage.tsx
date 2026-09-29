import { useEffect, useMemo, useState } from 'react'

import { stockApi, type CountSheetRow } from '../../api/stockApi'
import { Search } from '../../components/ui/Icons'
import { Modal } from '../../components/ui/Modal'
import { Pagination } from '../../components/ui/Pagination'
import { EmptyState, ErrorState, Spinner } from '../../components/ui/States'
import { Panel, WorkPage } from '../../components/ui/WorkPage'
import { useToast } from '../../context/ToastContext'
import { useAsync } from '../../hooks/useAsync'
import type { StockCount } from '../../types'
import { getErrorMessage } from '../../utils/errors'
import { formatDateTime } from '../../utils/format'

/** In-progress counts survive leaving the page or the app closing (per device only). */
const DRAFT_KEY = 'sellix.stockCountDraft'

type Draft = Record<number, number>

function loadDraft(): Draft {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    const parsed = raw ? (JSON.parse(raw) as Draft) : {}
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function saveDraft(draft: Draft) {
  try {
    if (Object.keys(draft).length === 0) localStorage.removeItem(DRAFT_KEY)
    else localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
  } catch {
    // Storage unavailable: the count still works, it just isn't kept across reloads.
  }
}

type Filter = 'all' | 'counted' | 'differences' | 'uncounted'

const signed = (value: number) => (value > 0 ? `+${value}` : String(value))

function differenceClass(difference: number): string {
  if (difference === 0) return 'text-[#1F5E3B]'
  return difference > 0 ? 'text-blue-700' : 'text-rose-700'
}

export function StockCountPage() {
  const [tab, setTab] = useState<'count' | 'history'>('count')
  const [openedCount, setOpenedCount] = useState<StockCount | null>(null)

  return (
    <WorkPage
      title="Stock count"
      subtitle="Count what’s on the shelf and correct the system stock."
      actions={
        <div role="tablist" aria-label="Stock count" className="flex rounded-full bg-white p-1 ring-1 ring-slate-200">
          {(['count', 'history'] as const).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`h-10 rounded-full px-4 text-sm font-medium transition ${tab === key ? 'bg-[#1F5E3B] text-white' : 'text-slate-600'}`}
            >
              {key === 'count' ? 'New count' : 'History'}
            </button>
          ))}
        </div>
      }
    >
      {tab === 'count' ? (
        <CountSheet
          onConfirmed={(count) => {
            setTab('history')
            setOpenedCount(count)
          }}
        />
      ) : (
        <CountHistory onOpen={setOpenedCount} />
      )}

      {openedCount && <CountDetail countId={openedCount.id} onClose={() => setOpenedCount(null)} />}
    </WorkPage>
  )
}

/* ------------------------------------------------------------------
   COUNT SHEET
------------------------------------------------------------------ */

function CountSheet({ onConfirmed }: { onConfirmed: (count: StockCount) => void }) {
  const { notify } = useToast()
  const sheet = useAsync(() => stockApi.countSheet(), [])
  const [counts, setCounts] = useState<Draft>(loadDraft)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [reviewing, setReviewing] = useState(false)

  useEffect(() => saveDraft(counts), [counts])

  const rows = sheet.data ?? []
  const byId = useMemo(() => new Map(rows.map((row) => [row.productId, row])), [rows])

  // Drop drafted counts for products that no longer exist / are inactive.
  const counted = Object.entries(counts)
    .map(([id, value]) => ({ row: byId.get(Number(id)), counted: value }))
    .filter((entry): entry is { row: CountSheetRow; counted: number } => Boolean(entry.row))
  const differences = counted.filter((entry) => entry.counted !== entry.row.stockQuantity)
  const netChange = differences.reduce((sum, entry) => sum + entry.counted - entry.row.stockQuantity, 0)

  const term = search.trim().toLowerCase()
  const visible = rows.filter((row) => {
    if (term && !row.name.toLowerCase().includes(term) && !row.sku.toLowerCase().includes(term)) return false
    const value = counts[row.productId]
    if (filter === 'counted') return value !== undefined
    if (filter === 'uncounted') return value === undefined
    if (filter === 'differences') return value !== undefined && value !== row.stockQuantity
    return true
  })

  function setCount(productId: number, value: number | undefined) {
    setCounts((prev) => {
      const next = { ...prev }
      if (value === undefined) delete next[productId]
      else next[productId] = value
      return next
    })
  }

  function discard() {
    setCounts({})
    notify('Count cleared.')
  }

  const filters: { key: Filter; label: string }[] = [
    { key: 'all', label: `All ${rows.length}` },
    { key: 'uncounted', label: `Not counted ${rows.length - counted.length}` },
    { key: 'counted', label: `Counted ${counted.length}` },
    { key: 'differences', label: `Differences ${differences.length}` },
  ]

  return (
    <div className="mt-5">
      <div className="relative">
        <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          aria-label="Search products"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search name or SKU"
          className="h-12 w-full rounded-2xl border-0 bg-white pl-11 pr-4 text-[15px] ring-1 ring-slate-200 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-[#1F5E3B] [&::-webkit-search-cancel-button]:hidden"
        />
      </div>

      <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-none sm:mx-0 sm:px-0">
        {filters.map((option) => (
          <button
            key={option.key}
            type="button"
            onClick={() => setFilter(option.key)}
            aria-pressed={filter === option.key}
            className={`h-10 shrink-0 rounded-full px-4 text-sm font-medium transition ${
              filter === option.key ? 'bg-[#1F5E3B] text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="mt-3 overflow-hidden rounded-2xl bg-white ring-1 ring-slate-100">
        <div className="hidden grid-cols-[minmax(0,1fr)_6rem_9rem_6rem] gap-3 border-b border-slate-100 px-4 py-3 text-xs font-medium text-slate-500 sm:grid">
          <span>Product</span>
          <span className="text-right">System stock</span>
          <span className="text-center">Counted stock</span>
          <span className="text-right">Difference</span>
        </div>

        {sheet.loading && !sheet.data && (
          <div className="py-12">
            <Spinner />
          </div>
        )}
        {sheet.error && (
          <div className="p-6">
            <ErrorState message={sheet.error} onRetry={() => void sheet.reload()} />
          </div>
        )}
        {sheet.data && visible.length === 0 && (
          <div className="py-12 text-center">
            <EmptyState title="Nothing to show" hint={term ? `No product matches “${search}”.` : 'Try another filter.'} />
          </div>
        )}

        <ul>
          {visible.map((row) => {
            const value = counts[row.productId]
            const difference = value === undefined ? null : value - row.stockQuantity
            return (
              <li
                key={row.productId}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b border-slate-100 px-4 py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_6rem_9rem_6rem]"
              >
                <div className="min-w-0">
                  <p className="truncate text-[15px]">{row.name}</p>
                  <p className="truncate text-xs text-slate-500">
                    {row.sku}
                    <span className="sm:hidden"> · System {row.stockQuantity}</span>
                  </p>
                </div>
                <p className="hidden text-right text-[15px] tabular-nums sm:block">{row.stockQuantity}</p>
                <div className="flex items-center justify-end gap-1 sm:justify-center">
                  <input
                    type="text"
                    inputMode="numeric"
                    aria-label={`Counted stock for ${row.name}`}
                    value={value === undefined ? '' : String(value)}
                    placeholder="—"
                    onChange={(event) => {
                      const digits = event.target.value.replace(/\D/g, '').slice(0, 7)
                      setCount(row.productId, digits === '' ? undefined : Number(digits))
                    }}
                    className="h-11 w-20 rounded-xl border-0 bg-[#F3F5F4] text-center text-[15px] font-semibold tabular-nums outline-none focus:bg-white focus:ring-2 focus:ring-[#1F5E3B]"
                  />
                  {value === undefined && (
                    <button
                      type="button"
                      onClick={() => setCount(row.productId, row.stockQuantity)}
                      aria-label={`${row.name} matches system stock`}
                      className="h-11 rounded-xl px-2 text-xs font-medium text-[#1F5E3B] active:bg-[#F2F8F4]"
                    >
                      Match
                    </button>
                  )}
                </div>
                <p
                  className={`col-span-2 text-right text-sm font-semibold tabular-nums sm:col-span-1 sm:text-[15px] ${
                    difference === null ? 'text-slate-300' : differenceClass(difference)
                  }`}
                >
                  {difference === null ? <span className="sm:inline hidden">—</span> : difference === 0 ? 'OK' : signed(difference)}
                </p>
              </li>
            )
          })}
        </ul>
      </div>

      {/* Sticky inside the page's scroll area, so it clears both the sidebar and the phone tab bar. */}
      {counted.length > 0 && (
        <div className="sticky bottom-0 z-20 pb-3 pt-3">
          <div className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-[0_8px_24px_rgba(9,20,19,0.12)] ring-1 ring-slate-100">
            <div className="min-w-0 flex-1 pl-1">
              <p className="text-sm font-semibold">
                {counted.length} counted · {differences.length} {differences.length === 1 ? 'difference' : 'differences'}
              </p>
              <p className="text-xs text-slate-500">
                Net change {signed(netChange)} ·{' '}
                <button type="button" onClick={discard} className="font-medium text-rose-600 underline-offset-2 hover:underline">
                  Clear
                </button>
              </p>
            </div>
            <button
              type="button"
              onClick={() => setReviewing(true)}
              className="h-12 shrink-0 rounded-2xl bg-[#1F5E3B] px-5 text-[15px] font-semibold text-white transition active:scale-[0.99]"
            >
              Review
            </button>
          </div>
        </div>
      )}

      {reviewing && (
        <ReviewDialog
          counted={counted}
          onClose={() => setReviewing(false)}
          onConfirmed={(count) => {
            setReviewing(false)
            setCounts({})
            void sheet.reload()
            notify(`${count.countNumber} saved. ${count.itemsAdjusted} ${count.itemsAdjusted === 1 ? 'product' : 'products'} adjusted.`)
            onConfirmed(count)
          }}
        />
      )}
    </div>
  )
}

function ReviewDialog({
  counted,
  onClose,
  onConfirmed,
}: {
  counted: { row: CountSheetRow; counted: number }[]
  onClose: () => void
  onConfirmed: (count: StockCount) => void
}) {
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const differences = counted.filter((entry) => entry.counted !== entry.row.stockQuantity)

  async function confirm() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const count = await stockApi.confirmCount({
        notes,
        items: counted.map((entry) => ({ productId: entry.row.productId, countedQuantity: entry.counted })),
      })
      onConfirmed(count)
    } catch (err) {
      setError(getErrorMessage(err))
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Confirm stock count"
      description={`${counted.length} counted · ${differences.length} will be adjusted`}
      onClose={onClose}
      preventClose={busy}
      size="lg"
      mobileFullScreen
      footer={
        <div className="flex w-full gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="h-12 flex-1 rounded-2xl text-[15px] font-medium text-slate-600 active:bg-slate-100 sm:flex-none sm:px-5">
            Keep counting
          </button>
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={busy}
            className="h-12 flex-1 rounded-2xl bg-[#1F5E3B] px-6 text-[15px] font-semibold text-white transition active:scale-[0.99] disabled:bg-slate-200 disabled:text-slate-400"
          >
            {busy ? 'Saving…' : differences.length ? `Adjust ${differences.length} ${differences.length === 1 ? 'product' : 'products'}` : 'Save count'}
          </button>
        </div>
      }
    >
      {differences.length === 0 ? (
        <p className="rounded-2xl bg-[#F2F8F4] px-4 py-3 text-sm text-[#1F5E3B]">Every counted product matches the system. The count is saved for the record.</p>
      ) : (
        <ul className="rounded-2xl ring-1 ring-slate-100">
          {differences.map((entry) => {
            const difference = entry.counted - entry.row.stockQuantity
            return (
              <li key={entry.row.productId} className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-2.5 text-sm last:border-b-0">
                <span className="min-w-0 truncate">{entry.row.name}</span>
                <span className="shrink-0 tabular-nums text-slate-500">
                  {entry.row.stockQuantity} → <span className="font-semibold text-[#091413]">{entry.counted}</span>{' '}
                  <span className={`font-semibold ${differenceClass(difference)}`}>({signed(difference)})</span>
                </span>
              </li>
            )
          })}
        </ul>
      )}
      <p className="mt-3 text-xs text-slate-500">
        Differences are applied against the stock at the moment you confirm, and each one is saved as a stock movement.
      </p>

      <label htmlFor="stock-count-notes" className="mt-4 block text-sm font-medium">
        Notes <span className="font-normal text-slate-400">(optional)</span>
      </label>
      <textarea
        id="stock-count-notes"
        rows={2}
        maxLength={200}
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        placeholder="e.g. Month-end count, back room only"
        className="mt-1.5 w-full resize-none rounded-2xl border-0 bg-[#F3F5F4] px-4 py-3 text-[15px] placeholder:text-slate-400 outline-none focus:bg-white focus:ring-2 focus:ring-[#1F5E3B]"
      />
      {error && (
        <p role="alert" className="mt-2 text-sm text-rose-600">
          {error}
        </p>
      )}
    </Modal>
  )
}

/* ------------------------------------------------------------------
   HISTORY
------------------------------------------------------------------ */

function CountHistory({ onOpen }: { onOpen: (count: StockCount) => void }) {
  const [page, setPage] = useState(1)
  const history = useAsync(() => stockApi.counts({ page, pageSize: 15 }), [page])

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
          <EmptyState title="No stock counts yet" hint="Confirmed counts will be listed here." />
        </div>
      )}
      <ul>
        {(history.data?.items ?? []).map((count) => (
          <li key={count.id} className="border-b border-slate-100 last:border-b-0">
            <button type="button" onClick={() => onOpen(count)} className="flex min-h-16 w-full items-center gap-3 py-3 text-left active:bg-slate-50">
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-medium">{count.countNumber}</p>
                <p className="truncate text-xs text-slate-500">
                  {formatDateTime(count.createdAt)} · {count.createdBy}
                  {count.notes && ` · ${count.notes}`}
                </p>
              </div>
              <div className="shrink-0 text-right text-sm">
                <p>{count.itemsCounted} counted</p>
                <p className={count.itemsAdjusted ? 'text-amber-700' : 'text-slate-500'}>
                  {count.itemsAdjusted} adjusted · net {signed(count.netChange)}
                </p>
              </div>
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

function CountDetail({ countId, onClose }: { countId: number; onClose: () => void }) {
  const detail = useAsync(() => stockApi.getCount(countId), [countId])
  const count = detail.data

  return (
    <Modal
      title={count?.countNumber ?? 'Stock count'}
      description={count ? `${formatDateTime(count.createdAt)} · ${count.createdBy}` : undefined}
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
      {count && (
        <>
          {count.notes && <p className="mb-3 text-sm text-slate-600">{count.notes}</p>}
          <div className="overflow-hidden rounded-2xl ring-1 ring-slate-100">
            <div className="grid grid-cols-[minmax(0,1fr)_4rem_4rem_4rem] gap-2 border-b border-slate-100 bg-[#F6F8F7] px-4 py-2 text-xs font-medium text-slate-500">
              <span>Product</span>
              <span className="text-right">System</span>
              <span className="text-right">Counted</span>
              <span className="text-right">Diff.</span>
            </div>
            <ul>
              {count.items.map((item) => (
                <li key={item.productId} className="grid grid-cols-[minmax(0,1fr)_4rem_4rem_4rem] items-center gap-2 border-b border-slate-100 px-4 py-2.5 text-sm last:border-b-0">
                  <span className="min-w-0 truncate">{item.productName}</span>
                  <span className="text-right tabular-nums text-slate-500">{item.systemQuantity}</span>
                  <span className="text-right tabular-nums">{item.countedQuantity}</span>
                  <span className={`text-right font-semibold tabular-nums ${differenceClass(item.difference)}`}>
                    {item.difference === 0 ? 'OK' : signed(item.difference)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </Modal>
  )
}

export default StockCountPage
