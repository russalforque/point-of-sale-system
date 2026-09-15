import { useMemo, useState } from 'react'

import { supplierApi, type SupplierPayload } from '../../api/supplierApi'
import {
  AddButton,
  Avatar,
  ContactActions,
  DetailList,
  DetailRow,
  EMAIL_PATTERN,
  EmptyBlock,
  ErrorBlock,
  InactivePill,
  LoadingBlock,
  PageHeader,
  PrimaryButton,
  RowButton,
  SearchField,
  Segmented,
  Sheet,
  SheetBody,
  SheetFooter,
  SheetHeader,
  SwitchRow,
  TextAreaField,
  TextButton,
  TextField,
  useEscapeKey,
} from '../../components/ui/MobileKit'
import { ConfirmDialog } from '../../components/ui/Modal'
import { useToast } from '../../context/ToastContext'
import { useAsync } from '../../hooks/useAsync'
import { useDebounced } from '../../hooks/useDebounced'
import type { Supplier } from '../../types'
import { getErrorMessage } from '../../utils/errors'

type StatusFilter = '' | 'active' | 'inactive'
type FormErrors = Partial<Record<keyof SupplierPayload, string>>

const emptyForm: SupplierPayload = {
  companyName: '',
  contactPerson: '',
  phone: '',
  email: '',
  address: '',
  isActive: true,
}

function toForm(supplier: Supplier): SupplierPayload {
  return {
    companyName: supplier.companyName,
    contactPerson: supplier.contactPerson ?? '',
    phone: supplier.phone ?? '',
    email: supplier.email ?? '',
    address: supplier.address ?? '',
    isActive: supplier.isActive,
  }
}

function validate(form: SupplierPayload): FormErrors {
  const errors: FormErrors = {}
  if (!form.companyName.trim()) errors.companyName = 'Enter the company name.'
  if (form.email?.trim() && !EMAIL_PATTERN.test(form.email.trim())) errors.email = 'Enter a valid email, like orders@company.com.'
  if (form.phone?.trim() && form.phone.replace(/\D/g, '').length < 7) errors.phone = 'Phone number looks too short.'
  return errors
}

export function MobileSuppliers() {
  const { notify } = useToast()

  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('')

  const [view, setView] = useState<Supplier | null>(null)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Supplier | null>(null)
  const [form, setForm] = useState<SupplierPayload>(emptyForm)
  const [initialForm, setInitialForm] = useState<SupplierPayload>(emptyForm)
  const [touched, setTouched] = useState<Partial<Record<keyof SupplierPayload, boolean>>>({})
  const [deactivate, setDeactivate] = useState<Supplier | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [busy, setBusy] = useState(false)

  const q = useDebounced(search).trim()

  // Load every status once so the filter counts are real totals.
  const { data, loading, error, reload } = useAsync(() => supplierApi.list({ search: q || undefined }), [q])
  const suppliers = data ?? []

  const counts = useMemo(() => {
    const active = suppliers.filter((s) => s.isActive).length
    return { all: suppliers.length, active, inactive: suppliers.length - active }
  }, [suppliers])

  const filtered = suppliers.filter((s) => (status === '' ? true : status === 'active' ? s.isActive : !s.isActive))

  const errors = validate(form)
  const isValid = Object.keys(errors).length === 0
  const isDirty = JSON.stringify(form) !== JSON.stringify(initialForm)
  const hasFilters = q !== '' || status !== ''
  const fieldError = (key: keyof SupplierPayload) => (touched[key] ? errors[key] : undefined)

  function openForm(supplier: Supplier | null) {
    const next = supplier ? toForm(supplier) : { ...emptyForm }
    setEditing(supplier)
    setForm(next)
    setInitialForm(next)
    setTouched({})
    setView(null)
    setOpen(true)
  }

  function closeForm() {
    setOpen(false)
    setConfirmDiscard(false)
  }

  function requestCloseForm() {
    if (busy) return
    if (isDirty) setConfirmDiscard(true)
    else closeForm()
  }

  useEscapeKey(() => (open ? requestCloseForm() : setView(null)), (open || view !== null) && !deactivate && !confirmDiscard)

  async function save() {
    setTouched({ companyName: true, phone: true, email: true })
    if (!isValid || busy) return

    setBusy(true)
    try {
      const payload: SupplierPayload = {
        ...form,
        companyName: form.companyName.trim(),
        contactPerson: form.contactPerson?.trim(),
        phone: form.phone?.trim(),
        email: form.email?.trim(),
        address: form.address?.trim(),
      }
      const saved = editing ? await supplierApi.update(editing.id, payload) : await supplierApi.create(payload)
      notify(editing ? 'Changes saved.' : `${saved.companyName} added.`)
      closeForm()
      setView(saved)
      await reload()
    } catch (err) {
      notify(getErrorMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function confirmDeactivate() {
    if (!deactivate) return
    setBusy(true)
    try {
      await supplierApi.deactivate(deactivate.id)
      notify(`${deactivate.companyName} deactivated.`)
      if (view?.id === deactivate.id) setView({ ...view, isActive: false })
      setDeactivate(null)
      await reload()
    } catch (err) {
      notify(getErrorMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function reactivate(supplier: Supplier) {
    setBusy(true)
    try {
      const updated = await supplierApi.update(supplier.id, { ...toForm(supplier), isActive: true })
      notify(`${supplier.companyName} is active again.`)
      setView(updated)
      await reload()
    } catch (err) {
      notify(getErrorMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-full flex-col bg-white text-[#091413] antialiased">
      <PageHeader
        title="Suppliers"
        subtitle={data ? `${counts.active} active suppliers` : 'Vendors and their contacts'}
        action={<AddButton onClick={() => openForm(null)} />}
      >
        <SearchField value={search} onChange={setSearch} placeholder="Company, contact or code" label="Search suppliers" />
        <Segmented
          label="Supplier status"
          value={status}
          onChange={setStatus}
          options={[
            { key: '', label: 'All', count: data ? counts.all : undefined },
            { key: 'active', label: 'Active', count: data ? counts.active : undefined },
            { key: 'inactive', label: 'Inactive', count: data ? counts.inactive : undefined },
          ]}
        />
      </PageHeader>

      <main className="flex-1 px-5 pb-6">
        {loading && !data && <LoadingBlock />}
        {!loading && error && <ErrorBlock message={error} onRetry={() => void reload()} />}

        {!loading && !error && filtered.length === 0 && (
          <EmptyBlock
            title={hasFilters ? 'No suppliers found' : 'No suppliers yet'}
            hint={q ? `Nothing matches “${q}”.` : hasFilters ? 'No suppliers have this status.' : 'Add the vendors you buy stock from.'}
            actionLabel={hasFilters ? 'Clear filters' : 'Add first supplier'}
            secondary={hasFilters}
            onAction={
              hasFilters
                ? () => {
                    setSearch('')
                    setStatus('')
                  }
                : () => openForm(null)
            }
          />
        )}

        {filtered.length > 0 && (
          <ul className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
            {filtered.map((supplier) => (
              <li key={supplier.id} className="border-b border-slate-100 last:border-b-0">
                <RowButton onClick={() => setView(supplier)}>
                  <Avatar name={supplier.companyName} inactive={!supplier.isActive} square />
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-[15px] ${supplier.isActive ? '' : 'text-slate-400'}`}>{supplier.companyName}</p>
                    <p className="mt-0.5 truncate text-xs text-slate-400">
                      {[supplier.contactPerson, supplier.phone].filter(Boolean).join(' · ') || 'No contact info'}
                    </p>
                  </div>
                  {!supplier.isActive && <InactivePill />}
                </RowButton>
              </li>
            ))}
          </ul>
        )}
      </main>

      {/* PROFILE */}
      {view && (
        <Sheet label={`${view.companyName} details`} onClose={() => setView(null)}>
          <SheetHeader
            title={view.companyName}
            subtitle={
              <>
                {view.supplierCode}
                {!view.isActive && ' · Inactive'}
              </>
            }
            leading={<Avatar name={view.companyName} inactive={!view.isActive} large square />}
            onClose={() => setView(null)}
          />

          <SheetBody>
            <ContactActions phone={view.phone} email={view.email} />
            <DetailList>
              <DetailRow label="Contact person" value={view.contactPerson} />
              <DetailRow label="Phone" value={view.phone} />
              <DetailRow label="Email" value={view.email} />
              <DetailRow label="Address" value={view.address} />
            </DetailList>
          </SheetBody>

          <SheetFooter>
            {view.isActive ? (
              <TextButton tone="danger" onClick={() => setDeactivate(view)} disabled={busy}>
                Deactivate
              </TextButton>
            ) : (
              <TextButton tone="accent" onClick={() => void reactivate(view)} disabled={busy}>
                {busy ? 'Activating…' : 'Reactivate'}
              </TextButton>
            )}
            <PrimaryButton onClick={() => openForm(view)}>Edit details</PrimaryButton>
          </SheetFooter>
        </Sheet>
      )}

      {/* FORM */}
      {open && (
        <Sheet label={editing ? 'Edit supplier' : 'Add supplier'} onClose={requestCloseForm}>
          <form
            noValidate
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(e) => {
              e.preventDefault()
              void save()
            }}
          >
            <SheetHeader title={editing ? 'Edit supplier' : 'Add supplier'} onClose={requestCloseForm} closeDisabled={busy} />

            <SheetBody>
              <TextField
                label="Company name"
                value={form.companyName}
                onChange={(companyName) => setForm({ ...form, companyName })}
                onBlur={() => setTouched((t) => ({ ...t, companyName: true }))}
                error={fieldError('companyName')}
                placeholder="e.g. Metro Beverages Inc."
                autoFocus={!editing}
                autoComplete="organization"
                autoCapitalize="words"
              />
              <TextField
                label="Contact person"
                optional
                value={form.contactPerson ?? ''}
                onChange={(contactPerson) => setForm({ ...form, contactPerson })}
                placeholder="Who do you talk to?"
                autoComplete="name"
                autoCapitalize="words"
              />
              <TextField
                label="Phone"
                optional
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={form.phone ?? ''}
                onChange={(phone) => setForm({ ...form, phone })}
                onBlur={() => setTouched((t) => ({ ...t, phone: true }))}
                error={fieldError('phone')}
                placeholder="e.g. 0912 345 6789"
              />
              <TextField
                label="Email"
                optional
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                value={form.email ?? ''}
                onChange={(email) => setForm({ ...form, email })}
                onBlur={() => setTouched((t) => ({ ...t, email: true }))}
                error={fieldError('email')}
                placeholder="e.g. orders@company.com"
              />
              <TextAreaField
                label="Address"
                optional
                value={form.address ?? ''}
                onChange={(address) => setForm({ ...form, address })}
                placeholder="Warehouse or office address"
                autoComplete="street-address"
              />
              {editing && (
                <SwitchRow
                  label="Active"
                  description="Inactive suppliers can’t be linked to products"
                  checked={form.isActive}
                  onChange={(isActive) => setForm({ ...form, isActive })}
                />
              )}
            </SheetBody>

            <SheetFooter>
              <PrimaryButton type="submit" disabled={busy || (editing !== null && !isDirty)}>
                {busy ? 'Saving…' : editing ? (isDirty ? 'Save changes' : 'No changes') : 'Add supplier'}
              </PrimaryButton>
            </SheetFooter>
          </form>
        </Sheet>
      )}

      {confirmDiscard && (
        <ConfirmDialog
          title="Discard changes?"
          message="The information you entered will not be saved."
          confirmLabel="Discard"
          danger
          onCancel={() => setConfirmDiscard(false)}
          onConfirm={closeForm}
        />
      )}

      {deactivate && (
        <ConfirmDialog
          title={`Deactivate ${deactivate.companyName}?`}
          message="They won’t be available when adding products. Their details are kept, and you can reactivate them anytime."
          confirmLabel="Deactivate"
          danger
          busy={busy}
          onCancel={() => setDeactivate(null)}
          onConfirm={() => void confirmDeactivate()}
        />
      )}
    </div>
  )
}

export default MobileSuppliers
