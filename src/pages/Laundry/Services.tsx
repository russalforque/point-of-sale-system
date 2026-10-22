import { useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Check, ChevronLeft, ChevronRight, CircleCheck, Droplets, FolderOpen,
  Info, Layers3, PackagePlus, Pencil, Plus, RefreshCw, Search, Shirt, Trash2,
} from 'lucide-react'
import { BackLayer, SearchBox, PillGroup } from '../../components/ui/WorkPage'
import { LaundryDiscountManager } from '../../components/laundry/LaundryDiscountManager'
import { Button } from '../../components/ui/Button'
import { laundryApi } from '../../api/laundryApi'
import {
  LaundryField, LaundryLoad, useLaundryAction, useLaundryMoney, useLaundryQuery,
} from '../../components/laundry/LaundryUI'
import { useToast } from '../../context/ToastContext'
import { Modal } from '../../components/ui/Modal'
import { cents } from '../../services/laundryMath'
import type { LaundryCatalog } from '../../types/laundry'
import './services.css'
import { LaundryAddAction } from '../../components/laundry/LaundryAddAction'

type CatalogKind = 'services' | 'addons'
type Availability = 'all' | 'active' | 'inactive'
type CatalogEditor = { kind: CatalogKind; item: Omit<LaundryCatalog, 'id'> & { id?: number }; price: string }
const PAGE_SIZE = 12
const pricingLabels: Record<LaundryCatalog['pricing'], string> = {
  kg: 'Per kilogram', load: 'Per load', piece: 'Per piece', fixed: 'Fixed price', quantity: 'Per quantity',
}
const pricingUnits: Record<LaundryCatalog['pricing'], string> = {
  kg: '/ kg', load: '/ load', piece: '/ piece', fixed: 'per order', quantity: '/ item',
}
const pricingHints: Record<LaundryCatalog['pricing'], string> = {
  kg: 'The price is charged for each kilogram of laundry.',
  load: 'The price is charged for each load.',
  piece: 'The price is multiplied by the number of pieces.',
  fixed: 'Charged once when this item is added to an order.',
  quantity: 'The price is multiplied by the number of items.',
}

export function LaundryServices() {
  const [section, setSection] = useState<'catalog' | 'discounts'>('catalog')
  const [removing, setRemoving] = useState(false)
  const [kind, setKind] = useState<CatalogKind>('services')
  const [editing, setEditing] = useState<CatalogEditor | null>(null)
  const [search, setSearch] = useState(''), [category, setCategory] = useState(''),
    [availability, setAvailability] = useState<Availability>('all'), [sort, setSort] = useState('name'), [page, setPage] = useState(1)
  const [formError, setFormError] = useState('')
  const action = useLaundryAction(), money = useLaundryMoney(), { notify } = useToast()
  const formId = useId(), categoriesId = useId(), errorId = useId()
  const errorRef = useRef<HTMLParagraphElement>(null), listRef = useRef<HTMLElement>(null)
  const data = useLaundryQuery(async () => {
    const [services, addons] = await Promise.all([laundryApi.catalog('services', true), laundryApi.catalog('addons', true)])
    return { services, addons }
  }, [])
  const entries = data.data?.[kind] ?? []
  const categories = [...new Set(entries.map(row => row.category?.trim()).filter((value): value is string => !!value))].sort((a, b) => a.localeCompare(b))
  const term = search.trim().toLocaleLowerCase()
  const matching = entries.filter(row => `${row.name} ${row.category ?? ''}`.toLocaleLowerCase().includes(term) && (!category || (category === 'uncategorized' ? !row.category?.trim() : row.category?.trim() === category.slice(9))))
  const active = matching.filter(row => !!row.is_active).length
  const visible = matching.filter(row => availability === 'all' || (availability === 'active' ? !!row.is_active : !row.is_active)).sort((a, b) => {
    if (sort === 'price-low') return a.price_cents - b.price_cents || a.name.localeCompare(b.name)
    if (sort === 'price-high') return b.price_cents - a.price_cents || a.name.localeCompare(b.name)
    return a.name.localeCompare(b.name)
  })
  const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))
  const currentPage = Math.min(page, pages)
  const rows = visible.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
  const filtered = !!(search || category || availability !== 'all')
  const label = kind === 'services' ? 'service' : 'add-on'
  let previewPrice: number | null = null
  if (editing?.price.trim()) {
    try { previewPrice = cents(Number(editing.price)) } catch { /* An incomplete price stays editable. */ }
  }

  function selectKind(next: CatalogKind) {
    if (next === kind) return
    setKind(next); setCategory(''); setAvailability('all'); setPage(1)
  }
  function clearFilters() { setSearch(''); setCategory(''); setAvailability('all'); setPage(1) }
  function openEditor(row?: LaundryCatalog) {
    setRemoving(false)
    setFormError('')
    setEditing({ kind, item: row ? { ...row } : {
      name: '', category: category.startsWith('category:') ? category.slice(9) : '',
      pricing: 'fixed', price_cents: 0, is_active: 1,
    }, price: row ? (row.price_cents / 100).toFixed(2) : '' })
  }
  function editItem(patch: Partial<CatalogEditor['item']>) {
    setFormError(''); setEditing(current => current ? { ...current, item: { ...current.item, ...patch } } : null)
  }
  function showError(message: string) {
    setFormError(message)
    requestAnimationFrame(() => errorRef.current?.focus())
  }
  async function save(close: () => void) {
    if (!editing || removing) return
    if (!editing.item.name.trim()) { showError('Enter a name for this item.'); return }
    if (!editing.price.trim()) { showError('Enter a unit price. Zero is allowed for a free item.'); return }
    let priceCents: number
    try { priceCents = cents(Number(editing.price)) }
    catch (error) { showError(error instanceof Error ? error.message : 'Enter a valid price.'); return }
    await action.run(async () => {
      try { await laundryApi.saveCatalog(editing.kind, { ...editing.item, name: editing.item.name.trim(), category: editing.item.category?.trim() ?? '', price_cents: priceCents }) }
      catch (error) { showError(error instanceof Error ? error.message : 'Unable to save this item. Try again.'); return }
      notify(`${editing.kind === 'services' ? 'Service' : 'Add-on'} ${editing.item.id ? 'updated' : 'added'}.`)
      if (!editing.item.id) clearFilters()
      close()
      await data.reload()
    })
  }
  function goToPage(next: number) {
    setPage(next); listRef.current?.focus({ preventScroll: true }); listRef.current?.scrollIntoView({ block: 'start' })
  }

  return <div className="laundry-screen laundry-services laundry-has-add">
    <header className="ls-header">
      <div><p className="ls-eyebrow"><span /> LAUNDRY CATALOGUE</p><h1>Services & add-ons</h1><p>Your shop's services, extras and prices, all in one place.</p></div>
      {section === 'catalog' && <div className="ls-header-actions"><Button variant="secondary" className="laundry-refresh-action" aria-label="Refresh catalogue" disabled={data.loading || action.busy} onClick={() => void data.reload()}><RefreshCw size={16} aria-hidden="true" className={data.loading ? 'ls-spin' : ''} /><span>Refresh</span></Button><LaundryAddAction label={`Add ${label}`} disabled={action.busy || !data.data || !!data.error} onClick={() => openEditor()} /></div>}
    </header>
    <div className="ls-section-tabs"><PillGroup label="Laundry catalogue section" value={section} onChange={setSection} options={[{ key: 'catalog', label: 'Services & add-ons' }, { key: 'discounts', label: 'Discounts & loyalty' }]} /></div>
    {section === 'discounts' && <LaundryDiscountManager categories={[...new Set([...(data.data?.services ?? []), ...(data.data?.addons ?? [])].map(row => row.category?.trim()).filter((value): value is string => !!value))]} />}
    <div hidden={section !== 'catalog'}>
    <div className="ls-price-note"><Info size={16} aria-hidden="true" /><p>Price changes apply to future orders. Saved orders keep their original prices.</p></div>
    <section className="ls-catalogue" ref={listRef} tabIndex={-1} aria-labelledby="ls-catalogue-title">
      <h2 className="sr-only" id="ls-catalogue-title">Manage laundry catalogue</h2>
      <div className="ls-tabs" role="group" aria-label="Catalogue type">
        {(['services', 'addons'] as const).map(tab => {
          const Icon = tab === 'services' ? Shirt : PackagePlus
          return <button type="button" key={tab} aria-pressed={kind === tab} className={kind === tab ? 'is-active' : ''} onClick={() => selectKind(tab)}><span className="ls-tab-icon"><Icon size={20} aria-hidden="true" /></span><span><strong>{tab === 'services' ? 'Laundry services' : 'Add-ons'}</strong><small>{tab === 'services' ? 'Wash, dry, fold and more' : 'Extra care for every load'}</small></span><span className="ls-tab-count">{data.data ? data.data[tab].length : '—'}</span></button>
        })}
      </div>
      <div className="ls-toolbar">
        <div className="ls-search"><span>Find a {label}</span><SearchBox label="Search services and add-ons" placeholder="Search by name or category…" value={search} onChange={value => { setSearch(value); setPage(1) }} /></div>
        <label className="laundry-field"><span>Category</span><select value={category} onChange={event => { setCategory(event.target.value); setPage(1) }}><option value="">All categories</option>{categories.map(value => <option key={value} value={`category:${value}`}>{value}</option>)}{entries.some(row => !row.category?.trim()) && <option value="uncategorized">Uncategorized</option>}</select></label>
        <label className="laundry-field"><span>Sort by</span><select value={sort} onChange={event => { setSort(event.target.value); setPage(1) }}><option value="name">Name: A–Z</option><option value="price-low">Price: low to high</option><option value="price-high">Price: high to low</option></select></label>
      </div>
      <div className="ls-filter-row"><div className="ls-availability" role="group" aria-label="Catalogue availability">{([
        { value: 'all', label: 'All items', count: matching.length },
        { value: 'active', label: 'Active', count: active },
        { value: 'inactive', label: 'Inactive', count: matching.length - active },
      ] as const).map(option => <button type="button" key={option.value} aria-pressed={availability === option.value} className={availability === option.value ? 'is-active' : ''} onClick={() => { setAvailability(option.value); setPage(1) }}>{option.label}<span>{data.data ? option.count : '—'}</span></button>)}</div>{filtered && <Button variant="ghost" onClick={clearFilters}>Clear filters</Button>}</div>
      <div className="ls-results" aria-busy={data.loading}>
        {data.loading ? <div className="ls-loading"><LaundryLoad loading error={null} retry={data.reload} /></div> : data.error ? <div className="ls-error"><LaundryLoad loading={false} error={data.error} retry={data.reload} /></div> : <>
          {rows.length ? <div className="ls-grid">{rows.map(row => {
            const Icon = kind === 'addons' ? PackagePlus : row.pricing === 'kg' ? Droplets : row.pricing === 'load' ? Layers3 : Shirt
            return <article className={`ls-service-card ${!row.is_active ? 'is-inactive' : ''}`} key={row.id}>
              <div className="ls-card-top"><span className="ls-service-icon"><Icon size={24} aria-hidden="true" /></span><span className={`ls-status ${row.is_active ? 'is-active' : ''}`}><span />{row.is_active ? 'Active' : 'Inactive'}</span></div>
              <h3>{row.name}</h3><span className="ls-category"><FolderOpen size={12} aria-hidden="true" />{row.category?.trim() || 'Uncategorized'}</span>
              <div className="ls-card-price"><strong>{money(row.price_cents)}</strong><span>{pricingUnits[row.pricing]}</span></div>
              <p className="ls-pricing-method">{pricingLabels[row.pricing]}</p>
              <div className="ls-card-footer"><span>{row.is_active ? 'Available for new orders' : 'Hidden from new orders'}</span><Button variant="secondary" aria-label={`Edit ${row.name}`} onClick={() => openEditor(row)}><Pencil size={14} aria-hidden="true" />Edit</Button></div>
            </article>
          })}</div> : <div className="ls-empty" role="status"><span>{filtered ? <Search size={28} aria-hidden="true" /> : kind === 'services' ? <Shirt size={28} aria-hidden="true" /> : <PackagePlus size={28} aria-hidden="true" />}</span><h3>{filtered ? 'No items match these filters' : `Add your first ${label}`}</h3><p>{filtered ? 'Try another name, category or availability filter.' : kind === 'services' ? 'Set up services such as Wash, Dry & Fold so your team can start taking orders.' : 'Offer extras such as detergent or an extra rinse. Set the price and how each one is charged.'}</p>{filtered ? <Button variant="secondary" onClick={clearFilters}>Reset filters</Button> : <Button onClick={() => openEditor()}><Plus size={17} aria-hidden="true" />Create {label}</Button>}</div>}
          <footer className="ls-pagination"><p role="status">{visible.length ? `Showing ${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, visible.length)} of ${visible.length} ${kind === 'services' ? 'services' : 'add-ons'}` : `0 ${kind === 'services' ? 'services' : 'add-ons'}`}</p>{pages > 1 && <nav aria-label="Catalogue pages"><Button variant="secondary" aria-label="Previous catalogue page" disabled={currentPage === 1} onClick={() => goToPage(currentPage - 1)}><ChevronLeft size={16} aria-hidden="true" /></Button><span>Page {currentPage} of {pages}</span><Button variant="secondary" aria-label="Next catalogue page" disabled={currentPage === pages} onClick={() => goToPage(currentPage + 1)}><ChevronRight size={16} aria-hidden="true" /></Button></nav>}</footer>
        </>}
      </div>
    </section>
    <p className="ls-footer-note"><CircleCheck size={14} aria-hidden="true" />Inactive items stay in your catalogue and can be enabled again.</p>
    </div>
    {editing && createPortal(<BackLayer name="laundry-catalog-dialog" onBack={() => setEditing(null)} blocked={action.busy}>{close => <Modal
      title={`${editing.item.id ? 'Edit' : 'Add'} ${editing.kind === 'services' ? 'service' : 'add-on'}`}
      description="Set the details, pricing and availability for new orders."
      size="lg" mobileFullScreen preventClose={action.busy} onClose={close}
      panelClassName="ls-editor-panel max-h-full max-w-2xl" bodyClassName="ls-editor-body"
      footer={<><Button variant="secondary" disabled={action.busy} className="ls-editor-cancel" onClick={close}>Cancel</Button><Button type="submit" form={formId} disabled={action.busy || removing} className="ls-editor-save"><Check size={17} aria-hidden="true" />{action.busy ? 'Saving…' : 'Save item'}</Button></>}
    >
      <form id={formId} onSubmit={event => { event.preventDefault(); void save(close) }}>
        <fieldset className="ls-editor-fields" disabled={action.busy}>
          <legend className="sr-only">Catalogue item details</legend>
          {formError && <p className="laundry-error ls-form-error" role="alert" tabIndex={-1} ref={errorRef} id={errorId}>{formError}</p>}
          <div className="ls-editor-layout"><div className="ls-editor-inputs">
            <LaundryField label="Name" required maxLength={100} value={editing.item.name} placeholder={editing.kind === 'services' ? 'e.g. Wash, Dry & Fold' : 'e.g. Extra rinse'} onChange={event => editItem({ name: event.target.value })} />
            <LaundryField label="Category (optional)" maxLength={60} list={categoriesId} value={editing.item.category ?? ''} placeholder="e.g. Everyday laundry" onChange={event => editItem({ category: event.target.value })} />
            <datalist id={categoriesId}>{[...new Set((data.data?.[editing.kind] ?? []).map(row => row.category?.trim()).filter((value): value is string => !!value))].map(value => <option key={value} value={value} />)}</datalist>
            <label className="laundry-field"><span>Pricing method</span><select value={editing.item.pricing} onChange={event => editItem({ pricing: event.target.value as LaundryCatalog['pricing'] })}>{(editing.kind === 'services' ? ['kg', 'load', 'piece', 'fixed'] as const : ['fixed', 'quantity'] as const).map(pricing => <option key={pricing} value={pricing}>{pricingLabels[pricing]}</option>)}</select></label>
            <p className="ls-editor-hint">{pricingHints[editing.item.pricing]}</p>
            <LaundryField label="Unit price" type="number" min="0" max="1000000" step="0.01" inputMode="decimal" required value={editing.price} placeholder="0.00" onFocus={event => event.target.select()} onChange={event => { setFormError(''); setEditing({ ...editing, price: event.target.value }) }} />
            <label className="ls-active-control"><span><strong>Active</strong><small>{editing.item.is_active ? 'Available when creating new orders.' : 'Hidden from new orders. Saved orders are kept.'}</small></span><input type="checkbox" role="switch" checked={!!editing.item.is_active} onChange={event => editItem({ is_active: event.target.checked ? 1 : 0 })} /></label>
          </div><aside className="ls-preview" aria-labelledby="ls-preview-title"><h3 id="ls-preview-title">Catalogue preview</h3><span className="ls-preview-icon">{editing.kind === 'services' ? <Shirt size={27} aria-hidden="true" /> : <PackagePlus size={27} aria-hidden="true" />}</span><strong className="ls-preview-name">{editing.item.name.trim() || (editing.kind === 'services' ? 'Your service name' : 'Your add-on name')}</strong><p>{editing.item.category?.trim() || 'Uncategorized'}</p><div className="ls-preview-price"><strong>{previewPrice === null ? '—' : money(previewPrice)}</strong><span>{pricingUnits[editing.item.pricing]}</span></div><span className={`ls-status ${editing.item.is_active ? 'is-active' : ''}`}><span />{editing.item.is_active ? 'Active' : 'Inactive'}</span></aside></div>
          <p className="ls-editor-note"><Info size={15} aria-hidden="true" />Changes apply to future orders. Existing orders keep their saved prices and service details.</p>
          {editing.item.id && <div className="laundry-stack">{removing ? <><p role="alert">Remove {editing.item.name}? Its saved order history will be kept.</p><Button variant="danger" onClick={() => void action.run(async () => { await laundryApi.removeCatalog(editing.kind, editing.item.id!); close(); await data.reload(); notify('Item removed.') })}>Confirm remove item</Button><Button variant="ghost" onClick={() => setRemoving(false)}>Keep item</Button></> : <Button variant="ghost" onClick={() => setRemoving(true)}><Trash2 size={16} />Remove item</Button>}</div>}
        </fieldset>
      </form>
    </Modal>}</BackLayer>, document.body)}
  </div>
}
