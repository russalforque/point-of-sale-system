import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

import type { BusinessReport } from '../../api/reportsApi'
import { useAuth } from '../../context/AuthContext'
import { ErrorState, Spinner } from '../ui/States'

type Tab = 'best' | 'profit' | 'slow' | 'category' | 'cashier' | 'expenses' | 'stock'

const TABS: { key: Tab; label: string }[] = [
  { key: 'best', label: 'Best sellers' },
  { key: 'profit', label: 'Most profit' },
  { key: 'slow', label: 'Slow movers' },
  { key: 'category', label: 'Categories' },
  { key: 'cashier', label: 'Cashiers' },
  { key: 'expenses', label: 'Expenses' },
  { key: 'stock', label: 'Low stock' },
]

/**
 * Profit & loss for the selected period, plus the breakdowns an owner asks about most.
 * One statement instead of a wall of cards; the lists sit behind a single tab row.
 */
export function BusinessReportPanel({
  report,
  loading,
  error,
  onRetry,
  money,
}: {
  report: BusinessReport | null
  loading: boolean
  error: string | null
  onRetry: () => void
  money: (value: number) => string
}) {
  if (!report) {
    return (
      <section className="rounded-2xl bg-white p-6 ring-1 ring-slate-100">
        {error ? <ErrorState message={error} onRetry={onRetry} /> : loading ? <Spinner /> : null}
      </section>
    )
  }

  return (
    <section className={`@container rounded-2xl bg-white ring-1 ring-slate-100 transition-opacity ${loading ? 'opacity-60' : ''}`}>
      <div className="grid gap-0 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* STATEMENT */}
        <div className="border-b border-slate-100 p-5 @3xl:border-b-0 @3xl:border-r sm:p-6">
          <ProfitLossStatement report={report} money={money} />
        </div>

        {/* AT A GLANCE */}
        <div className="p-5 sm:p-6">
          <div className="grid grid-cols-2 gap-x-4 gap-y-4">
            <Stat label="Transactions" value={report.transactions.toLocaleString()} />
            <Stat label="Average sale" value={money(report.averageTransaction)} />
            <Stat label="Items sold" value={report.itemsSold.toLocaleString()} />
            <Stat label="Tax collected" value={money(report.taxCollected)} />
            {report.inventory.ingredientValue > 0 ? (
              <Stat
                label="Stock value (cost)"
                value={money(report.inventory.costValue + report.inventory.ingredientValue)}
                hint={`${money(report.inventory.costValue)} products · ${money(report.inventory.ingredientValue)} ingredients`}
              />
            ) : (
              <Stat label="Stock value (cost)" value={money(report.inventory.costValue)} hint={`${money(report.inventory.retailValue)} at selling price`} />
            )}
            <Stat
              label="Stock alerts"
              value={`${report.inventory.lowStock + report.inventory.outOfStock + report.inventory.ingredientAlerts}`}
              hint={
                `${report.inventory.lowStock} low · ${report.inventory.outOfStock} out` +
                (report.inventory.ingredientAlerts ? ` · ${report.inventory.ingredientAlerts} ingredients` : '')
              }
              tone={report.inventory.outOfStock > 0 ? 'bad' : report.inventory.lowStock + report.inventory.ingredientAlerts > 0 ? 'warn' : undefined}
            />
            {report.receivables.total > 0 && (
              <Stat
                label="Owed by customers"
                value={money(report.receivables.total)}
                hint={`${report.receivables.customers} ${report.receivables.customers === 1 ? 'customer' : 'customers'}`}
                tone="warn"
              />
            )}
            {report.voidedCount > 0 && (
              <Stat label="Voided sales" value={String(report.voidedCount)} hint={`${money(report.voidedAmount)} · not counted`} />
            )}
          </div>
        </div>
      </div>

      <div className="border-t border-slate-100">
        <ReportBreakdowns report={report} money={money} />
      </div>
    </section>
  )
}

/** The profit & loss statement on its own (heading, lines and the net profit / loss). */
export function ProfitLossStatement({ report, money }: { report: BusinessReport; money: (value: number) => string }) {
  const discountDetail = [
    report.seniorDiscounts > 0 ? `Senior/PWD ${money(report.seniorDiscounts)}` : '',
    report.loyaltyRedeemed > 0 ? `points ${money(report.loyaltyRedeemed)}` : '',
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <>
      <h2 className="text-base font-semibold">Profit &amp; loss</h2>
      <p className="mt-0.5 text-sm text-slate-500">Before tax. Costs use each item’s cost when it was sold.</p>
      <dl className="mt-4 space-y-2 text-sm">
        <Line label="Gross sales" value={money(report.grossSales)} />
        <Line label="Discounts" value={`−${money(report.discounts)}`} hint={discountDetail || undefined} muted />
        <Line label="Refunds" value={`−${money(report.refundsExTax)}`} muted />
        <Line label="Net sales" value={money(report.netSales)} strong />
        <Line label="Cost of goods sold" value={`−${money(report.costOfGoods)}`} muted />
        <Line
          label="Gross profit"
          value={money(report.grossProfit)}
          hint={report.grossMargin !== null ? `${report.grossMargin}% margin` : undefined}
          strong
        />
        <Line label="Expenses" value={`−${money(report.expenses)}`} muted />
      </dl>
      <div
        className={`mt-3 flex items-baseline justify-between rounded-2xl px-4 py-3 ${
          report.netProfit >= 0 ? 'bg-[#F2F8F4] text-[#1F5E3B]' : 'bg-rose-50 text-rose-700'
        }`}
      >
        <span className="text-sm font-medium">{report.netProfit >= 0 ? 'Estimated net profit' : 'Estimated net loss'}</span>
        <span className="text-2xl font-bold tabular-nums">{money(report.netProfit)}</span>
      </div>
    </>
  )
}

/** Tabbed lists (best sellers, profit, slow movers, categories, cashiers, expenses, low stock). */
export function ReportBreakdowns({ report, money }: { report: BusinessReport; money: (value: number) => string }) {
  const { can } = useAuth()
  const [tab, setTab] = useState<Tab>('best')
  return (
    <>
      <div role="tablist" aria-label="Report breakdown" className="flex gap-1 overflow-x-auto px-3 py-2 scrollbar-none sm:px-4">
        {TABS.map((option) => (
          <button
            key={option.key}
            type="button"
            role="tab"
            aria-selected={tab === option.key}
            onClick={() => setTab(option.key)}
            className={`h-10 shrink-0 rounded-full px-4 text-sm font-medium transition pointer-coarse:h-11 ${
              tab === option.key ? 'bg-[#1F5E3B] text-white' : 'text-slate-600 hover:bg-[#F3F5F4]'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className="px-5 pb-5 sm:px-6">
        {tab === 'best' && (
          <Table
            empty="No products sold in this period."
            head={['Product', 'Sold', 'Sales', 'Profit']}
            bars={share(report.bestSellers.map((row) => row.quantity))}
            rows={report.bestSellers.map((row) => [row.name, row.quantity.toLocaleString(), money(row.revenue), money(row.profit)])}
          />
        )}
        {tab === 'profit' && (
          <Table
            empty="No products sold in this period."
            head={['Product', 'Sales', 'Cost', 'Profit']}
            bars={share(report.topProfit.map((row) => row.profit))}
            rows={report.topProfit.map((row) => [row.name, money(row.revenue), money(row.cost), money(row.profit)])}
          />
        )}
        {tab === 'slow' && (
          <Table
            empty="Every product in stock sold in this period."
            note="In stock but selling least — money tied up on the shelf."
            head={['Product', 'Sold', 'In stock', 'Stock value']}
            rows={report.slowMovers.map((row) => [row.name, row.quantitySold.toLocaleString(), row.stockQuantity.toLocaleString(), money(row.stockValue)])}
          />
        )}
        {tab === 'category' && (
          <Table
            empty="No sales in this period."
            head={['Category', 'Sold', 'Sales', 'Profit']}
            bars={share(report.byCategory.map((row) => row.revenue))}
            rows={report.byCategory.map((row) => [row.name, row.quantity.toLocaleString(), money(row.revenue), money(row.profit)])}
          />
        )}
        {tab === 'cashier' && (
          <Table
            empty="No sales in this period."
            head={['Cashier', 'Sales', 'Average', 'Total']}
            bars={share(report.byCashier.map((row) => row.total))}
              rows={report.byCashier.map((row) => [row.name, row.count.toLocaleString(), money(row.count ? row.total / row.count : 0), money(row.total)])}
          />
        )}
        {tab === 'expenses' && (
          <>
            <Table
              empty="No expenses recorded in this period."
              head={['Category', 'Entries', 'Amount']}
              bars={share(report.expensesByCategory.map((row) => row.amount))}
                rows={report.expensesByCategory.map((row) => [row.name, row.count.toLocaleString(), money(row.amount)])}
            />
            {can('expenses.manage') && (
              <Link to="/expenses" className="mt-3 inline-flex h-11 items-center rounded-full px-4 text-sm font-medium text-[#1F5E3B] hover:bg-[#F2F8F4]">
                Record or review expenses
              </Link>
            )}
          </>
        )}
        {tab === 'stock' && (
          <>
            <Table
              empty="Nothing is at or below its reorder level."
              note="Suggested order covers about two weeks of recent sales."
              head={['Product', 'In stock', 'Reorder at', 'Order']}
              rows={report.lowStock.map((row) => [row.name, row.stockQuantity.toLocaleString(), row.reorderLevel.toLocaleString(), row.suggestedQuantity.toLocaleString()])}
            />
            {can('purchasing.manage') && report.lowStock.length > 0 && (
              <Link
                to="/purchase-orders?new=low-stock"
                className="mt-3 inline-flex h-11 items-center rounded-full bg-[#1F5E3B] px-5 text-sm font-medium text-white"
              >
                Create purchase order
              </Link>
            )}
          </>
        )}
      </div>
    </>
  )
}

function Line({ label, value, hint, strong, muted }: { label: string; value: string; hint?: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 ${strong ? 'border-t border-slate-100 pt-2 font-semibold text-[#091413]' : ''}`}>
      <dt className={muted ? 'text-slate-500' : undefined}>
        {label}
        {hint && <span className="block text-xs font-normal text-slate-400">{hint}</span>}
      </dt>
      <dd className={`shrink-0 tabular-nums ${muted ? 'text-slate-500' : ''}`}>{value}</dd>
    </div>
  )
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'warn' | 'bad' }) {
  const color = tone === 'bad' ? 'text-rose-600' : tone === 'warn' ? 'text-amber-700' : 'text-[#091413]'
  return (
    <div className="min-w-0">
      <p className="truncate text-xs text-slate-500">{label}</p>
      <p className={`mt-0.5 truncate text-xl font-semibold tabular-nums ${color}`}>{value}</p>
      {hint && <p className="truncate text-xs text-slate-400">{hint}</p>}
    </div>
  )
}

/** Each value as a fraction of the largest (for the bars under a breakdown's names). */
function share(values: number[]): number[] {
  const max = Math.max(0, ...values)
  return values.map((value) => (max > 0 ? Math.max(0, value) / max : 0))
}

function Table({ head, rows, empty, note, bars }: { head: string[]; rows: ReactNode[][]; empty: string; note?: string; bars?: number[] }) {
  if (rows.length === 0) return <p className="py-8 text-center text-sm text-slate-400">{empty}</p>
  return (
    <div>
      {note && <p className="mb-2 text-xs text-slate-500">{note}</p>}
      <table className="w-full table-fixed text-left text-sm">
        <thead className="text-xs text-slate-500">
          <tr>
            {head.map((label, index) => (
              <th key={label} className={`py-2 font-medium ${index === 0 ? 'w-[46%]' : 'text-right'}`}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, index) => (
                <td key={index} className={`py-2.5 ${index === 0 ? 'truncate pr-2' : 'text-right tabular-nums'}`}>
                  {cell}
                  {index === 0 && bars && (
                    <span aria-hidden="true" className="mt-1 block h-1 overflow-hidden rounded-full bg-slate-100">
                      <span className="block h-full rounded-full bg-[#1F5E3B]/70" style={{ width: `${(bars[rowIndex] ?? 0) * 100}%` }} />
                    </span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
