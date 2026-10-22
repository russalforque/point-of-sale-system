import { useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronRight, Mail, MapPin, MessageSquare, Pencil, Phone, RefreshCw, Search, Shirt, UserRound, Users } from 'lucide-react'
import { customerApi, type CustomerPayload } from '../../api/customerApi'
import { laundryApi } from '../../api/laundryApi'
import { CustomerLaundryPanel } from '../../components/customers/CustomerLaundryPanel'
import { LaundryAddAction } from '../../components/laundry/LaundryAddAction'
import { LaundryLoad, message, useLaundryAction, useLaundryMoney, useLaundryQuery } from '../../components/laundry/LaundryUI'
import { Button } from '../../components/ui/Button'
import { Field, Input, Textarea } from '../../components/ui/Field'
import { EMAIL_PATTERN, getInitials } from '../../components/ui/MobileKit'
import { Modal } from '../../components/ui/Modal'
import { Pagination } from '../../components/ui/Pagination'
import { SearchBox } from '../../components/ui/WorkPage'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { useDebounced } from '../../hooks/useDebounced'
import type { Customer } from '../../types'
import './customers.css'

const PAGE_SIZE = 20
type ContactErrors = Partial<Record<'fullName' | 'phone' | 'email', string>>
const blank: CustomerPayload = { fullName: '', phone: '', email: '', address: '', notes: '', isActive: true }
const phoneLink = (phone: string) => phone.replace(/[^\d+]/g, '')

function CustomerEditor({ customer, onClose, onSaved }: {
  customer?: Customer; onClose: () => void; onSaved: (customer: Customer) => void
}) {
  const [initial] = useState<CustomerPayload>(() => customer ? {
    fullName: customer.fullName, phone: customer.phone ?? '', email: customer.email ?? '',
    address: customer.address ?? '', notes: customer.notes ?? '', isActive: customer.isActive,
  } : { ...blank })
  const [form, setForm] = useState(initial), [errors, setErrors] = useState<ContactErrors>({}),
    [saveError, setSaveError] = useState(''), [discard, setDiscard] = useState(false)
  const action = useLaundryAction(), formRef = useRef<HTMLFormElement>(null)
  const dirty = JSON.stringify(form) !== JSON.stringify(initial)
  function close() { if (dirty) setDiscard(true); else onClose() }
  function update<K extends keyof CustomerPayload>(key: K, value: CustomerPayload[K]) {
    setForm(current => ({ ...current, [key]: value })); setSaveError('')
    setErrors(current => ({ ...current, [key]: undefined }))
  }
  async function save(event: FormEvent) {
    event.preventDefault()
    const next: ContactErrors = {}
    if (!form.fullName.trim()) next.fullName = 'Enter the customer’s full name.'
    if (form.phone?.trim() && form.phone.replace(/\D/g, '').length < 7) next.phone = 'Enter a phone number with at least 7 digits.'
    if (form.email?.trim() && !EMAIL_PATTERN.test(form.email.trim())) next.email = 'Enter a valid email address.'
    setErrors(next); setSaveError(''); setDiscard(false)
    if (Object.keys(next).length) {
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
      return
    }
    await action.run(async () => {
      try {
        const payload = { ...form, fullName: form.fullName.trim(), phone: form.phone?.trim(), email: form.email?.trim() }
        const saved = customer ? await customerApi.update(customer.id, payload) : await customerApi.create(payload)
        onSaved(saved)
      } catch (error) { setSaveError(message(error)) }
    })
  }
  return <Modal title={customer ? 'Edit customer' : 'Add customer'} description="Keep contact details handy for pickup and order updates."
    onClose={close} preventClose={action.busy} mobileFullScreen size="lg" panelClassName="laundry-dialog-panel lc-dialog"
    footer={<><Button variant="secondary" onClick={close} disabled={action.busy}>Cancel</Button>
      <Button form="laundry-customer-form" type="submit" disabled={action.busy} className="laundry-dialog-primary">{action.busy ? 'Saving…' : customer ? 'Save changes' : 'Save customer'}</Button></>}>
    <form id="laundry-customer-form" ref={formRef} onSubmit={event => void save(event)} noValidate className="lc-form">
      {discard && <div className="lc-notice" role="alert"><strong>Discard unsaved changes?</strong><p>Your customer details have not been saved.</p>
        <div className="laundry-actions"><Button variant="secondary" onClick={() => setDiscard(false)}>Keep editing</Button><Button variant="danger" onClick={onClose}>Discard changes</Button></div></div>}
      {saveError && <div className="laundry-error" role="alert">{saveError}</div>}
      <div className="lc-form-section"><span className="lc-section-icon"><UserRound size={20} aria-hidden="true" /></span><div><h3>Customer details</h3><p>A name and phone number make pickup easier.</p></div></div>
      <Field label="Full name" required error={errors.fullName}><Input name="fullName" autoComplete="name" required maxLength={150} value={form.fullName} aria-invalid={!!errors.fullName} onChange={e => update('fullName', e.target.value)} placeholder="e.g. Maria Santos" /></Field>
      <Field label="Phone number" error={errors.phone} hint="Needed when placing a laundry order. You can add it later."><Input name="phone" type="tel" autoComplete="tel" inputMode="tel" maxLength={40} value={form.phone} aria-invalid={!!errors.phone} onChange={e => update('phone', e.target.value)} placeholder="e.g. 0912 345 6789" /></Field>
      <div className="lc-form-divider"><h3>Additional information</h3><span>Optional</span></div>
      <Field label="Email address" error={errors.email}><Input name="email" type="email" autoComplete="email" maxLength={150} value={form.email} aria-invalid={!!errors.email} onChange={e => update('email', e.target.value)} placeholder="name@example.com" /></Field>
      <Field label="Address"><Textarea name="address" autoComplete="street-address" maxLength={500} value={form.address} onChange={e => update('address', e.target.value)} placeholder="Street, building or delivery details" rows={2} /></Field>
      <Field label="Customer notes" hint="Internal notes for your laundry team."><Textarea name="notes" maxLength={1000} value={form.notes} onChange={e => update('notes', e.target.value)} placeholder="Preferences or helpful reminders" rows={3} /></Field>
      {customer && <label className="lc-active-switch"><span><strong>Active customer</strong><small>Active customers can be selected for new orders.</small></span><input type="checkbox" role="switch" checked={form.isActive} onChange={e => update('isActive', e.target.checked)} /></label>}
    </form>
  </Modal>
}

function CustomerDialog({ id, editing, onClose, onSaved, onEdit }: {
  id: number; editing: boolean; onClose: () => void; onSaved: (customer: Customer) => void; onEdit: () => void
}) {
  const query = useLaundryQuery(() => customerApi.get(id), [id]), { can } = useAuth()
  const customer = query.data
  if (editing && customer && !query.error) return <CustomerEditor customer={customer} onClose={onClose} onSaved={onSaved} />
  return <Modal title="Customer profile" description={customer?.customerCode} onClose={onClose} mobileFullScreen size="lg"
    panelClassName="laundry-dialog-panel lc-dialog"
    footer={customer && can('customers.manage') ? <Button onClick={onEdit} className="laundry-dialog-primary"><Pencil size={16} aria-hidden="true" />Edit details</Button> : undefined}>
    <LaundryLoad {...query} retry={query.reload} />
    {customer && !query.error && <div className="lc-profile">
      <div className="lc-profile-heading"><span className="lc-avatar lc-avatar-large" aria-hidden="true">{getInitials(customer.fullName)}</span>
        <div><span className={`lc-state ${customer.isActive ? '' : 'is-inactive'}`}>{customer.isActive ? 'Active customer' : 'Inactive customer'}</span><h3>{customer.fullName}</h3>
          <p>Customer since {new Date(customer.createdAt).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}</p></div></div>
      {customer.phone && <div className="lc-contact-actions"><a href={`tel:${phoneLink(customer.phone)}`}><Phone size={18} aria-hidden="true" />Call customer</a>
        <a href={`sms:${phoneLink(customer.phone)}`}><MessageSquare size={18} aria-hidden="true" />Send text</a></div>}
      <dl className="lc-contact-details">
        <div><dt><Phone size={16} aria-hidden="true" />Phone number</dt><dd>{customer.phone ? <a href={`tel:${phoneLink(customer.phone)}`}>{customer.phone}</a> : 'No phone number added'}</dd></div>
        {customer.email && <div><dt><Mail size={16} aria-hidden="true" />Email address</dt><dd><a href={`mailto:${customer.email}`}>{customer.email}</a></dd></div>}
        {customer.address && <div><dt><MapPin size={16} aria-hidden="true" />Address</dt><dd>{customer.address}</dd></div>}
      </dl>
      {!customer.phone && <p className="lc-notice">Add a phone number before placing a laundry order for this customer.</p>}
      <CustomerLaundryPanel key={customer.id} customerId={customer.id} />
      {customer.notes && <section className="lc-notes"><h3>Customer notes</h3><p>{customer.notes}</p></section>}
    </div>}
  </Modal>
}

/** One responsive component keeps customer forms intact when a tablet rotates. */
export function LaundryCustomers() {
  const { can } = useAuth(), { notify } = useToast(), money = useLaundryMoney()
  const navigate = useNavigate(), location = useLocation(), [params, setParams] = useSearchParams()
  const [revision, setRevision] = useState(0), resultsRef = useRef<HTMLHeadingElement>(null)
  const search = params.get('q') ?? '', term = useDebounced(search.trim())
  const status = ['active', 'inactive'].includes(params.get('status') ?? '') ? params.get('status')! : ''
  const rawPage = Number(params.get('page') ?? 1), page = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1
  const queryKey = JSON.stringify([term, status, page])
  const counts = useLaundryQuery(async () => {
    const [all, active] = await Promise.all([customerApi.list({ pageSize: 1 }), customerApi.list({ isActive: true, pageSize: 1 })])
    return { all: all.totalCount, active: active.totalCount, inactive: all.totalCount - active.totalCount }
  }, [revision])
  const directory = useLaundryQuery(async () => {
    const filters = { search: term || undefined, isActive: status ? status === 'active' : undefined, pageSize: PAGE_SIZE }
    let result = await customerApi.list({ ...filters, page })
    if (page > Math.max(1, result.totalPages)) result = await customerApi.list({ ...filters, page: Math.max(1, result.totalPages) })
    const summaries = await laundryApi.customerSummaries(result.items.map(customer => customer.id))
    return { ...result, summaries, key: queryKey }
  }, [term, status, page, revision])
  const data = directory.data?.key === queryKey && !directory.error ? directory.data : null
  const creating = location.pathname === '/customers/create'
  const match = location.pathname.match(/^\/customers\/(edit\/)?(\d+)$/)
  const id = match ? Number(match[2]) : null, editing = !!match?.[1]
  const canCreate = can('customers.create'), canManage = can('customers.manage')
  function route(path: string) { return `${path}${location.search}` }
  function close() { navigate(route('/customers'), { replace: true }) }
  function updateFilter(key: string, value: string) {
    setParams(current => { const next = new URLSearchParams(current); if (value) next.set(key, value); else next.delete(key); next.delete('page'); return next }, { replace: true })
  }
  function saved(customer: Customer) {
    notify(creating ? 'Customer added.' : 'Customer details updated.'); setRevision(value => value + 1)
    navigate(route(`/customers/${customer.id}`), { replace: true })
  }
  const dialog = creating ? canCreate ? <CustomerEditor onClose={close} onSaved={saved} /> : null
    : id && (!editing || canManage) ? <CustomerDialog key={`${id}-${editing}-${revision}`} id={id} editing={editing} onClose={close} onSaved={saved} onEdit={() => navigate(route(`/customers/edit/${id}`), { replace: true })} /> : null
  return <div className={`laundry-screen laundry-customers ${canCreate ? 'laundry-has-add' : ''}`}>
    <header className="lc-header"><div><p className="lc-eyebrow"><span /> LAUNDRY CUSTOMERS</p><h1>Customers</h1><p>Familiar faces. Every load, a little more personal.</p></div>
      {canCreate && <LaundryAddAction label="Add customer" to={route('/customers/create')} />}</header>
    <div className="lc-filters" role="group" aria-label="Customer status">
      {([{ key: '', title: 'All customers', value: counts.data?.all, icon: Users }, { key: 'active', title: 'Active', value: counts.data?.active, icon: UserRound }, { key: 'inactive', title: 'Inactive', value: counts.data?.inactive, icon: Users }]).map(filter => <button key={filter.key} type="button" aria-pressed={status === filter.key} className={status === filter.key ? 'is-selected' : ''} onClick={() => updateFilter('status', filter.key)}>
        <filter.icon size={18} aria-hidden="true" /><span>{filter.title}</span><strong>{filter.value ?? '—'}</strong></button>)}
    </div>
    {counts.error && <div className="lc-count-error" role="status">Customer counts unavailable.<Button variant="ghost" onClick={() => void counts.reload()}>Retry counts</Button></div>}
    <section className="lc-directory" aria-label="Customer directory">
      <div className="lc-toolbar"><SearchBox label="Search customers" placeholder="Search name, phone, email or code…" value={search} onChange={value => updateFilter('q', value)} />
        <Button variant="secondary" aria-label="Refresh customers" disabled={directory.loading || counts.loading} onClick={() => { void directory.reload(); void counts.reload() }}><RefreshCw size={17} aria-hidden="true" /><span>Refresh</span></Button></div>
      <div className="lc-results-heading"><h2 ref={resultsRef} tabIndex={-1}>{status === 'inactive' ? 'Inactive customers' : status === 'active' ? 'Active customers' : 'Customer directory'}</h2>
        <p aria-live="polite">{directory.loading || search.trim() !== term ? 'Updating…' : data ? `${data.totalCount} ${data.totalCount === 1 ? 'customer' : 'customers'}${term ? ' found' : ''}` : ''}</p></div>
      <LaundryLoad {...directory} retry={directory.reload} />
      {data && <>
        {!!data.items.length && <div className="lc-customer-grid" aria-busy={directory.loading}>
          {data.items.map(customer => {
            const summary = data.summaries[customer.id]!
            return <article className="lc-customer-card" key={customer.id}>
              <Link className="lc-customer-link" to={route(`/customers/${customer.id}`)} aria-label={`View ${customer.fullName}`}>
                <span className="lc-avatar" aria-hidden="true">{getInitials(customer.fullName)}</span><span className="lc-customer-name"><strong>{customer.fullName}</strong><small>{customer.customerCode}<span>·</span><span className={`lc-state ${customer.isActive ? '' : 'is-inactive'}`}>{customer.isActive ? 'Active' : 'Inactive'}</span></small></span><ChevronRight size={18} aria-hidden="true" />
              </Link>
              <div className="lc-card-contact">{customer.phone ? <a href={`tel:${phoneLink(customer.phone)}`} aria-label={`Call ${customer.fullName} at ${customer.phone}`}><Phone size={15} aria-hidden="true" />{customer.phone}</a> : <span className="lc-missing-phone"><Phone size={15} aria-hidden="true" />No phone number added</span>}</div>
              <dl className="lc-card-metrics"><div><dt><Shirt size={14} aria-hidden="true" />Active orders</dt><dd>{summary.active}<small> / {summary.total} total</small></dd></div><div className={summary.outstanding > 0 ? 'has-balance' : ''}><dt>Unpaid balance</dt><dd>{money(summary.outstanding)}</dd></div></dl>
              <Link className="lc-view-profile" to={route(`/customers/${customer.id}`)}>View profile & orders<ChevronRight size={15} aria-hidden="true" /></Link>
            </article>
          })}
        </div>}
        {!data.items.length && !directory.loading && <div className="lc-empty"><span>{term ? <Search size={28} aria-hidden="true" /> : <Users size={28} aria-hidden="true" />}</span><h3>{term || status ? 'No matching customers' : 'Your customers belong here'}</h3><p>{term || status ? 'Try another name, phone number or customer status.' : 'Add your first customer to keep their contact details and laundry history together.'}</p>
          {term || status ? <Button variant="secondary" onClick={() => setParams({}, { replace: true })}>Clear filters</Button> : canCreate && <Button onClick={() => navigate(route('/customers/create'))}>Add first customer</Button>}</div>}
        {data.totalPages > 1 && <div className="lc-pagination"><Pagination page={data.page} totalPages={data.totalPages} onPage={next => {
          setParams(current => { const value = new URLSearchParams(current); value.set('page', String(next)); return value }, { replace: true })
          resultsRef.current?.focus({ preventScroll: true }); resultsRef.current?.scrollIntoView({ block: 'start' })
        }} /></div>}
      </>}
    </section>
    {dialog && createPortal(dialog, document.body)}
    {((creating && !canCreate) || (editing && !canManage)) && createPortal(<Modal title="Permission required" onClose={close}><p>You don’t have permission to {creating ? 'add' : 'edit'} customers.</p></Modal>, document.body)}
  </div>
}
