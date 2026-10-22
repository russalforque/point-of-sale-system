import { useCallback, useEffect, useId, useRef, useState, type InputHTMLAttributes, type ReactNode } from 'react'
import { Banknote, Check, Clock3, Smartphone } from 'lucide-react'
import { useSettings } from '../../context/SettingsContext'
import { useToast } from '../../context/ToastContext'
import { Spinner } from '../ui/States'
import { Button, ButtonLink } from '../ui/Button'
import { Field, Input } from '../ui/Field'
import { Panel } from '../ui/WorkPage'
import type { LaundryMethod, LaundryOrder } from '../../types/laundry'
import { cents } from '../../services/laundryMath'
import './laundry.css'
import './payment.css'

export const message = (error: unknown) =>
  error instanceof Error ? error.message : 'Unable to complete this action. Try again.'
/** Latest query wins when a cashier changes search/date filters quickly. */
export function useLaundryQuery<T>(loader: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState<string | null>(null)
  const generation = useRef(0)
  const reload = useCallback(async () => {
    const token = ++generation.current
    setLoading(true)
    setError(null)
    try {
      const result = await loader()
      if (token === generation.current) setData(result)
    } catch (err) {
      if (token === generation.current) setError(message(err))
    } finally {
      if (token === generation.current) setLoading(false)
    }
    // Each caller supplies all query parameters; the loader itself changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(() => {
    void reload()
    return () => {
      generation.current += 1
    }
  }, [reload])
  return { data, loading, error, reload }
}
export function useLaundryAction() {
  const locked = useRef(false),
    [busy, setBusy] = useState(false)
  const { notify } = useToast()
  async function run(action: () => Promise<void>) {
    if (locked.current) return
    locked.current = true
    setBusy(true)
    try {
      await action()
    } catch (error) {
      notify(message(error), 'error')
    } finally {
      locked.current = false
      setBusy(false)
    }
  }
  return { busy, run }
}
export function useLaundryMoney() {
  const { settings } = useSettings()
  return (value: number) =>
    `${settings.currencySymbol}${(value / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
export function LaundryPage({
  title,
  subtitle,
  children,
  actions,
  className = '',
}: {
  title: string
  subtitle?: string
  children: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <div className={`laundry-screen ${className}`}>
      <header className="laundry-header">
        <div>
          <h1>{title}</h1>
          {subtitle && <p className="laundry-muted">{subtitle}</p>}
        </div>
        <div className="laundry-actions">{actions}</div>
      </header>
      {children}
    </div>
  )
}
export function LaundryCard({ title, children, className = '' }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <Panel title={title} className={`laundry-card ${className}`}>{children}</Panel>
  )
}
export function LaundryField({ label, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <div className="laundry-field"><Field label={label}><Input {...props} /></Field></div>
  )
}
export function StatusBadge({ status }: { status: string }) {
  const tone =
    status === 'Cancelled'
      ? 'cancelled'
      : status === 'Completed'
        ? 'completed'
        : status === 'Ready for Pickup'
          ? 'ready'
          : ''
  return <span className={`laundry-status ${tone}`}>{status}</span>
}
export function LaundryPaymentStatus({ order }: { order: LaundryOrder }) {
  const money = useLaundryMoney()
  const balance = order.total_cents - order.paid_cents
  return <p className="laundry-muted">{order.status === 'Cancelled' ? 'Cancelled' : balance === 0
    ? 'Paid in full' : `${order.paid_cents ? 'Partial' : 'Unpaid'} · Balance ${money(balance)}`}</p>
}
export function LaundryLoad({
  loading,
  error,
  retry,
}: {
  loading: boolean
  error: string | null
  retry: () => Promise<void>
}) {
  return loading ? (
    <Spinner />
  ) : error ? (
    <div role="alert" className="laundry-error">
      {error}
      <Button variant="secondary" onClick={() => void retry()}>
        Retry
      </Button>
    </div>
  ) : null
}
export function LaundryQuickLinks() {
  return (
    <div className="laundry-actions">
      <ButtonLink variant="primary" to="/laundry/new">
        New order
      </ButtonLink>
      <ButtonLink to="/laundry/orders">
        View orders
      </ButtonLink>
      <ButtonLink to="/customers">
        Customers
      </ButtonLink>
    </div>
  )
}
export type PaymentForm = {
  method: LaundryMethod | 'Pay later'
  amount: string
  tendered: string
  reference: string
}
export const emptyPayment: PaymentForm = { method: 'Pay later', amount: '', tendered: '', reference: '' }
export function PaymentFields({
  value,
  onChange,
  balance,
  allowLater = true,
}: {
  value: PaymentForm
  onChange: (value: PaymentForm) => void
  balance: number
  allowLater?: boolean
}) {
  const money = useLaundryMoney()
  const { settings } = useSettings(), fieldId = useId()
  let amount: number | null = null, received: number | null = null, amountError = '', receivedError = ''
  if (value.amount.trim()) {
    try {
      amount = cents(Number(value.amount))
      if (amount <= 0) amountError = 'Enter a payment amount above zero.'
      else if (amount > balance) amountError = `Payment cannot exceed ${money(balance)}.`
    } catch (error) { amountError = message(error) }
  }
  if (value.tendered.trim()) {
    try { received = cents(Number(value.tendered)) }
    catch (error) { receivedError = message(error) }
  }
  const validAmount = amount !== null && !amountError
  const cashCovered = validAmount && received !== null && !receivedError && received >= amount!
  const remaining = validAmount ? balance - amount! : null
  const methods: PaymentForm['method'][] = allowLater ? ['Pay later', 'Cash', 'GCash', 'Maya'] : ['Cash', 'GCash', 'Maya']
  return <div className="lp-payment">
    <div className="lp-balance"><span>Balance due</span><strong>{money(balance)}</strong></div>
    <fieldset className={`lp-methods ${allowLater ? 'lp-methods-with-later' : ''}`}><legend>Payment method</legend>
      <div className="lp-method-grid">{methods.map(method => {
        const Icon = method === 'Cash' ? Banknote : method === 'Pay later' ? Clock3 : Smartphone
        return <label className="lp-method" key={method}>
          <input type="radio" name={`${fieldId}-method`} value={method} checked={value.method === method} onChange={() => onChange({ ...value, method, amount: value.amount || String(balance / 100) })} />
          <span><Icon size={19} aria-hidden="true" /><strong>{method}</strong>{value.method === method && <Check size={14} className="lp-method-check" aria-hidden="true" />}</span>
        </label>
      })}</div>
    </fieldset>
    {value.method === 'Pay later' ? <p className="lp-later-note">No payment now. Collect the balance from order details when the customer pays.</p> : <>
      <div className="lp-input-grid">
        <div className="lp-entry"><div className="lp-entry-heading"><label htmlFor={`${fieldId}-amount`}>Payment amount</label><button type="button" onClick={() => onChange({ ...value, amount: (balance / 100).toFixed(2) })}>Full balance</button></div>
          <div className={`lp-money-input ${amountError ? 'has-error' : ''}`}><span aria-hidden="true">{settings.currencySymbol}</span><input id={`${fieldId}-amount`} name="paymentAmount" type="number" inputMode="decimal" min="0.01" max={balance / 100} step="0.01" required value={value.amount} placeholder="0.00" aria-invalid={!!amountError} aria-describedby={`${fieldId}-amount-help`} onFocus={event => event.target.select()} onChange={event => onChange({ ...value, amount: event.target.value })} /></div>
          <p id={`${fieldId}-amount-help`} className={amountError ? 'lp-field-error' : 'lp-input-help'}>{amountError || 'Amount to deduct from this order’s balance.'}</p>
        </div>
        {value.method === 'Cash' ? <div className="lp-entry"><div className="lp-entry-heading"><label htmlFor={`${fieldId}-received`}>Cash received</label><button type="button" disabled={!validAmount} onClick={() => onChange({ ...value, tendered: (amount! / 100).toFixed(2) })}>Exact amount</button></div>
          <div className={`lp-money-input ${receivedError ? 'has-error' : ''}`}><span aria-hidden="true">{settings.currencySymbol}</span><input id={`${fieldId}-received`} name="cashReceived" type="number" inputMode="decimal" min="0" step="0.01" required value={value.tendered} placeholder="0.00" aria-invalid={!!receivedError} aria-describedby={`${fieldId}-received-help`} onFocus={event => event.target.select()} onChange={event => onChange({ ...value, tendered: event.target.value })} /></div>
          <p id={`${fieldId}-received-help`} className={receivedError ? 'lp-field-error' : 'lp-input-help'}>{receivedError || (validAmount && received !== null && received < amount! ? `Need ${money(amount! - received)} more to cover this payment.` : 'Cash the customer handed to you.')}</p>
        </div> : <div className="lp-entry lp-reference"><div className="lp-entry-heading"><label htmlFor={`${fieldId}-reference`}>Reference <span>(optional)</span></label></div><input id={`${fieldId}-reference`} type="text" maxLength={120} autoComplete="off" placeholder="Transaction reference" value={value.reference} onChange={event => onChange({ ...value, reference: event.target.value })} /></div>}
      </div>
      <dl className={`lp-results ${value.method !== 'Cash' ? 'lp-results-digital' : ''}`} aria-live="polite" aria-atomic="true">
        {value.method === 'Cash' && <div className="lp-change"><dt>Change to give</dt><dd>{cashCovered ? money(received! - amount!) : '—'}</dd></div>}
        <div><dt>Balance after payment</dt><dd>{remaining !== null ? money(remaining) : '—'}</dd></div>
      </dl>
      {value.method !== 'Cash' && <p className="lp-wallet-note">Confirm the transfer in {value.method} before applying payment. This records the transfer; it does not verify it.</p>}
    </>}
  </div>
}
