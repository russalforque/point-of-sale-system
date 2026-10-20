import { Link } from 'react-router-dom'

import { purchaseOrderApi } from '../../api/purchaseOrderApi'
import { stockApi } from '../../api/stockApi'
import { supplierApi } from '../../api/supplierApi'
import { useAuth } from '../../context/AuthContext'
import { useSettings } from '../../context/SettingsContext'
import { useAsync } from '../../hooks/useAsync'
import { formatDate, formatMoney } from '../../utils/format'
import { Spinner } from '../ui/States'

/** Supplier profile extras: spend, open orders, products with their last costs, latest deliveries. */
export function SupplierActivity({ supplierId }: { supplierId: number }) {
  const { settings } = useSettings()
  const { can } = useAuth()
  const money = (value: number) => formatMoney(value, settings.currencySymbol)
  const summary = useAsync(() => supplierApi.summary(supplierId), [supplierId])
  const products = useAsync(() => supplierApi.products(supplierId), [supplierId])
  const deliveries = useAsync(() => stockApi.receipts({ supplierId, pageSize: 5 }), [supplierId])
  const orders = useAsync(
    () => (can('purchasing.manage') ? purchaseOrderApi.list({ supplierId, status: 'open', pageSize: 5 }) : Promise.resolve(null)),
    [supplierId],
  )

  return (
    <div className="space-y-5">
      {summary.data && (
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="rounded-2xl bg-[#F6F8F7] px-4 py-3">
            <dt className="text-xs text-slate-500">Total purchases</dt>
            <dd className="mt-0.5 text-lg font-semibold tabular-nums">{money(summary.data.totalPurchases)}</dd>
          </div>
          <div className="rounded-2xl bg-[#F6F8F7] px-4 py-3">
            <dt className="text-xs text-slate-500">Deliveries</dt>
            <dd className="mt-0.5 text-lg font-semibold tabular-nums">{summary.data.deliveries}</dd>
            {summary.data.lastDeliveryDate && <dd className="text-xs text-slate-400">last {formatDate(summary.data.lastDeliveryDate)}</dd>}
          </div>
          <div className="rounded-2xl bg-[#F6F8F7] px-4 py-3">
            <dt className="text-xs text-slate-500">On order</dt>
            <dd className="mt-0.5 text-lg font-semibold tabular-nums">{money(summary.data.openOrdersValue)}</dd>
            <dd className="text-xs text-slate-400">
              {summary.data.openOrders} open {summary.data.openOrders === 1 ? 'order' : 'orders'}
            </dd>
          </div>
        </dl>
      )}

      <div className="flex flex-wrap gap-2">
        {can('purchasing.manage') && (
          <Link
            to={`/purchase-orders?supplier=${supplierId}`}
            className="inline-flex h-11 items-center rounded-full bg-[#1F5E3B] px-4 text-sm font-semibold text-white"
          >
            New purchase order
          </Link>
        )}
        {can('inventory.receive') && (
          <Link
            to={`/receive-stock?supplier=${supplierId}`}
            className="inline-flex h-11 items-center rounded-full px-4 text-sm font-medium text-[#1F5E3B] ring-1 ring-slate-200 active:bg-[#F2F8F4]"
          >
            Receive stock
          </Link>
        )}
      </div>

      {orders.data && orders.data.items.length > 0 && (
        <section>
          <h3 className="text-sm font-medium text-slate-500">Open purchase orders</h3>
          <ul className="mt-1 divide-y divide-slate-100">
            {orders.data.items.map((order) => (
              <li key={order.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span className="min-w-0 truncate">
                  {order.poNumber}
                  <span className="text-slate-400">
                    {' '}
                    · {order.status}
                    {order.expectedDate && ` · expected ${formatDate(order.expectedDate)}`}
                  </span>
                </span>
                <span className="shrink-0 tabular-nums">{money(order.totalCost)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3 className="text-sm font-medium text-slate-500">
          Products supplied{products.data ? ` · ${products.data.length}` : ''}
        </h3>
        {products.loading && !products.data && (
          <div className="py-8">
            <Spinner />
          </div>
        )}
        {products.data && products.data.length === 0 && (
          <p className="mt-1 text-sm text-slate-500">No products linked yet. Set the supplier on a product, or receive stock from them.</p>
        )}
        <ul className="mt-1 divide-y divide-slate-100">
          {(products.data ?? []).map((product) => {
            const change = product.lastCost !== null && product.previousCost !== null ? product.lastCost - product.previousCost : 0
            return (
              <li key={product.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span className={`min-w-0 truncate ${product.isActive ? '' : 'text-slate-400'}`}>
                  {product.name} <span className="text-slate-400">· {product.stockQuantity} in stock</span>
                </span>
                <span className="shrink-0 text-right tabular-nums">
                  <span className="text-slate-600">{money(product.lastCost ?? product.costPrice)}</span>
                  {Math.abs(change) >= 0.005 && (
                    <span className={`ml-1.5 text-xs ${change > 0 ? 'text-rose-600' : 'text-[#1F5E3B]'}`}>
                      {change > 0 ? '▲' : '▼'} {money(Math.abs(change))}
                    </span>
                  )}
                  {product.lastReceivedDate && <span className="block text-xs text-slate-400">last bought {formatDate(product.lastReceivedDate)}</span>}
                </span>
              </li>
            )
          })}
        </ul>
      </section>

      {deliveries.data && deliveries.data.items.length > 0 && (
        <section>
          <h3 className="text-sm font-medium text-slate-500">Recent deliveries</h3>
          <ul className="mt-1 divide-y divide-slate-100">
            {deliveries.data.items.map((receipt) => (
              <li key={receipt.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span className="min-w-0 truncate">
                  {receipt.receiptNumber}
                  <span className="text-slate-400">
                    {' '}
                    · {formatDate(receipt.receivedDate)}
                    {receipt.purchaseOrderNumber && ` · ${receipt.purchaseOrderNumber}`}
                    {receipt.reference && ` · ref ${receipt.reference}`}
                  </span>
                </span>
                <span className="shrink-0 tabular-nums">{money(receipt.totalCost)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
