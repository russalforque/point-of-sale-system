
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { dashboardApi } from '../api/dashboardApi'

import { Card, PageHeader } from '../components/ui/Page'

import {
  EmptyState,
  ErrorState,
  Spinner,
} from '../components/ui/States'

import { useAsync } from '../hooks/useAsync'

import { useSettings } from '../context/SettingsContext'

import {
  formatDateTime,
  formatMoney,
} from '../utils/format'

export function DashboardPage() {
  const { settings } = useSettings()

  const {
    data,
    loading,
    error,
    reload,
  } = useAsync(() => dashboardApi.get(), [])

  if (loading) return <Spinner />

  if (error) {
    return (
      <ErrorState
        message={error}
        onRetry={() => void reload()}
      />
    )
  }

  if (!data) {
    return <EmptyState title="No dashboard data" />
  }

  const stats = [
    {
      label: "Today's Sales",
      value: formatMoney(
        data.todaysSales,
        settings.currencySymbol,
      ),
    },
    {
      label: 'Transactions',
      value: String(data.todaysTransactions),
    },
    {
      label: 'Customers',
      value: String(data.totalCustomers),
    },
    {
      label: 'Products',
      value: data.totalProducts.toLocaleString(),
    },
  ]

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-7xl px-4 pb-6 pt-4 sm:px-5 lg:px-6">
        <PageHeader
          title="Dashboard"
          subtitle="Store performance for the current day"
        />

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {stats.map((stat) => (
            <Card
              key={stat.label}
              className="overflow-hidden border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/50 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  {stat.label}
                </p>
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-sm shadow-emerald-200" />
              </div>

              <p className="mt-4 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
                {stat.value}
              </p>

              <div className="mt-3 flex items-center gap-2 text-[11px] text-slate-500">
                <span className="rounded-full bg-slate-100 px-2 py-1 font-medium text-slate-600">
                  Live
                </span>
                <span>Updated now</span>
              </div>
            </Card>
          ))}
        </section>

        <section className="mt-4 grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.8fr)_minmax(300px,1fr)]">
          <Card className="border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/50">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold tracking-tight text-slate-900">
                  Sales Overview
                </h2>
                <p className="mt-1 text-xs text-slate-500">Last 7 days</p>
              </div>

              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-medium text-slate-600">
                Sales
              </span>
            </div>

            {data.salesOverview.every((p) => p.amount === 0) ? (
              <div className="flex h-52 items-center justify-center">
                <EmptyState title="No sales in the last 7 days" />
              </div>
            ) : (
              <div className="h-52 min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={data.salesOverview}
                    margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                  >
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 10, fill: '#64748b' }}
                      tickLine={false}
                      axisLine={{ stroke: '#e2e8f0' }}
                      interval="preserveStartEnd"
                    />

                    <YAxis
                      tick={{ fontSize: 10, fill: '#64748b' }}
                      tickLine={false}
                      axisLine={false}
                      width={36}
                    />

                    <Tooltip
                      cursor={{ fill: '#f8fafc' }}
                      contentStyle={{
                        border: '1px solid #e2e8f0',
                        borderRadius: 12,
                        boxShadow: '0 12px 30px rgba(15,23,42,0.08)',
                        fontSize: 11,
                      }}
                      formatter={(value) => formatMoney(Number(value), settings.currencySymbol)}
                    />

                    <Bar
                      dataKey="amount"
                      fill="#0f172a"
                      radius={[6, 6, 0, 0]}
                      maxBarSize={30}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>

          <Card className="border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/50">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold tracking-tight text-slate-900">
                Best Selling Products
              </h2>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-medium text-slate-600">
                Top 5
              </span>
            </div>

            {data.topSellingProducts.length === 0 ? (
              <div className="flex h-52 items-center justify-center">
                <EmptyState title="No product sales yet" />
              </div>
            ) : (
              <div className="max-h-52 overflow-y-auto pr-1">
                <ul className="space-y-2">
                  {data.topSellingProducts.slice(0, 5).map((p, index) => (
                    <li
                      key={p.productId}
                      className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 transition-colors duration-100 hover:bg-slate-100"
                    >
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white text-[10px] font-semibold text-slate-600 ring-1 ring-slate-200">
                        {index + 1}
                      </span>

                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800" title={p.name}>
                        {p.name}
                      </span>

                      <span className="text-sm font-semibold text-slate-600">{p.quantitySold}</span>
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
              <h2 className="text-lg font-semibold tracking-tight text-slate-900">
                Recent Transactions
              </h2>
              <span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-medium text-emerald-700">
                Live
              </span>
            </div>

            {data.recentTransactions.length === 0 ? (
              <EmptyState title="No transactions yet" />
            ) : (
              <div className="max-h-64 overflow-auto">
                <table className="w-full min-w-[440px] border-separate border-spacing-0 text-left text-sm">
                  <thead className="sticky top-0 bg-white">
                    <tr>
                      <th className="border-b border-slate-200 px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Invoice
                      </th>
                      <th className="border-b border-slate-200 px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Customer
                      </th>
                      <th className="border-b border-slate-200 px-3 pb-2 text-right text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Total
                      </th>
                      <th className="border-b border-slate-200 px-3 pb-2 text-right text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                        When
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {data.recentTransactions.map((row) => (
                      <tr key={row.id} className="border-b border-slate-100 last:border-0">
                        <td className="max-w-[110px] truncate px-3 py-3 text-[12px] font-medium text-slate-800" title={row.invoiceNumber}>
                          {row.invoiceNumber}
                        </td>
                        <td className="max-w-[130px] truncate px-3 py-3 text-[12px] text-slate-600" title={row.customerName ?? 'Walk-in'}>
                          {row.customerName ?? 'Walk-in'}
                        </td>
                        <td className="px-3 py-3 text-right text-[12px] font-semibold text-slate-900">
                          {formatMoney(row.total, settings.currencySymbol)}
                        </td>
                        <td className="px-3 py-3 text-right text-[12px] text-slate-500">
                          {formatDateTime(row.createdAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card className="border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/50">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold tracking-tight text-slate-900">
                Inventory Alerts
              </h2>
              <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] font-medium text-rose-700">
                {data.lowStockCount} low stock
              </span>
            </div>

            {data.lowStockProducts.length === 0 ? (
              <EmptyState title="Stock levels look healthy" />
            ) : (
              <div className="max-h-64 overflow-auto">
                <table className="w-full min-w-[340px] border-separate border-spacing-0 text-left text-sm">
                  <thead className="sticky top-0 bg-white">
                    <tr>
                      <th className="border-b border-slate-200 px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Product
                      </th>
                      <th className="border-b border-slate-200 px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                        SKU
                      </th>
                      <th className="border-b border-slate-200 px-3 pb-2 text-right text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Stock
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {data.lowStockProducts.map((row) => (
                      <tr key={row.id} className="border-b border-slate-100 last:border-0">
                        <td className="max-w-[150px] truncate px-3 py-3 text-[12px] font-medium text-slate-800" title={row.name}>
                          {row.name}
                        </td>
                        <td className="max-w-[90px] truncate px-3 py-3 text-[12px] text-slate-500" title={row.sku}>
                          {row.sku}
                        </td>
                        <td className="px-3 py-3 text-right text-[12px] font-semibold text-rose-600">
                          {row.stockQuantity} / {row.reorderLevel}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </section>
      </div>
    </div>
  )
}

