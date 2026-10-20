import { useMemo, useState } from 'react'

import { ingredientApi } from '../../api/ingredientApi'
import { draftToStored, type QtyDraft } from '../../components/inventory/QuantityUnitField'
import { ConfirmDialog } from '../../components/ui/Modal'
import { PrimaryButton, TextAreaField } from '../../components/ui/MobileKit'
import { EmptyState, ErrorState, Spinner } from '../../components/ui/States'
import { Panel, PillGroup, SearchBox } from '../../components/ui/WorkPage'
import { useSettings } from '../../context/SettingsContext'
import { useToast } from '../../context/ToastContext'
import { useAsync } from '../../hooks/useAsync'
import { formatQty, unitShort, unitsForItem } from '../../services/units'
import type { Ingredient } from '../../types'
import { getErrorMessage } from '../../utils/errors'
import { formatMoney } from '../../utils/format'

type Show = 'all' | 'counted' | 'differences'

/** Shelves are counted in packs, kilos or litres: default to the purchase unit, else kg / L / pc. */
function countUnit(item: Ingredient): string {
  return item.purchaseUnit ?? (item.baseUnit === 'g' ? 'kg' : item.baseUnit === 'ml' ? 'l' : 'pc')
}

/**
 * Physical count of ingredients: type what is really on the shelf, see the variance against
 * what the system expected, then confirm. Each difference becomes a "Physical count" movement.
 */
export function IngredientCountPanel({ onDone }: { onDone: () => void }) {
  const { notify } = useToast()
  const { settings } = useSettings()
  const money = (value: number) => formatMoney(value, settings.currencySymbol)
  const items = useAsync(() => ingredientApi.all(), [])
  const [counted, setCounted] = useState<Record<number, QtyDraft>>({})
  const [search, setSearch] = useState('')
  const [show, setShow] = useState<Show>('all')
  const [notes, setNotes] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const entries = useMemo(
    () =>
      (items.data ?? []).map((item) => {
        const draft = counted[item.id]
        const value = draft && draft.text.trim() ? draftToStored(draft, item.baseUnit, item.conversions) : null
        return { item, draft, value, variance: value === null ? null : value - item.onHand }
      }),
    [items.data, counted],
  )
  const done = entries.filter((entry) => entry.value !== null)
  const differences = done.filter((entry) => entry.variance !== 0)
  const invalid = entries.filter((entry) => entry.draft?.text.trim() && entry.value === null)
  const varianceValue = differences.reduce((sum, entry) => sum + ((entry.variance ?? 0) / 1000) * entry.item.costPerBase, 0)
  const term = search.trim().toLowerCase()
  const visible = entries.filter(
    (entry) =>
      (!term || entry.item.name.toLowerCase().includes(term)) &&
      (show === 'all' || (show === 'counted' ? entry.value !== null : entry.variance !== null && entry.variance !== 0)),
  )

  function setDraft(item: Ingredient, patch: Partial<QtyDraft>) {
    setCounted((current) => ({ ...current, [item.id]: { text: '', unit: countUnit(item), ...current[item.id], ...patch } }))
  }

  async function confirm() {
    setBusy(true)
    try {
      const result = await ingredientApi.confirmCount({
        notes,
        items: done.map((entry) => ({ inventoryItemId: entry.item.id, countedQuantity: Math.max(entry.value!, 0) })),
      })
      notify(`${result.countNumber}: ${done.length} counted, ${result.adjusted} adjusted.`)
      setCounted({})
      setNotes('')
      setConfirming(false)
      onDone()
    } catch (err) {
      notify(getErrorMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  if (items.loading && !items.data) {
    return (
      <Panel>
        <div className="py-12">
          <Spinner />
        </div>
      </Panel>
    )
  }
  if (items.error) {
    return (
      <Panel>
        <ErrorState message={items.error} onRetry={() => void items.reload()} />
      </Panel>
    )
  }
  if ((items.data ?? []).length === 0) {
    return (
      <Panel>
        <div className="py-10 text-center">
          <EmptyState title="Nothing to count yet" hint="Add ingredients first." />
        </div>
      </Panel>
    )
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <Panel title="Count what’s on the shelf" description="Leave an item blank to skip it. Only counted items change.">
        <SearchBox value={search} onChange={setSearch} placeholder="Find an item" label="Find an item" />
        <div className="mt-3">
          <PillGroup
            label="Show"
            size="sm"
            value={show}
            onChange={setShow}
            options={[
              { key: 'all', label: 'All', count: entries.length },
              { key: 'counted', label: 'Counted', count: done.length },
              { key: 'differences', label: 'Differences', count: differences.length },
            ]}
          />
        </div>
        <ul className="mt-2 divide-y divide-slate-100">
          {visible.map(({ item, draft, value, variance }) => {
            const units = unitsForItem(item.baseUnit, item.conversions)
            const unit = draft?.unit ?? countUnit(item)
            return (
              <li key={item.id} className="py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="min-w-0 truncate text-[15px] font-medium">{item.name}</p>
                  <p className="shrink-0 text-xs tabular-nums text-slate-500">Expected {formatQty(item.onHand, item.baseUnit)}</p>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    inputMode="decimal"
                    value={draft?.text ?? ''}
                    onChange={(e) => setDraft(item, { text: e.target.value.replace(/[^\d.,]/g, '').slice(0, 14), unit })}
                    placeholder="Actual"
                    aria-label={`Actual ${item.name}`}
                    aria-invalid={Boolean(draft?.text.trim() && value === null)}
                    className="h-11 w-28 rounded-xl border-0 bg-[#F3F5F4] px-3 text-[15px] tabular-nums outline-none focus:bg-white focus:ring-2 focus:ring-[#1F5E3B]"
                  />
                  <div role="radiogroup" aria-label={`Unit for ${item.name}`} className="flex flex-wrap gap-1">
                    {units.map((option) => (
                      <button
                        key={option.code}
                        type="button"
                        role="radio"
                        aria-checked={unit === option.code}
                        onClick={() => setDraft(item, { unit: option.code })}
                        className={`h-11 min-w-11 rounded-xl px-3 text-sm font-medium ${
                          unit === option.code ? 'bg-[#1F5E3B] text-white' : 'bg-[#F3F5F4] text-slate-600 hover:bg-[#E9EEEB]'
                        }`}
                      >
                        {unitShort(option.code)}
                      </button>
                    ))}
                  </div>
                  {variance !== null && (
                    <span
                      className={`ml-auto text-sm font-semibold tabular-nums ${variance < 0 ? 'text-rose-600' : variance > 0 ? 'text-[#1F5E3B]' : 'text-slate-400'}`}
                    >
                      {variance === 0 ? 'Matches' : `${variance > 0 ? '+' : '−'}${formatQty(Math.abs(variance), item.baseUnit)}`}
                    </span>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      </Panel>

      <div className="lg:sticky lg:top-4 lg:self-start">
        <Panel title="Summary">
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">Counted</dt>
              <dd className="tabular-nums">
                {done.length} of {entries.length}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">With a difference</dt>
              <dd className="tabular-nums">{differences.length}</dd>
            </div>
            {differences.length > 0 && (
              <div className="flex justify-between">
                <dt className="text-slate-500">Value of difference</dt>
                <dd className={`tabular-nums ${varianceValue < 0 ? 'text-rose-600' : ''}`}>
                  {varianceValue < 0 ? '−' : '+'}
                  {money(Math.abs(varianceValue))}
                </dd>
              </div>
            )}
          </dl>
          <div className="mt-4">
            <TextAreaField label="Notes" optional value={notes} onChange={setNotes} placeholder="e.g. End-of-day count" />
          </div>
          {invalid.length > 0 && <p className="mt-3 text-sm text-rose-600">Fix the amount for {invalid[0]!.item.name}.</p>}
          <PrimaryButton onClick={() => setConfirming(true)} disabled={done.length === 0 || invalid.length > 0 || busy} className="mt-4 w-full">
            {done.length === 0 ? 'Enter a count to confirm' : `Confirm count (${differences.length} to adjust)`}
          </PrimaryButton>
        </Panel>
      </div>

      {confirming && (
        <ConfirmDialog
          title="Confirm this count?"
          message={
            differences.length === 0
              ? `${done.length} items match the system. The count is saved with no changes.`
              : `${differences.length} ${differences.length === 1 ? 'item changes' : 'items change'} to the amounts you counted (${differences
                  .slice(0, 3)
                  .map((entry) => `${entry.item.name} ${formatQty(entry.item.onHand, entry.item.baseUnit)} → ${formatQty(entry.value!, entry.item.baseUnit)}`)
                  .join(', ')}${differences.length > 3 ? '…' : ''}). Each change is recorded as a stock movement.`
          }
          confirmLabel="Confirm count"
          busy={busy}
          onCancel={() => setConfirming(false)}
          onConfirm={() => void confirm()}
        />
      )}
    </div>
  )
}
