
import { useEffect, useState } from 'react'
import {
  Search,
  UserPlus,
  Eye,
  Pencil,
  UserX,
  ChevronDown,
} from 'lucide-react'
import {
  useLocation,
  useNavigate,
} from 'react-router-dom'

import {
  customerApi,
  type CustomerPayload,
} from '../../api/customerApi'

import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Card, PageHeader } from '../../components/ui/Page'

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
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)

  const [form, setForm] =
    useState<CustomerPayload>(emptyForm)

  const [editing, setEditing] =
    useState<Customer | null>(null)

  const [open, setOpen] = useState(false)

  const [view, setView] =
    useState<Customer | null>(null)

  const [deactivate, setDeactivate] =
    useState<Customer | null>(null)

  const [busy, setBusy] = useState(false)


  const {
    data,
    loading,
    error,
    reload,
  } = useAsync(
    () =>
      customerApi.list({
        search: search || undefined,

        isActive:
          status === ''
            ? undefined
            : status === 'active',

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
    data?.items.reduce(
      (sum, customer) => sum + customer.loyaltyPoints,
      0,
    ) ?? 0

  /* =========================================================
     ROUTING
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

    const editMatch =
      path.match(/^\/customers\/edit\/(\d+)$/)

    const viewMatch =
      path.match(/^\/customers\/(\d+)$/)

    const id =
      editMatch?.[1] ??
      viewMatch?.[1]

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
  }, [
    location.pathname,
    navigate,
    notify,
  ])


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
        await customerApi.update(
          editing.id,
          form,
        )
      } else {
        await customerApi.create(form)
      }

      notify(
        editing
          ? 'Customer updated.'
          : 'Customer added.',
      )

      closeModals()
      await reload()
    } catch (err) {
      notify(
        getErrorMessage(err),
        'error',
      )
    } finally {
      setBusy(false)
    }
  }


  async function confirmDeactivate() {
    if (!deactivate) return

    setBusy(true)

    try {
      await customerApi.deactivate(
        deactivate.id,
      )

      notify('Customer deactivated.')

      setDeactivate(null)

      await reload()
    } catch (err) {
      notify(
        getErrorMessage(err),
        'error',
      )
    } finally {
      setBusy(false)
    }
  }


  return (
    <div className="min-h-full min-w-0 overflow-x-hidden bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-7xl px-4 pb-6 pt-4 sm:px-5 lg:px-6">
        <PageHeader
          title="Customers"
          subtitle="Manage customer records, status, and loyalty activity"
          actions={
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-slate-900/10 transition-all duration-150 hover:-translate-y-0.5 hover:bg-slate-800 active:translate-y-0 active:scale-[0.99]"
            >
              <UserPlus size={16} />
              <span>Add customer</span>
            </button>
          }
        />

        <section className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Total customers" value={String(totalCustomers)} accent="slate" />
          <MetricCard label="Active" value={String(activeCustomers)} accent="emerald" />
          <MetricCard label="Inactive" value={String(inactiveCustomers)} accent="amber" />
          <MetricCard label="Loyalty points" value={String(totalLoyaltyPoints)} accent="violet" />
        </section>

        <Card className="mb-4 overflow-hidden border border-slate-200 bg-white shadow-sm shadow-slate-200/50">
          <div className="flex flex-col gap-3 p-2.5 sm:flex-row sm:items-center sm:p-3">
            <div className="relative min-w-0 flex-1">
              <Search
                size={18}
                className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
              />

              <input
                autoFocus
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  setPage(1)
                }}
                placeholder="Search customer by name, phone or code..."
                className="h-12 w-full rounded-full border border-slate-200 bg-slate-50 pl-11 pr-3 text-sm text-slate-700 outline-none transition-all duration-150 placeholder:text-slate-400 focus:border-slate-900 focus:bg-white focus:ring-2 focus:ring-slate-200"
              />
            </div>

            <div className="relative w-full sm:w-45">
              <label className="sr-only">Filter by status</label>
              <select
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value)
                  setPage(1)
                }}
                className="h-12 w-full appearance-none rounded-full border border-slate-200 bg-slate-50 px-3 pr-9 text-sm text-slate-700 outline-none transition-all duration-150 focus:border-slate-900 focus:bg-white focus:ring-2 focus:ring-slate-200"
              >
                <option value="">All customers</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
              <ChevronDown
                size={16}
                className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500"
              />
            </div>
          </div>
        </Card>

        <main className="min-w-0">
          <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/50">
            <div className="flex flex-col gap-2 border-b border-slate-200 bg-slate-50/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Customer accounts</p>
                <h2 className="mt-1 text-lg font-semibold text-slate-900">Directory</h2>
              </div>

              {!loading && data && (
                <div className="inline-flex items-center rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-600 shadow-sm ring-1 ring-slate-200">
                  {data.items.length} shown
                </div>
              )}
            </div>

            <div className="min-w-0 p-3 sm:p-4">
              {loading && <Spinner />}

              {error && (
                <ErrorState
                  message={error}
                  onRetry={() => void reload()}
                />
              )}

              {!loading && !error && data && data.items.length === 0 && (
                <div className="rounded-2xl border border-slate-200 bg-slate-50">
                  <EmptyState
                    title="No customers found"
                    hint="Try a different name, phone number, or customer code."
                  />
                </div>
              )}

              {!loading && data && data.items.length > 0 && (
                <div className="overflow-hidden rounded-2xl border border-slate-200">
                  <div className="max-w-full overflow-x-auto overscroll-x-contain">
                    <table className="w-full min-w-190 border-collapse text-sm">
                      <thead className="bg-slate-50">
                        <tr className="border-b border-slate-200">
                          <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Code</th>
                          <th className="min-w-45 px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Customer</th>
                          <th className="w-32 px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Phone</th>
                          <th className="w-48 px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Email</th>
                          <th className="w-22 px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Points</th>
                          <th className="w-24 px-3 py-2.5 text-center text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Status</th>
                          <th className="w-40 px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Actions</th>
                        </tr>
                      </thead>

                      <tbody>
                        {data.items.map((customer) => (
                          <tr key={customer.id} className="border-b border-slate-200 last:border-b-0 transition-colors duration-150 hover:bg-slate-50/80">
                            <td className="max-w-24 truncate px-3 py-3 font-mono text-xs text-slate-500">
                              {customer.customerCode}
                            </td>

                            <td className="max-w-55 px-3 py-3">
                              <button
                                type="button"
                                onClick={() => navigate(`/customers/${customer.id}`)}
                                className="block max-w-full truncate text-left text-sm font-semibold text-slate-900 transition-colors duration-150 hover:text-slate-700 hover:underline"
                                title={customer.fullName}
                              >
                                {customer.fullName}
                              </button>
                            </td>

                            <td className="max-w-32 truncate px-3 py-3 text-sm text-slate-600" title={customer.phone ?? '—'}>
                              {customer.phone ?? '—'}
                            </td>

                            <td className="max-w-48 truncate px-3 py-3 text-sm text-slate-600" title={customer.email ?? '—'}>
                              {customer.email ?? '—'}
                            </td>

                            <td className="px-3 py-3 text-right text-sm font-medium text-slate-700">
                              {customer.loyaltyPoints}
                            </td>

                            <td className="px-3 py-3 text-center">
                              <Badge tone={customer.isActive ? 'green' : 'gray'}>
                                {customer.isActive ? 'Active' : 'Inactive'}
                              </Badge>
                            </td>

                            <td className="px-2 py-2">
                              <div className="flex items-center justify-end gap-1.5">
                                <IconAction title="View customer" onClick={() => navigate(`/customers/${customer.id}`)}>
                                  <Eye size={16} />
                                </IconAction>

                                <IconAction title="Edit customer" onClick={() => openEdit(customer)}>
                                  <Pencil size={16} />
                                </IconAction>

                                {customer.isActive && (
                                  <IconAction title="Deactivate customer" danger onClick={() => setDeactivate(customer)}>
                                    <UserX size={16} />
                                  </IconAction>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="border-t border-slate-200 bg-slate-50/80 px-3 py-2">
                    <Pagination page={data.page} totalPages={data.totalPages} onPage={setPage} />
                  </div>
                </div>
              )}
            </div>
          </section>
        </main>
      </div>

      {/* =====================================================
          CREATE / EDIT MODAL
      ====================================================== */}

      {open && (

        <Modal
          title={
            editing
              ? 'Edit customer'
              : 'Add customer'
          }
          onClose={closeModals}
          footer={

            <div
              className="
                flex
                flex-col-reverse
                gap-2
                sm:flex-row
                sm:justify-end
              "
            >

              <Button
                variant="secondary"
                onClick={closeModals}
              >
                Cancel
              </Button>


              <Button
                onClick={() => void save()}
                disabled={
                  busy ||
                  !form.fullName.trim()
                }
              >
                {busy
                  ? 'Saving...'
                  : editing
                    ? 'Save changes'
                    : 'Create customer'}
              </Button>

            </div>

          }
        >

          <div
            className="
              grid
              grid-cols-1
              gap-3
              sm:grid-cols-2
            "
          >

            <Field label="Full name">

              <Input
                value={form.fullName}
                onChange={(e) =>
                  setForm({
                    ...form,
                    fullName: e.target.value,
                  })
                }
                required
              />

            </Field>


            <Field label="Phone">

              <Input
                value={form.phone}
                onChange={(e) =>
                  setForm({
                    ...form,
                    phone: e.target.value,
                  })
                }
              />

            </Field>


            <Field label="Email">

              <Input
                type="email"
                value={form.email}
                onChange={(e) =>
                  setForm({
                    ...form,
                    email: e.target.value,
                  })
                }
              />

            </Field>


            <div className="sm:col-span-2">

              <Field label="Address">

                <Textarea
                  value={form.address}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      address: e.target.value,
                    })
                  }
                />

              </Field>

            </div>


            <label
              className="
                flex
                min-h-11
                items-center
                gap-2
                text-sm
                sm:col-span-2
              "
            >

              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) =>
                  setForm({
                    ...form,
                    isActive: e.target.checked,
                  })
                }
                className="h-4 w-4"
              />

              Active account

            </label>

          </div>

        </Modal>

      )}


      {/* =====================================================
          CUSTOMER DETAIL
      ====================================================== */}

      {view && (

        <Modal
          title="Customer details"
          onClose={closeModals}
        >

          <div
            className="
              grid
              grid-cols-1
              border-l
              border-t
              border-gray-200
              sm:grid-cols-2
            "
          >

            <InfoCell
              label="Customer code"
              value={view.customerCode}
            />

            <InfoCell
              label="Status"
              value={
                view.isActive
                  ? 'Active'
                  : 'Inactive'
              }
            />

            <InfoCell
              label="Full name"
              value={view.fullName}
            />

            <InfoCell
              label="Phone"
              value={view.phone ?? '—'}
            />

            <InfoCell
              label="Email"
              value={view.email ?? '—'}
            />

            <InfoCell
              label="Loyalty points"
              value={String(view.loyaltyPoints)}
            />

            <InfoCell
              label="Created"
              value={formatDate(view.createdAt)}
            />

            <div
              className="
                border-b
                border-r
                border-gray-200
                p-3
                sm:col-span-2
              "
            >

              <p className="text-xs text-gray-500">
                Address
              </p>

              <p
                className="
                  mt-1
                  wrap-break-word
                  text-sm
                "
              >
                {view.address ?? '—'}
              </p>

            </div>

          </div>

        </Modal>

      )}


      {/* =====================================================
          DEACTIVATE
      ====================================================== */}

      {deactivate && (

        <ConfirmDialog
          title="Deactivate customer"
          message={`Deactivate ${deactivate.fullName}? They will no longer appear in POS lookup.`}
          confirmLabel="Deactivate"
          danger
          busy={busy}
          onCancel={() =>
            setDeactivate(null)
          }
          onConfirm={() =>
            void confirmDeactivate()
          }
        />

      )}

    </div>
  )
}


function MetricCard({
  label,
  value,
  accent,
}: {
  label: string
  value: string
  accent: 'slate' | 'emerald' | 'amber' | 'violet'
}) {
  const accentClasses = {
    slate: 'bg-slate-100 text-slate-700',
    emerald: 'bg-emerald-100 text-emerald-700',
    amber: 'bg-amber-100 text-amber-700',
    violet: 'bg-violet-100 text-violet-700',
  }

  return (
    <Card className="overflow-hidden border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/50 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
        <span className={`h-2.5 w-2.5 rounded-full ${accent === 'slate' ? 'bg-slate-400' : accent === 'emerald' ? 'bg-emerald-400' : accent === 'amber' ? 'bg-amber-400' : 'bg-violet-400'} shadow-sm`} />
      </div>

      <p className="mt-4 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">{value}</p>

      <div className="mt-3 flex items-center gap-2 text-[11px] text-slate-500">
        <span className={`rounded-full px-2 py-1 font-medium ${accentClasses[accent]}`}>
          Live
        </span>
        <span>Updated now</span>
      </div>
    </Card>
  )
}


/* =============================================================
   SMALL UI COMPONENTS
============================================================= */


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
      className={`
        flex
        h-12
        w-12
        shrink-0
        items-center
        justify-center
        border
        border-transparent
        transition-all
        duration-100
        ease-out
        transform-gpu
        active:scale-[0.97]
        active:border-neutral-900
        active:text-neutral-900
        focus:outline-none
        focus:ring-2
        focus:ring-gray-400
        ${
          danger
            ? 'text-red-600 hover:border-red-200 hover:bg-red-50 active:border-red-600 active:bg-red-100'
            : 'text-gray-500 hover:border-gray-300 hover:bg-gray-50 hover:text-gray-900'
        }
      `}
    >
      {children}
    </button>

  )
}


function InfoCell({
  label,
  value,
}: {
  label: string
  value: string
}) {

  return (

    <div
      className="
        min-w-0
        border-b
        border-r
        border-gray-200
        p-3
      "
    >

      <p className="text-xs text-gray-500">
        {label}
      </p>

      <p
        className="
          mt-1
          wrap-break-word
          text-sm
          font-medium
        "
      >
        {value}
      </p>

    </div>

  )
}



