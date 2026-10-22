import { useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useParams } from 'react-router-dom'
import {
  ArrowLeft, ArrowRight, CalendarDays, Check, CircleCheck, Ellipsis,
  Clock3, History, PackageCheck, Phone, Printer, ReceiptText, RefreshCw,
  Shirt, UserRound, Wallet, X, type LucideIcon,
} from 'lucide-react'
import { laundryApi } from '../../api/laundryApi'
import { laundryPricingApi } from '../../api/laundryPricingApi'
import { Button, ButtonLink } from '../../components/ui/Button'
import { BOTTOM_NAV_HEIGHT } from '../../components/layout/MoreSheet'
import { Modal } from '../../components/ui/Modal'
import { BackLayer } from '../../components/ui/WorkPage'
import { LaundryLoad, PaymentFields, StatusBadge, message, useLaundryAction, useLaundryMoney, useLaundryQuery, type PaymentForm } from '../../components/laundry/LaundryUI'
import { useAuth } from '../../context/AuthContext'
import { useSettings } from '../../context/SettingsContext'
import { useToast } from '../../context/ToastContext'
import { cents, paymentAmounts } from '../../services/laundryMath'
import { autoPrintLaundryReceipt, openLaundryDrawer, printLaundryOrder } from '../../services/printer/laundryPrinting'
import { buildLaundryReceipt } from '../../services/printer/laundryReceipt'
import { LAUNDRY_STATUSES, type LaundryDetail, type LaundryLine, type LaundryStatus } from '../../types/laundry'
import type { StoreSetting } from '../../types'
import { getPrinterConfig } from '../../utils/printerConfig'
import './order-detail.css'

const dateTime = (value: string) => new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
type HistoryFilter = 'all' | 'status' | 'payment'

function DetailCard({ title, icon: Icon, children, className = '', aside }: {
  title: string; icon: LucideIcon; children: ReactNode; className?: string; aside?: ReactNode
}) {
  const headingId = useId()
  return <section className={`od-card ${className}`} aria-labelledby={headingId}><header className="od-card-heading"><span className="od-card-icon"><Icon size={19} aria-hidden="true" /></span><h2 id={headingId}>{title}</h2>{aside}</header>{children}</section>
}

function lineQuantity(line: LaundryLine) {
  if (line.pricing === 'fixed') return 'Fixed price'
  const quantity = line.quantity_milli / 1000
  const unit = line.pricing === 'kg' ? 'kg' : line.pricing === 'load' ? `load${quantity === 1 ? '' : 's'}` : line.pricing === 'piece' ? `piece${quantity === 1 ? '' : 's'}` : `item${quantity === 1 ? '' : 's'}`
  return `${quantity.toLocaleString(undefined, { maximumFractionDigits: 3 })} ${unit}`
}

function OrderServices({ order }: { order: LaundryDetail }) {
  const money = useLaundryMoney()
  return <>
    <div className="od-service-labels" aria-hidden="true"><span>Service / add-on</span><span>Amount</span></div>
    <ul className="od-service-list" aria-label="Ordered services and add-ons">
      {[...order.items.map(line => ({ line, addon: false })), ...order.addons.map(line => ({ line, addon: true }))].map(({ line, addon }) => <li className="od-service-line" key={`${addon ? 'addon' : 'service'}-${line.id}`}>
        <span className={`od-line-icon ${addon ? 'is-addon' : ''}`} aria-hidden="true">{addon ? <PackageCheck size={18} /> : <Shirt size={18} />}</span>
        <div><strong>{line.name}</strong><p>{addon && <span className="od-addon-label">Add-on · </span>}{lineQuantity(line)}{line.pricing !== 'fixed' && <> × {money(line.price_cents)}</>}</p></div><strong>{money(line.total_cents)}</strong>
      </li>)}
    </ul>
    {!order.items.length && !order.addons.length && <p className="od-help">No services recorded for this order.</p>}
    {order.notes && <section className="od-order-notes"><h3>Order notes</h3><p>{order.notes}</p></section>}
  </>
}

function OrderPaymentBreakdown({ order }: { order: LaundryDetail }) {
  const money = useLaundryMoney()
  const discounts = order.discounts?.length ? order.discounts : [{ name: 'Discount', amount_cents: order.discount_cents }]
  return <dl className="od-breakdown">
    <div><dt>Subtotal</dt><dd>{money(order.subtotal_cents)}</dd></div>
    {discounts.filter(discount => discount.amount_cents > 0).map((discount, index) => <div className="od-discount-row" key={index}><dt>{discount.name}</dt><dd>−{money(discount.amount_cents)}</dd></div>)}
    <div className="od-total-row"><dt>Order total</dt><dd>{money(order.total_cents)}</dd></div>
    <div className="od-collected-row"><dt>Collected</dt><dd>{money(order.paid_cents)}</dd></div>
  </dl>
}

function LaundryReceiptPreview({ order, settings }: { order: LaundryDetail; settings: StoreSetting }) {
  const receipt = buildLaundryReceipt(order, settings, getPrinterConfig())
  return <div className="od-receipt-scroll">
    <div className="od-receipt-paper" role="document" aria-label="Laundry receipt">
      <div className="od-receipt-lines" style={{ width: `${receipt.columns}ch` }}>
        {receipt.preview.map((line, index) => <div key={index} style={{ textAlign: line.align, fontWeight: line.bold ? 700 : 400 }}>
          {line.tall ? <span className="od-receipt-tall">{line.text || '\u00a0'}</span> : line.text || '\u00a0'}
        </div>)}
      </div>
    </div>
  </div>
}

function OrderActivity({ order, filter, onFilter, preview = false, onViewAll }: { order: LaundryDetail; filter: HistoryFilter; onFilter: (filter: HistoryFilter) => void; preview?: boolean; onViewAll?: () => void }) {
  const money = useLaundryMoney()
  const events = [
    ...order.history.map(entry => ({ kind: 'status' as const, entry })),
    ...order.payments.map(entry => ({ kind: 'payment' as const, entry })),
  ].filter(event => filter === 'all' || event.kind === filter)
    .sort((a, b) => new Date(b.entry.created_at).getTime() - new Date(a.entry.created_at).getTime() || b.entry.id - a.entry.id)
  return <DetailCard title={preview ? 'Recent activity' : 'Order activity'} icon={History} className="od-activity" aside={preview ? <Button variant="ghost" className="od-view-history" onClick={onViewAll}>View all<ArrowRight size={15} aria-hidden="true" /></Button> : <span className="od-count">Newest first</span>}>
    {!preview && !!order.discounts?.length && <section className="od-discount-history"><h3 className="text-sm font-semibold">Applied discounts</h3>{order.discounts.map((discount, index) => <p key={index} className="flex items-center justify-between gap-3 py-2 text-sm"><span>{discount.name}{discount.visit_number ? ` · Visit ${discount.visit_number}` : ''}</span><strong>−{money(discount.amount_cents)}</strong></p>)}</section>}
    {!preview && <div className="od-history-filters" role="group" aria-label="Activity filters">
      {([{ key: 'all', label: 'All activity', count: order.history.length + order.payments.length }, { key: 'status', label: 'Status', count: order.history.length }, { key: 'payment', label: 'Payments', count: order.payments.length }] as const).map(option => <button type="button" key={option.key} aria-pressed={filter === option.key} onClick={() => onFilter(option.key)}>{option.label}<span>{option.count}</span></button>)}
    </div>}
    <ol className="od-timeline" aria-label={filter === 'payment' ? 'Payment history' : filter === 'status' ? 'Status history' : 'Order history'}>
      {(preview ? events.slice(0, 3) : events).map(event => <li key={`${event.kind}-${event.entry.id}`}>
        <span className={`od-event-icon ${event.kind === 'payment' ? 'is-payment' : event.entry.status === 'Cancelled' ? 'is-cancelled' : ''}`} aria-hidden="true">{event.kind === 'payment' ? <Wallet size={16} /> : event.entry.status === 'Cancelled' ? <X size={16} /> : <Check size={16} />}</span>
        <div className="od-event-body"><div className="od-event-title"><strong>{event.kind === 'payment' ? `${event.entry.method} payment` : event.entry.status}</strong>{event.kind === 'payment' && <span>{money(event.entry.amount_cents)}</span>}</div>
          <p className="od-event-meta">{event.entry.staff}<span aria-hidden="true">·</span><time dateTime={event.entry.created_at}>{dateTime(event.entry.created_at)}</time></p>
          {event.kind === 'status' && event.entry.from_status && <p className="od-event-note">{event.entry.event_type === 'correction' ? 'Status correction: ' : event.entry.event_type === 'migration' ? 'Legacy migration: ' : ''}{event.entry.from_status} → {event.entry.status}</p>}
          {event.kind === 'status' ? event.entry.reason && <p className="od-event-note">{event.entry.reason}</p> : <>
            {event.entry.reference && <p className="od-event-note">Reference: {event.entry.reference}</p>}
            {event.entry.method === 'Cash' ? <p className="od-event-note">Tendered {money(event.entry.tendered_cents)} · Change {money(event.entry.tendered_cents - event.entry.amount_cents)}</p> : <p className="od-event-note">Manual · provider unverified</p>}
          </>}
        </div>
      </li>)}
    </ol>
    {!events.length && <p className="od-empty-history">{filter === 'payment' ? 'No payments recorded. Payments will appear here as they are collected.' : 'No activity recorded yet.'}</p>}
  </DetailCard>
}

/** A new route ID resets dialogs and drafts, so an old order cannot flash or receive an action. */
export function LaundryOrderDetail() {
  const { id } = useParams()
  return <OrderDetail key={id} orderId={Number(id)} />
}

function OrderDetail({ orderId }: { orderId: number }) {
  const money = useLaundryMoney(), { can } = useAuth(), { settings } = useSettings(), { notify } = useToast()
  const data = useLaundryQuery(async () => {
    if (!Number.isSafeInteger(orderId) || orderId <= 0) throw new Error('This order link is invalid. Return to the order list.')
    const [order, rules] = await Promise.all([laundryApi.detail(orderId), laundryPricingApi.rules()])
    return { ...order, allow_unpaid_completion: !!rules.allow_unpaid_completion }
  }, [orderId])
  const action = useLaundryAction(), print = useLaundryAction(), paymentFormId = useId(), statusFormId = useId()
  const [dialog, setDialog] = useState<'payment' | 'status' | 'receipt' | 'more' | 'history' | null>(null),
    [next, setNext] = useState<LaundryStatus>('Ready for Pickup'), [reason, setReason] = useState(''),
    [payment, setPayment] = useState<PaymentForm>({ method: 'Cash', amount: '', tendered: '', reference: '' }),
    [paymentError, setPaymentError] = useState(''), [historyFilter, setHistoryFilter] = useState<HistoryFilter>('all'),
    [printingDocument, setPrintingDocument] = useState<'receipt' | 'tag' | null>(null),
    [historyFromMenu, setHistoryFromMenu] = useState(false)
  const [correcting, setCorrecting] = useState(false), [statusVersion, setStatusVersion] = useState(0), [statusError, setStatusError] = useState('')
  const payKey = useRef(crypto.randomUUID()), paymentErrorRef = useRef<HTMLDivElement>(null)
  const order = data.data, balance = order ? order.total_cents - order.paid_cents : 0
  const lineCount = order ? order.items.length + order.addons.length : 0
  const cancelled = !!order?.archived_at
  const blocked = action.busy || data.loading || print.busy
  const nextStatus = order?.status === 'Received' ? 'Ready for Pickup' : order?.status === 'Ready for Pickup' ? 'Completed' : null
  const collectBeforePickup = nextStatus === 'Completed' && balance > 0 && !order?.allow_unpaid_completion
  const currentStep = LAUNDRY_STATUSES.findIndex(status => status === order?.status)
  const paidPercent = order && order.total_cents > 0 ? Math.min(100, Math.max(0, order.paid_cents / order.total_cents * 100)) : 100
  const paymentLabel = cancelled ? 'Archived' : balance <= 0 ? 'Paid in full' : order?.paid_cents ? 'Part paid' : 'Unpaid'
  const nextStepHint = cancelled ? 'This legacy order is archived. Details and history are read-only.'
    : order?.status === 'Received' ? 'When the laundry is prepared, mark this order ready for pickup.'
    : order?.status === 'Ready for Pickup' ? collectBeforePickup ? 'Collect the remaining balance, then complete pickup after handover.'
      : balance > 0 ? 'Complete pickup after handover. The remaining balance will stay due.' : 'Payment is settled. Complete pickup after handing over the laundry.'
    : balance > 0 ? 'Pickup is complete. The remaining balance can still be collected.' : 'Laundry collected and payment settled. This order is complete.'
  const selected = next
  const completionBlocked = selected === 'Completed' && balance > 0 && !order?.allow_unpaid_completion
  let amountToApply: number | null = null
  try {
    const amount = cents(Number(payment.amount))
    if (amount > 0 && amount <= balance) amountToApply = amount
  } catch { /* An invalid edit stays visible; Apply payment explains what to correct. */ }
  function openPayment() {
    if (!order || cancelled || balance <= 0 || blocked) return
    payKey.current = crypto.randomUUID()
    setPayment({ method: 'Cash', amount: String(balance / 100), tendered: '', reference: '' })
    setPaymentError(''); setDialog('payment')
  }
  function openStatus(correction = false) {
    if (!order || cancelled || blocked || (!correction && !nextStatus) || (correction && !can('sales.void'))) return
    setCorrecting(correction); setNext(correction ? order.status === 'Received' ? 'Ready for Pickup' : 'Received' : nextStatus!)
    setStatusVersion(order.status_version); setReason(''); setStatusError(''); setDialog('status')
  }
  function receiptPreview() { if (order) setDialog('receipt') }
  function openHistory(fromMenu = false) {
    setHistoryFromMenu(fromMenu); setHistoryFilter('all'); setDialog('history')
  }
  async function printDocument(tag = false) {
    if (!order || blocked) return
    await print.run(async () => {
      setPrintingDocument(tag ? 'tag' : 'receipt')
      try { await printLaundryOrder(order.id, tag); notify(tag ? 'Tag sent to printer.' : 'Receipt sent to printer.') }
      finally { setPrintingDocument(null) }
    })
  }
  async function recordPayment(close: () => void) {
    if (!order) return
    setPaymentError('')
    try {
      if (payment.method === 'Pay later') throw new Error('Select a payment method.')
      if (!payment.amount.trim()) throw new Error('Enter the payment amount.')
      if (payment.method === 'Cash') {
        if (!payment.tendered.trim()) throw new Error('Enter cash received, or tap Exact amount.')
        const paid = cents(Number(payment.amount)), received = cents(Number(payment.tendered))
        if (received < paid) throw new Error(`Cash received is short by ${money(paid - received)}.`)
      }
      paymentAmounts(Number(payment.amount), Number(payment.method === 'Cash' ? payment.tendered : payment.amount), payment.method, balance)
    } catch (error) {
      setPaymentError(message(error)); requestAnimationFrame(() => paymentErrorRef.current?.focus()); return
    }
    await action.run(async () => {
      if (payment.method === 'Pay later') return
      try {
        await laundryApi.pay(order.id, { requestKey: payKey.current, method: payment.method, amount: Number(payment.amount), tendered: Number(payment.method === 'Cash' ? payment.tendered : payment.amount), reference: payment.reference })
      } catch (error) {
        setPaymentError(message(error)); requestAnimationFrame(() => paymentErrorRef.current?.focus()); return
      }
      close(); setHistoryFilter('payment'); await data.reload(); notify('Payment applied.')
      if (payment.method === 'Cash') await openLaundryDrawer(notify)
      await print.run(async () => {
        setPrintingDocument('receipt')
        try { await autoPrintLaundryReceipt(order.id, notify, 'payment') }
        finally { setPrintingDocument(null) }
      })
    })
  }
  async function updateStatus(close: () => void) {
    if (!order || !selected) return
    await action.run(async () => {
      try { await laundryApi.status(order.id, selected, correcting ? reason : '', { correction: correcting, confirmed: selected === 'Completed', expectedVersion: statusVersion }) }
      catch (error) { setStatusError(message(error)); return }
      close(); setHistoryFilter('status'); await data.reload(); notify(correcting ? 'Status corrected. History retained.' : selected === 'Completed' ? 'Pickup completed.' : 'Order marked ready for pickup.')
    })
  }
  function primaryAction(className: string) {
    return !cancelled && collectBeforePickup ? <Button disabled={blocked} onClick={openPayment} className={className}><Wallet size={20} aria-hidden="true" />Collect payment</Button>
      : !cancelled && nextStatus ? <Button disabled={blocked} onClick={() => openStatus()} className={className}><PackageCheck size={20} aria-hidden="true" />{nextStatus === 'Completed' ? 'Complete pickup' : 'Mark ready for pickup'}</Button>
      : !cancelled && balance > 0 ? <Button disabled={blocked} onClick={openPayment} className={className}><Wallet size={20} aria-hidden="true" />Collect payment</Button>
      : <Button onClick={receiptPreview} className={className}><ReceiptText size={20} aria-hidden="true" />View receipt</Button>
  }
  return <div className={`laundry-screen laundry-order-detail laundry-detail-page ${order && !data.error ? 'laundry-mobile-has-bar' : ''}`}>
    <nav className="od-toolbar" aria-label="Order navigation"><ButtonLink to="/laundry/orders" variant="ghost" className="od-back"><ArrowLeft size={18} aria-hidden="true" />Back to orders</ButtonLink>
      <div className="od-toolbar-actions"><Button variant="secondary" className="od-refresh" disabled={blocked} aria-label="Refresh order" title="Refresh order" onClick={() => void data.reload()}><RefreshCw size={18} aria-hidden="true" className={data.loading ? 'od-spin' : ''} /></Button>
        {order && !data.error && <Button variant="secondary" className="od-refresh" disabled={blocked} aria-label="More actions" title="More actions" onClick={() => setDialog('more')}><Ellipsis size={20} aria-hidden="true" /></Button>}</div></nav>
    {(!order || data.error) && <LaundryLoad {...data} retry={data.reload} />}
    <p className="sr-only" role="status">{data.loading && order ? 'Refreshing order…' : ''}</p>
    {order && !data.error && <>
      <section className="od-counter" aria-label="Order overview" aria-busy={data.loading}>
        <header className="od-counter-identity"><div className="od-identity-main"><p className="od-eyebrow">LAUNDRY ORDER</p><h1>{order.order_number}</h1><p className="od-customer"><UserRound size={17} aria-hidden="true" />{order.customer_name}</p></div>
          <div className="od-identity-actions">{cancelled ? <span className="od-archived-label">Archived · Read-only</span> : <StatusBadge status={order.status} />}{primaryAction('od-primary-action od-primary-inline')}</div>
        </header>
        <dl className="od-order-meta">
          <div><dt><CalendarDays size={15} aria-hidden="true" />Received</dt><dd><time dateTime={order.created_at}>{dateTime(order.created_at)}</time></dd></div>
          <div><dt><Clock3 size={15} aria-hidden="true" />Scheduled pickup</dt><dd>{order.pickup_at ? <time dateTime={order.pickup_at}>{dateTime(order.pickup_at)}</time> : 'No pickup scheduled'}</dd></div>
          <div><dt><Phone size={15} aria-hidden="true" />Customer phone</dt><dd>{order.customer_phone ? <a href={`tel:${order.customer_phone.replace(/[^+\d]/g, '')}`}>{order.customer_phone}</a> : 'No phone recorded'}</dd></div>
        </dl>
        {!cancelled && <ol className="od-progress" aria-label="Order progress">{LAUNDRY_STATUSES.map((status, index) => <li key={status} className={index < currentStep ? 'is-done' : index === currentStep ? 'is-current' : ''} aria-current={index === currentStep ? 'step' : undefined}>
          <span className="od-step-marker" aria-hidden="true">{index < currentStep || order.status === 'Completed' ? <Check size={16} /> : index + 1}</span><span><strong>{status === 'Completed' ? 'Picked up' : status}</strong><small>{index < currentStep || order.status === 'Completed' ? 'Done' : index === currentStep ? 'Current stage' : 'Next stage'}</small></span>
        </li>)}</ol>}
        <p className={`od-next-step ${cancelled ? 'is-archived' : order.status === 'Completed' && balance <= 0 ? 'is-complete' : ''}`}><CircleCheck size={17} aria-hidden="true" />{nextStepHint}</p>
      </section>
      <div className="od-workspace">
        <aside className="od-summary" aria-label="Order payment and documents">
          <DetailCard title="Payment summary" icon={Wallet} className="od-payment-card" aside={<span className={`od-payment-state ${!cancelled && balance <= 0 ? 'is-paid' : ''}`}>{paymentLabel}</span>}>
            <div className={`od-balance-focus ${cancelled ? 'is-archived' : balance <= 0 ? 'is-settled' : ''}`}><span>{cancelled ? 'Balance closed' : balance > 0 ? 'Balance due' : 'Fully paid'}</span><strong>{cancelled ? '—' : money(Math.max(0, balance))}</strong><p>{cancelled ? 'Archived balances are closed.' : balance > 0 ? 'Remaining to collect from the customer' : 'No remaining balance on this order'}</p></div>
            <OrderPaymentBreakdown order={order} />
            {!cancelled && <div className="od-payment-progress"><div><span>Payment collected</span><strong>{Math.round(paidPercent)}%</strong></div><div className="od-payment-track" role="progressbar" aria-label="Payment collected" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(paidPercent)} aria-valuetext={`${money(order.paid_cents)} of ${money(order.total_cents)} collected`}><span style={{ width: `${paidPercent}%` }} /></div></div>}
            {!cancelled && balance > 0 && <Button className="od-collect-button" disabled={blocked} onClick={openPayment}><Wallet size={18} aria-hidden="true" />Collect payment</Button>}
            <p className="od-payment-note">{cancelled ? 'Historical payments are available in order activity.' : order.payments.length ? `${order.payments.length} ${order.payments.length === 1 ? 'payment' : 'payments'} recorded · Payment and pickup are tracked separately.` : 'No payments yet. Payment and pickup are tracked separately.'}</p>
          </DetailCard>
          <DetailCard title="Receipt & laundry tag" icon={ReceiptText} className="od-documents">
            <Button variant="secondary" className="od-preview-button" onClick={receiptPreview}><ReceiptText size={17} aria-hidden="true" />View receipt<ArrowRight size={16} aria-hidden="true" /></Button>
            <div className="od-print-actions"><Button variant="ghost" aria-label="Print receipt" aria-busy={printingDocument === 'receipt'} disabled={blocked} onClick={() => void printDocument()}>{printingDocument === 'receipt' ? <RefreshCw size={17} className="od-spin" aria-hidden="true" /> : <Printer size={17} aria-hidden="true" />}{printingDocument === 'receipt' ? 'Printing…' : 'Print receipt'}</Button><Button variant="ghost" aria-label="Print tag" aria-busy={printingDocument === 'tag'} disabled={blocked} onClick={() => void printDocument(true)}>{printingDocument === 'tag' ? <RefreshCw size={17} className="od-spin" aria-hidden="true" /> : <Shirt size={17} aria-hidden="true" />}{printingDocument === 'tag' ? 'Printing…' : 'Print tag'}</Button></div>
          </DetailCard>
        </aside>
        <div className="od-main-content">
          <DetailCard title="Services & add-ons" icon={Shirt} className="od-services" aside={<span className="od-count">{lineCount} line {lineCount === 1 ? 'item' : 'items'}</span>}><OrderServices order={order} /></DetailCard>
          <OrderActivity order={order} filter="all" onFilter={setHistoryFilter} preview onViewAll={() => openHistory()} />
        </div>
      </div>
      {createPortal(<div className="od-action-dock" style={{ bottom: BOTTOM_NAV_HEIGHT }} role="group" aria-label="Primary order action"><div className="od-dock-summary"><span>{cancelled ? 'Archived order' : balance > 0 ? 'Balance due' : 'Paid in full'}</span><strong>{cancelled ? order.order_number : money(Math.max(0, balance))}</strong></div>{primaryAction('od-dock-primary')}</div>, document.body)}
      {dialog && createPortal(<BackLayer name="laundry-order-dialog" blocked={action.busy} onBack={() => setDialog(null)}>{close => <>
        {dialog === 'more' && <Modal title="More actions" description={order.order_number} panelClassName="laundry-dialog-panel od-dialog od-menu-dialog" onClose={close}>
          <div className="od-menu-actions">
            <Button variant="secondary" onClick={() => openHistory(true)}><History size={18} aria-hidden="true" />Payment & status history<ArrowRight size={16} aria-hidden="true" /></Button>
            <Button variant="secondary" onClick={receiptPreview}><ReceiptText size={18} aria-hidden="true" />Receipt preview<ArrowRight size={16} aria-hidden="true" /></Button>
            {!cancelled && can('sales.void') && <Button variant="secondary" disabled={blocked} onClick={() => openStatus(true)}><PackageCheck size={18} aria-hidden="true" />Correct status<ArrowRight size={16} aria-hidden="true" /></Button>}
          </div>
        </Modal>}
        {dialog === 'history' && <Modal title="Order history" description={order.order_number} mobileFullScreen panelClassName="laundry-dialog-panel od-dialog" onClose={close}
          footer={<Button variant="secondary" className="od-return-actions" onClick={() => historyFromMenu ? setDialog('more') : close()}>{historyFromMenu && <ArrowLeft size={16} aria-hidden="true" />}{historyFromMenu ? 'Back to actions' : 'Done'}</Button>}><OrderActivity order={order} filter={historyFilter} onFilter={setHistoryFilter} /></Modal>}
        {dialog === 'payment' && <Modal title="Apply payment" description={`${order.order_number} · ${order.customer_name}`} mobileFullScreen panelClassName="laundry-dialog-panel od-dialog lp-payment-dialog" preventClose={action.busy} onClose={close}
          footer={<><Button variant="secondary" disabled={action.busy} onClick={close}>Cancel</Button><Button type="submit" form={paymentFormId} disabled={action.busy} className="laundry-dialog-primary lp-apply-button"><span>{action.busy ? 'Applying…' : 'Apply payment'}</span>{amountToApply !== null && <strong>{money(amountToApply)}</strong>}</Button></>}>
          <form id={paymentFormId} noValidate onSubmit={event => { event.preventDefault(); void recordPayment(close) }}><fieldset disabled={action.busy} className="laundry-stack laundry-payment-form"><legend className="sr-only">Payment details</legend>
            {paymentError && <div className="laundry-error" role="alert" tabIndex={-1} ref={paymentErrorRef}>{paymentError}</div>}
            <PaymentFields value={payment} onChange={value => { setPayment(value); setPaymentError('') }} balance={balance} allowLater={false} />
          </fieldset></form>
        </Modal>}
        {dialog === 'status' && <Modal title={correcting ? 'Correct order status' : selected === 'Completed' ? 'Complete pickup' : 'Mark ready for pickup'} description={`${order.order_number} · ${order.customer_name}`} mobileFullScreen panelClassName="laundry-dialog-panel od-dialog" preventClose={action.busy} onClose={close}
          footer={<><Button variant="secondary" disabled={action.busy} onClick={close}>Back</Button><Button form={statusFormId} type="submit" disabled={action.busy || completionBlocked || (correcting && reason.trim().length < 3)} className="laundry-dialog-primary">{action.busy ? 'Updating…' : selected === 'Completed' ? 'Confirm pickup' : correcting ? 'Confirm correction' : 'Mark as Ready for Pickup'}</Button></>}>
          <form id={statusFormId} onSubmit={event => { event.preventDefault(); void updateStatus(close) }}><fieldset disabled={action.busy} className="laundry-stack laundry-payment-form"><legend className="sr-only">Order status</legend>
            <div className="od-transition"><div><span>Current status</span><StatusBadge status={order.status} /></div><ArrowRight size={18} aria-hidden="true" /><div><span>New status</span>{selected && <StatusBadge status={selected} />}</div></div>
            {statusError && <p className="laundry-error" role="alert">{statusError}</p>}
            {correcting && <><label className="laundry-field"><span>Correct status</span><select value={selected} onChange={event => { setNext(event.target.value as LaundryStatus); setStatusError('') }}>{LAUNDRY_STATUSES.filter(status => status !== order.status).map(status => <option key={status}>{status}</option>)}</select></label><label className="laundry-field"><span>Reason for correction</span><textarea required minLength={3} maxLength={1000} rows={3} value={reason} onChange={event => setReason(event.target.value)} placeholder="Explain what was selected incorrectly…" /></label><p className="od-help">Your name, the original status and the reason stay in order history. Payments are unchanged.</p></>}
            {selected === 'Completed' ? <><p className="od-dialog-notice"><CircleCheck size={18} aria-hidden="true" />Confirm only after the customer has collected the laundry.</p>{balance > 0 ? <p className={`od-dialog-notice ${completionBlocked ? 'is-warning' : ''}`}><Wallet size={18} aria-hidden="true" /><span>Balance due: <strong>{money(balance)}</strong>. {completionBlocked ? 'Shop policy requires payment before pickup can be completed. Go back to collect payment.' : 'Shop policy allows completion. This balance remains due and can be collected later.'}</span></p> : <p className="od-help">Payment is settled.</p>}</> : !correcting && <p className="od-help">Mark ready when this order can be collected. Payment is tracked separately.</p>}
          </fieldset></form>
        </Modal>}
        {dialog === 'receipt' && <Modal title="Receipt preview" description={order.order_number} mobileFullScreen panelClassName="laundry-dialog-panel od-dialog" onClose={close}
          footer={<><Button variant="secondary" onClick={close}>Close</Button><Button onClick={() => void printDocument()} disabled={blocked} className="laundry-dialog-primary"><Printer size={16} aria-hidden="true" />{print.busy ? 'Printing…' : 'Print receipt'}</Button></>}>
          <LaundryReceiptPreview order={order} settings={settings} />
        </Modal>}
      </>}</BackLayer>, document.body)}

    </>}
  </div>
}
