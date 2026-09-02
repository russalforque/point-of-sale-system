import { useState } from 'react'
import { supplierApi, type SupplierPayload } from '../../api/supplierApi'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Field, Input, Select, Textarea } from '../../components/ui/Field'
import { ConfirmDialog, Modal } from '../../components/ui/Modal'
import { Card, PageHeader, TableWrap } from '../../components/ui/Page'
import { EmptyState, ErrorState, Spinner } from '../../components/ui/States'
import { useToast } from '../../context/ToastContext'
import { useAsync } from '../../hooks/useAsync'
import type { Supplier } from '../../types'
import { getErrorMessage } from '../../utils/errors'

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
  const [status, setStatus] = useState('')
  const [form, setForm] = useState<SupplierPayload>(emptyForm)
  const [editing, setEditing] = useState<Supplier | null>(null)
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<Supplier | null>(null)
  const [deactivate, setDeactivate] = useState<Supplier | null>(null)
  const [busy, setBusy] = useState(false)

  const { data, loading, error, reload } = useAsync(
    () =>
      supplierApi.list({
        search: search || undefined,
        isActive: status === '' ? undefined : status === 'active',
      }),
    [search, status],
  )

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

  async function save() {
    setBusy(true)
    try {
      if (editing) await supplierApi.update(editing.id, form)
      else await supplierApi.create(form)
      notify(editing ? 'Supplier updated.' : 'Supplier added.')
      setOpen(false)
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

  const totalSuppliers = data?.length ?? 0
  const activeSuppliers = data?.filter((supplier) => supplier.isActive).length ?? 0
  const inactiveSuppliers = totalSuppliers - activeSuppliers

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-7xl px-4 pb-6 pt-4 sm:px-5 lg:px-6">
        <PageHeader
          title="Suppliers"
          subtitle="Vendor accounts for purchasing"
          actions={
            <Button
              onClick={openCreate}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-900 px-3.5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-slate-200/50 transition-all duration-150 hover:-translate-y-0.5 hover:bg-slate-700 active:translate-y-0"
            >
              + Add supplier
            </Button>
          }
        />

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Card className="overflow-hidden border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/50 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Total suppliers
              </p>
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-sm shadow-emerald-200" />
            </div>
            <p className="mt-4 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
              {totalSuppliers}
            </p>
            <div className="mt-3 flex items-center gap-2 text-[11px] text-slate-500">
              <span className="rounded-full bg-slate-100 px-2 py-1 font-medium text-slate-600">
                Network
              </span>
              <span>Active roster</span>
            </div>
          </Card>

          <Card className="overflow-hidden border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/50 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Active
              </p>
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-sm shadow-emerald-200" />
            </div>
            <p className="mt-4 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
              {activeSuppliers}
            </p>
            <div className="mt-3 flex items-center gap-2 text-[11px] text-slate-500">
              <span className="rounded-full bg-emerald-50 px-2 py-1 font-medium text-emerald-700">
                Live
              </span>
              <span>Available</span>
            </div>
          </Card>

          <Card className="overflow-hidden border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/50 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Inactive
              </p>
              <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
            </div>
            <p className="mt-4 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
              {inactiveSuppliers}
            </p>
            <div className="mt-3 flex items-center gap-2 text-[11px] text-slate-500">
              <span className="rounded-full bg-slate-100 px-2 py-1 font-medium text-slate-600">
                Paused
              </span>
              <span>On hold</span>
            </div>
          </Card>
        </section>

        <section className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/50">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="relative w-full md:max-w-md">
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="m21 21-4.35-4.35m1.35-5.65a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z"
                    />
                  </svg>
                </span>
                <Input
                  placeholder="Search company, contact, code…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-11 w-full appearance-none rounded-full border border-slate-200 bg-white pl-10 pr-10 text-sm text-slate-700 shadow-sm shadow-slate-200/60 outline-none transition-all duration-150 focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
                />
                {search ? (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    aria-label="Clear search"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    ×
                  </button>
                ) : null}
              </div>

              <div className="rounded-full border border-slate-200 bg-white px-3 py-2 shadow-sm shadow-slate-200/50">
                <Select value={status} onChange={(e) => setStatus(e.target.value)} className="bg-transparent text-sm text-slate-700 outline-none">
                  <option value="">All statuses</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </Select>
              </div>
            </div>
          </div>

          {loading ? (
            <div className="flex min-h-72 items-center justify-center p-6">
              <Spinner />
            </div>
          ) : null}

          {error ? (
            <div className="p-6">
              <ErrorState message={error} onRetry={() => void reload()} />
            </div>
          ) : null}

          {!loading && !error && data && data.length === 0 ? (
            <div className="p-8">
              <EmptyState title="No suppliers found" />
            </div>
          ) : null}

          {!loading && data && data.length > 0 ? (
            <>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[760px] border-separate border-spacing-0 text-left text-sm">
                  <thead className="bg-white">
                    <tr>
                      <th className="border-b border-slate-200 px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Code
                      </th>
                      <th className="border-b border-slate-200 px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Company
                      </th>
                      <th className="border-b border-slate-200 px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Contact
                      </th>
                      <th className="border-b border-slate-200 px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Phone
                      </th>
                      <th className="border-b border-slate-200 px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Status
                      </th>
                      <th className="border-b border-slate-200 px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((s) => (
                      <tr key={s.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                        <td className="px-4 py-3 text-[13px] font-medium text-slate-500">
                          {s.supplierCode}
                        </td>
                        <td className="px-4 py-3 text-[13px] font-medium text-slate-800">
                          {s.companyName}
                        </td>
                        <td className="px-4 py-3 text-[13px] text-slate-600">
                          {s.contactPerson ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-[13px] text-slate-600">
                          {s.phone ?? '—'}
                        </td>
                        <td className="px-4 py-3">
                          <Badge tone={s.isActive ? 'green' : 'gray'}>{s.isActive ? 'Active' : 'Inactive'}</Badge>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900" onClick={() => setView(s)}>
                              View
                            </button>
                            <button className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900" onClick={() => openEdit(s)}>
                              Edit
                            </button>
                            {s.isActive ? (
                              <button className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-red-600 transition hover:bg-red-50" onClick={() => setDeactivate(s)}>
                                Deactivate
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="space-y-3 p-3 md:hidden">
                {data.map((s) => (
                  <div key={s.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">
                          {s.supplierCode}
                        </p>
                        <h3 className="mt-1 text-base font-semibold text-slate-900">{s.companyName}</h3>
                        <p className="mt-1 text-sm text-slate-600">{s.contactPerson ?? 'No contact person'}</p>
                      </div>
                      <Badge tone={s.isActive ? 'green' : 'gray'}>{s.isActive ? 'Active' : 'Inactive'}</Badge>
                    </div>

                    <div className="mt-3 space-y-1 border-t border-slate-200 pt-3 text-sm text-slate-600">
                      <div className="flex items-center justify-between gap-3">
                        <span>Phone</span>
                        <span className="font-medium text-slate-800">{s.phone ?? '—'}</span>
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <button className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700" onClick={() => setView(s)}>
                        View
                      </button>
                      <button className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700" onClick={() => openEdit(s)}>
                        Edit
                      </button>
                      {s.isActive ? (
                        <button className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700" onClick={() => setDeactivate(s)}>
                          Pause
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </section>
      </div>

      {open ? (
        <Modal
          title={editing ? 'Edit supplier' : 'Add supplier'}
          onClose={() => setOpen(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => void save()} disabled={busy || !form.companyName.trim()}>
                {busy ? 'Saving…' : 'Save'}
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            <Field label="Company name">
              <Input value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} />
            </Field>
            <Field label="Contact person">
              <Input value={form.contactPerson} onChange={(e) => setForm({ ...form, contactPerson: e.target.value })} />
            </Field>
            <Field label="Phone">
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </Field>
            <Field label="Email">
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
            <Field label="Address">
              <Textarea value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              />
              Active
            </label>
          </div>
        </Modal>
      ) : null}

      {view ? (
        <Modal title="Supplier details" onClose={() => setView(null)}>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-gray-500">Code</dt>
              <dd>{view.supplierCode}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Company</dt>
              <dd>{view.companyName}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Contact</dt>
              <dd>{view.contactPerson ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Phone</dt>
              <dd>{view.phone ?? '—'}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-gray-500">Email</dt>
              <dd>{view.email ?? '—'}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-gray-500">Address</dt>
              <dd>{view.address ?? '—'}</dd>
            </div>
          </dl>
        </Modal>
      ) : null}

      {deactivate ? (
        <ConfirmDialog
          title="Deactivate supplier"
          message={`Deactivate ${deactivate.companyName}?`}
          confirmLabel="Deactivate"
          danger
          busy={busy}
          onCancel={() => setDeactivate(null)}
          onConfirm={() => void confirmDeactivate()}
        />
      ) : null}
    </div>
  )
}
