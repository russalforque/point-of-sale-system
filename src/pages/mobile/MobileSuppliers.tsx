import { useState } from 'react'

import { supplierApi, type SupplierPayload } from '../../api/supplierApi'
import { Truck } from '../../components/ui/Icons'
import { Button } from '../../components/ui/Button'
import { Field, Input, Textarea } from '../../components/ui/Field'
import { FormSection } from '../../components/ui/FormSection'
import { ConfirmDialog, Modal } from '../../components/ui/Modal'
import { MobileEmpty, MobileError, MobileLoading, StickyToolbar } from '../../components/ui/MobileStates'
import { useToast } from '../../context/ToastContext'
import { useAsync } from '../../hooks/useAsync'
import type { Supplier } from '../../types'
import { getErrorMessage } from '../../utils/errors'

type StatusFilter = '' | 'active' | 'inactive'

const emptyForm: SupplierPayload = {
  companyName: '',
  contactPerson: '',
  phone: '',
  email: '',
  address: '',
  isActive: true,
}

export function MobileSuppliers() {
  const { notify } = useToast()

  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('')
  const [form, setForm] = useState<SupplierPayload>(emptyForm)
  const [editing, setEditing] = useState<Supplier | null>(null)
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<Supplier | null>(null)
  const [deactivate, setDeactivate] = useState<Supplier | null>(null)
  const [busy, setBusy] = useState(false)

  const { data, loading, error, reload } = useAsync(
    () =>
      supplierApi.list({
        search: search.trim() || undefined,
        isActive: status === '' ? undefined : status === 'active',
      }),
    [search, status],
  )

  const suppliersList = data ?? []

  function openCreate() {
    setEditing(null)
    setForm(emptyForm)
    setOpen(true)
  }

  function openEdit(supplier: Supplier) {
    setEditing(supplier)
    setForm({
      companyName: supplier.companyName,
      contactPerson: supplier.contactPerson ?? '',
      phone: supplier.phone ?? '',
      email: supplier.email ?? '',
      address: supplier.address ?? '',
      isActive: supplier.isActive,
    })
    setOpen(true)
  }

  function closeModals() {
    setOpen(false)
    setView(null)
  }

  async function save() {
    setBusy(true)
    try {
      if (editing) await supplierApi.update(editing.id, form)
      else await supplierApi.create(form)
      notify(editing ? 'Supplier updated.' : 'Supplier added.')
      closeModals()
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
      notify('Supplier deactivated.')
      setDeactivate(null)
      await reload()
    } catch (err) {
      notify(getErrorMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  function handleFilterStatus(target: StatusFilter) {
    setStatus((prev) => (prev === target ? '' : target))
  }

  const hasFilters = Boolean(search.trim() || status)
  const totalSuppliers = suppliersList.length
  const activeSuppliers = suppliersList.filter((s) => s.isActive).length
  const inactiveSuppliers = totalSuppliers - activeSuppliers

  return (
    <div className="min-h-screen bg-[#F6F8F7] pb-28 pt-[max(0.75rem,env(safe-area-inset-top,0px))] text-[#091413] antialiased">
      <main className="mx-auto w-full max-w-2xl px-4 sm:px-6">
        <header className="flex items-center justify-between gap-3 pb-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-black tracking-tight text-[#091413]">Suppliers</h1>
            <p className="mt-0.5 text-xs text-slate-500">Vendor accounts &amp; contacts</p>
          </div>
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-2xl bg-[#285A48] px-4 text-sm font-bold text-white shadow-md shadow-[#285A48]/20 active:scale-95 touch-manipulation"
          >
            <PlusIcon size={18} />
            <span>Add</span>
          </button>
        </header>

        <section className="grid grid-cols-3 gap-2">
          <MetricTile label="Total" value={totalSuppliers} active={status === ''} onClick={() => handleFilterStatus('')} />
          <MetricTile label="Active" value={activeSuppliers} tone="emerald" active={status === 'active'} onClick={() => handleFilterStatus('active')} />
          <MetricTile label="Inactive" value={inactiveSuppliers} tone="rose" active={status === 'inactive'} onClick={() => handleFilterStatus('inactive')} />
        </section>

        <StickyToolbar>
          <div className="relative mt-2">
            <SearchIcon size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search company, contact, or code..."
              className="h-12 w-full rounded-2xl border border-[#E5EBE7] bg-white pl-10 pr-9 text-sm font-medium text-[#091413] placeholder-slate-400 shadow-2xs outline-none transition focus:border-[#285A48] focus:ring-2 focus:ring-[#285A48]/15"
            />
          </div>
          {hasFilters && (
            <button
              type="button"
              onClick={() => {
                setSearch('')
                setStatus('')
              }}
              className="mt-2 text-xs font-bold text-[#285A48]"
            >
              Reset filters
            </button>
          )}
        </StickyToolbar>

        <section className="mt-2">
          {loading && <MobileLoading label="Loading suppliers…" />}

          {error && <MobileError message={error} onRetry={() => void reload()} />}

          {!loading && !error && suppliersList.length === 0 && (
            <MobileEmpty
              icon={<Truck size={22} />}
              title="No suppliers found"
              hint={hasFilters ? 'Try clearing filters or search a different keyword.' : 'Onboard your first vendor account.'}
              action={
                !hasFilters ? (
                  <Button onClick={openCreate} className="min-h-12 w-full text-sm">
                    Add Supplier
                  </Button>
                ) : undefined
              }
            />
          )}

          {!loading && !error && suppliersList.length > 0 && (
            <div className="space-y-3">
              {suppliersList.map((supplier) => (
                <article key={supplier.id} className="rounded-3xl border border-[#E5EBE7] bg-white p-4 shadow-xs">
                  <div className="flex items-start gap-3">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[#285A48]/20 bg-[#285A48]/10 text-sm font-bold text-[#285A48]">
                      {supplier.companyName.slice(0, 1).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-[#091413]">{supplier.companyName}</p>
                          <p className="text-[11px] font-mono text-slate-400">{supplier.supplierCode || 'No code'}</p>
                        </div>
                        <span
                          className={`shrink-0 inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold ${
                            supplier.isActive ? 'bg-[#EAF1EE] text-[#285A48]' : 'bg-slate-100 text-slate-500'
                          }`}
                        >
                          {supplier.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-xs text-slate-500">{supplier.contactPerson || 'No contact person'}</p>
                      <p className="text-xs font-mono text-slate-400">{supplier.phone || 'No phone'}</p>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3">
                    <button
                      type="button"
                      onClick={() => setView(supplier)}
                      className="flex h-11 flex-1 items-center justify-center rounded-xl border border-[#E5EBE7] bg-white text-xs font-bold text-slate-600 active:scale-95 touch-manipulation"
                    >
                      View
                    </button>
                    <button
                      type="button"
                      onClick={() => openEdit(supplier)}
                      className="flex h-11 flex-1 items-center justify-center rounded-xl border border-[#E5EBE7] bg-white text-xs font-bold text-[#285A48] active:scale-95 touch-manipulation"
                    >
                      Edit
                    </button>
                    {supplier.isActive && (
                      <button
                        type="button"
                        onClick={() => setDeactivate(supplier)}
                        aria-label="Deactivate supplier"
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-rose-200 bg-rose-50 text-rose-600 active:scale-95 touch-manipulation"
                      >
                        <TrashIcon size={15} />
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>

      {open && (
        <Modal
          title={editing ? 'Edit supplier' : 'Add supplier'}
          description={
            editing
              ? 'Update vendor contact details and status.'
              : 'Onboard a new vendor account.'
          }
          wide
          onClose={closeModals}
          preventClose={busy}
          footer={
            <div className="flex flex-col-reverse gap-2 w-full">
              <Button variant="secondary" onClick={closeModals} className="min-h-12 text-sm">
                Cancel
              </Button>
              <Button onClick={() => void save()} disabled={busy || !form.companyName.trim()} className="min-h-12 text-sm">
                {busy ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          }
        >
          <div className="space-y-5 text-sm">
            <FormSection title="Company Details">
              <Field label="Company name" required>
                <Input
                  value={form.companyName}
                  onChange={(e) => setForm({ ...form, companyName: e.target.value })}
                  className="min-h-12 rounded-2xl text-sm"
                  required
                />
              </Field>

              <Field label="Contact person">
                <Input
                  value={form.contactPerson}
                  onChange={(e) => setForm({ ...form, contactPerson: e.target.value })}
                  className="min-h-12 rounded-2xl text-sm"
                />
              </Field>
            </FormSection>

            <FormSection title="Contact Information">
              <Field label="Phone">
                <Input
                  type="tel"
                  inputMode="tel"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  className="min-h-12 rounded-2xl text-sm"
                />
              </Field>

              <Field label="Email">
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="min-h-12 rounded-2xl text-sm"
                />
              </Field>

              <Field label="Address">
                <Textarea
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  className="min-h-24 rounded-2xl text-sm"
                />
              </Field>
            </FormSection>

            <label className="flex min-h-12 items-center gap-3 rounded-2xl border border-[#E5EBE7] bg-white px-3.5 text-sm font-bold text-slate-700">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                className="h-5 w-5 rounded-md border-[#E5EBE7] text-[#285A48] focus:ring-[#285A48]"
              />
              Active supplier
            </label>
          </div>
        </Modal>
      )}

      {view && (
        <Modal title="Supplier details" onClose={closeModals}>
          <div className="divide-y divide-slate-100 text-sm">
            <DetailRow label="Code" value={view.supplierCode ?? '—'} />
            <DetailRow label="Company name" value={view.companyName} />
            <DetailRow label="Contact person" value={view.contactPerson ?? '—'} />
            <DetailRow label="Phone" value={view.phone ?? '—'} />
            <DetailRow label="Email" value={view.email ?? '—'} />
            <DetailRow label="Address" value={view.address ?? '—'} />
          </div>
          <Button onClick={() => openEdit(view)} className="mt-4 min-h-12 w-full text-sm">
            Edit Supplier
          </Button>
        </Modal>
      )}

      {deactivate && (
        <ConfirmDialog
          title="Deactivate supplier"
          message={`Deactivate ${deactivate.companyName}? It will no longer be available for purchasing orders.`}
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

function MetricTile({
  label,
  value,
  tone,
  active,
  onClick,
}: {
  label: string
  value: number
  tone?: 'emerald' | 'rose'
  active: boolean
  onClick: () => void
}) {
  const dot = tone === 'emerald' ? 'bg-emerald-500' : tone === 'rose' ? 'bg-rose-500' : null
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-17 flex-col items-center justify-center rounded-2xl border py-2 text-center transition-all active:scale-95 touch-manipulation ${
        active ? 'border-[#285A48] bg-white shadow-xs ring-1 ring-[#285A48]' : 'border-[#E5EBE7] bg-white'
      }`}
    >
      <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
        {dot && <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />}
        {label}
      </span>
      <span className="mt-1 text-lg font-black tabular-nums text-[#091413]">{value}</span>
    </button>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 py-2.5">
      <span className="text-slate-400 font-medium">{label}</span>
      <span className="text-[#091413] text-right font-bold">{value}</span>
    </div>
  )
}

function PlusIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

function SearchIcon({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}

function TrashIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </svg>
  )
}

export default MobileSuppliers
