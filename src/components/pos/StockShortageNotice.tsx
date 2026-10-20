import type { StockShortage } from '../../api/salePlan'
import { formatQty } from '../../services/units'
import { TriangleWarning } from '../ui/Icons'

function amount(value: number, baseUnit: StockShortage['baseUnit']): string {
  return baseUnit === null ? String(Math.max(value, 0)) : formatQty(Math.max(value, 0), baseUnit)
}

/**
 * What an order is short of, before payment. Blocking stores can't complete the sale; stores that
 * allow selling below zero see it as a warning and can carry on.
 */
export function StockShortageNotice({ shortages, blocked }: { shortages: StockShortage[]; blocked: boolean }) {
  if (shortages.length === 0) return null
  return (
    <div
      role={blocked ? 'alert' : 'status'}
      className={`rounded-2xl px-4 py-3 text-sm ${blocked ? 'bg-rose-50 text-rose-800' : 'bg-amber-50 text-amber-900'}`}
    >
      <p className="flex items-center gap-2 font-semibold">
        <TriangleWarning size={13} />
        {shortages.length === 1 ? `Insufficient ${shortages[0]!.name}` : 'Not enough stock for this order'}
      </p>
      <ul className="mt-1.5 space-y-1">
        {shortages.map((shortage) => (
          <li key={shortage.name} className="flex flex-wrap justify-between gap-x-3 tabular-nums">
            {shortages.length > 1 && <span className="font-medium">{shortage.name}</span>}
            <span>
              Required: {amount(shortage.required, shortage.baseUnit)} · Available: {amount(shortage.available, shortage.baseUnit)}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-xs opacity-80">
        {blocked
          ? 'Remove or change items, or restock first. A manager can allow selling below zero in Settings.'
          : 'You can still complete the sale; stock will go below zero. Recount or restock soon.'}
      </p>
    </div>
  )
}
