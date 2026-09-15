import { useMemo, useState } from 'react'

import { userApi, type UserAccount, type UserPayload } from '../../api/userApi'
import {
  AddButton,
  Avatar,
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
  TextButton,
  TextField,
  useEscapeKey,
} from '../../components/ui/MobileKit'
import { ConfirmDialog } from '../../components/ui/Modal'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { useAsync } from '../../hooks/useAsync'
import { getErrorMessage } from '../../utils/errors'
import { ROLE_LABELS, type Role } from '../../utils/permissions'

type RoleFilter = Role | ''
type FormErrors = Partial<Record<'fullName' | 'email' | 'password', string>>

const MIN_PASSWORD = 8

const ROLES: { value: Role; description: string }[] = [
  { value: 'cashier', description: 'Sales, payments and customers' },
  { value: 'manager', description: 'Plus products, inventory and reports' },
  { value: 'admin', description: 'Full access, including users and settings' },
]

const emptyForm = (): UserPayload => ({ email: '', fullName: '', role: 'cashier', isActive: true, password: '' })

export function MobileUsers() {
  const { notify } = useToast()
  const { user: currentUser } = useAuth()

  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('')

  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<UserAccount | null>(null)
  const [form, setForm] = useState<UserPayload>(emptyForm())
  const [initialForm, setInitialForm] = useState<UserPayload>(emptyForm())
  const [touched, setTouched] = useState<Partial<Record<keyof FormErrors, boolean>>>({})
  const [showPassword, setShowPassword] = useState(false)
  const [deactivate, setDeactivate] = useState<UserAccount | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [busy, setBusy] = useState(false)

  const { data, loading, error, reload } = useAsync(() => userApi.list(), [])
  const users = data ?? []

  const isSelf = (account: UserAccount | null) => Boolean(account && currentUser && Number(currentUser.id) === account.id)

  const counts = useMemo(
    () => ({
      all: users.length,
      admin: users.filter((u) => u.role === 'admin').length,
      manager: users.filter((u) => u.role === 'manager').length,
      cashier: users.filter((u) => u.role === 'cashier').length,
    }),
    [users],
  )

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    return users
      .filter((u) => !roleFilter || u.role === roleFilter)
      .filter((u) => !keyword || u.fullName.toLowerCase().includes(keyword) || u.email.toLowerCase().includes(keyword))
      .sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.fullName.localeCompare(b.fullName))
  }, [users, search, roleFilter])

  const errors: FormErrors = {}
  if (!form.fullName.trim()) errors.fullName = 'Enter the person’s name.'
  if (!EMAIL_PATTERN.test(form.email.trim())) errors.email = 'Enter a valid email. It’s used to sign in.'
  else if (!editing && users.some((u) => u.email.toLowerCase() === form.email.trim().toLowerCase()))
    errors.email = 'An account with this email already exists.'
  const password = form.password ?? ''
  if (!editing && password.length < MIN_PASSWORD) errors.password = `Use at least ${MIN_PASSWORD} characters.`
  else if (editing && password.length > 0 && password.length < MIN_PASSWORD)
    errors.password = `Use at least ${MIN_PASSWORD} characters, or leave blank.`

  const isValid = Object.keys(errors).length === 0
  const isDirty = JSON.stringify(form) !== JSON.stringify(initialForm)
  const editingSelf = isSelf(editing)
  const hasFilters = search.trim() !== '' || roleFilter !== ''
  const fieldError = (key: keyof FormErrors) => (touched[key] ? errors[key] : undefined)

  function openForm(account: UserAccount | null) {
    const next = account
      ? { email: account.email, fullName: account.fullName, role: account.role, isActive: account.isActive, password: '' }
      : emptyForm()
    setEditing(account)
    setForm(next)
    setInitialForm(next)
    setTouched({})
    setShowPassword(false)
    setOpen(true)
  }

  function closeForm() {
    setOpen(false)
    setConfirmDiscard(false)
  }

  function requestClose() {
    if (busy) return
    if (isDirty) setConfirmDiscard(true)
    else closeForm()
  }

  useEscapeKey(requestClose, open && !deactivate && !confirmDiscard)

  async function save() {
    setTouched({ fullName: true, email: true, password: true })
    if (!isValid || busy) return

    setBusy(true)
    try {
      const payload: UserPayload = {
        ...form,
        fullName: form.fullName.trim(),
        email: form.email.trim(),
        password: password || undefined,
      }
      if (editing) await userApi.update(editing.id, payload)
      else await userApi.create(payload)
      notify(editing ? 'Changes saved.' : `Account created for ${payload.fullName}.`)
      closeForm()
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
      await userApi.deactivate(deactivate.id)
      notify(`${deactivate.fullName} can no longer sign in.`)
      setDeactivate(null)
      closeForm()
      await reload()
    } catch (err) {
      notify(getErrorMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function reactivate(account: UserAccount) {
    setBusy(true)
    try {
      await userApi.update(account.id, { ...account, isActive: true, password: undefined })
      notify(`${account.fullName} can sign in again.`)
      closeForm()
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
        title="Users"
        subtitle={data ? `${users.filter((u) => u.isActive).length} people can sign in` : 'Staff accounts and roles'}
        action={<AddButton onClick={() => openForm(null)} />}
      >
        <SearchField value={search} onChange={setSearch} placeholder="Name or email" label="Search users" />
        <Segmented
          scroll
          label="Role"
          value={roleFilter}
          onChange={setRoleFilter}
          options={[
            { key: '', label: 'All', count: data ? counts.all : undefined },
            { key: 'admin', label: 'Admins', count: data ? counts.admin : undefined },
            { key: 'manager', label: 'Managers', count: data ? counts.manager : undefined },
            { key: 'cashier', label: 'Cashiers', count: data ? counts.cashier : undefined },
          ]}
        />
      </PageHeader>

      <main className="flex-1 px-5 pb-6">
        {loading && !data && <LoadingBlock />}
        {!loading && error && <ErrorBlock message={error} onRetry={() => void reload()} />}

        {!error && data && filtered.length === 0 && (
          <EmptyBlock
            title="No users found"
            hint={hasFilters ? 'Try a different search or role.' : 'Create accounts for your staff.'}
            actionLabel={hasFilters ? 'Clear filters' : 'Add user'}
            secondary={hasFilters}
            onAction={
              hasFilters
                ? () => {
                    setSearch('')
                    setRoleFilter('')
                  }
                : () => openForm(null)
            }
          />
        )}

        {filtered.length > 0 && (
          <ul>
            {filtered.map((account) => (
              <li key={account.id} className="border-b border-slate-100 last:border-b-0">
                <RowButton onClick={() => openForm(account)}>
                  <Avatar name={account.fullName} inactive={!account.isActive} />
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-[15px] ${account.isActive ? '' : 'text-slate-400'}`}>
                      {account.fullName}
                      {isSelf(account) && <span className="ml-1.5 text-xs font-medium text-[#1F5E3B]">You</span>}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-slate-400">{account.email}</p>
                  </div>
                  {account.isActive ? (
                    <span className="shrink-0 text-sm text-slate-500">{ROLE_LABELS[account.role]}</span>
                  ) : (
                    <InactivePill />
                  )}
                </RowButton>
              </li>
            ))}
          </ul>
        )}
      </main>

      {open && (
        <Sheet label={editing ? 'Edit user' : 'Add user'} onClose={requestClose}>
          <form
            noValidate
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(e) => {
              e.preventDefault()
              void save()
            }}
          >
            <SheetHeader
              title={editing ? editing.fullName : 'Add user'}
              subtitle={editing ? (editing.isActive ? ROLE_LABELS[editing.role] : 'Inactive — can’t sign in') : undefined}
              leading={editing ? <Avatar name={editing.fullName} inactive={!editing.isActive} /> : undefined}
              onClose={requestClose}
              closeDisabled={busy}
            />

            <SheetBody>
              <TextField
                label="Full name"
                value={form.fullName}
                onChange={(fullName) => setForm({ ...form, fullName })}
                onBlur={() => setTouched((t) => ({ ...t, fullName: true }))}
                error={fieldError('fullName')}
                placeholder="e.g. Maria Santos"
                autoFocus={!editing}
                autoComplete="off"
                autoCapitalize="words"
              />

              <TextField
                label="Email"
                type="email"
                inputMode="email"
                autoComplete="off"
                autoCapitalize="none"
                value={form.email}
                onChange={(email) => setForm({ ...form, email })}
                onBlur={() => setTouched((t) => ({ ...t, email: true }))}
                error={editing ? undefined : fieldError('email')}
                hint={editing ? 'Used to sign in, so it can’t be changed.' : 'Used to sign in.'}
                disabled={Boolean(editing)}
                placeholder="e.g. maria@store.com"
              />

              {/* Role as descriptive choices so the impact of each is clear */}
              <fieldset disabled={editingSelf}>
                <legend className="text-sm font-medium">Role</legend>
                <div className="mt-1.5 space-y-2">
                  {ROLES.map((role) => {
                    const selected = form.role === role.value
                    return (
                      <label
                        key={role.value}
                        className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl px-4 py-2 transition ${
                          selected ? 'bg-[#F2F8F4] ring-2 ring-[#1F5E3B]' : 'bg-[#F6F8F7]'
                        } ${editingSelf ? 'cursor-not-allowed opacity-60' : ''}`}
                      >
                        <input
                          type="radio"
                          name="role"
                          value={role.value}
                          checked={selected}
                          onChange={() => setForm({ ...form, role: role.value })}
                          className="h-5 w-5 accent-[#1F5E3B]"
                        />
                        <span className="min-w-0">
                          <span className="block text-[15px]">{ROLE_LABELS[role.value]}</span>
                          <span className="block text-xs text-slate-500">{role.description}</span>
                        </span>
                      </label>
                    )
                  })}
                </div>
                {editingSelf && <p className="mt-1.5 text-xs text-slate-500">You can’t change your own role.</p>}
              </fieldset>

              <TextField
                label={editing ? 'New password' : 'Password'}
                optional={Boolean(editing)}
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                value={password}
                onChange={(value) => setForm({ ...form, password: value })}
                onBlur={() => setTouched((t) => ({ ...t, password: true }))}
                error={fieldError('password')}
                hint={editing ? 'Leave blank to keep their current password.' : `At least ${MIN_PASSWORD} characters.`}
                trailing={
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="h-10 rounded-xl px-3 text-sm font-medium text-[#1F5E3B] active:bg-[#E6F1EA]"
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                }
              />

              {editing && editing.isActive && !editingSelf && (
                <TextButton tone="danger" onClick={() => setDeactivate(editing)} disabled={busy} className="-ml-4">
                  Deactivate account
                </TextButton>
              )}
              {editing && !editing.isActive && (
                <TextButton tone="accent" onClick={() => void reactivate(editing)} disabled={busy} className="-ml-4">
                  {busy ? 'Reactivating…' : 'Reactivate account'}
                </TextButton>
              )}
            </SheetBody>

            <SheetFooter>
              <PrimaryButton type="submit" disabled={busy || (editing !== null && !isDirty)}>
                {busy ? 'Saving…' : editing ? (isDirty ? 'Save changes' : 'No changes') : 'Create account'}
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
          title={`Deactivate ${deactivate.fullName}?`}
          message="They won’t be able to sign in. Their sales history is kept, and you can reactivate the account anytime."
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

export default MobileUsers
