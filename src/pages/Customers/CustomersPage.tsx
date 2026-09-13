import { useEffect, useState } from 'react'
import {
  Search,
  UserPlus,
  Eye,
  Pencil,
  UserX,
} from '../../components/ui/Icons'
import {
  useLocation,
  useNavigate,
} from 'react-router-dom'

import {
  customerApi,
  type CustomerPayload,
} from '../../api/customerApi'

import { Button } from '../../components/ui/Button'
import { PageHeader } from '../../components/ui/Page'

import {
  ConfirmDialog,
  Modal,
} from '../../components/ui/Modal'

import {
  Field,
  Input,
  Textarea,
} from '../../components/ui/Field'

import { Pagination } from '../../components/ui/Pagination'

import {
  EmptyState,
  ErrorState,
  Spinner,
} from '../../components/ui/States'

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

export function CustomersPage() {
  const { notify } = useToast()
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
  const activeCustomers =
    data?.items.filter((customer) => customer.isActive).length ?? 0
  const inactiveCustomers =
    data?.items.filter((customer) => !customer.isActive).length ?? 0
  const totalLoyaltyPoints =
    data?.items.reduce((sum, customer) => sum + customer.loyaltyPoints, 0) ?? 0

  const hasActiveFilters = search.trim() !== '' || status !== ''

  function resetAllFilters() {
    setSearch('')
    setStatus('')
    setPage(1)
  }

  function handleStatusChange(newStatus: '' | 'active' | 'inactive') {
    setStatus(newStatus)
    setPage(1)
  }

  /* =========================================================
     URL-BASED MODAL ROUTING
  ========================================================= */

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
  }, [location.pathname, navigate, notify])

  function closeModals() {
    setOpen(false)
    setView(null)
    if (location.pathname !== '/customers') {
      navigate('/customers')
    }
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
      if (editing) {
        await customerApi.update(editing.id, form)
      } else {
        await customerApi.create(form)
      }

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

  return (
    <div className="min-h-screen bg-[#F6F8F7] text-[#091413] pb-24 antialiased selection:bg-[#285A48] selection:text-white">
      <div className="mx-auto max-w-7xl px-3.5 pt-4 sm:px-6 sm:pt-6 md:px-8">
        
        {/* =========================================================
            PAGE HEADER & PRIMARY ACTION
        ========================================================= */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between pb-2">
          <PageHeader
            title="Customers"
            subtitle="Customer directory, loyalty points, and accounts"
          />
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 self-start rounded-2xl bg-[#285A48] px-4 py-2.5 text-xs font-bold text-white shadow-md shadow-[#285A48]/20 transition-all hover:bg-[#1f4739] active:scale-95 touch-manipulation sm:self-auto"
          >
            <UserPlus size={16} />
            <span>Add Customer</span>
          </button>
        </div>

        {/* =========================================================
            INTERACTIVE KPI CARDS (Click to Quick-Filter)
        ========================================================= */}
        <div className="mt-2 grid grid-cols-2 gap-2.5 sm:gap-3 md:grid-cols-4">
          <MetricCard
            label="Total Accounts"
            value={totalCustomers}
            isSelected={status === ''}
            onClick={() => handleStatusChange('')}
          />
          <MetricCard
            label="Active Accounts"
            value={activeCustomers}
            indicator="emerald"
            isSelected={status === 'active'}
            onClick={() => handleStatusChange('active')}
          />
          <MetricCard
            label="Inactive"
            value={inactiveCustomers}
            indicator="neutral"
            isSelected={status === 'inactive'}
            onClick={() => handleStatusChange('inactive')}
          />
          <MetricCard
            label="Total Loyalty Points"
            value={totalLoyaltyPoints.toLocaleString()}
            isClickable={false}
            icon="star"
          />
        </div>

        {/* =========================================================
            SEARCH & STATUS FILTER TOOLBAR
        ========================================================= */}
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {/* Segmented Filter Pills */}
          <div className="flex items-center gap-1 rounded-2xl border border-[#E5EBE7] bg-white p-1 self-start sm:self-auto shadow-2xs">
            <button
              type="button"
              onClick={() => handleStatusChange('')}
              className={`rounded-xl px-3.5 py-1.5 text-xs font-bold transition-all active:scale-95 touch-manipulation ${
                status === ''
                  ? 'bg-[#285A48] text-white shadow-xs'
                  : 'text-slate-500 hover:text-[#091413]'
              }`}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => handleStatusChange('active')}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-bold transition-all active:scale-95 touch-manipulation ${
                status === 'active'
                  ? 'bg-[#285A48] text-white shadow-xs'
                  : 'text-slate-500 hover:text-[#091413]'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${status === 'active' ? 'bg-emerald-300' : 'bg-emerald-500'}`} />
              Active
            </button>
            <button
              type="button"
              onClick={() => handleStatusChange('inactive')}
              className={`rounded-xl px-3.5 py-1.5 text-xs font-bold transition-all active:scale-95 touch-manipulation ${
                status === 'inactive'
                  ? 'bg-[#285A48] text-white shadow-xs'
                  : 'text-slate-500 hover:text-[#091413]'
              }`}
            >
              Inactive
            </button>
          </div>

          {/* Search Bar & Reset Trigger */}
          <div className="flex items-center gap-2 flex-1 sm:max-w-md sm:justify-end">
            <div className="relative w-full">
              <Search
                size={16}
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  setPage(1)
                }}
                placeholder="Search by name, phone, code..."
                className="h-11 w-full rounded-2xl border border-[#E5EBE7] bg-white pl-10 pr-9 text-xs font-semibold text-[#091413] placeholder-slate-400 outline-none transition focus:border-[#285A48] focus:ring-2 focus:ring-[#285A48]/15"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => {
                    setSearch('')
                    setPage(1)
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1 text-slate-400 hover:text-slate-700"
                  title="Clear search"
                >
                  <ClearIcon size={14} />
                </button>
              )}
            </div>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={resetAllFilters}
                className="flex h-11 shrink-0 items-center justify-center rounded-2xl border border-[#E5EBE7] bg-white px-3.5 text-xs font-bold text-slate-600 shadow-2xs hover:bg-[#F0F5F2] hover:text-[#091413] active:scale-95 touch-manipulation"
              >
                Reset
              </button>
            )}
          </div>
        </div>

        {/* =========================================================
            DIRECTORY CONTENT CONTAINER
        ========================================================= */}
        <div className="mt-4 overflow-hidden rounded-3xl border border-[#E5EBE7] bg-white shadow-sm">
          {loading && (
            <div className="py-20 flex flex-col items-center justify-center text-center">
              <Spinner />
              <p className="mt-3 text-xs font-semibold text-slate-400">
                Fetching customer directory...
              </p>
            </div>
          )}

          {error && (
            <div className="p-6">
              <ErrorState message={error} onRetry={() => void reload()} />
            </div>
          )}

          {!loading && !error && data && data.items.length === 0 && (
            <div className="p-10 text-center">
              <EmptyState
                title="No customers found"
                hint={
                  hasActiveFilters
                    ? 'Try clearing your active status filter or search keyword.'
                    : 'Get started by adding your first registered customer.'
                }
              />
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={resetAllFilters}
                  className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-[#285A48] underline hover:text-[#1a3b2f]"
                >
                  Reset directory filters
                </button>
              )}
            </div>
          )}

          {!loading && !error && data && data.items.length > 0 && (
            <>
              {/* ---------------------------------------------------
                  MOBILE DIRECTORY VIEW (Cards instead of clipped table)
              ---------------------------------------------------- */}
              <div className="divide-y divide-slate-100 md:hidden">
                {data.items.map((customer) => (
                  <div key={customer.id} className="p-4 hover:bg-[#FBFDFB] transition-colors">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#EAF1EE] text-xs font-extrabold text-[#285A48]">
                          {getInitials(customer.fullName)}
                        </div>
                        <div className="min-w-0">
                          <button
                            type="button"
                            onClick={() => navigate(`/customers/${customer.id}`)}
                            className="text-left font-bold text-sm text-[#091413] truncate hover:text-[#285A48] block"
                          >
                            {customer.fullName}
                          </button>
                          <p className="text-[11px] font-semibold text-slate-400">
                            {customer.customerCode}
                          </p>
                        </div>
                      </div>

                      <span
                        className={`inline-flex shrink-0 items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          customer.isActive
                            ? 'bg-[#EAF1EE] text-[#285A48]'
                            : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {customer.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </div>

                    <div className="mt-3 flex items-center justify-between text-xs text-slate-500 border-t border-slate-100/80 pt-2.5">
                      <div className="flex flex-col text-[11px]">
                        <span>{customer.phone || 'No phone'}</span>
                        <span className="text-slate-400 truncate max-w-[170px]">{customer.email || 'No email'}</span>
                      </div>

                      <div className="flex items-center gap-1">
                        <span className="rounded-xl bg-[#F6F8F7] px-2 py-1 text-[11px] font-bold text-[#285A48] border border-[#E5EBE7]">
                          ★ {customer.loyaltyPoints.toLocaleString()} pts
                        </span>

                        <div className="flex items-center ml-1">
                          <IconAction
                            title="View customer"
                            onClick={() => navigate(`/customers/${customer.id}`)}
                          >
                            <Eye size={15} />
                          </IconAction>
                          <IconAction
                            title="Edit customer"
                            onClick={() => openEdit(customer)}
                          >
                            <Pencil size={15} />
                          </IconAction>
                          {customer.isActive && (
                            <IconAction
                              title="Deactivate customer"
                              danger
                              onClick={() => setDeactivate(customer)}
                            >
                              <UserX size={15} />
                            </IconAction>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* ---------------------------------------------------
                  DESKTOP DIRECTORY TABLE VIEW
              ---------------------------------------------------- */}
              <div className="hidden md:block w-full overflow-x-auto">
                <table className="w-full text-left text-xs text-slate-600">
                  <thead className="border-b border-[#E5EBE7] bg-[#FBFDFB] text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    <tr>
                      <th className="py-3.5 pl-6 pr-3">Customer</th>
                      <th className="py-3.5 px-3">Contact</th>
                      <th className="py-3.5 px-3 text-right">Loyalty Points</th>
                      <th className="py-3.5 px-3 text-center">Status</th>
                      <th className="py-3.5 pl-3 pr-6 text-right">Actions</th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-slate-100">
                    {data.items.map((customer) => (
                      <tr
                        key={customer.id}
                        className="transition-colors hover:bg-[#F9FAF9]"
                      >
                        <td className="py-3.5 pl-6 pr-3">
                          <div className="flex items-center gap-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-[#EAF1EE] text-xs font-black text-[#285A48]">
                              {getInitials(customer.fullName)}
                            </div>
                            <div className="flex flex-col min-w-0">
                              <button
                                type="button"
                                onClick={() => navigate(`/customers/${customer.id}`)}
                                className="text-left font-bold text-slate-900 hover:text-[#285A48] transition-colors"
                              >
                                {customer.fullName}
                              </button>
                              <span className="text-[11px] font-semibold text-slate-400">
                                {customer.customerCode}
                              </span>
                            </div>
                          </div>
                        </td>

                        <td className="py-3.5 px-3">
                          <div className="flex flex-col text-slate-700">
                            <span className="font-semibold text-xs text-slate-900">{customer.phone ?? '—'}</span>
                            <span className="text-[11px] text-slate-400 truncate max-w-[220px]">
                              {customer.email ?? '—'}
                            </span>
                          </div>
                        </td>

                        <td className="py-3.5 px-3 text-right">
                          <span className="inline-flex items-center rounded-xl bg-[#EAF1EE] px-2.5 py-1 text-xs font-black text-[#285A48]">
                            ★ {customer.loyaltyPoints.toLocaleString()}
                          </span>
                        </td>

                        <td className="py-3.5 px-3 text-center">
                          <span
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                              customer.isActive
                                ? 'bg-[#EAF1EE] text-[#285A48] border border-[#285A48]/10'
                                : 'bg-slate-100 text-slate-500'
                            }`}
                          >
                            {customer.isActive ? 'Active' : 'Inactive'}
                          </span>
                        </td>

                        <td className="py-3.5 pl-3 pr-6 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <IconAction
                              title="View details"
                              onClick={() => navigate(`/customers/${customer.id}`)}
                            >
                              <Eye size={15} />
                            </IconAction>

                            <IconAction
                              title="Edit profile"
                              onClick={() => openEdit(customer)}
                            >
                              <Pencil size={15} />
                            </IconAction>

                            {customer.isActive && (
                              <IconAction
                                title="Deactivate account"
                                danger
                                onClick={() => setDeactivate(customer)}
                              >
                                <UserX size={15} />
                              </IconAction>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination Bar */}
              <div className="border-t border-[#E5EBE7] bg-[#FBFDFB] px-4 py-3 sm:px-6">
                <Pagination
                  page={data.page}
                  totalPages={data.totalPages}
                  onPage={setPage}
                />
              </div>
            </>
          )}
        </div>
      </div>

      {/* =========================================================
          CREATE / EDIT MODAL
      ========================================================= */}
      {open && (
        <Modal
          title={editing ? 'Edit Customer Profile' : 'Add New Customer'}
          onClose={closeModals}
          footer={
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end w-full">
              <Button variant="secondary" onClick={closeModals}>
                Cancel
              </Button>
              <Button
                onClick={() => void save()}
                disabled={busy || !form.fullName.trim()}
              >
                {busy
                  ? 'Saving...'
                  : editing
                    ? 'Save Changes'
                    : 'Create Customer'}
              </Button>
            </div>
          }
        >
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 text-xs">
            <div className="sm:col-span-2">
              <Field label="Full Name">
                <Input
                  value={form.fullName}
                  placeholder="e.g., Jane Doe"
                  onChange={(e) =>
                    setForm({ ...form, fullName: e.target.value })
                  }
                  required
                />
              </Field>
            </div>

            <Field label="Mobile Phone">
              <Input
                value={form.phone}
                placeholder="e.g., +63 912 345 6789"
                onChange={(e) =>
                  setForm({ ...form, phone: e.target.value })
                }
              />
            </Field>

            <Field label="Email Address">
              <Input
                type="email"
                placeholder="e.g., customer@email.com"
                value={form.email}
                onChange={(e) =>
                  setForm({ ...form, email: e.target.value })
                }
              />
            </Field>

            <div className="sm:col-span-2">
              <Field label="Physical Address / Delivery Notes">
                <Textarea
                  value={form.address}
                  placeholder="Street, City, Landmark"
                  onChange={(e) =>
                    setForm({ ...form, address: e.target.value })
                  }
                />
              </Field>
            </div>

            <label className="flex items-center gap-2 text-xs font-bold text-slate-700 sm:col-span-2 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) =>
                  setForm({ ...form, isActive: e.target.checked })
                }
                className="h-4 w-4 rounded-md border-[#E5EBE7] text-[#285A48] focus:ring-[#285A48]"
              />
              Account Active & Eligible for POS checkout
            </label>
          </div>
        </Modal>
      )}

      {/* =========================================================
          VIEW CUSTOMER DETAIL MODAL
      ========================================================= */}
      {view && (
        <Modal title="Customer Profile" onClose={closeModals}>
          <div className="text-xs space-y-4">
            {/* Top Identity Hero */}
            <div className="flex items-center gap-3.5 rounded-2xl bg-[#F6F8F7] p-3.5 border border-[#E5EBE7]">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#EAF1EE] text-sm font-black text-[#285A48]">
                {getInitials(view.fullName)}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="font-extrabold text-sm text-[#091413] truncate">{view.fullName}</h3>
                <p className="text-[11px] font-semibold text-slate-400">{view.customerCode}</p>
              </div>
              <span
                className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold ${
                  view.isActive ? 'bg-[#EAF1EE] text-[#285A48]' : 'bg-slate-200 text-slate-600'
                }`}
              >
                {view.isActive ? 'Active' : 'Inactive'}
              </span>
            </div>

            {/* Information Ledger */}
            <div className="divide-y divide-slate-100 rounded-2xl border border-[#E5EBE7] bg-white px-4">
              <DetailRow label="Phone Number" value={view.phone || '—'} />
              <DetailRow label="Email Address" value={view.email || '—'} />
              <DetailRow
                label="Loyalty Balance"
                value={<span className="font-black text-[#285A48]">★ {view.loyaltyPoints.toLocaleString()} Points</span>}
              />
              <DetailRow label="Member Since" value={formatDate(view.createdAt)} />
              <DetailRow label="Address" value={view.address || '—'} />
            </div>
          </div>
        </Modal>
      )}

      {/* =========================================================
          CONFIRM DEACTIVATE DIALOG
      ========================================================= */}
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

/* =============================================================
   HELPER COMPONENTS & FUNCTIONS
============================================================= */

function getInitials(name: string): string {
  if (!name) return '?'
  const parts = name.trim().split(' ').filter(Boolean)
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase()
}

function MetricCard({
  label,
  value,
  indicator,
  isSelected = false,
  isClickable = true,
  icon,
  onClick,
}: {
  label: string
  value: string | number
  indicator?: 'emerald' | 'neutral'
  isSelected?: boolean
  isClickable?: boolean
  icon?: 'star'
  onClick?: () => void
}) {
  return (
    <div
      onClick={isClickable ? onClick : undefined}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onKeyDown={(e) => {
        if (isClickable && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          onClick?.()
        }
      }}
      className={`group relative rounded-3xl border p-4 text-left transition-all active:scale-[0.98] ${
        isClickable ? 'cursor-pointer touch-manipulation' : ''
      } ${
        isSelected
          ? 'border-[#285A48] bg-white ring-2 ring-[#285A48]/20 shadow-sm'
          : 'border-[#E5EBE7] bg-white hover:border-slate-300'
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
          {label}
        </span>
        {indicator === 'emerald' && (
          <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
        )}
        {icon === 'star' && (
          <span className="text-xs text-[#285A48] font-bold">★</span>
        )}
      </div>
      <p className="mt-2 text-xl font-black tracking-tight text-[#091413] sm:text-2xl">
        {value}
      </p>
    </div>
  )
}

function IconAction({
  children,
  title,
  danger = false,
  onClick,
}: {
  children: React.ReactNode
  title: string
  danger?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`flex h-8 w-8 items-center justify-center rounded-xl transition-all active:scale-95 touch-manipulation ${
        danger
          ? 'text-slate-400 hover:bg-rose-50 hover:text-rose-600'
          : 'text-slate-400 hover:bg-[#EAF1EE] hover:text-[#285A48]'
      }`}
    >
      {children}
    </button>
  )
}

function DetailRow({
  label,
  value,
}: {
  label: string
  value: React.ReactNode
}) {
  return (
    <div className="flex justify-between py-2.5">
      <span className="text-slate-400 font-medium">{label}</span>
      <span className="text-slate-900 font-bold text-right">{value}</span>
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

export default CustomersPage