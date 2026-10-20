import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { ingredientApi } from '../../api/ingredientApi'
import { Badge } from '../../components/ui/Badge'
import { ChevronRight, Plus } from '../../components/ui/Icons'
import { ConfirmDialog, Modal } from '../../components/ui/Modal'
import { DetailList, DetailRow, PrimaryButton, TextButton } from '../../components/ui/MobileKit'
import { Pagination } from '../../components/ui/Pagination'
import { EmptyState, ErrorState, Spinner } from '../../components/ui/States'
import { Panel, PillGroup, SearchBox, WorkPage } from '../../components/ui/WorkPage'
import { useAuth } from '../../context/AuthContext'
import { useSettings } from '../../context/SettingsContext'
import { useToast } from '../../context/ToastContext'
import { useAsync } from '../../hooks/useAsync'
import { useDebounced } from '../../hooks/useDebounced'
import { useDismissOnBack } from '../../hooks/useDismissOnBack'
import { formatInUnit, formatQty, unitShort } from '../../services/units'
import type { Ingredient, StockLevel, StockMovementType } from '../../types'
import { getErrorMessage } from '../../utils/errors'
import { formatDateTime, formatMoney } from '../../utils/format'
import { AdjustIngredientDialog } from './AdjustIngredientDialog'
import { BatchesPanel } from './BatchesPanel'
import { IngredientCountPanel } from './IngredientCountPanel'
import { IngredientForm } from './IngredientForm'
import { MovementList, MovementsPanel } from './MovementsPanel'
import { UsagePanel } from './UsagePanel'

type Tab = 'stock' | 'count' | 'batches' | 'history' | 'usage'
type Filter = '' | StockLevel

const PAGE_SIZE = 20

/** On hand in the base unit, plus the purchase unit when there is one ("3,200 g · 3.2 bag"). */
export function onHandLabel(item: Ingredient): string {
  const base = formatQty(item.onHand, item.baseUnit)
  return item.purchaseUnit && item.purchaseUnit !== item.baseUnit ? `${base} · ${formatInUnit(item.onHand, item.purchaseUnit, item.baseUnit, item.conversions)}` : base
}

function levelTone(level: StockLevel): 'red' | 'amber' | 'green' {
  return level === 'Out of Stock' ? 'red' : level === 'Low Stock' ? 'amber' : 'green'
}

/**
 * Ingredients & supplies for cafés and kitchens: what's on hand, deliveries, waste, counts,
 * batches and how much was used. Baristas can record waste and batches; managers do the rest.
 */
export function IngredientsPage() {
  const { can } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const tabs: { key: Tab; label: string }[] = [
    { key: 'stock', label: 'Stock' },
    ...(can('inventory.count') ? [{ key: 'count' as Tab, label: 'Count' }] : []),
    ...(can('inventory.produce') ? [{ key: 'batches' as Tab, label: 'Batches' }] : []),
    ...(can('inventory.manage') ? [{ key: 'history' as Tab, label: 'History' }] : []),
    ...(can('inventory.manage') ? [{ key: 'usage' as Tab, label: 'Usage' }] : []),
  ]
  const requested = searchParams.get('tab') as Tab | null
  const tab: Tab = tabs.some((option) => option.key === requested) ? requested! : 'stock'
  const setTab = (next: Tab) => setSearchParams(next === 'stock' ? {} : { tab: next }, { replace: true })

  return (
    <WorkPage title="Ingredients" subtitle="Beans, milk, syrups, cups and everything your recipes use." maxWidth="max-w-6xl">
      {tabs.length > 1 && (
        <div className="mt-4">
          <PillGroup label="Ingredients view" options={tabs} value={tab} onChange={setTab} />
        </div>
      )}
      <div className="mt-4">
        {tab === 'stock' && <StockPanel />}
        {tab === 'count' && <IngredientCountPanel onDone={() => setTab('stock')} />}
        {tab === 'batches' && <BatchesPanel initialProductId={Number(searchParams.get('product')) || null} />}
        {tab === 'history' && <MovementsPanel />}
        {tab === 'usage' && <UsagePanel />}
      </div>
    </WorkPage>
  )
}

function StockPanel() {
  const { can } = useAuth()
  const { settings } = useSettings()
  const money = (value: number) => formatMoney(value, settings.currencySymbol)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('')
  const [page, setPage] = useState(1)
  const [showInactive, setShowInactive] = useState(false)
  const [editing, setEditing] = useState<Ingredient | null | 'new'>(null)
  const [detail, setDetail] = useState<Ingredient | null>(null)
  const [adjusting, setAdjusting] = useState<{ item: Ingredient; type: StockMovementType } | null>(null)
  const q = useDebounced(search).trim()
  const canManage = can('inventory.manage')

  const list = useAsync(
    () => ingredientApi.list({ search: q || undefined, stockStatus: filter || undefined, includeInactive: showInactive, page, pageSize: PAGE_SIZE }),
    [q, filter, page, showInactive],
  )
  const counts = useAsync(() => ingredientApi.statusCounts(), [])

  useEffect(() => setPage(1), [q, filter, showInactive])

  function refresh(updated?: Ingredient) {
    void list.reload()
    void counts.reload()
    if (updated && detail?.id === updated.id) setDetail(updated)
  }

  const items = list.data?.items ?? []
  const alerts = (counts.data?.['Low Stock'] ?? 0) + (counts.data?.['Out of Stock'] ?? 0)

  return (
    <Panel>
      <div className="flex flex-col gap-3 @container sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <SearchBox value={search} onChange={setSearch} placeholder="Search ingredients" label="Search ingredients" />
        </div>
        {canManage && (
          <PrimaryButton onClick={() => setEditing('new')} className="h-12 flex-none px-5">
            <Plus size={11} />
            Add item
          </PrimaryButton>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <PillGroup
          label="Stock level"
          size="sm"
          value={filter}
          onChange={setFilter}
          options={[
            { key: '', label: 'All', count: counts.data?.all },
            { key: 'Low Stock', label: 'Low', count: counts.data?.['Low Stock'] },
            { key: 'Out of Stock', label: 'Out', count: counts.data?.['Out of Stock'] },
          ]}
        />
        {canManage && (
          <button type="button" aria-pressed={showInactive} onClick={() => setShowInactive((value) => !value)} className="h-11 rounded-full px-3 text-sm font-medium text-slate-500 hover:bg-slate-100">
            {showInactive ? 'Hide inactive' : 'Show inactive'}
          </button>
        )}
      </div>
      {alerts > 0 && filter === '' && (
        <p className="mt-3 rounded-2xl bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          {alerts} {alerts === 1 ? 'item needs' : 'items need'} restocking.{' '}
          <button type="button" onClick={() => setFilter('Low Stock')} className="font-semibold underline">
            Show
          </button>
        </p>
      )}

      {list.loading && !list.data && (
        <div className="py-12">
          <Spinner />
        </div>
      )}
      {list.error && (
        <div className="py-6">
          <ErrorState message={list.error} onRetry={() => void list.reload()} />
        </div>
      )}
      {list.data && items.length === 0 && (
        <div className="py-10 text-center">
          <EmptyState
            title={q || filter ? 'Nothing matches' : 'No ingredients yet'}
            hint={q || filter ? 'Try another search or filter.' : canManage ? 'Add coffee beans, milk, cups… then use them in product recipes.' : 'A manager adds them here.'}
          />
          {!q && !filter && canManage && (
            <PrimaryButton onClick={() => setEditing('new')} className="mx-auto mt-4 h-12 max-w-xs">
              Add your first ingredient
            </PrimaryButton>
          )}
        </div>
      )}

      {items.length > 0 && (
        <ul className={`mt-3 divide-y divide-slate-100 ${list.loading ? 'opacity-60' : ''}`}>
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-2 py-1">
              <button
                type="button"
                onClick={() => setDetail(item)}
                className="flex min-h-16 min-w-0 flex-1 items-center gap-3 rounded-xl px-1 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B]"
              >
                <div className="min-w-0 flex-1">
                  <p className={`truncate text-[15px] font-medium ${item.isActive ? '' : 'text-slate-400'}`}>{item.name}</p>
                  <p className="truncate text-xs text-slate-500">
                    {item.costPerBase > 0 ? `${money(item.unitCost)}/${unitShort(item.costUnit)}` : 'No cost set'}
                    {item.recipeCount > 0 && ` · in ${item.recipeCount} ${item.recipeCount === 1 ? 'recipe' : 'recipes'}`}
                    {!item.isActive && ' · Inactive'}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className={`text-[15px] font-semibold tabular-nums ${item.stockStatus === 'Out of Stock' ? 'text-rose-600' : ''}`}>{formatQty(item.onHand, item.baseUnit)}</p>
                  {item.stockStatus !== 'In Stock' ? (
                    <Badge tone={levelTone(item.stockStatus)}>{item.stockStatus === 'Low Stock' ? 'Low' : 'Out'}</Badge>
                  ) : (
                    item.purchaseUnit &&
                    item.purchaseUnit !== item.baseUnit && (
                      <p className="text-xs tabular-nums text-slate-400">{formatInUnit(item.onHand, item.purchaseUnit, item.baseUnit, item.conversions)}</p>
                    )
                  )}
                </div>
                <ChevronRight size={12} className="shrink-0 text-slate-300" />
              </button>
              {item.isActive && can('inventory.waste') && (
                <button
                  type="button"
                  onClick={() => setAdjusting({ item, type: 'waste' })}
                  className="hidden h-11 shrink-0 rounded-full px-3 text-sm font-medium text-rose-600 hover:bg-rose-50 sm:block"
                >
                  Waste
                </button>
              )}
              {item.isActive && can('inventory.receive') && (
                <button
                  type="button"
                  onClick={() => setAdjusting({ item, type: 'stock_in' })}
                  className="hidden h-11 shrink-0 rounded-full bg-[#E6F1EA] px-3.5 text-sm font-semibold text-[#1F5E3B] hover:bg-[#D3E6DB] sm:block"
                >
                  Stock in
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {(list.data?.totalPages ?? 1) > 1 && (
        <div className="mt-3">
          <Pagination page={list.data!.page} totalPages={list.data!.totalPages} onPage={setPage} />
        </div>
      )}

      {detail && !adjusting && editing === null && (
        <IngredientDetail
          item={detail}
          onClose={() => setDetail(null)}
          onAdjust={(type) => setAdjusting({ item: detail, type })}
          onEdit={() => setEditing(detail)}
          onChanged={refresh}
        />
      )}
      {adjusting && (
        <AdjustIngredientDialog
          item={adjusting.item}
          initialType={adjusting.type}
          onClose={() => setAdjusting(null)}
          onSaved={(updated) => refresh(updated)}
        />
      )}
      {editing !== null && (
        <IngredientForm
          item={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            refresh(saved)
            if (editing !== 'new') setDetail(saved)
          }}
        />
      )}
    </Panel>
  )
}

function IngredientDetail({
  item,
  onClose,
  onAdjust,
  onEdit,
  onChanged,
}: {
  item: Ingredient
  onClose: () => void
  onAdjust: (type: StockMovementType) => void
  onEdit: () => void
  onChanged: (item?: Ingredient) => void
}) {
  const { can } = useAuth()
  const { notify } = useToast()
  const { settings } = useSettings()
  const money = (value: number) => formatMoney(value, settings.currencySymbol)
  const { close } = useDismissOnBack('ingredientDetailOpen', onClose)
  const [confirmDeactivate, setConfirmDeactivate] = useState(false)
  const [busy, setBusy] = useState(false)
  const movements = useAsync(() => ingredientApi.movements({ inventoryItemId: item.id, pageSize: 8 }), [item.id, item.onHand])

  async function deactivate() {
    setBusy(true)
    try {
      await ingredientApi.deactivate(item.id)
      notify(`${item.name} deactivated.`)
      onChanged()
      close()
    } catch (err) {
      notify(getErrorMessage(err), 'error')
    } finally {
      setBusy(false)
      setConfirmDeactivate(false)
    }
  }

  return (
    <>
      <Modal
        title={item.name}
        description={item.sku ?? undefined}
        size="lg"
        mobileFullScreen
        onClose={close}
        footer={
          <div className="flex w-full flex-wrap items-center gap-2">
            {can('inventory.manage') && item.isActive && (
              <TextButton tone="danger" onClick={() => setConfirmDeactivate(true)} disabled={busy} className="h-12">
                Deactivate
              </TextButton>
            )}
            <div className="flex-1" />
            {can('inventory.manage') && (
              <TextButton tone="accent" onClick={onEdit} className="h-12">
                Edit
              </TextButton>
            )}
            {item.isActive && can('inventory.waste') && (
              <TextButton tone="danger" onClick={() => onAdjust('waste')} className="h-12">
                Record waste
              </TextButton>
            )}
            {item.isActive && can('inventory.manage') && (
              <TextButton tone="accent" onClick={() => onAdjust('correction')} className="h-12">
                Adjust
              </TextButton>
            )}
            {item.isActive && can('inventory.receive') && (
              <PrimaryButton onClick={() => onAdjust('stock_in')} className="h-12 flex-none px-6">
                Stock in
              </PrimaryButton>
            )}
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-2xl bg-[#F6F8F7] px-4 py-3">
              <p className="text-sm text-slate-500">On hand</p>
              <p className={`mt-0.5 text-2xl font-bold tabular-nums ${item.stockStatus === 'Out of Stock' ? 'text-rose-600' : ''}`}>{formatQty(item.onHand, item.baseUnit)}</p>
              <p className="text-xs text-slate-500">
                {item.purchaseUnit && item.purchaseUnit !== item.baseUnit ? `${formatInUnit(item.onHand, item.purchaseUnit, item.baseUnit, item.conversions)} · ` : ''}
                {item.reorderLevel > 0 ? `low at ${formatQty(item.reorderLevel, item.baseUnit)}` : 'no low-stock alert'}
              </p>
            </div>
            <div className="rounded-2xl bg-[#F2F8F4] px-4 py-3">
              <p className="text-sm text-[#1F5E3B]">Cost</p>
              <p className="mt-0.5 text-2xl font-bold tabular-nums">{money(item.unitCost)}</p>
              <p className="text-xs text-slate-500">
                per {unitShort(item.costUnit)} · stock worth {money(Math.max(item.onHand, 0) / 1000 * item.costPerBase)}
              </p>
            </div>
          </div>
          {item.stockStatus !== 'In Stock' && (
            <p className={`rounded-2xl px-4 py-2.5 text-sm ${item.stockStatus === 'Out of Stock' ? 'bg-rose-50 text-rose-800' : 'bg-amber-50 text-amber-900'}`}>
              {item.stockStatus === 'Out of Stock' ? 'Out of stock: recipes using it can’t be sold.' : 'Running low: time to reorder.'}
              {item.supplierName && ` Supplier: ${item.supplierName}.`}
            </p>
          )}
          <DetailList>
            <DetailRow label="Measured in" value={unitShort(item.baseUnit)} />
            <DetailRow
              label="Package sizes"
              value={
                Object.keys(item.conversions).length
                  ? Object.entries(item.conversions)
                      .map(([unit, size]) => `1 ${unitShort(unit)} = ${formatQty(size, item.baseUnit)}`)
                      .join(', ')
                  : null
              }
            />
            <DetailRow label="Supplier" value={item.supplierName} />
            <DetailRow label="Used in" value={item.recipeCount ? `${item.recipeCount} ${item.recipeCount === 1 ? 'recipe' : 'recipes'}` : null} />
            <DetailRow label="Notes" value={item.notes} />
          </DetailList>
          {can('inventory.manage') && (
            <div>
              <h3 className="text-sm font-semibold">Recent movements</h3>
              {movements.loading && !movements.data ? (
                <div className="py-6">
                  <Spinner />
                </div>
              ) : (
                <MovementList movements={movements.data?.items ?? []} showItem={false} />
              )}
            </div>
          )}
          <p className="text-xs text-slate-400">Last changed {formatDateTime(item.updatedAt)}</p>
        </div>
      </Modal>
      {confirmDeactivate && (
        <ConfirmDialog
          title={`Deactivate ${item.name}?`}
          message="It disappears from recipes pickers and counts. Its history is kept and you can reactivate it from Edit."
          confirmLabel="Deactivate"
          danger
          busy={busy}
          onCancel={() => setConfirmDeactivate(false)}
          onConfirm={() => void deactivate()}
        />
      )}
    </>
  )
}
