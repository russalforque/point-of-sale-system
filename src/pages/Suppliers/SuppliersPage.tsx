import { useMemo, useState } from 'react'

import { supplierApi, type SupplierPayload } from '../../api/supplierApi'
import {
  DataCard,
  DesktopPage,
  DesktopSearch,
  EmptyRow,
  ErrorRow,
  FilterPills,
  HoverAction,
  LoadingRow,
  StatusCell,
  Th,
  Toolbar,
} from '../../components/ui/DesktopKit'
import { ChevronRight } from '../../components/ui/Icons'
import {
  AddButton,
  Avatar,
  ContactActions,
  DetailList,
  DetailRow,
  EMAIL_PATTERN,
  PrimaryButton,
  SwitchRow,
  TextAreaField,
  TextButton,
  TextField,
} from '../../components/ui/MobileKit'
import { ConfirmDialog, Modal } from '../../components/ui/Modal'
import { useToast } from '../../context/ToastContext'
import { useAsync } from '../../hooks/useAsync'
import { useDebounced } from '../../hooks/useDebounced'
import { useIsMobile } from '../../hooks/useIsMobile'
import type { Supplier } from '../../types'
import { getErrorMessage } from '../../utils/errors'
import { MobileSuppliers } from '../mobile/MobileSuppliers'

type StatusFilter = '' | 'active' | 'inactive'
type FormErrors = Partial<Record<'companyName' | 'email' | 'phone', string>>

const FORM_ID = 'supplier-form'

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

export function SuppliersPage() {
  const isMobile = useIsMobile()
  if (isMobile) return <MobileSuppliers />
  return <DesktopSuppliersPage />
}

function DesktopSuppliersPage() {
  const { notify } = useToast()

  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('')

  const [view, setView] = useState<Supplier | null>(null)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Supplier | null>(null)
  const [form, setForm] = useState<SupplierPayload>(emptyForm)
  const [initialForm, setInitialForm] = useState<SupplierPayload>(emptyForm)
  const [touched, setTouched] = useState<Partial<Record<keyof FormErrors, boolean>>>({})
  const [deactivate, setDeactivate] = useState<Supplier | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [busy, setBusy] = useState(false)

  const q = useDebounced(search).trim()

  // Load every status once (list isn't paged) so the filter counts are real totals.
  const { data, loading, error, reload } = useAsync(() => supplierApi.list({ search: q || undefined }), [q])
  const suppliers = useMemo(() => data ?? [], [data])

  const counts = useMemo(() => {
    const active = suppliers.filter((s) => s.isActive).length
    return { all: suppliers.length, active, inactive: suppliers.length - active }
  }, [suppliers])

  const filtered = suppliers.filter((s) => (status === '' ? true : status === 'active' ? s.isActive : !s.isActive))

  const errors = validate(form)
  const isValid = Object.keys(errors).length === 0
  const isDirty = JSON.stringify(form) !== JSON.stringify(initialForm)
  const hasFilters = q !== '' || status !== ''
  const fieldError = (key: keyof FormErrors) => (touched[key] ? errors[key] : undefined)

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
    <DesktopPage
      title="Suppliers"
      subtitle={data ? `${counts.all} ${counts.all === 1 ? 'supplier' : 'suppliers'} · ${counts.active} active` : 'Vendors and their contacts'}
      actions={<AddButton label="Add supplier" onClick={() => openForm(null)} />}
    >
      <Toolbar>
        <DesktopSearch value={search} onChange={setSearch} placeholder="Search company, contact or code" label="Search suppliers" />
        <FilterPills
          label="Supplier status"
          value={status}
          onChange={setStatus}
          options={[
            { key: '', label: 'All', count: data ? counts.all : undefined },
            { key: 'active', label: 'Active', count: data ? counts.active : undefined },
            { key: 'inactive', label: 'Inactive', count: data ? counts.inactive : undefined },
          ]}
        />
      </Toolbar>

      <DataCard className="mt-4">
        {loading && !data && <LoadingRow />}
        {!loading && error && <ErrorRow message={error} onRetry={() => void reload()} />}
        {!loading && !error && filtered.length === 0 && (
          <EmptyRow
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
          <div className="overflow-x-auto">
            <table className={`w-full text-left text-sm transition-opacity ${loading ? 'opacity-60' : ''}`}>
              <thead className="border-b border-slate-100 text-xs text-slate-500">
                <tr>
                  <Th className="pl-6">Supplier</Th>
                  <Th>Contact person</Th>
                  <Th>Phone</Th>
                  <Th className="hidden lg:table-cell">Email</Th>
                  <Th>Status</Th>
                  <Th className="pr-6">
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((supplier) => (
                  <tr key={supplier.id} onClick={() => setView(supplier)} className="group cursor-pointer hover:bg-slate-50">
                    <td className="py-3 pl-6 pr-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={supplier.companyName} inactive={!supplier.isActive} square />
                        <div className="min-w-0">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              setView(supplier)
                            }}
                            className={`block max-w-64 truncate text-left font-medium focus-visible:underline focus-visible:outline-none ${
                              supplier.isActive ? '' : 'text-slate-400'
                            }`}
                          >
                            {supplier.companyName}
                          </button>
                          <span className="text-xs text-slate-400">{supplier.supplierCode}</span>
                        </div>
                      </div>
                    </td>
                    <td className={`px-3 py-3 ${supplier.contactPerson ? '' : 'text-slate-300'}`}>{supplier.contactPerson || 'Not added'}</td>
                    <td className={`px-3 py-3 tabular-nums ${supplier.phone ? '' : 'text-slate-300'}`}>{supplier.phone || 'Not added'}</td>
                    <td className={`hidden max-w-60 truncate px-3 py-3 lg:table-cell ${supplier.email ? 'text-slate-600' : 'text-slate-300'}`}>
                      {supplier.email || 'Not added'}
                    </td>
                    <td className="px-3 py-3">
                      <StatusCell active={supplier.isActive} />
                    </td>
                    <td className="py-3 pl-3 pr-6">
                      <div className="flex items-center justify-end gap-1">
                        <HoverAction label="Edit" ariaLabel={`Edit ${supplier.companyName}`} onClick={() => openForm(supplier)} />
                        <ChevronRight size={12} className="text-slate-300" />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DataCard>

      {/* PROFILE */}
      {view && (
        <Modal
          title={view.companyName}
          description={`${view.supplierCode}${view.isActive ? '' : ' · Inactive'}`}
          size="lg"
          onClose={() => setView(null)}
          footer={
            <div className="flex w-full items-center gap-2">
              {view.isActive ? (
                <TextButton tone="danger" onClick={() => setDeactivate(view)} disabled={busy} className="h-12">
                  Deactivate
                </TextButton>
              ) : (
                <TextButton tone="accent" onClick={() => void reactivate(view)} disabled={busy} className="h-12">
                  {busy ? 'Activating…' : 'Reactivate'}
                </TextButton>
              )}
              <div className="flex-1" />
              <PrimaryButton onClick={() => openForm(view)} className="h-12 flex-none px-8">
                Edit details
              </PrimaryButton>
            </div>
          }
        >
          <div className="space-y-5">
            <ContactActions phone={view.phone} email={view.email} />
            <DetailList>
              <DetailRow label="Contact person" value={view.contactPerson} />
              <DetailRow label="Phone" value={view.phone} />
              <DetailRow label="Email" value={view.email} />
              <DetailRow label="Address" value={view.address} />
            </DetailList>
          </div>
        </Modal>
      )}

      {/* ADD / EDIT */}
      {open && (
        <Modal
          title={editing ? 'Edit supplier' : 'Add supplier'}
          description={editing ? editing.supplierCode : undefined}
          size="lg"
          onClose={requestCloseForm}
          preventClose={busy}
          footer={
            <div className="flex w-full items-center justify-end gap-2">
              <TextButton onClick={requestCloseForm} disabled={busy} className="h-12">
                Cancel
              </TextButton>
              <PrimaryButton type="submit" form={FORM_ID} disabled={busy || (editing !== null && !isDirty)} className="h-12 flex-none px-8">
                {busy ? 'Saving…' : editing ? (isDirty ? 'Save changes' : 'No changes') : 'Add supplier'}
              </PrimaryButton>
            </div>
          }
        >
          <form
            id={FORM_ID}
            noValidate
            onSubmit={(e) => {
              e.preventDefault()
              void save()
            }}
            className="space-y-4"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="Company name"
                value={form.companyName}
                onChange={(companyName) => setForm({ ...form, companyName })}
                onBlur={() => setTouched((t) => ({ ...t, companyName: true }))}
                error={fieldError('companyName')}
                placeholder="e.g. Metro Beverages Inc."
                autoFocus
                autoCapitalize="words"
              />
              <TextField
                label="Contact person"
                optional
                value={form.contactPerson ?? ''}
                onChange={(contactPerson) => setForm({ ...form, contactPerson })}
                placeholder="Who do you talk to?"
                autoCapitalize="words"
              />
              <TextField
                label="Phone"
                optional
                type="tel"
                inputMode="tel"
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
                autoCapitalize="none"
                value={form.email ?? ''}
                onChange={(email) => setForm({ ...form, email })}
                onBlur={() => setTouched((t) => ({ ...t, email: true }))}
                error={fieldError('email')}
                placeholder="e.g. orders@company.com"
              />
            </div>
            <TextAreaField
              label="Address"
              optional
              value={form.address ?? ''}
              onChange={(address) => setForm({ ...form, address })}
              placeholder="Warehouse or office address"
            />
            {editing && (
              <SwitchRow
                label="Active"
                description="Inactive suppliers can’t be linked to products"
                checked={form.isActive}
                onChange={(isActive) => setForm({ ...form, isActive })}
              />
            )}
          </form>
        </Modal>
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
    </DesktopPage>
  )
}

export default SuppliersPage
