import { useEffect, useState } from 'react'

import { ingredientApi } from '../../api/ingredientApi'
import { Pagination } from '../../components/ui/Pagination'
import { EmptyState, ErrorState, Spinner } from '../../components/ui/States'
import { Panel, PillGroup } from '../../components/ui/WorkPage'
import { useAsync } from '../../hooks/useAsync'
import { WASTE_TYPES } from '../../services/inventoryMovements'
import { formatQty } from '../../services/units'
import type { StockMovement, StockMovementType } from '../../types'
import { formatDateTime } from '../../utils/format'

type Kind = 'all' | 'sales' | 'in' | 'waste' | 'counts' | 'adjustments'

const KIND_TYPES: Record<Kind, StockMovementType[] | undefined> = {
  all: undefined,
  sales: ['sale', 'void', 'production'],
  in: ['stock_in', 'opening'],
  waste: [...WASTE_TYPES],
  counts: ['count'],
  adjustments: ['stock_out', 'correction', 'other'],
}

/** Every change to ingredient stock, newest first. */
export function MovementsPanel() {
  const [kind, setKind] = useState<Kind>('all')
  const [page, setPage] = useState(1)
  const list = useAsync(() => ingredientApi.movements({ types: KIND_TYPES[kind], page, pageSize: 25 }), [kind, page])
  useEffect(() => setPage(1), [kind])

  return (
    <Panel title="Stock movements" description="Every change to ingredient stock: sales, deliveries, waste, counts and corrections.">
      <PillGroup
        label="Kind of movement"
        size="sm"
        value={kind}
        onChange={setKind}
        options={[
          { key: 'all', label: 'All' },
          { key: 'sales', label: 'Used' },
          { key: 'in', label: 'Stock in' },
          { key: 'waste', label: 'Waste' },
          { key: 'counts', label: 'Counts' },
          { key: 'adjustments', label: 'Adjustments' },
        ]}
      />
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
      {list.data && list.data.items.length === 0 && (
        <div className="py-10 text-center">
          <EmptyState title="No movements yet" hint="Sales of recipe products, deliveries and waste will show here." />
        </div>
      )}
      {list.data && list.data.items.length > 0 && (
        <div className={list.loading ? 'opacity-60' : ''}>
          <MovementList movements={list.data.items} showItem />
          {list.data.totalPages > 1 && (
            <div className="mt-3">
              <Pagination page={list.data.page} totalPages={list.data.totalPages} onPage={setPage} />
            </div>
          )}
        </div>
      )}
    </Panel>
  )
}

/** "-18 g · Sale INV-001024 · 3,182 g left" rows. */
export function MovementList({ movements, showItem }: { movements: StockMovement[]; showItem: boolean }) {
  if (movements.length === 0) return <p className="py-4 text-sm text-slate-500">No movements yet.</p>
  return (
    <ul className="mt-2 divide-y divide-slate-100">
      {movements.map((movement) => (
        <li key={movement.id} className="flex items-start gap-3 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {showItem ? `${movement.itemName} · ` : ''}
              {movement.typeLabel}
            </p>
            <p className="truncate text-xs text-slate-500">
              {[movement.reason !== movement.typeLabel ? movement.reason : null, movement.userName, formatDateTime(movement.createdAt)].filter(Boolean).join(' · ')}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className={`text-sm font-semibold tabular-nums ${movement.quantity < 0 ? 'text-rose-600' : 'text-[#1F5E3B]'}`}>
              {movement.quantity > 0 ? '+' : '−'}
              {formatQty(Math.abs(movement.quantity), movement.baseUnit)}
            </p>
            <p className="text-xs tabular-nums text-slate-400">→ {formatQty(movement.newQuantity, movement.baseUnit)}</p>
          </div>
        </li>
      ))}
    </ul>
  )
}
