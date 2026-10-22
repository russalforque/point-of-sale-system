import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowDownLeft, ArrowRight, CalendarDays, Check, ChevronRight, CircleCheck,
  Clock3, Inbox, Layers3, Plus, RefreshCw, Wallet,
} from 'lucide-react'
import { Button, ButtonLink } from '../../components/ui/Button'
import { SearchBox } from '../../components/ui/WorkPage'
import { laundryReportsApi } from '../../api/laundryReportsApi'
import { laundryApi } from '../../api/laundryApi'
import { useAuth } from '../../context/AuthContext'
import { useDebounced } from '../../hooks/useDebounced'
import { LAUNDRY_STATUSES, type LaundryStatus } from '../../types/laundry'
import {
  LaundryLoad, LaundryPaymentStatus, StatusBadge, useLaundryMoney, useLaundryQuery,
} from '../../components/laundry/LaundryUI'
import './dashboard.css'
import { LaundryAddAction } from '../../components/laundry/LaundryAddAction'

const stages = [
  { status: 'Received', label: 'Received', icon: Inbox, tone: 'slate' },
  { status: 'Ready for Pickup', label: 'Ready for pickup', icon: CircleCheck, tone: 'green' },
  { status: 'Completed', label: 'Completed', icon: Check, tone: 'slate' },
] as const

export function LaundryDashboard() {
  const money = useLaundryMoney(), { can } = useAuth()
  const [search, setSearch] = useState(''), [status, setStatus] = useState<LaundryStatus | ''>('')
  const [refreshing, setRefreshing] = useState(false)
  const refreshLock = useRef(false)
  const orderSection = useRef<HTMLElement>(null)
  const term = useDebounced(search)
  const summary = useLaundryQuery(() => laundryReportsApi.dashboard(), [])
  const orders = useLaundryQuery(() => laundryApi.list({ search: term, status }), [term, status])
  const stats = summary.data
  const inProgress = stats?.states.Received ?? 0
  const totalOrders = inProgress + (stats?.states['Ready for Pickup'] ?? 0) + (stats?.states.Completed ?? 0)
  const visibleOrders = orders.data?.orders.slice(0, 6) ?? []
  const filtered = Boolean(search || status)
  const orderParams = new URLSearchParams()
  if (term) orderParams.set('search', term)
  if (status) orderParams.set('status', status)
  const allOrdersUrl = `/laundry/orders${orderParams.size ? `?${orderParams}` : ''}`

  async function refresh() {
    if (refreshLock.current) return
    refreshLock.current = true
    setRefreshing(true)
    try {
      await Promise.all([summary.reload(), orders.reload()])
    } finally {
      refreshLock.current = false
      setRefreshing(false)
    }
  }

  function showStage(next: LaundryStatus | '') {
    setSearch('')
    setStatus(next)
    orderSection.current?.focus({ preventScroll: true })
    orderSection.current?.scrollIntoView({ block: 'start' })
  }

  return (
    <div className="laundry-screen laundry-dashboard laundry-has-add">
      <header className="ld-header">
        <div>
          <p className="ld-eyebrow"><span /> LAUNDRY OVERVIEW</p>
          <h1>Dashboard</h1>
          <p className="ld-subtitle">A fresh look at your day. Every load, payment and pickup.</p>
        </div>
        <div className="ld-header-actions">
          <Button variant="secondary" className="laundry-refresh-action" onClick={() => void refresh()} disabled={refreshing || summary.loading || orders.loading} aria-label="Refresh dashboard">
            <RefreshCw size={16} aria-hidden="true" className={refreshing ? 'ld-spin' : ''} />
            <span>{refreshing ? 'Refreshing…' : 'Refresh'}</span>
          </Button>
          <LaundryAddAction to="/laundry/new" label="New order" />
        </div>
      </header>

      <div className="ld-section-label">
        <h2>Today at a glance</h2>
        <span><CalendarDays size={14} aria-hidden="true" />{new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</span>
      </div>
      {summary.error && <LaundryLoad loading={false} error={summary.error} retry={summary.reload} />}
      {!stats && summary.loading && (
        <div className="ld-metrics" role="status" aria-label="Loading dashboard totals">
          {[0, 1, 2, 3].map((key) => <div className="ld-metric ld-skeleton" key={key}><span /><strong /><span /></div>)}
          <span className="sr-only">Loading dashboard totals…</span>
        </div>
      )}
      {stats && (
        <div className="ld-metrics" aria-label="Laundry summary" aria-busy={summary.loading}>
          <section className="ld-metric ld-metric-featured">
            <div className="ld-metric-top"><h3>Today's collections</h3><span className="ld-metric-icon"><Wallet size={18} aria-hidden="true" /></span></div>
            <p className="ld-metric-value">{money(stats.collections)}</p>
            <p className="ld-metric-note"><ArrowDownLeft size={14} aria-hidden="true" /> Payments received today</p>
          </section>
          <section className="ld-metric">
            <div className="ld-metric-top"><h3>Orders today</h3><span className="ld-metric-icon ld-tone-slate"><Layers3 size={18} aria-hidden="true" /></span></div>
            <p className="ld-metric-value">{stats.orders}</p>
            <p className="ld-metric-note">New orders received today</p>
          </section>
          <section className="ld-metric">
            <div className="ld-metric-top"><h3>Received</h3><span className="ld-metric-icon ld-tone-slate"><Inbox size={18} aria-hidden="true" /></span></div>
            <p className="ld-metric-value">{inProgress}</p>
            <p className="ld-metric-note">Not yet ready for pickup</p>
          </section>
          <button type="button" className="ld-metric ld-metric-link" onClick={() => showStage('Ready for Pickup')}>
            <span className="ld-metric-top"><span className="ld-metric-label">Ready for pickup</span><span className="ld-metric-icon ld-tone-green"><CircleCheck size={18} aria-hidden="true" /></span></span>
            <span className="ld-metric-value">{stats.states['Ready for Pickup'] ?? 0}</span>
            <span className="ld-metric-note">View pickup queue <ArrowRight size={15} aria-hidden="true" /></span>
          </button>
        </div>
      )}

      <div className="ld-content">
        <section className="ld-panel ld-orders" ref={orderSection} tabIndex={-1} aria-labelledby="ld-orders-title">
          <div className="ld-panel-header">
            <div><h2 id="ld-orders-title">Recent orders</h2><p className="ld-subtitle">Your latest orders, with the details that matter.</p></div>
            <Link className="ld-text-link" to={allOrdersUrl}>View all <ArrowRight size={16} aria-hidden="true" /></Link>
          </div>
          <div className="ld-order-filters">
            <SearchBox value={search} onChange={setSearch} label="Search dashboard orders" placeholder="Search order, customer or phone…" />
            <select aria-label="Filter orders by status" value={status} onChange={(event) => setStatus(event.target.value as LaundryStatus | '')}>
              <option value="">All statuses</option>
              {LAUNDRY_STATUSES.map((stage) => <option key={stage} value={stage}>{stage}</option>)}
            </select>
          </div>
          <div className="ld-order-results" aria-busy={orders.loading}>
            <LaundryLoad {...orders} retry={orders.reload} />
            {!orders.loading && !orders.error && orders.data && (
              <>
                {visibleOrders.length > 0 ? (
                  <>
                    <div className="ld-table-head" aria-hidden="true"><span>Order / customer</span><span>Status</span><span>Total / payment</span><span /></div>
                    <div className="ld-order-list">
                      {visibleOrders.map((order) => (
                        <Link className="ld-order" key={order.id} to={`/laundry/orders/${order.id}`}>
                          <div className="ld-order-customer">
                            <span className="ld-avatar" aria-hidden="true">{order.customer_name.trim().split(/\s+/).slice(0, 2).map((name) => name[0]).join('').toUpperCase() || '?'}</span>
                            <div><strong>{order.customer_name}</strong><p>{order.order_number} <span aria-hidden="true">·</span> {new Date(order.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</p></div>
                          </div>
                          <div className="ld-order-status"><StatusBadge status={order.status} />{order.pickup_at && <p><Clock3 size={12} aria-hidden="true" />{new Date(order.pickup_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>}</div>
                          <div className="ld-order-payment"><strong>{money(order.total_cents)}</strong><LaundryPaymentStatus order={order} /></div>
                          <ChevronRight className="ld-order-chevron" size={16} aria-hidden="true" />
                        </Link>
                      ))}
                    </div>
                    <div className="ld-orders-footer"><p role="status">Showing {visibleOrders.length} latest of {orders.data.count} {filtered ? 'matching ' : ''}orders</p><Link className="ld-text-link" to={allOrdersUrl}>Open order list <ArrowRight size={14} aria-hidden="true" /></Link></div>
                  </>
                ) : (
                  <div className="ld-empty" role="status">
                    <span className="ld-empty-icon"><Inbox size={26} aria-hidden="true" /></span>
                    <h3>{filtered ? 'No matching orders' : 'Your first load starts here'}</h3>
                    <p>{filtered ? 'Try a different name, order number or status.' : 'Create an order to start tracking laundry, payments and pickups.'}</p>
                    {filtered ? <Button variant="secondary" onClick={() => { setSearch(''); setStatus('') }}>Clear filters</Button> : <div className="laundry-actions"><ButtonLink variant="primary" to="/laundry/new"><Plus size={16} aria-hidden="true" />New order</ButtonLink>{can('products.manage') && <ButtonLink to="/laundry/services">Configure services</ButtonLink>}</div>}
                  </div>
                )}
              </>
            )}
          </div>
        </section>

        <aside className="ld-sidebar" aria-label="Laundry workflow and balances">
          <section className="ld-panel ld-workflow" aria-labelledby="ld-workflow-title">
            <div className="ld-panel-header"><div><h2 id="ld-workflow-title">Laundry workflow</h2><p className="ld-subtitle">Orders across all dates</p></div>{stats && <span className="ld-count">{totalOrders}</span>}</div>
            <div className="ld-workflow-stages">
              {stages.map(({ status: stage, label, icon: Icon, tone }) => (
                <button type="button" key={stage} disabled={!stats} className={`ld-stage ${status === stage ? 'is-selected' : ''}`} aria-pressed={status === stage} onClick={() => showStage(status === stage ? '' : stage)}>
                  <span className={`ld-stage-icon ld-tone-${tone}`}><Icon size={17} aria-hidden="true" /></span>
                  <span className="ld-stage-label">{label}</span><strong>{stats ? (stats.states[stage] ?? 0) : '—'}</strong><ChevronRight size={14} aria-hidden="true" />
                </button>
              ))}
            </div>
            <div className="ld-workflow-footer"><Check size={15} aria-hidden="true" /><span>Receive, prepare, then complete pickup.</span></div>
          </section>
          <section className="ld-balance" aria-labelledby="ld-balance-title">
            <span className="ld-balance-icon"><Wallet size={18} aria-hidden="true" /></span>
            <h2 id="ld-balance-title">Outstanding balance</h2>
            <p className="ld-balance-value">{stats ? money(stats.outstanding) : '—'}</p>
            <p>Unpaid balances across received, ready and completed orders.</p>
            <Link className="ld-text-link" to={can('reports.view') ? '/reports' : '/laundry/orders'}>{can('reports.view') ? 'View payment reports' : 'Review orders'}<ArrowRight size={15} aria-hidden="true" /></Link>
          </section>
        </aside>
      </div>
    </div>
  )
}
