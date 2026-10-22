import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { createPortal } from 'react-dom'
import {
  ArrowLeft, ArrowRight, CalendarDays, Check, CheckCheck, ChevronRight,
  ClipboardList, Droplets, Minus, PackagePlus, Phone, Plus, Printer,
  ReceiptText, Shirt, ShoppingBag, UserPlus, UserRound, Wallet,
} from 'lucide-react'
import { customerApi } from '../../api/customerApi'
import { laundryPricingApi } from '../../api/laundryPricingApi'
import { laundryDiscountLineEligible, laundryDiscountReason, laundryDiscountTotals, laundryPricingKey } from '../../services/laundryDiscounts'
import { DiscountAmountInput } from '../../components/pos/DiscountControl'
import { useSettings } from '../../context/SettingsContext'
import { laundryApi } from '../../api/laundryApi'
import { useDebounced } from '../../hooks/useDebounced'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import {
  LaundryField, LaundryLoad, PaymentFields, emptyPayment,
  useLaundryAction, useLaundryMoney, useLaundryQuery as useAsync, type PaymentForm,
} from '../../components/laundry/LaundryUI'
import { Button, ButtonLink } from '../../components/ui/Button'
import { SearchBox, PillGroup } from '../../components/ui/WorkPage'
import { paymentAmounts, priceLines } from '../../services/laundryMath'
import type { Customer } from '../../types'
import type { LaundryCatalog, LaundrySelection } from '../../types/laundry'
import { autoPrintLaundryReceipt, openLaundryDrawer } from '../../services/printer/laundryPrinting'
import './new-order.css'

const unitLabels: Record<string, string> = { kg: 'kg', load: 'load', piece: 'piece', quantity: 'item', fixed: 'item' }
type WizardStep = 0 | 1 | 2 | 3

function OrderSection({ id, step, title, subtitle, action, children, hidden = false }: {
  id: string; step: string; title: string; subtitle: string; action?: ReactNode; children: ReactNode; hidden?: boolean
}) {
  return <section className="lno-section" id={id} tabIndex={-1} aria-labelledby={`${id}-title`} hidden={hidden}>
    <div className="lno-section-header">
      <span className="lno-step-number" aria-hidden="true">{step}</span>
      <div className="lno-section-heading"><h2 id={`${id}-title`}>{title}</h2><p>{subtitle}</p></div>
      {action}
    </div>
    <div className="lno-section-body">{children}</div>
  </section>
}

function CatalogPicker({ entries, selected, onChange, kind }: {
  entries: LaundryCatalog[]; selected: LaundrySelection[]
  onChange: (rows: LaundrySelection[]) => void; kind: 'service' | 'addon'
}) {
  const money = useLaundryMoney()
  const [search, setSearch] = useState(''), [category, setCategory] = useState('')
  const categories = [...new Set(entries.map(row => row.category?.trim()).filter((value): value is string => !!value))]
  const visible = entries.filter(row => row.name.toLowerCase().includes(search.trim().toLowerCase()) && (!category || row.category?.trim() === category))
  function updateQuantity(id: number, quantity: number) {
    onChange(selected.map(row => row.id === id ? { ...row, quantity } : row))
  }
  return <div className="lno-catalog">
    {entries.length > 6 && <SearchBox value={search} onChange={setSearch} label={kind === 'service' ? 'Search services' : 'Search add-ons'} placeholder={kind === 'service' ? 'Find a laundry service…' : 'Find an add-on…'} />}
    {!!categories.length && <PillGroup label={kind === 'service' ? 'Service categories' : 'Add-on categories'} value={category} onChange={setCategory}
      options={[{ key: '', label: 'All' }, ...categories.map(key => ({ key, label: key }))]} />}
    <div className="lno-catalog-grid">
      {visible.map(entry => {
        const line = selected.find(row => row.id === entry.id)
        let lineTotal = '—'
        if (line) {
          try { lineTotal = money(priceLines([line], [entry])[0]!.total_cents) } catch { /* Keep invalid edits visible until corrected. */ }
        }
        const Icon = kind === 'addon' ? PackagePlus : entry.pricing === 'kg' ? Droplets : Shirt
        return <div className={`lno-service ${line ? 'is-selected' : ''}`} key={entry.id}>
          <label className="lno-service-label">
            <input type="checkbox" checked={!!line} onChange={e => onChange(e.target.checked
              ? [...selected, { id: entry.id, quantity: 1 }] : selected.filter(row => row.id !== entry.id))} />
            <span className="lno-service-icon" aria-hidden="true"><Icon size={20} /></span>
            <span className="lno-service-name"><strong>{entry.name}</strong><span>{money(entry.price_cents)}{entry.pricing === 'fixed' ? ' · fixed price' : ` / ${unitLabels[entry.pricing] ?? entry.pricing}`}</span></span>
          </label>
          {line && <div className="lno-service-detail">
            {entry.pricing === 'fixed' ? <span className="lno-fixed-note"><Check size={14} aria-hidden="true" />Added to order</span> : <div className="lno-quantity">
              {entry.pricing !== 'kg' && <button type="button" className="lno-quantity-button" aria-label={`Decrease quantity for ${entry.name}`} disabled={!Number.isFinite(line.quantity) || line.quantity <= 1} onClick={() => updateQuantity(entry.id, line.quantity - 1)}><Minus size={15} aria-hidden="true" /></button>}
              <LaundryField label={entry.pricing === 'kg' ? 'Weight (kg)' : 'Quantity'}
                aria-label={`${entry.pricing === 'kg' ? 'Weight (kg)' : 'Quantity'} for ${entry.name}`}
                type="number" inputMode={entry.pricing === 'kg' ? 'decimal' : 'numeric'} required
                min={entry.pricing === 'kg' ? '0.001' : '1'} max="10000" step={entry.pricing === 'kg' ? '0.001' : '1'}
                value={Number.isNaN(line.quantity) ? '' : line.quantity}
                onFocus={e => e.target.select()}
                onChange={e => updateQuantity(entry.id, e.target.value === '' ? NaN : Number(e.target.value))} />
              {entry.pricing !== 'kg' && <button type="button" className="lno-quantity-button" aria-label={`Increase quantity for ${entry.name}`} disabled={!Number.isFinite(line.quantity) || line.quantity >= 10000} onClick={() => updateQuantity(entry.id, line.quantity + 1)}><Plus size={15} aria-hidden="true" /></button>}
            </div>}
            <div className="lno-line-total"><span>Line total</span><strong>{lineTotal}</strong></div>
          </div>}
        </div>
      })}
    </div>
    {!visible.length && <div className="lno-catalog-empty">
      <p>{entries.length ? 'No items match this search or category.' : kind === 'service' ? 'No active services available yet.' : 'No add-ons available. You can continue with services only.'}</p>
      {!!entries.length && <Button variant="ghost" onClick={() => { setSearch(''); setCategory('') }}>Clear filters</Button>}
    </div>}
  </div>
}

export function LaundryNewOrder() {
  const navigate = useNavigate(), location = useLocation(), money = useLaundryMoney(), { can } = useAuth(), { notify } = useToast()
  const wizardSession = useRef(crypto.randomUUID()), stepHeading = useRef<HTMLDivElement>(null), transitionLock = useRef(false)
  const wizardState = location.state?.laundryWizard as { session?: string; step?: number } | undefined
  // History steps belong to this mounted draft. Reloading starts a new order at Customer.
  const step: WizardStep = wizardState?.session === wizardSession.current && [0, 1, 2, 3].includes(wizardState.step ?? -1) ? wizardState.step as WizardStep : 0
  const reviewing = step === 2
  const paying = step === 3
  const notesId = useId()
  const manualDiscountId = useId(), { settings } = useSettings()
  const [discountIds, setDiscountIds] = useState<number[]>([])
  const [search, setSearch] = useState(''), [customer, setCustomer] = useState<Customer | null>(null),
    [choosing, setChoosing] = useState(true), [adding, setAdding] = useState(false),
    [name, setName] = useState('')
  const term = useDebounced(search), customers = useAsync(() => customerApi.lookup(term), [term])
  const pricing = useAsync(() => customer ? laundryPricingApi.context(customer.id) : Promise.resolve(null), [customer?.id])
  const discountContext = pricing.data?.customer_id === customer?.id ? pricing.data : null
  const catalog = useAsync(async () => {
    const [services, addons] = await Promise.all([laundryApi.catalog('services'), laundryApi.catalog('addons')])
    return { services, addons }
  }, [])
  const [items, setItems] = useState<LaundrySelection[]>([]), [addons, setAddons] = useState<LaundrySelection[]>([]),
    [discount, setDiscount] = useState('0'), [pickup, setPickup] = useState(''), [notes, setNotes] = useState(''),
    [payment, setPayment] = useState<PaymentForm>(emptyPayment), [attempted, setAttempted] = useState(false),
    [transitioning, setTransitioning] = useState(false), [printingReceipt, setPrintingReceipt] = useState(false)
  const request = useRef(crypto.randomUUID()), payKey = useRef(crypto.randomUUID()),
    action = useLaundryAction(), addCustomer = useLaundryAction(), errorRef = useRef<HTMLDivElement>(null)
  const canSaveCustomer = !!name.trim()
  let totals = { subtotal: 0, discount: 0, total: 0 }, serviceError = '', totalError = ''
  let appliedDiscounts: ReturnType<typeof laundryDiscountTotals>['applied'] = []
  let pricingKey = ''
  let lines: ReturnType<typeof priceLines> = [], extras: ReturnType<typeof priceLines> = []
  try {
    lines = priceLines(items, catalog.data?.services ?? [])
    extras = priceLines(addons, catalog.data?.addons ?? [])
  } catch (error) { serviceError = error instanceof Error ? error.message : 'Check service quantities.' }
  if (items.length && !serviceError) {
    try {
      if (pricing.loading || !discountContext || pricing.error) throw new Error('Refresh discount eligibility before continuing.')
      const calculated = laundryDiscountTotals(lines, extras, Number(discount), discountIds, discountContext)
      totals = calculated; appliedDiscounts = calculated.applied
      pricingKey = laundryPricingKey(lines, extras, discountContext, discountIds)
    }
    catch (error) { totalError = error instanceof Error ? error.message : 'Check the discount.' }
  }
  const calculationError = serviceError || totalError

  const customerValidation = adding ? 'Save or cancel the new customer details before continuing.'
    : !customer?.fullName.trim() ? 'Select a customer.'
    : ''
  const servicesValidation = !items.length ? 'Select at least one laundry service.' : serviceError
  const detailsValidation = customerValidation || servicesValidation
  let validation = detailsValidation || calculationError
  if (!validation && payment.method !== 'Pay later' && totals.total > 0) {
    try {
      paymentAmounts(Number(payment.amount), Number(payment.method === 'Cash' ? payment.tendered : payment.amount), payment.method, totals.total)
    } catch (error) {
      validation = error instanceof Error ? error.message : 'Check the payment.'
    }
  }
  async function save() {
    if (!paying || transitionLock.current || action.busy || addCustomer.busy) return
    setAttempted(true)
    if (customerValidation || servicesValidation) {
      goToStep(customerValidation ? 0 : 1)
      setAttempted(true)
      return
    }
    if (calculationError) {
      goToStep(2)
      setAttempted(true)
      return
    }
    if (validation) {
      requestAnimationFrame(() => errorRef.current?.focus())
      return
    }
    await action.run(async () => {
      if (!customer) return
      const paymentInput = payment.method === 'Pay later' || totals.total === 0 ? undefined : {
        requestKey: payKey.current, method: payment.method, amount: Number(payment.amount),
        tendered: Number(payment.method === 'Cash' ? payment.tendered : payment.amount), reference: payment.reference,
      }
      const id = await laundryApi.create({ requestKey: request.current, customerId: customer.id, items, addons,
        discount: Number(discount), discountIds, pricingKey, pickupAt: pickup || undefined, notes: notes || undefined, payment: paymentInput })
      notify('Laundry order saved.')
      if (paymentInput?.method === 'Cash') await openLaundryDrawer(notify)
      setPrintingReceipt(true)
      try { await autoPrintLaundryReceipt(id, notify) }
      finally { setPrintingReceipt(false) }
      navigate(`/laundry/orders/${id}`, { replace: true })
    })
  }
  async function createCustomer() {
    if (!canSaveCustomer) return
    await addCustomer.run(async () => {
      const saved = await customerApi.create({ fullName: name.trim(), isActive: true })
      setCustomer(saved); setChoosing(false); setAdding(false); setName(''); await customers.reload()
    })
  }
  useEffect(() => {
    if (!catalog.data) return
    const unlock = window.setTimeout(() => { transitionLock.current = false; setTransitioning(false) }, 400)
    const frame = requestAnimationFrame(() => {
      stepHeading.current?.focus({ preventScroll: true })
      document.getElementById('lno-wizard-start')?.scrollIntoView({ block: 'start' })
    })
    return () => { cancelAnimationFrame(frame); window.clearTimeout(unlock) }
  }, [step, catalog.data, location.key])
  function goToStep(target: WizardStep) {
    if (action.busy || addCustomer.busy || transitionLock.current) return
    setAttempted(false)
    if (target === step) return
    if (target < step) { transitionLock.current = true; setTransitioning(true); navigate(target - step); return }
    const error = customerValidation || (target >= 2 ? servicesValidation : '') || (target === 3 ? calculationError : '')
    if (error) {
      if (customerValidation && step > 0) { transitionLock.current = true; setTransitioning(true); navigate(-step) }
      setAttempted(true)
      requestAnimationFrame(() => errorRef.current?.focus())
      return
    }
    transitionLock.current = true
    setTransitioning(true)
    navigate(`${location.pathname}${location.search}`, { state: { ...location.state, laundryWizard: { session: wizardSession.current, step: target } } })
  }
  function nextStep() { if (step < 3) goToStep((step + 1) as WizardStep) }
  function previousStep() { if (step > 0) goToStep((step - 1) as WizardStep) }
  const totalLabel = calculationError || !items.length ? '—' : money(totals.total)
  const displayedError = paying ? validation : reviewing ? detailsValidation || calculationError : step === 0 ? customerValidation : servicesValidation
  const nextLabel = step === 0 ? 'Next: services' : step === 1 ? 'Review order' : 'Next: payment'
  const saveLabel = printingReceipt ? 'Printing receipt…' : action.busy ? 'Saving order…' : 'Save order'
  const footerLabel = step === 0 ? 'Customer' : 'Order total'
  const footerValue = step === 0 ? customer?.fullName ?? 'Not selected' : serviceError ? 'Check quantities' : totalError ? 'Check discount' : totalLabel
  const steps = [
    { label: 'Customer', title: 'Choose a customer', help: 'Find a customer or add someone new.', complete: !customerValidation, icon: UserRound },
    { label: 'Services', title: 'Choose services', help: 'Add services and enter the weight or quantity.', complete: !servicesValidation, icon: Shirt },
    { label: 'Review', title: 'Review your order', help: 'Check the customer, services and total before payment.', complete: !detailsValidation && !calculationError, icon: ReceiptText },
    { label: 'Payment', title: 'Payment & save', help: 'Collect payment now or choose Pay later, then save your order.', complete: false, icon: Wallet },
  ]

  return <div className={`laundry-screen laundry-new-order lno-wizard laundry-mobile-has-bar ${step >= 2 ? 'is-confirming' : 'is-editing'} ${reviewing ? 'is-reviewing' : paying ? 'is-paying' : ''}`} data-step={step}>
    <header className="lno-header">
      <div><p className="lno-eyebrow"><span /> LAUNDRY COUNTER</p><h1>New laundry order</h1><p className="lno-subtitle">Customer, services, review, then payment. Save when everything is ready.</p></div>
      <ButtonLink to="/laundry/orders"><ArrowLeft size={16} aria-hidden="true" />Back to orders</ButtonLink>
    </header>
    <LaundryLoad {...catalog} retry={catalog.reload} />
    {catalog.data && !catalog.error && <form id="laundry-new-order-form" noValidate onSubmit={e => {
      e.preventDefault()
      if (paying) void save()
      else nextStep()
    }} onKeyDown={e => {
      // Enter in a field must not advance the wizard or commit an order.
      if (e.key === 'Enter' && e.target instanceof HTMLInputElement) e.preventDefault()
    }}>
      <fieldset disabled={action.busy || addCustomer.busy} className="laundry-order-form">
        <legend className="sr-only">New laundry order details</legend>
        <nav className="lno-progress" id="lno-wizard-start" aria-label="Order steps">
          {steps.map(({ label, complete, icon: Icon }, index) => <button type="button" key={label} disabled={index > step || transitioning} className={`${index < step && complete ? 'is-complete' : ''} ${index === step ? 'is-current' : ''}`} aria-current={index === step ? 'step' : undefined} onClick={() => goToStep(index as WizardStep)}>
            <span className="lno-progress-icon">{index < step && complete ? <Check size={16} aria-hidden="true" /> : <Icon size={16} aria-hidden="true" />}</span><span>{label}</span>{index < step && complete && <span className="sr-only"> complete</span>}{index < steps.length - 1 && <ChevronRight size={14} className="lno-progress-chevron" aria-hidden="true" />}
          </button>)}
          <span className="lno-draft"><span /> Not saved yet</span>
        </nav>
        <div className="lno-flow-heading" id="lno-review-heading" tabIndex={-1} ref={stepHeading}>
          <div><p>Step {step + 1} of {steps.length}</p><h2>{steps[step]!.title}</h2><span>{steps[step]!.help}</span></div>
        </div>
        {attempted && displayedError && <div role="alert" className="laundry-error lno-flow-error" tabIndex={-1} ref={errorRef}>{displayedError}</div>}
        <div className="laundry-order-layout lno-layout">
          <div className="lno-main" hidden={step >= 2}>
            <OrderSection id="lno-customer" step="01" title="Customer" subtitle="Who are we taking care of today?" hidden={step !== 0}
              action={can('customers.create') && <Button variant="ghost" onClick={() => setAdding(!adding)} aria-expanded={adding} aria-controls="lno-add-customer"><UserPlus size={16} aria-hidden="true" />{adding ? 'Close new customer' : 'Add new customer'}</Button>}>
              {customer && <div className="lno-selected-customer">
                <span className="lno-customer-avatar" aria-hidden="true"><UserRound size={22} /></span>
                <div><strong>Selected: {customer.fullName}</strong>{customer.phone && <p><Phone size={13} aria-hidden="true" />{customer.phone}</p>}</div>
                <Button variant="ghost" onClick={() => { setChoosing(!choosing); setAdding(false) }}>{choosing ? 'Done' : 'Change'}</Button>
              </div>}
              {adding && <div className="lno-add-customer" id="lno-add-customer" onKeyDown={e => {
                if (e.key === 'Enter' && e.target instanceof HTMLInputElement) { e.preventDefault(); void createCustomer() }
              }}>
                <h3>New customer details</h3><p className="lno-help">Enter the customer's name to get started.</p>
                <div className="laundry-grid">
                  <LaundryField label="Customer name" required value={name} maxLength={100} autoComplete="name" autoFocus onChange={e => setName(e.target.value)} />
                </div>
                <div className="lno-inline-actions"><Button disabled={!canSaveCustomer || addCustomer.busy} onClick={() => void createCustomer()}><Check size={16} aria-hidden="true" />{addCustomer.busy ? 'Saving customer…' : 'Save customer'}</Button><Button variant="ghost" onClick={() => setAdding(false)}>Cancel</Button></div>
              </div>}
              {choosing && !adding && <div className="lno-customer-picker">
                <SearchBox label="Find a customer by name or phone" placeholder="Search by customer name or phone…" value={search} onChange={setSearch} />
                <LaundryLoad {...customers} retry={customers.reload} />
                {!customers.loading && !customers.error && <>
                  {!!customers.data?.length && <p className="lno-result-label">{search.trim() ? 'Matching customers' : 'Choose a customer'}</p>}
                  <div className="laundry-customer-results lno-customer-results">
                    {customers.data?.map(row => <button type="button" key={row.id} className={`lno-customer-option ${customer?.id === row.id ? 'is-selected' : ''}`}
                      aria-pressed={customer?.id === row.id} onClick={() => { setCustomer(row); setChoosing(false) }}>
                      <span className="lno-customer-avatar" aria-hidden="true"><UserRound size={17} /></span><span><strong>{row.fullName}</strong>{row.phone && <small>{row.phone}</small>}</span><Plus size={16} aria-hidden="true" />
                    </button>)}
                  </div>
                  {!customers.data?.length && <p className="lno-catalog-empty">No customers found. Try another name{can('customers.create') ? ' or add a new customer above.' : ' or contact number.'}</p>}
                </>}
              </div>}
            </OrderSection>
            <OrderSection id="lno-services" step="02" title="Services" subtitle="Choose a service, then enter the weight or quantity." hidden={step !== 1}
              action={<span className="lno-count">{items.length} selected</span>}>
              <CatalogPicker kind="service" entries={catalog.data.services} selected={items} onChange={setItems} />
              {!catalog.data.services.length && can('products.manage') && <ButtonLink to="/laundry/services" className="mt-3">Configure services<ArrowRight size={15} aria-hidden="true" /></ButtonLink>}
              <details className="lno-addon-options"><summary><PackagePlus size={18} aria-hidden="true" /><span>Add-ons <small>(optional)</small></span>{!!addons.length && <span className="lno-count">{addons.length} selected</span>}<ChevronRight size={17} aria-hidden="true" /></summary>
              <CatalogPicker kind="addon" entries={catalog.data.addons} selected={addons} onChange={setAddons} />
              </details>
            </OrderSection>
            <details className="lno-optional-details" hidden={step !== 1}><summary><CalendarDays size={18} aria-hidden="true" /><span>Pickup & notes <small>(optional)</small></span><ChevronRight size={17} aria-hidden="true" /></summary>
            <OrderSection id="lno-details" step="03" title="Pickup & notes" subtitle="A few details to keep every order on track.">
              <div className="lno-details-grid">
                <div><LaundryField label="Pickup date/time (optional)" type="datetime-local" value={pickup} onChange={e => setPickup(e.target.value)} /><p className="lno-help"><CalendarDays size={13} aria-hidden="true" />Leave blank if pickup hasn't been arranged.</p></div>
                <div className="lno-notes"><label className="laundry-field" htmlFor={notesId}><span>Order notes (optional)</span><textarea id={notesId} aria-describedby={`${notesId}-count`} maxLength={1000} rows={3} placeholder="Separate whites, delicate items, special requests…" value={notes} onChange={e => setNotes(e.target.value)} /></label><p id={`${notesId}-count`} className="lno-notes-count">{notes.length}/1,000 characters</p></div>
              </div>
            </OrderSection>
            </details>
          </div>
          <aside className="laundry-order-summary lno-summary" id="order-summary" aria-label={paying ? 'Order payment' : 'Order summary'} tabIndex={-1} hidden={step < 1}>
            <section className="lno-review" aria-labelledby="lno-summary-title" hidden={step === 0 || paying}>
              <header className="lno-review-header"><div className="lno-review-title"><ReceiptText size={19} aria-hidden="true" /><h2 id="lno-summary-title">Order summary</h2></div><Button variant="ghost" disabled={transitioning} onClick={() => goToStep(1)}>Edit services</Button></header>
              <div className="lno-review-customer"><UserRound size={15} aria-hidden="true" /><span>{customer ? customer.fullName : 'No customer selected'}</span>{customer?.phone && <small>{customer.phone}</small>}<button type="button" disabled={transitioning} onClick={() => goToStep(0)}>Edit customer</button></div>
              <div className="lno-summary-lines">
                {[...lines.map(line => ({ ...line, kind: 'service' })), ...extras.map(line => ({ ...line, kind: 'addon' }))].map(line => <div className="lno-summary-line" key={`${line.kind}-${line.id}`}>
                  <div><strong>{line.name}</strong><small>{line.quantity_milli / 1000} {unitLabels[line.pricing] ?? line.pricing} × {money(line.price_cents)}</small></div><span>{money(line.total_cents)}</span>
                </div>)}
                {!items.length && <div className="lno-summary-empty"><ShoppingBag size={27} aria-hidden="true" /><strong>{addons.length ? 'Add a laundry service' : 'Your order is waiting'}</strong><p>{addons.length ? 'Choose at least one service to complete this order.' : 'Select a service to see your breakdown here.'}</p></div>}
              </div>
              <div className="lno-summary-totals">
                <div className="lno-subtotal"><span>Subtotal</span><strong>{calculationError || !items.length ? '—' : money(totals.subtotal)}</strong></div>
                <div className="lno-discounts">
                  <div className="lno-discount-heading"><strong>Discounts</strong><Button variant="ghost" disabled={pricing.loading || catalog.loading} onClick={() => void Promise.all([pricing.reload(), catalog.reload()])}>Refresh prices & discounts</Button></div>
                  <LaundryLoad {...pricing} retry={pricing.reload} />
                  {discountContext && <><p className="lno-help">{discountContext.visits} qualifying {discountContext.visits === 1 ? 'visit' : 'visits'} · Next visit {discountContext.visits + 1}</p><p className="lno-help">Counts {discountContext.rules.visit_status === 'Completed' ? 'completed' : 'ready or completed'} orders{discountContext.rules.visit_require_paid ? ', fully paid' : ''}. Minimum {money(discountContext.rules.visit_minimum_cents)} {discountContext.rules.visit_basis === 'subtotal' ? 'before' : 'after'} discounts.</p>
                    <div className="lno-discount-options">{discountContext.discounts.map(rule => {
                      const reason = laundryDiscountReason(rule, discountContext) || (!lines.some(line => line.total_cents > 0 && laundryDiscountLineEligible(rule, line, 0)) && !extras.some(line => line.total_cents > 0 && laundryDiscountLineEligible(rule, line, 1)) ? 'Add an eligible service or add-on.' : ''), selected = discountIds.includes(rule.id)
                      return <button type="button" key={rule.id} aria-pressed={selected} disabled={!!reason && !selected} className={selected ? 'is-selected' : ''} onClick={() => {
                        if (selected) setDiscountIds(ids => ids.filter(id => id !== rule.id))
                        else { setDiscountIds(ids => discountContext.rules.allow_stacking && rule.stackable && ids.every(id => discountContext.discounts.find(row => row.id === id)?.stackable) ? [...ids, rule.id] : [rule.id]); if (!discountContext.rules.allow_stacking || !rule.stackable) setDiscount('0') }
                      }}><span><strong>{rule.name}</strong><small>{reason || rule.eligibility_note || `Applies to ${rule.scope === 'order' ? 'the order' : rule.scope}`}</small></span><b>{rule.kind === 'percent' ? `${rule.value / 100}%` : money(rule.value)}</b>{selected && <Check size={16} aria-hidden="true" />}</button>
                    })}</div></>}
                  {!!discountIds.length && <Button variant="ghost" onClick={() => setDiscountIds([])}>Remove selected discounts</Button>}
                  <div className="lno-manual-discount"><label htmlFor={manualDiscountId}>Discount amount</label><DiscountAmountInput id={manualDiscountId} value={discount} onChange={value => { setDiscount(value); if (Number(value) > 0 && (!discountContext?.rules.allow_stacking || discountIds.some(id => !discountContext.discounts.find(row => row.id === id)?.stackable))) setDiscountIds([]) }} currencySymbol={settings.currencySymbol} /></div>
                  {appliedDiscounts.map((rule, index) => <div className="lno-subtotal" key={index}><span>{rule.name}</span><strong>−{money(rule.amount_cents)}</strong></div>)}
                </div>
                <p className="lno-help">Manual discounts follow the store limit. Named discounts follow shop rules.</p>
              </div>
              <div className="lno-grand-total" aria-live="polite" aria-atomic="true"><div><span>Order total</span><small>{items.length} {items.length === 1 ? 'service' : 'services'}{addons.length ? ` · ${addons.length} add-on${addons.length === 1 ? '' : 's'}` : ''}</small></div><strong>{totalLabel}</strong></div>
              {calculationError && <p className="laundry-error lno-calculation-error" role="alert">{calculationError}</p>}
              {pickup && <p className="lno-pickup-summary"><CalendarDays size={14} aria-hidden="true" />Pickup: {new Date(pickup).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>}
              {reviewing && notes.trim() && <div className="lno-review-notes"><strong>Order notes</strong><p>{notes}</p></div>}
            </section>
            {paying && <section className="lno-payment" aria-labelledby="lno-payment-title">
              <div className="lno-payment-heading"><Wallet size={18} aria-hidden="true" /><h2 id="lno-payment-title">Payment</h2><span className="lno-optional">Collect now or later</span></div>
              {items.length && totals.total === 0 && !calculationError ? <p className="lno-payment-note"><CheckCheck size={18} aria-hidden="true" />No payment required for this order.</p>
                : <><fieldset className="lno-payment-fields" disabled={!items.length || !!calculationError}><legend className="sr-only">Payment details</legend><PaymentFields value={payment} onChange={setPayment} balance={totals.total} /></fieldset>{!items.length ? <p className="lno-payment-note"><ShoppingBag size={17} aria-hidden="true" />Add a service to set up payment.</p> : payment.method === 'Pay later' && <p className="lno-payment-note"><ClipboardList size={17} aria-hidden="true" />Save the order now and collect payment from its details when the customer is ready.</p>}</>}
            </section>}
            {paying && <div className="lno-receipt-info">
              <div><Printer size={18} aria-hidden="true" /><span><strong>Receipt prints automatically</strong><small>After saving, for paid and Pay later orders. Reprint from order details if needed.</small></span></div>
              <p className="lno-save-help">Orders start as <strong>Received</strong>. You can print receipts and laundry tags from order details.</p>
              <p className="lno-save-help">Nothing is saved until you press <strong>Save order</strong>.</p>
            </div>}
          </aside>
        </div>
        <div className="laundry-order-bar lno-order-bar">
          {step > 0 && <Button variant="ghost" className="lno-order-previous px-4" disabled={transitioning} onClick={previousStep}><ArrowLeft size={16} aria-hidden="true" />Back</Button>}
          <span className="laundry-order-bar-total"><span className="lno-help">{footerLabel}</span><strong>{footerValue}</strong></span>
          {paying ? <Button className="px-4" type="submit" disabled={action.busy || addCustomer.busy || transitioning} onClick={event => { if (event.detail > 1) event.preventDefault() }}><Check size={16} aria-hidden="true" />{saveLabel}</Button>
            : <Button className="px-4" disabled={transitioning} onClick={nextStep}>{nextLabel}<ArrowRight size={16} aria-hidden="true" /></Button>}
        </div>
      </fieldset>
    </form>}
    {catalog.data && !catalog.error && createPortal(<div className="laundry-mobile-action-bar lno-mobile-bar" data-step={step} aria-label={paying ? 'Save reviewed order' : 'Continue to next step'}>
      {step > 0 && <Button variant="ghost" className="lno-mobile-back" aria-label="Previous step" disabled={action.busy || addCustomer.busy || transitioning} onClick={previousStep}><ArrowLeft size={18} aria-hidden="true" /></Button>}
      <div><span>{footerLabel}</span><strong>{footerValue}</strong></div>
      {paying ? <Button form="laundry-new-order-form" type="submit" disabled={action.busy || addCustomer.busy || transitioning} onClick={event => { if (event.detail > 1) event.preventDefault() }}>{saveLabel}<Check size={17} aria-hidden="true" /></Button>
        : <Button disabled={action.busy || addCustomer.busy || transitioning} onClick={nextStep}>{nextLabel}<ArrowRight size={17} aria-hidden="true" /></Button>}
    </div>, document.body)}
  </div>
}
