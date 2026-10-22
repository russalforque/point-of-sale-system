import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { laundryApi } from '../../api/laundryApi'
import { laundryPricingApi } from '../../api/laundryPricingApi'
import { LaundryLoad, LaundryPaymentStatus, StatusBadge, useLaundryMoney, useLaundryQuery } from '../laundry/LaundryUI'
import { Pagination } from '../ui/Pagination'
import { useAuth } from '../../context/AuthContext'

/** Shared by the existing customer profile dialog and mobile customer sheet. */
export function CustomerLaundryPanel({ customerId }: { customerId: number }) {
  const [page, setPage] = useState(1)
  const money = useLaundryMoney(), { can } = useAuth(), canReadOrders = can('sales.process')
  const data = useLaundryQuery(async () => {
    const [summary, history, visits] = await Promise.all([
      laundryApi.customerSummary(customerId),
      canReadOrders ? laundryApi.list({ customerId, page }) : null,
      canReadOrders ? laundryPricingApi.context(customerId) : null,
    ])
    return { summary, history, visits, page, customerId }
  }, [customerId, page, canReadOrders])
  const current = data.data?.page === page && data.data.customerId === customerId ? data.data : null
  return <section aria-label="Laundry activity" className="laundry-stack customer-laundry-panel">
    <h3 className="text-sm font-semibold">Laundry activity</h3>
    <LaundryLoad {...data} retry={data.reload} />
    {current && !data.error && <>
      <dl className="lc-activity-summary">
        {[
          ['Total orders', current.summary.total], ['Active orders', current.summary.active],
          ['Outstanding balance', money(current.summary.outstanding)],
        ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd>{label === 'Outstanding balance' && <small>Across all laundry orders, excluding legacy archives.</small>}</div>)}
      </dl>
      {current.visits && <p className="laundry-muted">{current.visits.visits} qualifying visits · Next visit {current.visits.visits + 1}. Qualifying visits follow the shop’s laundry loyalty rules.</p>}
      {canReadOrders && <>
        <h3 className="text-sm font-medium">Laundry order history</h3>
        {!!current.history?.orders.length && <div className="lc-history">{current.history.orders.map(order => <Link key={order.id} to={`/laundry/orders/${order.id}`} className="lc-history-order" aria-label={`View order ${order.order_number}`}>
          <div><strong>{order.order_number}</strong><time dateTime={order.created_at}>{new Date(order.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</time><StatusBadge status={order.status} /></div>
          <div className="lc-history-money"><strong>{money(order.total_cents)}</strong><LaundryPaymentStatus order={order} /></div><ChevronRight size={16} aria-hidden="true" />
        </Link>)}</div>}
        {!current.history?.count && <div className="lc-history-empty"><strong>No laundry orders yet</strong>This customer’s orders and payment progress will appear here.</div>}
        {(current.history?.count ?? 0) > 30 && <Pagination page={page} totalPages={Math.ceil((current.history?.count ?? 0) / 30)} onPage={setPage} />}
      </>}
    </>}
  </section>
}
