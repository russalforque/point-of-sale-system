import { useId, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Pencil, RefreshCw, Settings2, Tag, Trash2 } from 'lucide-react'
import { laundryPricingApi } from '../../api/laundryPricingApi'
import type { LaundryDiscount, LaundryRules } from '../../types/laundry'
import { cents } from '../../services/laundryMath'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { Button } from '../ui/Button'
import { BackLayer, SearchBox } from '../ui/WorkPage'
import { Modal } from '../ui/Modal'
import { LaundryAddAction } from './LaundryAddAction'
import { LaundryField, LaundryLoad, message, useLaundryAction, useLaundryMoney, useLaundryQuery } from './LaundryUI'

const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
type Draft = Omit<LaundryDiscount, 'id' | 'revision'> & { id?: number }
const empty: Draft = { name: '', kind: 'fixed', value: 0, scope: 'order', categories: [], visit_number: 0, repeat_every: 0, weekday: null, stackable: 1, is_active: 1, eligibility_note: '' }

/** Uses the same catalog cards, fields, modal, add action and action locks as item management. */
export function LaundryDiscountManager({ categories }: { categories: string[] }) {
  const data = useLaundryQuery(async () => {
    const [discounts, rules] = await Promise.all([laundryPricingApi.discounts(true), laundryPricingApi.rules()])
    return { discounts, rules }
  }, [])
  const [search, setSearch] = useState(''), [editing, setEditing] = useState<Draft | null>(null)
  const [rules, setRules] = useState<LaundryRules | null>(null), [value, setValue] = useState('')
  const [error, setError] = useState(''), [removing, setRemoving] = useState(false)
  const action = useLaundryAction(), money = useLaundryMoney(), { notify } = useToast(), { can } = useAuth(), formId = useId()
  const rows = (data.data?.discounts ?? []).filter(row => `${row.name} ${row.eligibility_note}`.toLowerCase().includes(search.trim().toLowerCase()))
  function edit(row?: LaundryDiscount) { setEditing(row ? { ...row } : { ...empty, categories: [] }); setValue(row ? String(row.value / 100) : ''); setError(''); setRemoving(false) }
  function patch(patch: Partial<Draft>) { setEditing(row => row ? { ...row, ...patch } : row); setError('') }
  async function save(close: () => void) {
    await action.run(async () => {
      try {
        if (editing) {
          if (!value.trim()) throw new Error('Enter a discount value.')
          await laundryPricingApi.saveDiscount({ ...editing, value: cents(Number(value)) })
        } else if (rules) await laundryPricingApi.saveRules(rules)
      } catch (error) { setError(message(error)); return }
      notify(editing ? 'Discount saved.' : 'Laundry shop rules saved.')
      close(); await data.reload()
    })
  }
  return <section className="ls-discount-manager" aria-label="Laundry discounts and loyalty">
    <div className="ls-discount-toolbar"><div><h2>Discounts & loyalty</h2><p className="laundry-muted">Owner-defined discounts apply only to Laundry Mode.</p></div><Button variant="secondary" aria-label="Refresh discounts" disabled={data.loading || action.busy} onClick={() => void data.reload()}><RefreshCw size={17} /></Button><LaundryAddAction label="Add discount" disabled={action.busy || !data.data || !!data.error} onClick={() => edit()} /></div>
    <div className="ls-price-note"><Settings2 size={18} /><div><p>Visits currently count {data.data?.rules.visit_status === 'Ready for Pickup' ? 'ready or completed' : 'completed'} orders{data.data?.rules.visit_require_paid ? ' that are fully paid' : ''}. Discount stacking is {data.data?.rules.allow_stacking ? 'on' : 'off'}.</p><p>Rewards use the next qualifying visit. Saving an order reserves its reward. Status corrections keep used rewards protected.</p></div>{can('settings.manage') && <Button variant="secondary" disabled={!data.data || action.busy} onClick={() => { setRules({ ...data.data!.rules }); setEditing(null); setError('') }}>Configure rules</Button>}</div>
    <SearchBox label="Search laundry discounts" placeholder="Find a discount…" value={search} onChange={setSearch} />
    <LaundryLoad {...data} retry={data.reload} />
    {!data.loading && !data.error && <div className="ls-grid">{rows.map(row => <article className={`ls-service-card ${!row.is_active ? 'is-inactive' : ''}`} key={row.id}>
      <div className="ls-card-top"><span className="ls-service-icon"><Tag size={22} /></span><span className={`ls-status ${row.is_active ? 'is-active' : ''}`}>{row.is_active ? 'Active' : 'Inactive'}</span></div>
      <h3>{row.name}</h3><div className="ls-card-price"><strong>{row.kind === 'percent' ? `${row.value / 100}%` : money(row.value)}</strong><span>discount</span></div>
      <p className="ls-pricing-method">{row.scope === 'order' ? 'Whole order' : row.scope === 'categories' ? row.categories.join(', ') : `Selected ${row.scope}`}</p>
      {row.visit_number > 0 && <p className="ls-pricing-method">Visit {row.visit_number}{row.repeat_every ? `, then every ${row.repeat_every} visits` : ' · once per customer'}</p>}
      {row.weekday !== null && <p className="ls-pricing-method">{weekdays[row.weekday]} only</p>}
      {row.eligibility_note && <p className="ls-pricing-method">{row.eligibility_note}</p>}
      <div className="ls-card-footer"><span>{row.stackable ? 'Stacking follows shop rules' : 'Cannot combine'}</span><Button variant="secondary" aria-label={`Edit ${row.name}`} onClick={() => edit(row)}><Pencil size={15} />Edit</Button></div>
    </article>)}</div>}
    {!data.loading && !data.error && !rows.length && <p className="ls-price-note">No discounts match. Add a discount or change the search.</p>}
    {(editing || rules) && createPortal(<BackLayer name="laundry-discount-editor" blocked={action.busy} onBack={() => { setEditing(null); setRules(null) }}>{close => <Modal
      title={editing ? `${editing.id ? 'Edit' : 'Add'} discount` : 'Laundry shop rules'} mobileFullScreen size="lg" preventClose={action.busy} onClose={close} panelClassName="laundry-dialog-panel ls-editor-panel max-h-full max-w-2xl" bodyClassName="ls-editor-body"
      footer={<><Button variant="secondary" disabled={action.busy} onClick={close}>Cancel</Button><Button type="submit" form={formId} disabled={action.busy}><Check size={17} />{action.busy ? 'Saving…' : 'Save changes'}</Button></>}>
      <form id={formId} noValidate onSubmit={event => { event.preventDefault(); void save(close) }}><fieldset className="ls-editor-fields laundry-stack" disabled={action.busy}><legend className="sr-only">Laundry discount settings</legend>
        {error && <p className="laundry-error" role="alert">{error}</p>}
        {editing ? <>
          <LaundryField label="Discount name" value={editing.name} maxLength={100} onChange={event => patch({ name: event.target.value })} />
          <div className="laundry-grid two"><label className="laundry-field"><span>Discount type</span><select value={editing.kind} onChange={event => patch({ kind: event.target.value as Draft['kind'] })}><option value="fixed">Fixed amount</option><option value="percent">Percentage</option></select></label><LaundryField label={editing.kind === 'percent' ? 'Discount percent' : 'Discount amount'} type="number" inputMode="decimal" min="0" max={editing.kind === 'percent' ? 100 : 1000000} step="0.01" value={value} onChange={event => setValue(event.target.value)} /></div>
          <label className="laundry-field"><span>Applies to</span><select value={editing.scope} onChange={event => patch({ scope: event.target.value as Draft['scope'] })}><option value="order">Whole order</option><option value="services">Services only</option><option value="addons">Add-ons only</option><option value="categories">Selected categories</option></select></label>
          {editing.scope === 'categories' && <fieldset className="ls-category-choices"><legend>Eligible categories</legend>{[...new Set([...categories, ...editing.categories])].map(category => <label key={category}><input type="checkbox" checked={editing.categories.includes(category)} onChange={event => patch({ categories: event.target.checked ? [...editing.categories, category] : editing.categories.filter(row => row !== category) })} />{category}</label>)}{!categories.length && <p>Create a service category first.</p>}</fieldset>}
          <div className="laundry-grid two"><LaundryField label="Qualifying visit number (0 = any visit)" type="number" min="0" max="1000000" step="1" value={editing.visit_number} onChange={event => patch({ visit_number: Number(event.target.value) })} /><LaundryField label="Repeat every N visits (0 = once)" type="number" min="0" max="1000000" step="1" value={editing.repeat_every} onChange={event => patch({ repeat_every: Number(event.target.value) })} /></div>
          <label className="laundry-field"><span>Available day</span><select value={editing.weekday ?? ''} onChange={event => patch({ weekday: event.target.value === '' ? null : Number(event.target.value) })}><option value="">Every day</option>{weekdays.map((day, index) => <option key={day} value={index}>{day}</option>)}</select></label>
          <LaundryField label="Eligibility instructions (optional)" maxLength={300} value={editing.eligibility_note} onChange={event => patch({ eligibility_note: event.target.value })} />
          <label className="ls-active-control"><span>Allow combining with other discounts when stacking is on</span><input type="checkbox" checked={!!editing.stackable} onChange={event => patch({ stackable: Number(event.target.checked) })} /></label>
          <label className="ls-active-control"><span>Active for new orders</span><input type="checkbox" role="switch" checked={!!editing.is_active} onChange={event => patch({ is_active: Number(event.target.checked) })} /></label>
          {editing.id && <div className="laundry-stack">{removing ? <><p role="alert">Remove {editing.name}? Saved orders and discount history will be kept.</p><Button variant="danger" onClick={() => void action.run(async () => { await laundryPricingApi.removeDiscount(editing.id!); close(); await data.reload(); notify('Discount removed.') })}>Confirm remove discount</Button><Button variant="ghost" onClick={() => setRemoving(false)}>Keep discount</Button></> : <Button variant="ghost" onClick={() => setRemoving(true)}><Trash2 size={16} />Remove discount</Button>}</div>}
        </> : rules && <>
          <label className="ls-active-control"><span><strong>Allow pickup with an unpaid balance</strong><small>Staff must still confirm collection. The balance stays due and can be collected after completion.</small></span><input type="checkbox" checked={!!rules.allow_unpaid_completion} onChange={event => setRules({ ...rules, allow_unpaid_completion: Number(event.target.checked) })} /></label>
          <p className="laundry-muted">Each order can count at most once. Legacy archives never count. Changing these rules recounts existing history; already-used rewards stay protected.</p>
          <label className="laundry-field"><span>Visit qualifies when</span><select value={rules.visit_status} onChange={event => setRules({ ...rules, visit_status: event.target.value as LaundryRules['visit_status'] })}><option value="Completed">Laundry is collected / completed</option><option value="Ready for Pickup">Laundry is ready for pickup or completed</option></select></label>
          <label className="ls-active-control"><span>Require payment in full</span><input type="checkbox" checked={!!rules.visit_require_paid} onChange={event => setRules({ ...rules, visit_require_paid: Number(event.target.checked) })} /></label>
          <LaundryField label="Minimum visit amount" type="number" inputMode="decimal" min="0" step="0.01" value={rules.visit_minimum_cents / 100} onChange={event => setRules({ ...rules, visit_minimum_cents: Math.round(Number(event.target.value) * 100) })} />
          <label className="laundry-field"><span>Minimum amount is measured</span><select value={rules.visit_basis} onChange={event => setRules({ ...rules, visit_basis: event.target.value as LaundryRules['visit_basis'] })}><option value="subtotal">Before discounts</option><option value="total">After discounts</option></select></label>
          <label className="ls-active-control"><span>Allow stacking discounts</span><input type="checkbox" checked={!!rules.allow_stacking} onChange={event => setRules({ ...rules, allow_stacking: Number(event.target.checked) })} /></label>
          <p className="laundry-muted">When enabled, selected discounts apply in saved creation order to the remaining eligible amount; manual discounts apply last. The payable total cannot go below zero. A 100% reward counts toward future visits when the minimum is measured before discounts.</p>
        </>}
      </fieldset></form>
    </Modal>}</BackLayer>, document.body)}
  </section>
}
