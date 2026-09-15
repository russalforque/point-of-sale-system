import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { customerApi, type CustomerPayload } from '../../api/customerApi'
import { salesApi } from '../../api/salesApi'
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
import { Pagination } from '../../components/ui/Pagination'
import { Spinner } from '../../components/ui/States'
import { useAuth } from '../../context/AuthContext'
import { useSettings } from '../../context/SettingsContext'
import { useToast } from '../../context/ToastContext'
import { useAsync } from '../../hooks/useAsync'
import { useDebounced } from '../../hooks/useDebounced'
import type { Customer } from '../../types'
import { getErrorMessage } from '../../utils/errors'
import { formatDate, formatDateTime, formatMoney } from '../../utils/format'

type StatusFilter = '' | 'active' | 'inactive'
type FocusField = 'phone' | 'email' | null

const emptyForm: CustomerPayload = {
  fullName: '',
  phone: '',
  email: '',
  address: '',
  isActive: true,
}

const PAGE_SIZE = 20

const digitsOnly = (value: string | null | undefined) => (value ?? '').replace(/\D/g, '')

function toForm(customer: Customer): CustomerPayload {
  return {
    fullName: customer.fullName,
    phone: customer.phone ?? '',
    email: customer.email ?? '',
    address: customer.address ?? '',
    isActive: customer.isActive,
  }
}

function validate(form: CustomerPayload) {
  const errors: Partial<Record<keyof CustomerPayload, string>> = {}
  if (!form.fullName.trim()) errors.fullName = 'Enter the customer’s name.'
  if (form.email?.trim() && !EMAIL_PATTERN.test(form.email.trim())) errors.email = 'Enter a valid email, like name@email.com.'
  if (form.phone?.trim() && digitsOnly(form.phone).length < 7) errors.phone = 'Phone number looks too short.'
  return errors
}

export function MobileCustomers() {
  const { notify } = useToast()
  const { can } = useAuth()
  const { settings } = useSettings()
  const canManage = can('customers.manage')
  const navigate = useNavigate()
  const location = useLocation()

  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('')
  const [page, setPage] = useState(1)

  const [form, setForm] = useState<CustomerPayload>(emptyForm)
  const [initialForm, setInitialForm] = useState<CustomerPayload>(emptyForm)
  const [touched, setTouched] = useState<Partial<Record<keyof CustomerPayload, boolean>>>({})
  const [editing, setEditing] = useState<Customer | null>(null)
  const [focusField, setFocusField] = useState<FocusField>(null)
  const [duplicate, setDuplicate] = useState<Customer | null>(null)
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<Customer | null>(null)
  const [deactivate, setDeactivate] = useState<Customer | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [busy, setBusy] = useState(false)

  const formRef = useRef<HTMLFormElement | null>(null)
  // Guard against losing edits to Android/browser back: remember where the form lives,
  // and whether the current navigation was intended (Cancel/Discard/Save).
  const guardRef = useRef({ open: false, dirty: false })
  const formUrlRef = useRef<string | null>(null)
  const allowLeaveRef = useRef(false)
  const restoringRef = useRef(false)
  const restoredRef = useRef(false)

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

  // Real totals (respecting search) rather than counts of the visible page.
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
  const isFirstLoad = loading && !data
  const hasActiveFilters = q !== '' || status !== ''
  const errors = validate(form)
  const isValid = Object.keys(errors).length === 0
  const isDirty = JSON.stringify(form) !== JSON.stringify(initialForm)

  useEffect(() => {
    setPage(1)
  }, [q])

  // Runs before the route effect below, so it always sees the latest form state.
  useEffect(() => {
    guardRef.current = { open, dirty: isDirty }
  })

  /* ------------------------------------------------------------------
     ROUTE-DRIVEN SHEETS (/customers/create, /customers/:id, /customers/edit/:id[?focus=phone|email])
  ------------------------------------------------------------------ */

  function openForm(customer: Customer | null, focus: FocusField) {
    const next = customer ? toForm(customer) : emptyForm
    setEditing(customer)
    setForm(next)
    setInitialForm(next)
    setTouched({})
    setDuplicate(null)
    setFocusField(focus)
    setOpen(true)
    setView(null)
    formUrlRef.current = `${location.pathname}${location.search}`
  }

  useEffect(() => {
    const path = location.pathname
    const url = `${path}${location.search}`

    // Back pressed on an edited form: return to it and ask before throwing the edits away.
    if (guardRef.current.open && guardRef.current.dirty && formUrlRef.current && url !== formUrlRef.current && !allowLeaveRef.current) {
      restoringRef.current = true
      restoredRef.current = true
      navigate(formUrlRef.current)
      setConfirmDiscard(true)
      return
    }
    allowLeaveRef.current = false
    if (restoringRef.current) {
      restoringRef.current = false
      if (url === formUrlRef.current) return
    }

    // A dialog belongs to the screen it was opened on; never leave it floating after navigation.
    setDeactivate(null)
    setConfirmDiscard(false)

    const focusParam = new URLSearchParams(location.search).get('focus')
    const focus: FocusField = focusParam === 'phone' || focusParam === 'email' ? focusParam : null

    if (path === '/customers/create') {
      if (!canManage) {
        navigate('/customers', { replace: true })
        return
      }
      openForm(null, null)
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
        if (editMatch) openForm(customer, focus)
        else {
          setView(customer)
          setOpen(false)
        }
      })
      .catch((err) => {
        notify(getErrorMessage(err), 'error')
        navigate('/customers')
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, location.search, navigate, notify, canManage])

  function goToList() {
    setOpen(false)
    setView(null)
    setConfirmDiscard(false)
    formUrlRef.current = null
    if (location.pathname === '/customers') return
    allowLeaveRef.current = true
    if (restoredRef.current) {
      // The form entry was re-pushed after a back press; step back instead of stacking another list entry.
      restoredRef.current = false
      navigate(-1)
    } else {
      navigate('/customers')
    }
  }

  function requestCloseForm() {
    if (busy) return
    if (isDirty) setConfirmDiscard(true)
    else goToList()
  }

  // Escape closes the top-most layer (dialogs handle their own).
  useEscapeKey(() => {
    if (deactivate || confirmDiscard) return
    if (open) requestCloseForm()
    else if (view) goToList()
  }, open || view !== null)

  /** Warn (without blocking) when another customer already uses this phone number. */
  async function checkDuplicatePhone() {
    const digits = digitsOnly(form.phone)
    if (digits.length < 7) {
      setDuplicate(null)
      return
    }
    try {
      const result = await customerApi.list({ search: form.phone?.trim(), page: 1, pageSize: 5 })
      setDuplicate(result.items.find((customer) => customer.id !== editing?.id && digitsOnly(customer.phone) === digits) ?? null)
    } catch {
      setDuplicate(null)
    }
  }

  async function save() {
    setTouched({ fullName: true, phone: true, email: true })
    if (!isValid) {
      // Take the user straight to what needs fixing.
      window.requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
      return
    }
    if (busy) return

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
      // Land on the profile so the result is visible.
      allowLeaveRef.current = true
      restoredRef.current = false
      formUrlRef.current = null
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

  function selectStatus(next: StatusFilter) {
    setStatus(next)
    setPage(1)
  }

  const fieldError = (key: keyof CustomerPayload) => (touched[key] ? errors[key] : undefined)
  const money = (value: number) => formatMoney(value, settings.currencySymbol)

  return (
    <div className="flex min-h-full flex-col bg-white text-[#091413] antialiased">
      <PageHeader
        title="Customers"
        subtitle={counts.data ? `${counts.data.active} active customers` : 'Contacts and loyalty points'}
        action={canManage ? <AddButton onClick={() => navigate('/customers/create')} /> : undefined}
      >
        <SearchField value={search} onChange={setSearch} placeholder="Name, phone, email or code" label="Search customers" />
        <Segmented
          label="Customer status"
          value={status}
          onChange={selectStatus}
          options={[
            { key: '', label: 'All', count: counts.data?.all },
            { key: 'active', label: 'Active', count: counts.data?.active },
            { key: 'inactive', label: 'Inactive', count: counts.data?.inactive },
          ]}
        />
      </PageHeader>

      {/* LIST */}
      <main className="flex-1 px-5 pb-6">
        {isFirstLoad && <LoadingBlock />}

        {!loading && error && !data && <ErrorBlock message={error} onRetry={() => void reload()} />}

        {/* A failed refresh keeps the last list on screen */}
        {error && data && (
          <div role="alert" className="mb-2 flex items-center gap-3 rounded-2xl bg-rose-50 py-1 pl-4 pr-1 text-sm text-rose-700">
            <span className="min-w-0 flex-1">Couldn’t refresh. Showing the last loaded list.</span>
            <button
              type="button"
              onClick={() => void reload()}
              disabled={loading}
              className="h-11 shrink-0 rounded-full px-4 font-medium active:bg-rose-100 disabled:opacity-50"
            >
              {loading ? 'Retrying…' : 'Retry'}
            </button>
          </div>
        )}

        {!loading && !error && items.length === 0 && (
          <EmptyBlock
            title={hasActiveFilters ? 'No customers found' : 'No customers yet'}
            hint={
              q
                ? `Nothing matches “${q}”.`
                : hasActiveFilters
                ? 'No customers have this status.'
                : 'Save customers to track their purchases and loyalty points.'
            }
            actionLabel={hasActiveFilters ? 'Clear filters' : canManage ? 'Add first customer' : undefined}
            secondary={hasActiveFilters}
            onAction={
              hasActiveFilters
                ? () => {
                    setSearch('')
                    selectStatus('')
                  }
                : () => navigate('/customers/create')
            }
          />
        )}

        {items.length > 0 && (
          <>
            <ul className={`transition-opacity ${loading ? 'opacity-60' : ''}`}>
              {items.map((customer) => (
                <li key={customer.id} className="border-b border-slate-100 last:border-b-0">
                  <RowButton onClick={() => navigate(`/customers/${customer.id}`)}>
                    <Avatar name={customer.fullName} inactive={!customer.isActive} />

                    <div className="min-w-0 flex-1">
                      <p className={`truncate text-[15px] ${customer.isActive ? '' : 'text-slate-400'}`}>{customer.fullName}</p>
                      <p className="mt-0.5 truncate text-xs text-slate-400">
                        {customer.phone || customer.email || 'No contact info'} · {customer.customerCode}
                      </p>
                    </div>

                    {customer.isActive ? (
                      <div className="shrink-0 text-right">
                        <p className="text-[15px] font-medium tabular-nums">{customer.loyaltyPoints.toLocaleString()}</p>
                        <p className="text-xs text-slate-400">points</p>
                      </div>
                    ) : (
                      <InactivePill />
                    )}
                  </RowButton>
                </li>
              ))}
            </ul>

            {(data?.totalPages ?? 1) > 1 && (
              <div className="pt-4">
                <Pagination page={data?.page ?? 1} totalPages={data?.totalPages ?? 1} onPage={setPage} />
              </div>
            )}
          </>
        )}
      </main>

      {/* PROFILE */}
      {view && (
        <Sheet label={`${view.fullName} profile`} onClose={goToList}>
          <SheetHeader
            title={view.fullName}
            subtitle={`${view.customerCode} · Since ${formatDate(view.createdAt)}`}
            leading={<Avatar name={view.fullName} inactive={!view.isActive} large />}
            onClose={goToList}
          />

          <SheetBody>
            {!view.isActive && (
              <p className="rounded-2xl bg-slate-100 px-4 py-3 text-sm text-slate-600">
                Inactive — this customer can’t be selected at checkout.
              </p>
            )}

            <ContactActions
              phone={view.phone}
              email={view.email}
              onMissing={canManage ? (field) => navigate(`/customers/edit/${view.id}?focus=${field}`) : undefined}
            />

            <div className="rounded-3xl bg-[#F2F8F4] px-5 py-4">
              <p className="text-sm font-medium text-[#1F5E3B]">Loyalty points</p>
              <p className="mt-1 text-3xl font-bold tabular-nums">{view.loyaltyPoints.toLocaleString()}</p>
            </div>

            <DetailList>
              <DetailRow label="Phone" value={view.phone} />
              <DetailRow label="Email" value={view.email} />
              <DetailRow label="Address" value={view.address} />
            </DetailList>

            <section aria-label="Recent purchases" className="pt-2">
              <div className="flex items-baseline justify-between">
                <p className="text-sm font-medium">Recent purchases</p>
                {recentSales.data && recentSales.data.length > 0 && <p className="text-xs text-slate-400">Last {recentSales.data.length}</p>}
              </div>
              {recentSales.loading ? (
                <div className="py-6 text-center">
                  <Spinner />
                </div>
              ) : recentSales.error ? (
                <div className="mt-1 flex items-center justify-between gap-3 py-1 text-sm text-slate-500">
                  <span>Couldn’t load purchases.</span>
                  <button
                    type="button"
                    onClick={() => void recentSales.reload()}
                    className="h-11 shrink-0 rounded-full px-4 font-medium text-[#1F5E3B] active:bg-[#F2F8F4]"
                  >
                    Retry
                  </button>
                </div>
              ) : recentSales.data && recentSales.data.length > 0 ? (
                <ul className="mt-1">
                  {recentSales.data.map((sale) => (
                    <li key={sale.id} className="flex min-h-12 items-center justify-between gap-3 border-b border-slate-100 py-2 last:border-b-0">
                      <span className="min-w-0">
                        <span className="block truncate text-[15px]">{sale.invoiceNumber}</span>
                        <span className="block truncate text-xs text-slate-400">
                          {formatDateTime(sale.createdAt)} · {sale.paymentMethod}
                        </span>
                      </span>
                      <span className={`shrink-0 text-[15px] tabular-nums ${sale.status === 'Voided' ? 'text-slate-400 line-through' : ''}`}>
                        {money(sale.total)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 py-2 text-sm text-slate-400">No purchases yet.</p>
              )}
            </section>
          </SheetBody>

          {canManage && (
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
              <PrimaryButton onClick={() => navigate(`/customers/edit/${view.id}`)}>Edit details</PrimaryButton>
            </SheetFooter>
          )}
        </Sheet>
      )}

      {/* ADD / EDIT */}
      {open && (
        <Sheet label={editing ? 'Edit customer' : 'Add customer'} onClose={requestCloseForm}>
          <form
            ref={formRef}
            noValidate
            onSubmit={(e) => {
              e.preventDefault()
              void save()
            }}
            className="flex min-h-0 flex-1 flex-col"
          >
            <SheetHeader
              title={editing ? 'Edit customer' : 'Add customer'}
              subtitle={editing ? editing.customerCode : 'Only the name is required.'}
              onClose={requestCloseForm}
              closeDisabled={busy}
            />

            <SheetBody>
              <TextField
                label="Full name"
                autoFocus={!editing}
                autoComplete="name"
                autoCapitalize="words"
                enterKeyHint="next"
                value={form.fullName}
                placeholder="e.g. Juan Dela Cruz"
                error={fieldError('fullName')}
                onChange={(fullName) => setForm({ ...form, fullName })}
                onBlur={() => setTouched((t) => ({ ...t, fullName: true }))}
              />

              <div>
                <TextField
                  label="Mobile number"
                  optional
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  enterKeyHint="next"
                  autoFocus={focusField === 'phone'}
                  value={form.phone ?? ''}
                  placeholder="e.g. 0912 345 6789"
                  error={fieldError('phone')}
                  onChange={(phone) => {
                    setForm({ ...form, phone })
                    setDuplicate(null)
                  }}
                  onBlur={() => {
                    setTouched((t) => ({ ...t, phone: true }))
                    void checkDuplicatePhone()
                  }}
                />
                {duplicate && !fieldError('phone') && (
                  <p role="status" className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    This number is already saved for <span className="font-medium">{duplicate.fullName}</span> ({duplicate.customerCode}). Check
                    you’re not adding the same person twice.
                  </p>
                )}
              </div>

              <TextField
                label="Email"
                optional
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                autoCorrect="off"
                enterKeyHint="next"
                autoFocus={focusField === 'email'}
                value={form.email ?? ''}
                placeholder="e.g. juan@email.com"
                error={fieldError('email')}
                onChange={(email) => setForm({ ...form, email })}
                onBlur={() => setTouched((t) => ({ ...t, email: true }))}
              />

              <TextAreaField
                label="Address"
                optional
                autoComplete="street-address"
                value={form.address ?? ''}
                placeholder="Street, city, landmark"
                onChange={(address) => setForm({ ...form, address })}
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
            </SheetBody>

            <SheetFooter>
              <PrimaryButton type="submit" disabled={busy || (editing !== null && !isDirty)}>
                {busy ? 'Saving…' : editing ? (isDirty ? 'Save changes' : 'No changes') : 'Add customer'}
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
          onConfirm={goToList}
        />
      )}

      {deactivate && (
        <ConfirmDialog
          title={`Deactivate ${deactivate.fullName}?`}
          message="They won't appear at checkout. Their history and points are kept, and you can reactivate them anytime."
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

export default MobileCustomers
