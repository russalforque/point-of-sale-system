import { Link } from 'react-router-dom'

import { stockApi } from '../../api/stockApi'
import { supplierApi } from '../../api/supplierApi'
import { useAuth } from '../../context/AuthContext'
import { useSettings } from '../../context/SettingsContext'
import { useAsync } from '../../hooks/useAsync'
import { formatDate, formatMoney } from '../../utils/format'
import { Spinner } from '../ui/States'

/** Supplier profile extras: the products they supply and their latest deliveries. */
export function SupplierActivity({ supplierId }: { supplierId: number }) {
  const { settings } = useSettings()
  const { can } = useAuth()
  const money = (value: number) => formatMoney(value, settings.currencySymbol)
  const products = useAsync(() => supplierApi.products(supplierId), [supplierId])
  const deliveries = useAsync(() => stockApi.receipts({ supplierId, pageSize: 5 }), [supplierId])

  return (
    <div className="space-y-5">
      <section>
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium text-slate-500">
            Products supplied{products.data ? ` · ${products.data.length}` : ''}
          </h3>
          {can('inventory.receive') && (
            <Link
              to={`/receive-stock?supplier=${supplierId}`}
              className="inline-flex h-10 items-center rounded-full px-3 text-sm font-medium text-[#1F5E3B] active:bg-[#F2F8F4]"
            >
              Receive stock
            </Link>
          )}
        </div>
        {products.loading && !products.data && <Spinner />}
        {products.data && products.data.length === 0 && (
          <p className="mt-1 text-sm text-slate-500">No products linked yet. Set the supplier on a product, or receive stock from them.</p>
        )}
        <ul className="mt-1 divide-y divide-slate-100">
          {(products.data ?? []).map((product) => (
            <li key={product.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <span className={`min-w-0 truncate ${product.isActive ? '' : 'text-slate-400'}`}>
                {product.name} <span className="text-slate-400">· {product.sku}</span>
              </span>
              <span className="shrink-0 tabular-nums text-slate-500">
                {product.stockQuantity} in stock · cost {money(product.costPrice)}
              </span>
            </li>
          ))}
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
