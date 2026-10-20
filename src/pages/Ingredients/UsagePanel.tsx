import { useMemo, useState } from 'react'

import { ingredientApi } from '../../api/ingredientApi'
import { EmptyState, ErrorState, Spinner } from '../../components/ui/States'
import { Panel, PillGroup } from '../../components/ui/WorkPage'
import { useSettings } from '../../context/SettingsContext'
import { useAsync } from '../../hooks/useAsync'
import { formatQty, qtyCost } from '../../services/units'
import type { IngredientUsageRow } from '../../types'
import { formatMoney } from '../../utils/format'

type Range = 'today' | '7d' | '30d'

function rangeBounds(range: Range): { from: string; to: string; label: string } {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  if (range === '7d') start.setDate(start.getDate() - 6)
  if (range === '30d') start.setDate(start.getDate() - 29)
  const end = new Date()
  end.setHours(0, 0, 0, 0)
  end.setDate(end.getDate() + 1)
  return { from: start.toISOString(), to: end.toISOString(), label: range === 'today' ? 'Today' : range === '7d' ? 'Last 7 days' : 'Last 30 days' }
}

/**
 * Theoretical vs actual: what each ingredient should have, from what was bought, used by sales
 * and batches, and wasted, against what counts found. Valued at today's cost.
 */
export function UsagePanel() {
  const { settings } = useSettings()
  const money = (value: number) => formatMoney(value, settings.currencySymbol)
  const [range, setRange] = useState<Range>('7d')
  const bounds = useMemo(() => rangeBounds(range), [range])
  const report = useAsync(() => ingredientApi.usageReport({ from: bounds.from, to: bounds.to }), [bounds])

  const rows = (report.data ?? []).filter((row) => row.purchases || row.usage || row.waste || row.adjustments || row.countVariance)
  const usageCost = rows.reduce((sum, row) => sum + qtyCost(row.usage, row.costPerBase), 0)
  const wasteCost = rows.reduce((sum, row) => sum + qtyCost(row.waste, row.costPerBase), 0)
  const varianceCost = rows.reduce((sum, row) => sum + qtyCost(row.countVariance, row.costPerBase), 0)

  return (
    <Panel
      title="Usage & variance"
      description="Opening + purchases − used − waste ± adjustments = expected. Counts show how far the shelf was from expected."
    >
      <PillGroup
        label="Period"
        size="sm"
        value={range}
        onChange={setRange}
        options={[
          { key: 'today', label: 'Today' },
          { key: '7d', label: '7 days' },
          { key: '30d', label: '30 days' },
        ]}
      />

      {report.loading && !report.data && (
        <div className="py-12">
          <Spinner />
        </div>
      )}
      {report.error && (
        <div className="py-6">
          <ErrorState message={report.error} onRetry={() => void report.reload()} />
        </div>
      )}

      {report.data && (
        <>
          <dl className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Stat label={`Used · ${bounds.label.toLowerCase()}`} value={money(usageCost)} hint="Sales and batches, at today’s cost" />
            <Stat label="Waste" value={money(wasteCost)} hint={usageCost > 0 ? `${Math.round((wasteCost / usageCost) * 1000) / 10}% of what was used` : undefined} tone={wasteCost > 0 ? 'warn' : undefined} />
            <Stat label="Count variance" value={`${varianceCost < 0 ? '−' : varianceCost > 0 ? '+' : ''}${money(Math.abs(varianceCost))}`} hint="Shelf vs expected" tone={varianceCost < 0 ? 'bad' : undefined} />
          </dl>

          {rows.length === 0 ? (
            <div className="py-10 text-center">
              <EmptyState title="Nothing moved in this period" hint="Sales of recipe products, deliveries and waste show here." />
            </div>
          ) : (
            <div className="mt-4 @container">
              {/* Wide: a table. Narrow (phones, portrait with the sidebar open): one card per item. */}
              <table className="hidden w-full text-sm @3xl:table">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="py-2 pr-3 font-medium">Item</th>
                    <th className="px-2 py-2 text-right font-medium">Opening</th>
                    <th className="px-2 py-2 text-right font-medium">+ In</th>
                    <th className="px-2 py-2 text-right font-medium">− Used</th>
                    <th className="px-2 py-2 text-right font-medium">− Waste</th>
                    <th className="px-2 py-2 text-right font-medium">± Adj.</th>
                    <th className="px-2 py-2 text-right font-medium">Expected</th>
                    <th className="px-2 py-2 text-right font-medium">Actual</th>
                    <th className="py-2 pl-2 text-right font-medium">Variance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((row) => (
                    <tr key={row.inventoryItemId}>
                      <td className="py-2.5 pr-3 font-medium">{row.name}</td>
                      <Cell row={row} value={row.opening} />
                      <Cell row={row} value={row.purchases} />
                      <Cell row={row} value={row.usage} />
                      <Cell row={row} value={row.waste} tone={row.waste ? 'warn' : undefined} />
                      <Cell row={row} value={row.adjustments} signed />
                      <Cell row={row} value={row.expected} />
                      <Cell row={row} value={row.closing} strong />
                      <Cell row={row} value={row.countVariance} signed tone={row.countVariance < 0 ? 'bad' : undefined} />
                    </tr>
                  ))}
                </tbody>
              </table>
              <ul className="space-y-2 @3xl:hidden">
                {rows.map((row) => (
                  <li key={row.inventoryItemId} className="rounded-2xl bg-[#F6F8F7] p-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="font-medium">{row.name}</p>
                      <p className="text-sm tabular-nums">
                        {formatQty(row.closing, row.baseUnit)} <span className="text-slate-400">actual</span>
                      </p>
                    </div>
                    <dl className="mt-1 grid grid-cols-3 gap-x-3 gap-y-1 text-xs text-slate-500">
                      <Mini label="Opening" value={formatQty(row.opening, row.baseUnit)} />
                      <Mini label="+ In" value={formatQty(row.purchases, row.baseUnit)} />
                      <Mini label="− Used" value={formatQty(row.usage, row.baseUnit)} />
                      <Mini label="− Waste" value={formatQty(row.waste, row.baseUnit)} />
                      <Mini label="Expected" value={formatQty(row.expected, row.baseUnit)} />
                      <Mini
                        label="Variance"
                        value={`${row.countVariance > 0 ? '+' : row.countVariance < 0 ? '−' : ''}${formatQty(Math.abs(row.countVariance), row.baseUnit)}`}
                      />
                    </dl>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </Panel>
  )
}

function Cell({ row, value, signed, strong, tone }: { row: IngredientUsageRow; value: number; signed?: boolean; strong?: boolean; tone?: 'bad' | 'warn' }) {
  const text = value === 0 ? '—' : `${signed && value > 0 ? '+' : value < 0 ? '−' : ''}${formatQty(Math.abs(value), row.baseUnit)}`
  return (
    <td
      className={`whitespace-nowrap px-2 py-2.5 text-right tabular-nums ${strong ? 'font-semibold' : ''} ${
        tone === 'bad' ? 'text-rose-600' : tone === 'warn' ? 'text-amber-700' : value === 0 ? 'text-slate-300' : ''
      }`}
    >
      {text}
    </td>
  )
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className="tabular-nums text-slate-700">{value}</dd>
    </div>
  )
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'bad' | 'warn' }) {
  return (
    <div className="rounded-2xl bg-[#F6F8F7] px-4 py-3">
      <dt className="text-sm text-slate-500">{label}</dt>
      <dd className={`mt-0.5 text-xl font-bold tabular-nums ${tone === 'bad' ? 'text-rose-600' : tone === 'warn' ? 'text-amber-700' : ''}`}>{value}</dd>
      {hint && <dd className="text-xs text-slate-500">{hint}</dd>}
    </div>
  )
}
