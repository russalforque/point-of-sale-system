import { useMemo, useState } from 'react'
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { reportsApi } from '../api/reportsApi'
import { Card, PageHeader } from '../components/ui/Page'
import { Input } from '../components/ui/Field'
import { EmptyState, ErrorState, Spinner } from '../components/ui/States'
import { useSettings } from '../context/SettingsContext'
import { useAsync } from '../hooks/useAsync'
import { formatMoney } from '../utils/format'

const COLORS = ['#2563eb', '#0f766e', '#b45309', '#7c3aed', '#dc2626', '#334155']

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function daysAgoIso(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0)
}

function formatCompact(value: number) {
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}

export function ReportsPage() {
  const { settings } = useSettings()
  const [from, setFrom] = useState(daysAgoIso(30))
  const [to, setTo] = useState(todayIso())
  const [showFilters, setShowFilters] = useState(false)

  const { data, loading, error, reload } = useAsync(
    () => reportsApi.get(from, to),
    [from, to],
  )

  const money = (n: number) => formatMoney(n, settings.currencySymbol)

  const summary = useMemo(() => {
    if (!data) {
      return { revenue: 0, transactions: 0, averageOrder: 0, inventoryValue: 0, lowStock: 0 }
    }

    const revenue = sum(data.dailySales.map((item) => item.total))
    const transactions = sum(data.dailySales.map((item) => item.transactions))

    return {
      revenue,
      transactions,
      averageOrder: revenue / Math.max(transactions, 1),
      inventoryValue: data.inventoryStatus.inventoryValue ?? 0,
      lowStock: data.inventoryStatus.lowStock ?? 0,
    }
  }, [data])

  const stats = [
    { label: "Total revenue", value: money(summary.revenue), detail: `${formatCompact(summary.transactions)} orders` },
    { label: 'Average order', value: money(summary.averageOrder), detail: 'Per transaction' },
    { label: 'Inventory value', value: money(summary.inventoryValue), detail: `${summary.lowStock} low-stock items` },
    { label: 'Daily avg', value: formatCompact(summary.revenue / Math.max(data?.dailySales.length ?? 1, 1)), detail: 'Sales per day' },
  ]

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-7xl px-4 pb-6 pt-4 sm:px-5 lg:px-6">
        <PageHeader
          title="Reports"
          subtitle="Sales and inventory overview"
          actions={
            <Button
              variant="secondary"
              onClick={() => void reload()}
            >
              Refresh
            </Button>
          }
        />

        <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/50">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Period</p>
            </div>
            <Button
              variant="primary"
              onClick={() => setShowFilters((value) => !value)}
            >
              {showFilters ? 'Hide filters' : 'Filter by date'}
            </Button>
          </div>

          <div className={showFilters ? 'mt-4 grid gap-3 sm:grid-cols-2' : 'hidden'}>
            <label className="block text-sm">
              <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">From</span>
              <Input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="min-h-[48px] w-full rounded-xl border-slate-200 bg-slate-50 text-slate-700 outline-none transition focus:border-slate-400 focus:bg-white focus:ring-2 focus:ring-slate-200"
              />
            </label>

            <label className="block text-sm">
              <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">To</span>
              <Input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="min-h-[48px] w-full rounded-xl border-slate-200 bg-slate-50 text-slate-700 outline-none transition focus:border-slate-400 focus:bg-white focus:ring-2 focus:ring-slate-200"
              />
            </label>
          </div>
        </section>

        {loading ? <Spinner /> : null}
        {error ? <ErrorState message={error} onRetry={() => void reload()} /> : null}

        {!loading && data ? (
          <>
            <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              {stats.map((stat) => (
                <Card key={stat.label} className="overflow-hidden border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/50 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">{stat.label}</p>
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-sm shadow-emerald-200" />
                  </div>

                  <p className="mt-4 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">{stat.value}</p>

                  <div className="mt-3 flex items-center gap-2 text-[11px] text-slate-500">
                    <span className="rounded-full bg-slate-100 px-2 py-1 font-medium text-slate-600">Live</span>
                    <span>{stat.detail}</span>
                  </div>
                </Card>
              ))}
            </section>

            <section className="mt-4 grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.8fr)_minmax(300px,1fr)]">
              <Card className="border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/50">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold tracking-tight text-slate-900">Sales Overview</h2>
                    <p className="mt-1 text-xs text-slate-500">Last 30 days</p>
                  </div>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-medium text-slate-600">
                    Sales
                  </span>
                </div>

                {data.dailySales.every((item) => item.total === 0) ? (
                  <div className="flex h-52 items-center justify-center">
                    <EmptyState title="No sales in this period" />
                  </div>
                ) : (
                  <div className="h-52 min-w-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data.dailySales} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                        <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} interval="preserveStartEnd" />
                        <YAxis tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} width={36} />
                        <Tooltip
                          cursor={{ fill: '#f8fafc' }}
                          formatter={(value) => money(Number(value))}
                          contentStyle={{
                            border: '1px solid #e2e8f0',
                            borderRadius: 12,
                            boxShadow: '0 12px 30px rgba(15,23,42,0.08)',
                            fontSize: 11,
                          }}
                        />
                        <Bar dataKey="total" fill="#0f172a" radius={[6, 6, 0, 0]} maxBarSize={30} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </Card>

              <Card className="border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/50">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold tracking-tight text-slate-900">Top categories</h2>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-medium text-slate-600">Top 5</span>
                </div>

                {data.salesByCategory.length === 0 ? (
                  <div className="flex h-52 items-center justify-center">
                    <EmptyState title="No category data" />
                  </div>
                ) : (
                  <div className="max-h-52 overflow-y-auto pr-1">
                    <ul className="space-y-2">
                      {data.salesByCategory.slice(0, 5).map((item, index) => (
                        <li key={item.name} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 transition-colors duration-100 hover:bg-slate-100">
                          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white text-[10px] font-semibold text-slate-600 ring-1 ring-slate-200">
                            {index + 1}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800" title={item.name}>{item.name}</span>
                          <span className="text-sm font-semibold text-slate-600">{money(item.amount)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Card>
            </section>

            <section className="mt-4 grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
              <Card className="border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/50">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold tracking-tight text-slate-900">Sales by product</h2>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-medium text-slate-600">List</span>
                </div>

                {data.salesByProduct.length === 0 ? (
                  <EmptyState title="No product sales" />
                ) : (
                  <ul className="space-y-2 text-sm">
                    {data.salesByProduct.slice(0, 6).map((row) => (
                      <li key={row.name} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                        <span className="min-w-0 flex-1 truncate">
                          {row.name}
                          <span className="ml-1 text-slate-400">({row.count})</span>
                        </span>
                        <span className="font-semibold text-slate-700">{money(row.amount)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <Card className="border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/50">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold tracking-tight text-slate-900">Top-selling products</h2>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-medium text-slate-600">Top 5</span>
                </div>

                {data.topSellingProducts.length === 0 ? (
                  <EmptyState title="No product data" />
                ) : (
                  <ul className="space-y-2 text-sm">
                    {data.topSellingProducts.slice(0, 6).map((row) => (
                      <li key={row.name} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                        <span className="min-w-0 flex-1 truncate">
                          {row.name}
                          <span className="ml-1 text-slate-400">({row.count})</span>
                        </span>
                        <span className="font-semibold text-slate-700">{money(row.amount)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </section>

            <section className="mt-4 grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.8fr)]">
              <Card className="border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/50">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Mix</p>
                    <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-900">Payment methods</h2>
                  </div>
                  <span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-medium text-emerald-700">Live</span>
                </div>

                {data.salesByPaymentMethod.length === 0 ? (
                  <EmptyState title="No payment data" />
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                      <span className="text-sm text-slate-600">Total collected</span>
                      <span className="text-base font-semibold text-slate-900">
                        {money(sum(data.salesByPaymentMethod.map((item) => item.amount)))}
                      </span>
                    </div>

                    <div className="space-y-2">
                      {data.salesByPaymentMethod.map((method, index) => {
                        const total = sum(data.salesByPaymentMethod.map((item) => item.amount)) || 1
                        const percentage = Math.round((method.amount / total) * 100)

                        return (
                          <div
                            key={method.name}
                            className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3"
                          >
                            <div className="mb-2 flex items-center justify-between gap-3">
                              <div className="flex min-w-0 items-center gap-2">
                                <span
                                  className="inline-block h-2.5 w-2.5 rounded-full"
                                  style={{ backgroundColor: COLORS[index % COLORS.length] }}
                                />
                                <span className="truncate text-sm font-medium text-slate-700">
                                  {method.name}
                                </span>
                              </div>
                              <span className="text-sm font-semibold text-slate-900">
                                {money(method.amount)}
                              </span>
                            </div>

                            <div className="flex items-center gap-2 text-[11px] text-slate-500">
                              <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200">
                                <div
                                  className="h-full rounded-full"
                                  style={{
                                    width: `${percentage}%`,
                                    backgroundColor: COLORS[index % COLORS.length],
                                  }}
                                />
                              </div>
                              <span className="w-10 text-right font-medium text-slate-600">{percentage}%</span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </Card>

              <Card className="border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/50">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Stock</p>
                    <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-900">Inventory status</h2>
                  </div>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-medium text-slate-600">
                    Snapshot
                  </span>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Total inventory value</p>
                      <p className="mt-1 text-xl font-semibold text-slate-900">{money(data.inventoryStatus.inventoryValue)}</p>
                    </div>
                    <span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-medium text-emerald-700">
                      Healthy
                    </span>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <Stat label="In stock" value={String(data.inventoryStatus.inStock)} accent="slate" />
                    <Stat label="Low stock" value={String(data.inventoryStatus.lowStock)} accent="amber" />
                    <Stat label="Out of stock" value={String(data.inventoryStatus.outOfStock)} accent="rose" />
                    <Stat label="Reorder" value={String(Math.max(data.inventoryStatus.lowStock, 0))} accent="emerald" />
                  </div>
                </div>
              </Card>
            </section>
          </>
        ) : null}
      </div>
    </div>
  )
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string
  value: string
  accent: 'slate' | 'amber' | 'rose' | 'emerald'
}) {
  const toneMap = {
    slate: 'bg-slate-100 text-slate-700',
    amber: 'bg-amber-100 text-amber-700',
    rose: 'bg-rose-100 text-rose-700',
    emerald: 'bg-emerald-100 text-emerald-700',
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3.5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <div className="mt-3 flex items-end justify-between gap-3">
        <p className="text-2xl font-semibold text-slate-900">{value}</p>
        <span className={`rounded-full px-2 py-1 text-[10px] font-medium ${toneMap[accent]}`}>{label}</span>
      </div>
    </div>
  )
}
