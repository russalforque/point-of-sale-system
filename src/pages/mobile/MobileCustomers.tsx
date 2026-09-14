import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { customerApi, type CustomerPayload } from '../../api/customerApi'
import { Users } from '../../components/ui/Icons'
import { Button } from '../../components/ui/Button'
import { Field, Input, Textarea } from '../../components/ui/Field'
import { FormSection } from '../../components/ui/FormSection'
import { ConfirmDialog, Modal } from '../../components/ui/Modal'
import { Pagination } from '../../components/ui/Pagination'
import { MobileEmpty, MobileError, MobileLoading, StickyToolbar } from '../../components/ui/MobileStates'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { useAsync } from '../../hooks/useAsync'
import type { Customer } from '../../types'
import { getErrorMessage } from '../../utils/errors'
import { formatDate } from '../../utils/format'

const emptyForm: CustomerPayload = {
  fullName: '',
  phone: '',
  email: '',
  address: '',
  isActive: true,
}

function getInitials(name: string): string {
  if (!name) return '?'
  const parts = name.trim().split(' ').filter(Boolean)
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase()
}

export function MobileCustomers() {
  const { notify } = useToast()
  const { can } = useAuth()
  const canManage = can('customers.manage')
  const navigate = useNavigate()
  const location = useLocation()

  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'' | 'active' | 'inactive'>('')
  const [page, setPage] = useState(1)

  const [form, setForm] = useState<CustomerPayload>(emptyForm)
  const [editing, setEditing] = useState<Customer | null>(null)
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<Customer | null>(null)
  const [deactivate, setDeactivate] = useState<Customer | null>(null)
  const [busy, setBusy] = useState(false)

  const { data, loading, error, reload } = useAsync(
    () =>
      customerApi.list({
        search: search.trim() || undefined,
        isActive: status === '' ? undefined : status === 'active',
        page,
        pageSize: 10,
      }),
    [search, status, page],
  )

  const totalCustomers = data?.totalCount ?? 0
  const activeCustomers = data?.items.filter((c) => c.isActive).length ?? 0
  const inactiveCustomers = data?.items.filter((c) => !c.isActive).length ?? 0

  const hasActiveFilters = search.trim() !== '' || status !== ''

  useEffect(() => {
    const path = location.pathname
    if (path === '/customers/create') {
      setEditing(null)
      setForm(emptyForm)
      setOpen(true)
      setView(null)
      return
    }
    const editMatch = path.match(/^\/customers\/edit\/(\d+)$/)
    const viewMatch = path.match(/^\/customers\/(\d+)$/)
    const id = editMatch?.[1] ?? viewMatch?.[1]
    if (!id) {
      setOpen(false)
      setView(null)
      return
    }
    if (editMatch && !canManage) {
      navigate('/customers', { replace: true })
      return
    }
    void customerApi
      .get(Number(id))
      .then((customer) => {
        if (editMatch) {
          setEditing(customer)
          setForm({
            fullName: customer.fullName,
            phone: customer.phone ?? '',
            email: customer.email ?? '',
            address: customer.address ?? '',
            isActive: customer.isActive,
          })
          setOpen(true)
          setView(null)
        } else {
          setView(customer)
          setOpen(false)
        }
      })
      .catch((err) => {
        notify(getErrorMessage(err), 'error')
        navigate('/customers')
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, navigate, notify, canManage])

  function closeModals() {
    setOpen(false)
    setView(null)
    if (location.pathname !== '/customers') navigate('/customers')
  }

  function openCreate() {
    navigate('/customers/create')
  }

  function openEdit(customer: Customer) {
    navigate(`/customers/edit/${customer.id}`)
  }

  async function save() {
    setBusy(true)
    try {
      if (editing) await customerApi.update(editing.id, form)
      else await customerApi.create(form)
      notify(editing ? 'Customer profile updated.' : 'Customer added to directory.')
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
      await customerApi.deactivate(deactivate.id)
      notify('Customer account deactivated.')
      setDeactivate(null)
      await reload()
    } catch (err) {
      notify(getErrorMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  function handleStatusChange(next: '' | 'active' | 'inactive') {
    setStatus(next)
    setPage(1)
  }

  return (
    <div className="min-h-screen bg-[#F6F8F7] pb-28 pt-[max(0.75rem,env(safe-area-inset-top,0px))] text-[#091413] antialiased">
      <main className="mx-auto w-full max-w-2xl px-4 sm:px-6">
        <header className="flex items-center justify-between gap-3 pb-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-black tracking-tight text-[#091413]">Customers</h1>
            <p className="mt-0.5 text-xs text-slate-500">Directory &amp; loyalty accounts</p>
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
          <MetricTile label="Total" value={totalCustomers} active={status === ''} onClick={() => handleStatusChange('')} />
          <MetricTile label="Active" value={activeCustomers} tone="emerald" active={status === 'active'} onClick={() => handleStatusChange('active')} />
          <MetricTile label="Inactive" value={inactiveCustomers} active={status === 'inactive'} onClick={() => handleStatusChange('inactive')} />
        </section>

        <StickyToolbar>
          <div className="relative mt-2">
            <SearchIcon size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
              placeholder="Search by name, phone, code..."
              className="h-12 w-full rounded-2xl border border-[#E5EBE7] bg-white pl-10 pr-9 text-sm font-medium text-[#091413] placeholder-slate-400 shadow-2xs outline-none transition focus:border-[#285A48] focus:ring-2 focus:ring-[#285A48]/15"
            />
          </div>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={() => {
                setSearch('')
                setStatus('')
                setPage(1)
              }}
              className="mt-2 text-xs font-bold text-[#285A48]"
            >
              Reset filters
            </button>
          )}
        </StickyToolbar>

        <section className="mt-2">
          {loading && <MobileLoading label="Loading customers…" />}

          {error && <MobileError message={error} onRetry={() => void reload()} />}

          {!loading && !error && data && data.items.length === 0 && (
            <MobileEmpty
              icon={<Users size={22} />}
              title="No customers found"
              hint={hasActiveFilters ? 'Try clearing your filters or search keyword.' : 'Add your first registered customer.'}
              action={
                !hasActiveFilters ? (
                  <Button onClick={openCreate} className="min-h-12 w-full text-sm">
                    Add Customer
                  </Button>
                ) : undefined
              }
            />
          )}

          {!loading && !error && data && data.items.length > 0 && (
            <div className="space-y-3">
              {data.items.map((customer) => (
                <article key={customer.id} className="rounded-3xl border border-[#E5EBE7] bg-white p-4 shadow-xs">
                  <div className="flex items-start gap-3">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#EAF1EE] text-sm font-black text-[#285A48]">
                      {getInitials(customer.fullName)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-[#091413]">{customer.fullName}</p>
                          <p className="text-[11px] font-semibold text-slate-400">{customer.customerCode}</p>
                        </div>
                        <span
                          className={`shrink-0 inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold ${
                            customer.isActive ? 'bg-[#EAF1EE] text-[#285A48]' : 'bg-slate-100 text-slate-500'
                          }`}
                        >
                          {customer.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">{customer.phone || 'No phone'}</p>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2.5 text-xs">
                    <span className="text-slate-500">Loyalty points</span>
                    <span className="rounded-lg bg-[#F6F8F7] px-2 py-1 font-bold text-[#285A48] border border-[#E5EBE7]">
                      ★ {customer.loyaltyPoints.toLocaleString()}
                    </span>
                  </div>

                  <div className="mt-3 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => navigate(`/customers/${customer.id}`)}
                      className="flex h-11 flex-1 items-center justify-center rounded-xl border border-[#E5EBE7] bg-white text-xs font-bold text-slate-600 active:scale-95 touch-manipulation"
                    >
                      View
                    </button>
                    {canManage && (
                      <button
                        type="button"
                        onClick={() => openEdit(customer)}
                        className="flex h-11 flex-1 items-center justify-center rounded-xl border border-[#E5EBE7] bg-white text-xs font-bold text-[#285A48] active:scale-95 touch-manipulation"
                      >
                        Edit
                      </button>
                    )}
                    {canManage && customer.isActive && (
                      <button
                        type="button"
                        onClick={() => setDeactivate(customer)}
                        aria-label="Deactivate customer"
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-rose-200 bg-rose-50 text-rose-600 active:scale-95 touch-manipulation"
                      >
                        <UserXIcon size={15} />
                      </button>
                    )}
                  </div>
                </article>
              ))}

              <div className="pt-1">
                <Pagination page={data.page} totalPages={data.totalPages} onPage={setPage} />
              </div>
            </div>
          )}
        </section>
      </main>

      {open && (
        <Modal
          title={editing ? 'Edit Customer Profile' : 'Add New Customer'}
          description={
            editing
              ? 'Update contact details and account status.'
              : 'Register a new customer to the directory.'
          }
          onClose={closeModals}
          preventClose={busy}
          footer={
            <div className="flex flex-col-reverse gap-2 w-full">
              <Button variant="secondary" onClick={closeModals} className="min-h-12 text-sm">
                Cancel
              </Button>
              <Button onClick={() => void save()} disabled={busy || !form.fullName.trim()} className="min-h-12 text-sm">
                {busy ? 'Saving...' : editing ? 'Save Changes' : 'Create Customer'}
              </Button>
            </div>
          }
        >
          <div className="space-y-5 text-sm">
            <Field label="Full Name" required>
              <Input
                value={form.fullName}
                placeholder="e.g., Jane Doe"
                onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                className="min-h-12 rounded-2xl text-sm"
                required
              />
            </Field>

            <FormSection title="Contact Information">
              <Field label="Mobile Phone">
                <Input
                  type="tel"
                  inputMode="tel"
                  value={form.phone}
                  placeholder="e.g., +63 912 345 6789"
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  className="min-h-12 rounded-2xl text-sm"
                />
              </Field>

              <Field label="Email Address">
                <Input
                  type="email"
                  placeholder="e.g., customer@email.com"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="min-h-12 rounded-2xl text-sm"
                />
              </Field>

              <Field label="Address / Delivery Notes">
                <Textarea
                  value={form.address}
                  placeholder="Street, City, Landmark"
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
              Active &amp; eligible for POS checkout
            </label>
          </div>
        </Modal>
      )}

      {view && (
        <Modal title="Customer Profile" onClose={closeModals}>
          <div className="space-y-4 text-sm">
            <div className="flex items-center gap-3.5 rounded-2xl border border-[#E5EBE7] bg-[#F6F8F7] p-3.5">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#EAF1EE] text-base font-black text-[#285A48]">
                {getInitials(view.fullName)}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-base font-extrabold text-[#091413]">{view.fullName}</h3>
                <p className="text-xs font-semibold text-slate-400">{view.customerCode}</p>
              </div>
              <span
                className={`shrink-0 inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold ${
                  view.isActive ? 'bg-[#EAF1EE] text-[#285A48]' : 'bg-slate-200 text-slate-600'
                }`}
              >
                {view.isActive ? 'Active' : 'Inactive'}
              </span>
            </div>

            <div className="divide-y divide-slate-100 rounded-2xl border border-[#E5EBE7] bg-white px-4">
              <DetailRow label="Phone Number" value={view.phone || '—'} />
              <DetailRow label="Email Address" value={view.email || '—'} />
              <DetailRow label="Loyalty Balance" value={<span className="font-black text-[#285A48]">★ {view.loyaltyPoints.toLocaleString()} Points</span>} />
              <DetailRow label="Member Since" value={formatDate(view.createdAt)} />
              <DetailRow label="Address" value={view.address || '—'} />
            </div>

            {canManage && (
              <Button onClick={() => openEdit(view)} className="min-h-12 w-full text-sm">
                Edit Customer
              </Button>
            )}
          </div>
        </Modal>
      )}

      {deactivate && (
        <ConfirmDialog
          title="Deactivate Customer Account"
          message={`Deactivate ${deactivate.fullName}? They will no longer be available for selection in the register checkout.`}
          confirmLabel="Deactivate Account"
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
  tone?: 'emerald'
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-17 flex-col items-center justify-center rounded-2xl border py-2 text-center transition-all active:scale-95 touch-manipulation ${
        active ? 'border-[#285A48] bg-white shadow-xs ring-1 ring-[#285A48]' : 'border-[#E5EBE7] bg-white'
      }`}
    >
      <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
        {tone === 'emerald' && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}
        {label}
      </span>
      <span className="mt-1 text-lg font-black tabular-nums text-[#091413]">{value}</span>
    </button>
  )
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
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

function UserXIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <line x1="17" y1="8" x2="22" y2="13" />
      <line x1="22" y1="8" x2="17" y2="13" />
    </svg>
  )
}

export default MobileCustomers
