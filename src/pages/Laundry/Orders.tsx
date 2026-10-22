import { Button, ButtonLink } from '../../components/ui/Button'
import { SearchBox } from '../../components/ui/WorkPage'
import { CalendarDays, ChevronLeft, ChevronRight, CircleCheck, ClipboardList, Clock3, Droplets, Layers3, Plus, RefreshCw, ShoppingBag, SlidersHorizontal, X } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { laundryApi } from '../../api/laundryApi'
import { laundryReportsApi, localDate } from '../../api/laundryReportsApi'
import { LAUNDRY_STATUSES, type LaundryStatus } from '../../types/laundry'
import { useLaundryQuery as useAsync } from '../../components/laundry/LaundryUI'
import { useDebounced } from '../../hooks/useDebounced'
import {
  LaundryField,
  LaundryLoad,
  StatusBadge,
  useLaundryMoney,
} from '../../components/laundry/LaundryUI'
import './orders.css'
import { LaundryAddAction } from '../../components/laundry/LaundryAddAction'

export function LaundryOrders() {
  const [params, setParams] = useSearchParams()
  const search = params.get('search') ?? ''
  const archived = params.get('archive') === '1'
  const requestedStatus = params.get('status') ?? ''
  const status = !archived && LAUNDRY_STATUSES.includes(requestedStatus as LaundryStatus) ? requestedStatus : ''
  const requestedDate = params.get('date') ?? ''
  const date = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) && localDate(new Date(`${requestedDate}T00:00:00`)) === requestedDate ? requestedDate : ''
  const requestedPage = Number(params.get('page') ?? 1)
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1
  const term = useDebounced(search), money = useLaundryMoney()
  const [refreshing, setRefreshing] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const filtersId = useId()
  const advancedFilterCount = Number(Boolean(status)) + Number(Boolean(date))
  const refreshLock = useRef(false)
  const listRef = useRef<HTMLElement>(null)
  const queryKey = JSON.stringify([term, status, date, page, archived])
  const data = useAsync(async () => ({ ...await laundryApi.list({ search: term, status, date, page, archived }), queryKey }), [term, status, date, page, archived])
  const summary = useAsync(() => laundryReportsApi.dashboard(), [])
  const result = data.data?.queryKey === queryKey ? data.data : null
  const pending = data.loading || search !== term || (!result && !data.error)
  const stats = summary.data
  const totalOrders = stats ? Object.values(stats.states).reduce((sum, count) => sum + count, 0) : null
  const inProgress = stats ? stats.states.Received ?? 0 : null
  const filtered = Boolean(search || status || date)
  const pageCount = Math.max(1, Math.ceil((result?.count ?? 0) / 30))
  const overview = [
    { label: 'All orders', value: totalOrders, note: 'Every order, across all dates', icon: Layers3, tone: 'slate' },
    { label: 'Received', value: inProgress, note: 'Not yet ready for pickup', icon: Droplets, tone: 'slate' },
    { label: 'Ready for pickup', value: stats ? stats.states['Ready for Pickup'] ?? 0 : null, note: 'Ready to go home', icon: ShoppingBag, tone: 'green' },
    { label: 'Completed', value: stats ? stats.states.Completed ?? 0 : null, note: 'Collected by the customer', icon: CircleCheck, tone: 'sage' },
  ]

  function updateFilters(patch: { search?: string; status?: string; date?: string; page?: number }) {
    setParams(current => {
      const next = new URLSearchParams(current)
      next.delete('page')
      for (const [key, value] of Object.entries(patch)) {
        if (value !== '' && !(key === 'page' && value === 1)) next.set(key, String(value))
        else next.delete(key)
      }
      return next
    }, { replace: true })
  }
  function clearFilters() { setParams(archived ? { archive: '1' } : {}, { replace: true }) }
  function toggleArchive() { setParams(archived ? {} : { archive: '1' }, { replace: true }) }
  function goToPage(next: number) {
    updateFilters({ page: next })
    listRef.current?.focus({ preventScroll: true })
    listRef.current?.scrollIntoView({ block: 'start' })
  }
  async function refresh() {
    if (refreshLock.current) return
    refreshLock.current = true
    setRefreshing(true)
    try { await Promise.all([data.reload(), summary.reload()]) }
    finally { refreshLock.current = false; setRefreshing(false) }
  }

  return <div className="laundry-screen laundry-orders laundry-has-add">
    <header className="lo-header">
      <div><p className="lo-eyebrow"><span /> LAUNDRY OPERATIONS</p><h1>Laundry orders</h1><p>Track loads, payments and pickups.</p></div>
      <div className="lo-header-actions"><Button variant="secondary" className="laundry-refresh-action" onClick={() => void refresh()} disabled={refreshing || pending} aria-label="Refresh orders"><RefreshCw size={16} aria-hidden="true" className={refreshing ? 'lo-spin' : ''} /><span>{refreshing ? 'Refreshing…' : 'Refresh'}</span></Button><LaundryAddAction to="/laundry/new" label="New order" /></div>
    </header>
    <div className="lo-overview-label"><h2>Order overview</h2><span>Across all dates</span></div>
    {summary.error && <div className="lo-summary-error" role="alert"><span>Order overview unavailable. {summary.error}</span><Button variant="ghost" onClick={() => void summary.reload()}>Retry overview</Button></div>}
    <div className="lo-overview" aria-busy={summary.loading}>
      {overview.map(({ label, value, note, icon: Icon, tone }) => <section className="lo-metric" key={label}><div><h3>{label}</h3><span className={`lo-metric-icon lo-tone-${tone}`}><Icon size={18} aria-hidden="true" /></span></div><p className="lo-metric-value">{value === null ? <span aria-label={summary.loading ? 'Loading total' : 'Total unavailable'}>—</span> : value.toLocaleString()}</p><p className="lo-metric-note">{note}</p></section>)}
    </div>
    <section className="lo-list" ref={listRef} tabIndex={-1} aria-labelledby="lo-list-title">
      <div className="lo-list-heading"><div><h2 id="lo-list-title">{archived ? 'Legacy archive' : 'Order list'}</h2><p>{archived ? 'Historical cancelled orders. Read-only, with their original history.' : 'Tap an order to manage payment or pickup.'}</p></div><Button variant="secondary" onClick={toggleArchive}>{archived ? 'Back to current orders' : 'Legacy archive'}</Button></div>
      <div className="lo-search-toolbar">
        <div className="lo-search"><SearchBox label="Search order or customer" placeholder="Name, phone or ID" value={search} onChange={value => updateFilters({ search: value })} /></div>
        <Button variant="secondary" className={`lo-filter-toggle ${filtersOpen || advancedFilterCount ? 'is-active' : ''}`} aria-label={`Filters${advancedFilterCount ? `, ${advancedFilterCount} applied` : ''}`} aria-expanded={filtersOpen} aria-controls={filtersId} onClick={() => setFiltersOpen(open => !open)}><SlidersHorizontal size={17} aria-hidden="true" /><span className="lo-filter-label">Filters</span>{advancedFilterCount > 0 && <span className="lo-filter-count" aria-hidden="true">{advancedFilterCount}</span>}</Button>
      </div>
      {!archived && <div className="lo-quick-filters" role="group" aria-label="Quick order status filters">
        {[['', 'All orders'], ...LAUNDRY_STATUSES.map(value => [value, value])].map(([value, label]) => <button type="button" key={value} aria-label={value || label} aria-pressed={status === value} className={status === value ? 'is-active' : ''} onClick={() => updateFilters({ status: value })}>{value === 'Ready for Pickup' && <CircleCheck size={14} aria-hidden="true" />}{label}</button>)}
      </div>}
      <div className="lo-filters" id={filtersId} hidden={!filtersOpen}>
        {!archived && <label className="laundry-field"><span>Status</span><select value={status} onChange={event => updateFilters({ status: event.target.value })}><option value="">All statuses</option>{LAUNDRY_STATUSES.map(value => <option key={value}>{value}</option>)}</select></label>}
        <LaundryField label="Received date" type="date" value={date} onChange={event => updateFilters({ date: event.target.value })} />
      </div>
      {filtered && <div className="lo-active-filters" aria-label="Applied filters">
        {search && <button type="button" onClick={() => updateFilters({ search: '' })} aria-label="Remove search filter"><span>Search: {search}</span><X size={13} aria-hidden="true" /></button>}
        {status && <button type="button" onClick={() => updateFilters({ status: '' })} aria-label="Remove status filter"><span>{status}</span><X size={13} aria-hidden="true" /></button>}
        {date && <button type="button" onClick={() => updateFilters({ date: '' })} aria-label="Remove date filter"><span>Received: {new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span><X size={13} aria-hidden="true" /></button>}
        <Button variant="ghost" onClick={clearFilters}>Clear filters</Button>
      </div>}
      <div className="lo-results" aria-busy={pending}>
        {pending ? <div className="lo-loading"><LaundryLoad loading error={null} retry={data.reload} /></div> : data.error ? <div className="lo-list-error"><LaundryLoad loading={false} error={data.error} retry={data.reload} /></div> : result && <>
          {result.orders.length ? <>
            <div className="lo-table-head" aria-hidden="true"><span>Order / received</span><span>Customer</span><span>Status</span><span>Pickup</span><span>Total / payment</span><span /></div>
            <div className="lo-order-list">
              {result.orders.map(order => {
                const closed = order.status === 'Cancelled' || order.status === 'Completed'
                const overdue = !closed && !!order.pickup_at && new Date(order.pickup_at).getTime() < Date.now()
                const balance = order.total_cents - order.paid_cents
                const paymentState = order.status === 'Cancelled' ? 'cancelled' : balance <= 0 ? 'paid' : order.paid_cents > 0 ? 'partial' : 'unpaid'
                return <Link key={order.id} className="laundry-order-row lo-order-row" to={`/laundry/orders/${order.id}`}>
                  <div className="lo-order-identity"><strong>{order.order_number}</strong><p><CalendarDays size={12} aria-hidden="true" />{new Date(order.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</p></div>
                  <div className="lo-customer"><span className="lo-avatar" aria-hidden="true">{order.customer_name.trim().split(/\s+/).slice(0, 2).map(name => name[0]).join('').toUpperCase() || '?'}</span><div><strong>{order.customer_name}</strong><p>{order.customer_phone || 'No contact number'}</p></div></div>
                  <div className="lo-state" data-status={order.status}><StatusBadge status={order.status} /></div>
                  <div className={`lo-pickup ${overdue ? 'is-overdue' : ''} ${!order.pickup_at || closed ? 'lo-pickup-inactive' : ''}`}><span className="lo-mobile-label">Pickup</span>{order.pickup_at ? <><p><Clock3 size={13} aria-hidden="true" /><span>{new Date(order.pickup_at).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</span></p>{overdue && <small>Pickup overdue</small>}</> : <p className="lo-unscheduled">Not scheduled</p>}</div>
                  <div className="lo-payment">
                    <div className={`lo-mobile-payment is-${paymentState}`}><span>{paymentState === 'cancelled' ? 'Cancelled' : paymentState === 'paid' ? 'Paid in full' : paymentState === 'partial' ? 'Remaining due' : 'Amount due'}</span>{paymentState !== 'cancelled' && <strong>{money(paymentState === 'paid' ? order.total_cents : Math.max(0, balance))}</strong>}</div>
                    <div className="lo-desktop-payment"><strong>{money(order.total_cents)}</strong><span className={`lo-payment-state is-${paymentState}`}><span aria-hidden="true" />{paymentState === 'cancelled' ? 'Cancelled' : paymentState === 'paid' ? 'Paid in full' : paymentState === 'partial' ? 'Partially paid' : 'Unpaid'}</span>{order.status !== 'Cancelled' && balance > 0 && <small>Due {money(balance)}</small>}</div>
                  </div>
                  <ChevronRight size={17} className="lo-row-arrow" aria-hidden="true" />
                </Link>
              })}
            </div>
          </> : <div className="lo-empty" role="status"><span className="lo-empty-icon"><ClipboardList size={28} aria-hidden="true" /></span><h3>{result.count > 0 ? 'No orders on this page' : filtered ? 'No orders match these filters.' : archived ? 'No archived orders' : 'Your first order starts here'}</h3><p>{result.count > 0 ? 'Return to the first page to see the available orders.' : filtered ? 'Try another order number, customer or date.' : archived ? 'Historical cancelled orders will appear here after migration.' : 'Create an order to start tracking laundry, payments and pickups.'}</p>{result.count > 0 ? <Button variant="secondary" onClick={() => goToPage(1)}>Go to first page</Button> : filtered ? <Button variant="secondary" onClick={clearFilters}>Reset filters</Button> : archived ? <Button variant="secondary" onClick={toggleArchive}>Back to current orders</Button> : <ButtonLink variant="primary" to="/laundry/new"><Plus size={16} aria-hidden="true" />New order</ButtonLink>}</div>}
          <footer className="lo-pagination"><p role="status">{result.orders.length ? `Showing ${(page - 1) * 30 + 1}–${(page - 1) * 30 + result.orders.length} of ${result.count.toLocaleString()} ${filtered ? 'matching ' : ''}orders` : `${result.count.toLocaleString()} ${filtered ? 'matching ' : ''}orders`}</p><nav aria-label="Order list pages"><Button variant="secondary" aria-label="Previous page" disabled={page === 1} onClick={() => goToPage(page - 1)}><ChevronLeft size={16} aria-hidden="true" /><span>Previous</span></Button><span className="lo-page-number">Page {page}{page <= pageCount ? ` of ${pageCount}` : ''}</span><Button variant="secondary" aria-label="Next page" disabled={page >= pageCount} onClick={() => goToPage(page + 1)}><span>Next</span><ChevronRight size={16} aria-hidden="true" /></Button></nav></footer>
        </>}
      </div>
    </section>
  </div>
}

export { LaundryOrderDetail } from './OrderDetail'
