import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { customerApi, type CustomerPayload } from '../../api/customerApi'
import { salesApi } from '../../api/salesApi'
import { ChevronRight, Search, X } from '../../components/ui/Icons'
import {
  AddButton,
  Avatar,
  ContactActions,
  DetailList,
  DetailRow,
  EMAIL_PATTERN,
  InactivePill,
  PrimaryButton,
  SwitchRow,
  TextAreaField,
  TextButton,
  TextField,
} from '../../components/ui/MobileKit'
import { ConfirmDialog, Modal } from '../../components/ui/Modal'
import { Pagination } from '../../components/ui/Pagination'
import { EmptyState, ErrorState, Spinner } from '../../components/ui/States'
import { useAuth } from '../../context/AuthContext'
import { useSettings } from '../../context/SettingsContext'
import { useToast } from '../../context/ToastContext'
import { useAsync } from '../../hooks/useAsync'
import { useDebounced } from '../../hooks/useDebounced'
import { useIsMobile } from '../../hooks/useIsMobile'
import type { Customer } from '../../types'
import { getErrorMessage } from '../../utils/errors'
import { formatDate, formatDateTime, formatMoney } from '../../utils/format'
import { MobileCustomers } from '../mobile/MobileCustomers'

type StatusFilter = '' | 'active' | 'inactive'
type FormErrors = Partial<Record<'fullName' | 'email' | 'phone', string>>

const PAGE_SIZE = 20
const FORM_ID = 'customer-form'

const emptyForm: CustomerPayload = {
  fullName: '',
  phone: '',
  email: '',
  address: '',
  isActive: true,
}

function toForm(customer: Customer): CustomerPayload {
  return {
    fullName: customer.fullName,
    phone: customer.phone ?? '',
    email: customer.email ?? '',
    address: customer.address ?? '',
    isActive: customer.isActive,
  }
}

function validate(form: CustomerPayload): FormErrors {
  const errors: FormErrors = {}
  if (!form.fullName.trim()) errors.fullName = 'Enter the customer’s name.'
  if (form.email?.trim() && !EMAIL_PATTERN.test(form.email.trim())) errors.email = 'Enter a valid email, like name@email.com.'
  if (form.phone?.trim() && form.phone.replace(/\D/g, '').length < 7) errors.phone = 'Phone number looks too short.'
  return errors
}

export function CustomersPage() {
  const isMobile = useIsMobile()
  if (isMobile) return <MobileCustomers />
  return <DesktopCustomersPage />
}

function DesktopCustomersPage() {
  const { notify } = useToast()
  const { can } = useAuth()
  const { settings } = useSettings()
  const canManage = can('customers.manage')
  const navigate = useNavigate()
  const location = useLocation()

  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('')
  const [page, setPage] = useState(1)

  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Customer | null>(null)
  const [view, setView] = useState<Customer | null>(null)
  const [form, setForm] = useState<CustomerPayload>(emptyForm)
  const [initialForm, setInitialForm] = useState<CustomerPayload>(emptyForm)
  const [touched, setTouched] = useState<Partial<Record<keyof FormErrors, boolean>>>({})
  const [deactivate, setDeactivate] = useState<Customer | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [busy, setBusy] = useState(false)

  const q = useDebounced(search).trim()

  const { data, loading, error, reload } = useAsync(
    () =>
      customerApi.list({
        search: q || undefined,
        isActive: status === '' ? undefined : status === 'active',
        page,
        pageSize: PAGE_SIZE,
      }),
    [q, status, page],
  )

  // Real totals across all customers (respecting search), not just the visible page.
  const counts = useAsync(async () => {
    const count = (isActive?: boolean) =>
      customerApi.list({ search: q || undefined, isActive, page: 1, pageSize: 1 }).then((r) => r.totalCount)
    const [all, active] = await Promise.all([count(), count(true)])
    return { all, active, inactive: Math.max(0, all - active) }
  }, [q])

  const recentSales = useAsync(async () => {
    if (!view) return null
    const result = await salesApi.list({ search: view.fullName, page: 1, pageSize: 20 })
    return result.items.filter((sale) => sale.customerId === view.id).slice(0, 5)
  }, [view?.id])

  const items = data?.items ?? []
  const hasFilters = q !== '' || status !== ''
  const errors = validate(form)
  const isValid = Object.keys(errors).length === 0
  const isDirty = JSON.stringify(form) !== JSON.stringify(initialForm)
  const fieldError = (key: keyof FormErrors) => (touched[key] ? errors[key] : undefined)

  useEffect(() => {
    setPage(1)
  }, [q])

  /* =========================================================
     URL-BASED MODALS (/customers/create, /customers/:id, /customers/edit/:id)
  ========================================================= */

  useEffect(() => {
    const path = location.pathname

    if (path === '/customers/create') {
      if (!canManage) {
        navigate('/customers', { replace: true })
        return
      }
      setEditing(null)
      setForm(emptyForm)
      setInitialForm(emptyForm)
      setTouched({})
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
          setForm(toForm(customer))
          setInitialForm(toForm(customer))
          setTouched({})
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

  function goToList() {
    setOpen(false)
    setView(null)
    setConfirmDiscard(false)
    if (location.pathname !== '/customers') navigate('/customers')
  }

  function requestCloseForm() {
    if (busy) return
    if (isDirty) setConfirmDiscard(true)
    else goToList()
  }

  function selectStatus(next: StatusFilter) {
    setStatus(next)
    setPage(1)
  }

  function clearFilters() {
    setSearch('')
    selectStatus('')
  }

  /* =========================================================
     ACTIONS
  ========================================================= */

  async function save() {
    setTouched({ fullName: true, email: true, phone: true })
    if (!isValid || busy) return

    setBusy(true)
    try {
      const payload: CustomerPayload = {
        ...form,
        fullName: form.fullName.trim(),
        phone: form.phone?.trim(),
        email: form.email?.trim(),
        address: form.address?.trim(),
      }
      const saved = editing ? await customerApi.update(editing.id, payload) : await customerApi.create(payload)
      notify(editing ? 'Changes saved.' : `${saved.fullName} added.`)
      setInitialForm(form)
      await Promise.all([reload(), counts.reload()])
      // Show the result right away.
      navigate(`/customers/${saved.id}`, { replace: true })
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
      notify(`${deactivate.fullName} deactivated.`)
      if (view?.id === deactivate.id) setView({ ...view, isActive: false })
      setDeactivate(null)
      await Promise.all([reload(), counts.reload()])
    } catch (err) {
      notify(getErrorMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function reactivate(customer: Customer) {
    setBusy(true)
    try {
      const updated = await customerApi.update(customer.id, { ...toForm(customer), isActive: true })
      notify(`${customer.fullName} is active again.`)
      if (view?.id === customer.id) setView(updated)
      await Promise.all([reload(), counts.reload()])
    } catch (err) {
      notify(getErrorMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  /* =========================================================
     RENDER
  ========================================================= */

  const filterOptions: { key: StatusFilter; label: string; count?: number }[] = [
    { key: '', label: 'All', count: counts.data?.all },
    { key: 'active', label: 'Active', count: counts.data?.active },
    { key: 'inactive', label: 'Inactive', count: counts.data?.inactive },
  ]

  return (
    <div className="min-h-full bg-[#F6F8F7] text-[#091413] antialiased">
      <div className="mx-auto max-w-6xl px-6 pb-10 pt-6">
        {/* HEADER */}
        <header className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight">Customers</h1>
            <p className="mt-0.5 text-sm text-slate-500">
              {counts.data
                ? `${counts.data.all} ${counts.data.all === 1 ? 'customer' : 'customers'} · ${counts.data.active} active`
                : 'Contacts and loyalty points'}
            </p>
          </div>
          {canManage && <AddButton label="Add customer" onClick={() => navigate('/customers/create')} />}
        </header>

        {/* TOOLBAR */}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <div className="relative w-full max-w-md">
            <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              aria-label="Search customers"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, phone, email or code"
              className="h-11 w-full rounded-2xl border-0 bg-white pl-11 pr-11 text-sm ring-1 ring-slate-200 placeholder:text-slate-400 outline-none transition focus:ring-2 focus:ring-[#1F5E3B] [&::-webkit-search-cancel-button]:hidden"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="Clear search"
                className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100"
              >
                <X size={13} />
              </button>
            )}
          </div>

          <div role="tablist" aria-label="Customer status" className="flex rounded-full bg-white p-1 ring-1 ring-slate-200">
            {filterOptions.map((option) => {
              const active = status === option.key
              return (
                <button
                  key={option.key || 'all'}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => selectStatus(option.key)}
                  className={`inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B] ${
                    active ? 'bg-[#1F5E3B] text-white' : 'text-slate-600 hover:text-[#091413]'
                  }`}
                >
                  {option.label}
                  {option.count !== undefined && (
                    <span className={`tabular-nums ${active ? 'text-white/70' : 'text-slate-400'}`}>{option.count}</span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* DIRECTORY */}
        <div className="mt-4 overflow-hidden rounded-2xl bg-white ring-1 ring-slate-100">
          {loading && !data && (
            <div className="py-20">
              <Spinner />
            </div>
          )}

          {!loading && error && (
            <div className="p-6">
              <ErrorState message={error} onRetry={() => void reload()} />
            </div>
          )}

          {!loading && !error && items.length === 0 && (
            <div className="px-6 py-16 text-center">
              <EmptyState
                title={hasFilters ? 'No customers found' : 'No customers yet'}
                hint={
                  q
                    ? `Nothing matches “${q}”.`
                    : hasFilters
                    ? 'No customers have this status.'
                    : 'Save customers to track their purchases and loyalty points.'
                }
              />
              {hasFilters ? (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="mt-4 h-10 rounded-full bg-[#F3F5F4] px-5 text-sm font-medium hover:bg-[#E9EEEB]"
                >
                  Clear filters
                </button>
              ) : (
                canManage && (
                  <button
                    type="button"
                    onClick={() => navigate('/customers/create')}
                    className="mt-4 h-11 rounded-full bg-[#1F5E3B] px-6 text-sm font-medium text-white"
                  >
                    Add first customer
                  </button>
                )
              )}
            </div>
          )}

          {!error && items.length > 0 && (
            <>
              <div className="overflow-x-auto">
                <table className={`w-full text-left text-sm transition-opacity ${loading ? 'opacity-60' : ''}`}>
                  <thead className="border-b border-slate-100 text-xs text-slate-500">
                    <tr>
                      <th scope="col" className="py-3 pl-6 pr-3 font-medium">Customer</th>
                      <th scope="col" className="px-3 py-3 font-medium">Contact</th>
                      <th scope="col" className="px-3 py-3 text-right font-medium">Points</th>
                      <th scope="col" className="px-3 py-3 font-medium">Status</th>
                      <th scope="col" className="py-3 pl-3 pr-6"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {items.map((customer) => (
                      <tr
                        key={customer.id}
                        onClick={() => navigate(`/customers/${customer.id}`)}
                        className="group cursor-pointer transition-colors hover:bg-slate-50"
                      >
                        <td className="py-3 pl-6 pr-3">
                          <div className="flex items-center gap-3">
                            <Avatar name={customer.fullName} inactive={!customer.isActive} />
                            <div className="min-w-0">
                              {/* The name is the keyboard-accessible way to open the profile. */}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  navigate(`/customers/${customer.id}`)
                                }}
                                className={`block max-w-64 truncate text-left font-medium focus-visible:underline focus-visible:outline-none ${
                                  customer.isActive ? '' : 'text-slate-400'
                                }`}
                              >
                                {customer.fullName}
                              </button>
                              <span className="text-xs text-slate-400">{customer.customerCode}</span>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <span className={`block ${customer.phone ? '' : 'text-slate-300'}`}>{customer.phone || 'No phone'}</span>
                          <span className={`block max-w-60 truncate text-xs ${customer.email ? 'text-slate-500' : 'text-slate-300'}`}>
                            {customer.email || 'No email'}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">{customer.loyaltyPoints.toLocaleString()}</td>
                        <td className="px-3 py-3">
                          {customer.isActive ? (
                            <span className="text-sm text-[#1F5E3B]">Active</span>
                          ) : (
                            <InactivePill />
                          )}
                        </td>
                        <td className="py-3 pl-3 pr-6">
                          <div className="flex items-center justify-end gap-1">
                            {canManage && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  navigate(`/customers/edit/${customer.id}`)
                                }}
                                aria-label={`Edit ${customer.fullName}`}
                                className="h-9 rounded-full px-3 text-sm font-medium text-[#1F5E3B] opacity-0 transition hover:bg-[#F2F8F4] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B] group-hover:opacity-100"
                              >
                                Edit
                              </button>
                            )}
                            <ChevronRight size={12} className="text-slate-300" />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {(data?.totalPages ?? 1) > 1 && (
                <div className="border-t border-slate-100 px-6 py-3">
                  <Pagination page={data?.page ?? 1} totalPages={data?.totalPages ?? 1} onPage={setPage} />
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* PROFILE */}
      {view && (
        <Modal
          title={view.fullName}
          description={`${view.customerCode} · Customer since ${formatDate(view.createdAt)}`}
          size="lg"
          onClose={goToList}
          footer={
            canManage ? (
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
                <PrimaryButton onClick={() => navigate(`/customers/edit/${view.id}`)} className="h-12 flex-none px-8">
                  Edit details
                </PrimaryButton>
              </div>
            ) : undefined
          }
        >
          <div className="space-y-5">
            {!view.isActive && (
              <p className="rounded-2xl bg-slate-100 px-4 py-3 text-sm text-slate-600">
                Inactive — this customer can’t be selected at checkout.
              </p>
            )}

            <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
              <ContactActions phone={view.phone} email={view.email} />
              <div className="rounded-2xl bg-[#F2F8F4] px-5 py-3 sm:min-w-40">
                <p className="text-sm text-[#1F5E3B]">Loyalty points</p>
                <p className="text-2xl font-bold tabular-nums">{view.loyaltyPoints.toLocaleString()}</p>
              </div>
            </div>

            <DetailList>
              <DetailRow label="Phone" value={view.phone} />
              <DetailRow label="Email" value={view.email} />
              <DetailRow label="Address" value={view.address} />
            </DetailList>

            <section>
              <h3 className="text-sm font-medium">Recent purchases</h3>
              {recentSales.loading ? (
                <div className="py-6">
                  <Spinner />
                </div>
              ) : recentSales.data && recentSales.data.length > 0 ? (
                <ul className="mt-1">
                  {recentSales.data.map((sale) => (
                    <li
                      key={sale.id}
                      className="flex items-baseline justify-between gap-3 border-b border-slate-100 py-2.5 text-sm last:border-b-0"
                    >
                      <span className="min-w-0 truncate text-slate-500">
                        {sale.invoiceNumber} · {formatDateTime(sale.createdAt)}
                      </span>
                      <span className="shrink-0 tabular-nums">{formatMoney(sale.total, settings.currencySymbol)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 py-2 text-sm text-slate-400">No purchases yet.</p>
              )}
            </section>
          </div>
        </Modal>
      )}

      {/* ADD / EDIT */}
      {open && (
        <Modal
          title={editing ? 'Edit customer' : 'Add customer'}
          description={editing ? editing.customerCode : undefined}
          size="lg"
          onClose={requestCloseForm}
          preventClose={busy}
          footer={
            <div className="flex w-full items-center justify-end gap-2">
              <TextButton onClick={requestCloseForm} disabled={busy} className="h-12">
                Cancel
              </TextButton>
              <PrimaryButton
                type="submit"
                form={FORM_ID}
                disabled={busy || (editing !== null && !isDirty)}
                className="h-12 flex-none px-8"
              >
                {busy ? 'Saving…' : editing ? (isDirty ? 'Save changes' : 'No changes') : 'Add customer'}
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
            <TextField
              label="Full name"
              value={form.fullName}
              onChange={(fullName) => setForm({ ...form, fullName })}
              onBlur={() => setTouched((t) => ({ ...t, fullName: true }))}
              error={fieldError('fullName')}
              placeholder="e.g. Juan Dela Cruz"
              autoFocus
              autoComplete="off"
              autoCapitalize="words"
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="Mobile number"
                optional
                type="tel"
                inputMode="tel"
                autoComplete="off"
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
                autoComplete="off"
                autoCapitalize="none"
                value={form.email ?? ''}
                onChange={(email) => setForm({ ...form, email })}
                onBlur={() => setTouched((t) => ({ ...t, email: true }))}
                error={fieldError('email')}
                placeholder="e.g. juan@email.com"
              />
            </div>

            <TextAreaField
              label="Address"
              optional
              value={form.address ?? ''}
              onChange={(address) => setForm({ ...form, address })}
              placeholder="Street, city, landmark"
            />

            {/* New customers are always active; status only matters when editing. */}
            {editing && (
              <SwitchRow
                label="Active"
                description="Can be selected at checkout"
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
          onConfirm={goToList}
        />
      )}

      {deactivate && (
        <ConfirmDialog
          title={`Deactivate ${deactivate.fullName}?`}
          message="They won’t appear at checkout. Their history and points are kept, and you can reactivate them anytime."
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

export default CustomersPage
