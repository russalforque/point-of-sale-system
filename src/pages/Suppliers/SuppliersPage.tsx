import { useState } from 'react'
import {
  Eye,
  Pencil,
  Plus,
  Search,
  Trash2,
} from '../../components/ui/Icons'

import { supplierApi, type SupplierPayload } from '../../api/supplierApi'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Field, Input, Textarea } from '../../components/ui/Field'
import { ConfirmDialog, Modal } from '../../components/ui/Modal'
import { PageHeader } from '../../components/ui/Page'
import { EmptyState, ErrorState, Spinner } from '../../components/ui/States'
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

export function SuppliersPage() {
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

  const suppliersList = (Array.isArray(data) ? data : (data as any)?.items ?? []) as Supplier[]

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

  function handleFilterStatus(targetStatus: StatusFilter) {
    setStatus((prev) => (prev === targetStatus ? '' : targetStatus))
  }

  function resetFilters() {
    setSearch('')
    setStatus('')
  }

  const hasFilters = Boolean(search.trim() || status)
  const totalSuppliers = suppliersList.length
  const activeSuppliers = suppliersList.filter((supplier) => supplier.isActive).length
  const inactiveSuppliers = totalSuppliers - activeSuppliers

  return (
    <div className="min-h-screen bg-[#091413]/[0.02] text-[#091413] antialiased">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 md:px-8">
        {/* Page Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <PageHeader
            title="Suppliers"
            subtitle="Vendor accounts and purchasing contacts"
          />
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center justify-center gap-2 self-start rounded-lg bg-[#285A48] px-3.5 py-2 text-xs font-medium text-white shadow-xs transition-colors hover:bg-[#1e4537] active:scale-[0.98] sm:self-auto"
          >
            <Plus size={15} />
            <span>Add supplier</span>
          </button>
        </div>

        {/* Interactive KPI Cards */}
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <MetricCard
            label="Total"
            value={totalSuppliers}
            isSelected={status === ''}
            onClick={() => handleFilterStatus('')}
          />
          <MetricCard
            label="Active"
            value={activeSuppliers}
            indicator="pine"
            isSelected={status === 'active'}
            onClick={() => handleFilterStatus('active')}
          />
          <MetricCard
            label="Inactive"
            value={inactiveSuppliers}
            indicator="rose"
            isSelected={status === 'inactive'}
            onClick={() => handleFilterStatus('inactive')}
          />
        </div>

        {/* Filter Toolbar */}
        <div className="mt-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          {/* Segmented Status Pills */}
          <div className="flex flex-wrap items-center gap-1 rounded-lg border border-[#091413]/10 bg-[#091413]/[0.04] p-0.5 self-start">
            <button
              type="button"
              onClick={() => handleFilterStatus('')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                status === ''
                  ? 'bg-white text-[#091413] shadow-xs'
                  : 'text-[#091413]/60 hover:text-[#091413]'
              }`}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => handleFilterStatus('active')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                status === 'active'
                  ? 'bg-white text-[#091413] shadow-xs'
                  : 'text-[#091413]/60 hover:text-[#091413]'
              }`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-[#285A48]" />
              Active
            </button>
            <button
              type="button"
              onClick={() => handleFilterStatus('inactive')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                status === 'inactive'
                  ? 'bg-white text-[#091413] shadow-xs'
                  : 'text-[#091413]/60 hover:text-[#091413]'
              }`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
              Inactive
            </button>
          </div>

          {/* Search Input & Reset */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 flex-1 lg:max-w-md lg:justify-end">
            <div className="relative w-full">
              <Search
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#091413]/40"
              />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search company, contact, or code..."
                className="h-9 w-full rounded-lg border border-[#091413]/15 bg-white pl-8.5 pr-8 text-xs text-[#091413] placeholder-[#091413]/40 outline-none transition-colors focus:border-[#285A48] focus:ring-1 focus:ring-[#285A48]"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-[#091413]/40 hover:text-[#091413]"
                  title="Clear search"
                >
                  <ClearIcon size={13} />
                </button>
              )}
            </div>

            {hasFilters && (
              <button
                type="button"
                onClick={resetFilters}
                className="shrink-0 rounded-lg border border-[#091413]/15 bg-white px-3 py-2 text-xs font-medium text-[#091413]/70 transition-colors hover:bg-[#091413]/[0.03] hover:text-[#091413]"
              >
                Reset
              </button>
            )}
          </div>
        </div>

        {/* Suppliers Table Container */}
        <main className="mt-4 overflow-hidden rounded-xl border border-[#091413]/10 bg-white shadow-xs">
          {loading && (
            <div className="py-16">
              <Spinner />
            </div>
          )}

          {error && (
            <div className="p-6">
              <ErrorState message={error} onRetry={() => void reload()} />
            </div>
          )}

          {!loading && !error && suppliersList.length === 0 && (
            <div className="p-8 text-center">
              <EmptyState
                title="No suppliers found"
                hint={
                  hasFilters
                    ? 'Try clearing active filters or searching a different keyword.'
                    : 'Get started by onboarding your first vendor account.'
                }
              />
              {hasFilters && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-[#285A48] underline hover:text-[#1e4537]"
                >
                  Clear all filters
                </button>
              )}
            </div>
          )}

          {!loading && !error && suppliersList.length > 0 && (
            <>
              {/* Tablet & Desktop Table */}
              <div className="hidden md:block w-full overflow-x-auto">
                <table className="w-full text-left text-xs text-[#091413]/80">
                  <thead className="border-b border-[#091413]/10 bg-[#091413]/[0.02] text-[11px] font-medium uppercase tracking-wider text-[#091413]/50">
                    <tr>
                      <th className="py-3 pl-4 pr-3 sm:pl-6 font-medium">Supplier</th>
                      <th className="py-3 px-3 font-medium">Contact Person</th>
                      <th className="py-3 px-3 font-medium">Phone</th>
                      <th className="hidden py-3 px-3 lg:table-cell font-medium">Email</th>
                      <th className="py-3 px-3 text-center font-medium">Status</th>
                      <th className="py-3 pl-3 pr-4 sm:pr-6 text-right font-medium">Actions</th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-[#091413]/5 font-normal">
                    {suppliersList.map((supplier) => (
                      <tr
                        key={supplier.id}
                        className="transition-colors hover:bg-[#285A48]/[0.03]"
                      >
                        <td className="py-3.5 pl-4 pr-3 sm:pl-6">
                          <SupplierIdentity supplier={supplier} />
                        </td>

                        <td className="py-3.5 px-3 text-[#091413]">
                          {supplier.contactPerson || '—'}
                        </td>

                        <td className="py-3.5 px-3 font-mono text-[#091413]/70">
                          {supplier.phone || '—'}
                        </td>

                        <td className="hidden py-3.5 px-3 text-[#091413]/60 lg:table-cell">
                          {supplier.email || '—'}
                        </td>

                        <td className="py-3.5 px-3 text-center">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${
                              supplier.isActive
                                ? 'bg-[#285A48]/10 text-[#285A48] border border-[#285A48]/20'
                                : 'bg-[#091413]/[0.05] text-[#091413]/60 border border-[#091413]/10'
                            }`}
                          >
                            {supplier.isActive ? 'Active' : 'Inactive'}
                          </span>
                        </td>

                        <td className="py-3.5 pl-3 pr-4 sm:pr-6 text-right">
                          <RowActions
                            onView={() => setView(supplier)}
                            onEdit={() => openEdit(supplier)}
                            onDeactivate={() => setDeactivate(supplier)}
                            showDeactivate={supplier.isActive}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile Compact Cards (<md) */}
              <div className="divide-y divide-[#091413]/5 md:hidden">
                {suppliersList.map((supplier) => (
                  <SupplierCard
                    key={supplier.id}
                    supplier={supplier}
                    onView={() => setView(supplier)}
                    onEdit={() => openEdit(supplier)}
                    onDeactivate={() => setDeactivate(supplier)}
                  />
                ))}
              </div>
            </>
          )}
        </main>
      </div>

      {/* =====================================================
          ADD / EDIT SUPPLIER MODAL
      ====================================================== */}
      {open && (
        <Modal
          title={editing ? 'Edit supplier' : 'Add supplier'}
          wide
          onClose={closeModals}
          footer={
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="secondary" onClick={closeModals}>
                Cancel
              </Button>
              <button
                type="button"
                onClick={() => void save()}
                disabled={busy || !form.companyName.trim()}
                className="inline-flex items-center justify-center rounded-lg bg-[#285A48] px-4 py-2 text-xs font-medium text-white shadow-xs transition-colors hover:bg-[#1e4537] disabled:opacity-50"
              >
                {busy ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          }
        >
          <div className="grid gap-4 sm:grid-cols-2 text-xs">
            <div className="sm:col-span-2">
              <Field label="Company name">
                <Input
                  value={form.companyName}
                  onChange={(e) =>
                    setForm({ ...form, companyName: e.target.value })
                  }
                  required
                />
              </Field>
            </div>

            <Field label="Contact person">
              <Input
                value={form.contactPerson}
                onChange={(e) =>
                  setForm({ ...form, contactPerson: e.target.value })
                }
              />
            </Field>

            <Field label="Phone">
              <Input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </Field>

            <div className="sm:col-span-2">
              <Field label="Email">
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </Field>
            </div>

            <div className="sm:col-span-2">
              <Field label="Address">
                <Textarea
                  value={form.address}
                  onChange={(e) =>
                    setForm({ ...form, address: e.target.value })
                  }
                />
              </Field>
            </div>

            <label className="flex items-center gap-2 text-xs font-medium text-[#091413]/80 sm:col-span-2 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) =>
                  setForm({ ...form, isActive: e.target.checked })
                }
                className="h-4 w-4 rounded border-[#091413]/20 text-[#285A48] focus:ring-[#285A48]"
              />
              Active supplier
            </label>
          </div>
        </Modal>
      )}

      {/* =====================================================
          SUPPLIER DETAIL MODAL
      ====================================================== */}
      {view && (
        <Modal title="Supplier details" onClose={closeModals}>
          <div className="divide-y divide-[#091413]/5 text-xs">
            <DetailRow label="Code" value={view.supplierCode ?? '—'} mono />
            <DetailRow label="Company name" value={view.companyName} />
            <DetailRow label="Contact person" value={view.contactPerson ?? '—'} />
            <DetailRow label="Phone" value={view.phone ?? '—'} mono />
            <DetailRow label="Email" value={view.email ?? '—'} />
            <DetailRow label="Address" value={view.address ?? '—'} />
            <DetailRow
              label="Status"
              value={
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${
                    view.isActive
                      ? 'bg-[#285A48]/10 text-[#285A48] border border-[#285A48]/20'
                      : 'bg-[#091413]/[0.05] text-[#091413]/60 border border-[#091413]/10'
                  }`}
                >
                  {view.isActive ? 'Active' : 'Inactive'}
                </span>
              }
            />
          </div>
        </Modal>
      )}

      {/* =====================================================
          DEACTIVATE DIALOG
      ====================================================== */}
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

/* =============================================================
   REFINED MICRO-COMPONENTS
============================================================= */

function MetricCard({
  label,
  value,
  indicator,
  isSelected = false,
  onClick,
}: {
  label: string
  value: string | number
  indicator?: 'pine' | 'amber' | 'rose'
  isSelected?: boolean
  onClick: () => void
}) {
  const dotColor =
    indicator === 'pine'
      ? 'bg-[#285A48]'
      : indicator === 'amber'
        ? 'bg-amber-500'
        : indicator === 'rose'
          ? 'bg-rose-500'
          : null

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative rounded-xl border p-3.5 sm:p-4 text-left transition-all active:scale-[0.99] ${
        isSelected
          ? 'border-[#285A48] bg-white ring-1 ring-[#285A48] shadow-xs'
          : 'border-[#091413]/10 bg-white hover:border-[#285A48]/50'
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wider text-[#091413]/50">
          {label}
        </span>
        {dotColor && <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} />}
      </div>
      <p className="mt-2 text-xl font-semibold tracking-tight text-[#091413] sm:text-2xl">
        {value}
      </p>
    </button>
  )
}

function SupplierIdentity({ supplier }: { supplier: Supplier }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className="h-9 w-9 shrink-0 overflow-hidden rounded-lg border border-[#285A48]/20 bg-[#285A48]/10 flex items-center justify-center text-xs font-semibold text-[#285A48]">
        {supplier.companyName.slice(0, 1).toUpperCase()}
      </div>

      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-[#091413]">
          {supplier.companyName}
        </p>
        <p className="truncate font-mono text-[11px] text-[#091413]/40">
          {supplier.supplierCode || 'No code'}
        </p>
      </div>
    </div>
  )
}

function RowActions({
  onView,
  onEdit,
  onDeactivate,
  showDeactivate,
}: {
  onView: () => void
  onEdit: () => void
  onDeactivate: () => void
  showDeactivate: boolean
}) {
  return (
    <div className="flex items-center justify-end gap-1">
      <button
        type="button"
        title="View details"
        aria-label="View details"
        onClick={onView}
        className="flex h-8 w-8 items-center justify-center rounded-md text-[#091413]/40 transition-colors hover:bg-[#285A48]/10 hover:text-[#285A48] active:scale-95"
      >
        <Eye size={15} />
      </button>

      <button
        type="button"
        title="Edit supplier"
        aria-label="Edit supplier"
        onClick={onEdit}
        className="flex h-8 w-8 items-center justify-center rounded-md text-[#091413]/40 transition-colors hover:bg-[#285A48]/10 hover:text-[#285A48] active:scale-95"
      >
        <Pencil size={15} />
      </button>

      {showDeactivate && (
        <button
          type="button"
          title="Deactivate supplier"
          aria-label="Deactivate supplier"
          onClick={onDeactivate}
          className="flex h-8 w-8 items-center justify-center rounded-md text-[#091413]/40 transition-colors hover:bg-rose-50 hover:text-rose-600 active:scale-95"
        >
          <Trash2 size={15} />
        </button>
      )}
    </div>
  )
}

function SupplierCard({
  supplier,
  onView,
  onEdit,
  onDeactivate,
}: {
  supplier: Supplier
  onView: () => void
  onEdit: () => void
  onDeactivate: () => void
}) {
  return (
    <div className="flex items-center gap-3 p-3.5">
      <SupplierIdentity supplier={supplier} />

      <div className="ml-auto flex shrink-0 items-center gap-3">
        <div className="text-right hidden sm:block">
          <p className="text-xs font-medium text-[#091413]">
            {supplier.contactPerson || '—'}
          </p>
          <p className="text-[11px] font-mono text-[#091413]/50">
            {supplier.phone || '—'}
          </p>
        </div>

        <RowActions
          onView={onView}
          onEdit={onEdit}
          onDeactivate={onDeactivate}
          showDeactivate={supplier.isActive}
        />
      </div>
    </div>
  )
}

function DetailRow({
  label,
  value,
  mono = false,
}: {
  label: string
  value: React.ReactNode
  mono?: boolean
}) {
  return (
    <div className="flex justify-between items-center py-2.5">
      <span className="text-[#091413]/50">{label}</span>
      <span
        className={`text-[#091413] text-right ${
          mono ? 'font-mono' : 'font-medium'
        }`}
      >
        {value}
      </span>
    </div>
  )
}

function ClearIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}