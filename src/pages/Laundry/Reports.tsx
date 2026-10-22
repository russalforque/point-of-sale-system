import { useRef, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  ArrowDownLeft, ArrowRight, CalendarDays, CheckCheck, ChevronLeft, ChevronRight,
  CircleCheck, CreditCard, Download, FileSpreadsheet, FileText, Layers3,
  PackageOpen, RefreshCw, Search, Shirt, Wallet,
} from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { SearchBox } from '../../components/ui/WorkPage'
import { laundryReportsApi, localDate, dateRange } from '../../api/laundryReportsApi'
import { useSettings } from '../../context/SettingsContext'
import { useAuth } from '../../context/AuthContext'
import {
  LaundryField, LaundryLoad, useLaundryAction, useLaundryMoney, useLaundryQuery,
} from '../../components/laundry/LaundryUI'
import { LAUNDRY_STATUSES } from '../../types/laundry'
import { exportLaundryReport } from '../../services/laundryExport'
import './reports.css'

const PAGE_SIZE = 10
const methods = [
  { name: 'Cash', icon: Wallet, tone: 'cash' },
  { name: 'GCash', icon: CreditCard, tone: 'gcash' },
  { name: 'Maya', icon: CreditCard, tone: 'maya' },
] as const
const units: Record<string, string> = { kg: 'kg', load: 'loads', piece: 'pieces', fixed: 'items', quantity: 'items' }
const displayDate = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

function ReportPanel({ id, title, subtitle, extra, children, className = '' }: {
  id: string; title: string; subtitle: string; extra?: ReactNode; children: ReactNode; className?: string
}) {
  return <section id={id} className={`lr-panel ${className}`} aria-labelledby={`${id}-title`}>
    <header className="lr-panel-header"><div><h2 id={`${id}-title`}>{title}</h2><p>{subtitle}</p></div>{extra}</header>
    {children}
  </section>
}

function ReportPagination({ page, total, noun, onChange }: {
  page: number; total: number; noun: string; onChange: (page: number) => void
}) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  return <footer className="lr-pagination"><p role="status">{total ? `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total.toLocaleString()} ${noun}` : `0 ${noun}`}</p>{pages > 1 && <nav aria-label={`${noun} pages`}><Button variant="secondary" aria-label={`Previous ${noun} page`} disabled={page <= 1} onClick={() => onChange(page - 1)}><ChevronLeft size={16} aria-hidden="true" /></Button><span>Page {page} of {pages}</span><Button variant="secondary" aria-label={`Next ${noun} page`} disabled={page >= pages} onClick={() => onChange(page + 1)}><ChevronRight size={16} aria-hidden="true" /></Button></nav>}</footer>
}

export function LaundryReports() {
  const today = localDate()
  const [params, setParams] = useSearchParams()
  let from = params.get('from') ?? today, to = params.get('to') ?? today
  try { dateRange(from, to) } catch { from = today; to = today }
  const [draftFrom, setDraftFrom] = useState(from), [draftTo, setDraftTo] = useState(to)
  const [rangeError, setRangeError] = useState('')
  const [search, setSearch] = useState(''), [method, setMethod] = useState(''),
    [paymentPage, setPaymentPage] = useState(1), [balancePage, setBalancePage] = useState(1)
  const [exporting, setExporting] = useState<'csv' | 'pdf' | null>(null)
  const { settings } = useSettings(), { can } = useAuth(), money = useLaundryMoney(), action = useLaundryAction()
  const paymentsRef = useRef<HTMLElement>(null), balancesRef = useRef<HTMLElement>(null)
  const data = useLaundryQuery(async () => ({ report: await laundryReportsApi.report(from, to), from, to }), [from, to])
  const report = data.data?.from === from && data.data.to === to ? data.data.report : null
  const pending = data.loading || (!report && !data.error)
  const dirty = draftFrom !== from || draftTo !== to
  const collected = report?.collections.reduce((sum, row) => sum + row.amount_cents, 0) ?? 0
  const booked = report?.orders.reduce((sum, row) => sum + row.value, 0) ?? 0
  const orderCount = report?.orders.reduce((sum, row) => sum + row.count, 0) ?? 0
  const netServices = report?.services.reduce((sum, row) => sum + row.net_value, 0) ?? 0
  const periodLabel = from === to ? displayDate(from) : `${displayDate(from)} – ${displayDate(to)}`
  const lastWeek = new Date(`${today}T00:00:00`)
  lastWeek.setDate(lastWeek.getDate() - 6)
  const monthStart = new Date(`${today}T00:00:00`)
  monthStart.setDate(1)
  const presets = [
    { label: 'Today', from: today, to: today },
    { label: '7 days', from: localDate(lastWeek), to: today },
    { label: 'This month', from: localDate(monthStart), to: today },
  ]
  const activePreset = presets.findIndex(preset => preset.from === from && preset.to === to)
  const term = search.trim().toLocaleLowerCase()
  const filteredPayments = (report?.collections ?? []).filter(row => (!method || row.method === method) && (!term || [row.order_number, row.customer_name, row.staff, row.reference ?? ''].some(value => value.toLocaleLowerCase().includes(term))))
  const currentPaymentPage = Math.min(paymentPage, Math.max(1, Math.ceil(filteredPayments.length / PAGE_SIZE)))
  const paymentRows = filteredPayments.slice((currentPaymentPage - 1) * PAGE_SIZE, currentPaymentPage * PAGE_SIZE)
  const balances = [...(report?.balances ?? [])].sort((a, b) => b.balance - a.balance || a.order_number.localeCompare(b.order_number))
  const currentBalancePage = Math.min(balancePage, Math.max(1, Math.ceil(balances.length / PAGE_SIZE)))
  const balanceRows = balances.slice((currentBalancePage - 1) * PAGE_SIZE, currentBalancePage * PAGE_SIZE)
  const statusRows = LAUNDRY_STATUSES.map(status => report?.orders.find(row => row.status === status)).filter((row): row is NonNullable<typeof row> => row !== undefined && row.count > 0)

  function applyRange(start: string, end: string) {
    try { dateRange(start, end) }
    catch (error) { setRangeError(error instanceof Error ? error.message : 'Choose a valid date range.'); return }
    setRangeError('')
    setDraftFrom(start); setDraftTo(end)
    setPaymentPage(1); setBalancePage(1)
    setParams({ from: start, to: end }, { replace: true })
  }
  async function exportReport(format: 'csv' | 'pdf') {
    if (!report || pending || data.error || dirty || action.busy) return
    await action.run(async () => {
      setExporting(format)
      try { await exportLaundryReport(format, report, settings, from, to) }
      finally { setExporting(null) }
    })
  }
  function changePage(section: 'payments' | 'balances', page: number) {
    if (section === 'payments') setPaymentPage(page)
    else setBalancePage(page)
    const target = section === 'payments' ? paymentsRef.current : balancesRef.current
    target?.focus({ preventScroll: true }); target?.scrollIntoView({ block: 'start' })
  }

  return <div className="laundry-screen laundry-reports">
    <header className="lr-header">
      <div><p className="lr-eyebrow"><span /> LAUNDRY INSIGHTS</p><h1>Laundry reports</h1><p>A clearer view of collections, booked value and balances.</p></div>
      <div className="lr-header-actions">
        <Button variant="secondary" className="lr-refresh" aria-label="Refresh report" disabled={pending || action.busy} onClick={() => void data.reload()}><RefreshCw size={17} aria-hidden="true" className={pending ? 'lr-spin' : ''} /></Button>
        <Button variant="secondary" disabled={!report || pending || !!data.error || dirty || action.busy} onClick={() => void exportReport('csv')}><FileSpreadsheet size={16} aria-hidden="true" />{exporting === 'csv' ? 'Preparing CSV…' : 'Export CSV'}</Button>
        <Button disabled={!report || pending || !!data.error || dirty || action.busy} onClick={() => void exportReport('pdf')}><Download size={16} aria-hidden="true" />{exporting === 'pdf' ? 'Preparing PDF…' : 'Export PDF'}</Button>
      </div>
    </header>
    <section className="lr-date-panel" aria-labelledby="lr-period-title">
      <div className="lr-date-heading"><span className="lr-date-icon"><CalendarDays size={19} aria-hidden="true" /></span><div><h2 id="lr-period-title">Reporting period</h2><p>Dates include the full day in your local time.</p></div><div className="lr-presets" role="group" aria-label="Report date presets">{presets.map((preset, index) => <button key={preset.label} type="button" aria-pressed={!dirty && activePreset === index} className={!dirty && activePreset === index ? 'is-active' : ''} onClick={() => applyRange(preset.from, preset.to)}>{preset.label}</button>)}</div></div>
      <form className="lr-date-form" onSubmit={event => { event.preventDefault(); applyRange(draftFrom, draftTo) }}>
        <LaundryField label="From" type="date" required value={draftFrom} max={draftTo || undefined} aria-describedby={rangeError ? 'lr-date-error' : undefined} onChange={event => { setDraftFrom(event.target.value); setRangeError('') }} />
        <ArrowRight size={17} className="lr-date-arrow" aria-hidden="true" />
        <LaundryField label="To" type="date" required value={draftTo} min={draftFrom || undefined} aria-describedby={rangeError ? 'lr-date-error' : undefined} onChange={event => { setDraftTo(event.target.value); setRangeError('') }} />
        <Button type="submit" variant="secondary">Apply dates<ArrowRight size={15} aria-hidden="true" /></Button>
      </form>
      {rangeError && <p className="laundry-error lr-range-error" id="lr-date-error" role="alert">{rangeError}</p>}
      {dirty && <p className="lr-date-notice" role="status">Date range changed. Apply dates to update this report and enable exports.</p>}
    </section>
    <div className="lr-period-summary"><h2>Report overview</h2><span><CalendarDays size={14} aria-hidden="true" />{periodLabel}</span></div>
    {pending ? <div className="lr-loading"><LaundryLoad loading error={null} retry={data.reload} /><p>Preparing your report for {periodLabel}.</p></div> : data.error ? <LaundryLoad loading={false} error={data.error} retry={data.reload} /> : report && <>
      <div className="lr-metrics">
        <section className="lr-metric is-featured"><div><h3>Collected in period</h3><span><Wallet size={18} aria-hidden="true" /></span></div><p className="lr-metric-value">{money(collected)}</p><p className="lr-metric-note"><ArrowDownLeft size={14} aria-hidden="true" />{report.collections.length.toLocaleString()} payments received</p></section>
        <section className="lr-metric"><div><h3>Order value in period</h3><span className="lr-tone-blue"><FileText size={18} aria-hidden="true" /></span></div><p className="lr-metric-value">{money(booked)}</p><p className="lr-metric-note">After discounts; cancellations excluded</p></section>
        <section className="lr-metric"><div><h3>Orders received</h3><span className="lr-tone-slate"><Layers3 size={18} aria-hidden="true" /></span></div><p className="lr-metric-value">{orderCount.toLocaleString()}</p><p className="lr-metric-note">In this period, excluding legacy archives</p></section>
        <section className="lr-metric is-outstanding"><div><h3>Outstanding now</h3><span><Wallet size={18} aria-hidden="true" /></span></div><p className="lr-metric-value">{money(report.outstanding)}</p><p className="lr-metric-note">All dates · current unpaid balances</p></section>
      </div>
      {!orderCount && !report.collections.length && <div className="lr-period-empty"><CalendarDays size={18} aria-hidden="true" /><p>No orders or payments in this period. Current outstanding balances are still shown below.</p></div>}
      <nav className="lr-section-nav" aria-label="Report sections">
        <a href="#lr-services"><Shirt size={16} aria-hidden="true" />Services</a>
        <a href="#lr-payments"><Wallet size={16} aria-hidden="true" />Payments</a>
        <a href="#lr-balances"><Layers3 size={16} aria-hidden="true" />Balances</a>
      </nav>
      <div className="lr-breakdowns">
        <ReportPanel id="lr-methods" title="Payment methods" subtitle="Share of money collected in the selected period." extra={<span className="lr-count">{report.collections.length} payments</span>}>
          <div className="lr-method-list">{methods.map(({ name, icon: Icon, tone }) => {
            const payments = report.collections.filter(row => row.method === name)
            const amount = payments.reduce((sum, row) => sum + row.amount_cents, 0)
            const share = collected > 0 ? amount / collected * 100 : 0
            return <div className={`lr-method lr-method-${tone}`} key={name}><span className="lr-method-icon"><Icon size={18} aria-hidden="true" /></span><div className="lr-method-info"><div><strong>{name}</strong><span>{money(amount)}</span></div><div className="lr-method-caption"><span>{payments.length} {payments.length === 1 ? 'payment' : 'payments'}{name !== 'Cash' ? ' · manual' : ''}</span><span>{share.toFixed(1)}%</span></div><div className="lr-method-track" aria-hidden="true"><span style={{ width: `${share}%` }} /></div></div></div>
          })}</div><p className="lr-panel-footnote">GCash and Maya are manually recorded, unverified payments.</p>
        </ReportPanel>
        <ReportPanel id="lr-status" title="Orders received in period" subtitle="Current status of orders received within these dates." extra={<span className="lr-count">{orderCount} orders</span>}>
          {statusRows.length ? <div className="lr-status-list">{statusRows.map(row => <div className="lr-status-row" key={row.status}><span className="lr-status-dot" data-status={row.status} aria-hidden="true" /><span>{row.status}</span><div className="lr-status-track" aria-hidden="true"><span style={{ width: `${orderCount ? row.count / orderCount * 100 : 0}%` }} /></div><strong>{row.count}</strong></div>)}</div> : <div className="lr-small-empty"><PackageOpen size={25} aria-hidden="true" /><p>No orders received in this period.</p></div>}
          <p className="lr-panel-footnote">Received → Ready for Pickup → Completed. Legacy archived orders are excluded.</p>
        </ReportPanel>
      </div>
      <ReportPanel id="lr-services" title="Revenue by service & add-on" subtitle="Booked value after allocated discounts, for orders received in this period. Legacy archived orders excluded." extra={<span className="lr-net-total">{money(netServices)}<small>Net booked value</small></span>}>
        {report.services.length ? <><div className="lr-table-wrap"><table className="lr-table lr-service-table" role="table"><caption className="sr-only">Service and add-on revenue for {periodLabel}</caption><thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Service / add-on</th><th role="columnheader" scope="col">Quantity</th><th role="columnheader" scope="col">Gross value</th><th role="columnheader" scope="col">Discount</th><th role="columnheader" scope="col">Net booked</th></tr></thead><tbody role="rowgroup">{report.services.map(row => <tr role="row" key={`${row.kind}:${row.name}:${row.pricing}`}><td role="cell" data-label="Service"><div className="lr-service-name"><span className="lr-service-icon"><Shirt size={17} aria-hidden="true" /></span><div><strong>{row.name}</strong><span className="lr-kind">{row.kind ? 'Add-on' : 'Service'}{row.pricing === 'fixed' ? ' · fixed price' : ''}</span></div></div></td><td role="cell" data-label="Quantity">{(row.quantity_milli / 1000).toLocaleString(undefined, { maximumFractionDigits: 3 })} {units[row.pricing] ?? row.pricing}</td><td role="cell" data-label="Gross value">{money(row.value)}</td><td role="cell" data-label="Discount" className="lr-muted">{money(row.value - row.net_value)}</td><td role="cell" data-label="Net booked" className="lr-net-cell">{money(row.net_value)}</td></tr>)}</tbody></table></div><p className="lr-panel-footnote">Booked value uses order received dates. Collections use payment dates, so their totals can differ.</p></> : <div className="lr-small-empty"><Shirt size={25} aria-hidden="true" /><p>No services booked in this period.</p></div>}
      </ReportPanel>
      <section id="lr-payments" className="lr-panel lr-payments" ref={paymentsRef} tabIndex={-1} aria-labelledby="lr-payments-title">
        <header className="lr-panel-header"><div><h2 id="lr-payments-title">Collected payments</h2><p>Each payment received within {periodLabel}.</p></div><span className="lr-count">{report.collections.length} payments</span></header>
        <div className="lr-payment-filters"><div className="lr-payment-search"><span aria-hidden="true">Search payments</span><SearchBox label="Search collected payments" placeholder="Search payments…" value={search} onChange={value => { setSearch(value); setPaymentPage(1) }} /></div><label className="laundry-field"><span>Payment method</span><select value={method} onChange={event => { setMethod(event.target.value); setPaymentPage(1) }}><option value="">All payment methods</option>{methods.map(({ name }) => <option key={name}>{name}</option>)}</select></label></div>
        <p className="lr-filter-help">Table filters affect this list only. Exports include the full reporting period.</p>
        {paymentRows.length ? <div className="lr-table-wrap"><table className="lr-table lr-payments-table" role="table"><caption className="sr-only">Collected payments matching the table filters</caption><thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Date</th><th role="columnheader" scope="col">Order / customer</th><th role="columnheader" scope="col">Method / reference</th><th role="columnheader" scope="col">Staff</th><th role="columnheader" scope="col">Collected</th></tr></thead><tbody role="rowgroup">{paymentRows.map(row => <tr role="row" key={row.id}><td role="cell" data-label="Date"><span>{new Date(row.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span><small>{new Date(row.created_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</small></td><td role="cell" data-label="Order / customer">{can('sales.process') ? <Link className="lr-order-link" to={`/laundry/orders?search=${encodeURIComponent(row.order_number)}`}>{row.order_number}</Link> : <strong>{row.order_number}</strong>}<small>{row.customer_name}</small></td><td role="cell" data-label="Method"><span className={`lr-method-pill lr-method-${row.method.toLowerCase()}`}>{row.method}</span>{row.reference && <small>Ref: {row.reference}</small>}{row.method !== 'Cash' && <small>Manual · unverified</small>}</td><td role="cell" data-label="Staff">{row.staff}</td><td role="cell" data-label="Collected" className="lr-collected-cell">{money(row.amount_cents)}</td></tr>)}</tbody></table></div> : <div className="lr-small-empty"><Search size={25} aria-hidden="true" /><p>{report.collections.length ? 'No payments match your search or method.' : 'No payments collected in this period.'}</p>{(search || method) && <Button variant="ghost" onClick={() => { setSearch(''); setMethod(''); setPaymentPage(1) }}>Clear payment filters</Button>}</div>}
        <ReportPagination page={currentPaymentPage} total={filteredPayments.length} noun="payments" onChange={page => changePage('payments', page)} />
      </section>
      <section id="lr-balances" className="lr-panel lr-balances" ref={balancesRef} tabIndex={-1} aria-labelledby="lr-balances-title">
        <header className="lr-panel-header"><div><h2 id="lr-balances-title">Outstanding balances</h2><p>Includes unpaid completed orders across all dates. Legacy archived orders excluded.</p></div><span className="lr-current-label">All dates · current</span></header>
        {balanceRows.length ? <><div className="lr-balance-list">{balanceRows.map(row => <div className="lr-balance-row" key={row.order_number}><span className="lr-balance-icon"><Wallet size={17} aria-hidden="true" /></span><div><strong>{row.customer_name}</strong>{can('sales.process') ? <Link className="lr-order-link" to={`/laundry/orders?search=${encodeURIComponent(row.order_number)}`}>{row.order_number}<ChevronRight size={12} aria-hidden="true" /></Link> : <small>{row.order_number}</small>}</div><span>{money(row.balance)}<small>Balance due</small></span></div>)}</div><div className="lr-balance-total"><span>Total outstanding <small>{balances.length} {balances.length === 1 ? 'order' : 'orders'}</small></span><strong>{money(report.outstanding)}</strong></div><ReportPagination page={currentBalancePage} total={balances.length} noun="balances" onChange={page => changePage('balances', page)} /></> : <div className="lr-small-empty is-settled"><CheckCheck size={28} aria-hidden="true" /><strong>All balances are settled</strong><p>There are no outstanding balances across your orders.</p></div>}
      </section>
      <p className="lr-footer-note"><CircleCheck size={14} aria-hidden="true" />Collections reflect recorded payments. Outstanding balances always reflect current records.</p>
    </>}
  </div>
}
