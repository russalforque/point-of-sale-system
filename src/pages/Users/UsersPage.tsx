import { useMemo, useState } from 'react'

import { userApi, type UserAccount, type UserPayload } from '../../api/userApi'
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
import { AddButton, Avatar, EMAIL_PATTERN, PrimaryButton, TextButton, TextField } from '../../components/ui/MobileKit'
import { ConfirmDialog, Modal } from '../../components/ui/Modal'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { useAsync } from '../../hooks/useAsync'
import { useIsMobile } from '../../hooks/useIsMobile'
import { getErrorMessage } from '../../utils/errors'
import { ROLE_LABELS, type Role } from '../../utils/permissions'
import { MobileUsers } from '../mobile/MobileUsers'

type RoleFilter = Role | ''
type FormErrors = Partial<Record<'fullName' | 'email' | 'password', string>>

const FORM_ID = 'user-form'
const MIN_PASSWORD = 8

const ROLES: { value: Role; description: string }[] = [
  { value: 'cashier', description: 'Sales, payments and customers' },
  { value: 'manager', description: 'Plus products, inventory and reports' },
  { value: 'admin', description: 'Full access, including users and settings' },
]

const emptyForm = (): UserPayload => ({ email: '', fullName: '', role: 'cashier', isActive: true, password: '' })

export function UsersPage() {
  const isMobile = useIsMobile()
  if (isMobile) return <MobileUsers />
  return <DesktopUsersPage />
}

function DesktopUsersPage() {
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
  const users = useMemo(() => data ?? [], [data])

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

  const password = form.password ?? ''
  const errors: FormErrors = {}
  if (!form.fullName.trim()) errors.fullName = 'Enter the person’s name.'
  if (!EMAIL_PATTERN.test(form.email.trim())) errors.email = 'Enter a valid email. It’s used to sign in.'
  else if (!editing && users.some((u) => u.email.toLowerCase() === form.email.trim().toLowerCase()))
    errors.email = 'An account with this email already exists.'
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

  async function save() {
    setTouched({ fullName: true, email: true, password: true })
    if (!isValid || busy) return
    setBusy(true)
    try {
      const payload: UserPayload = { ...form, fullName: form.fullName.trim(), email: form.email.trim(), password: password || undefined }
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
    <DesktopPage
      title="Users"
      subtitle={data ? `${users.filter((u) => u.isActive).length} people can sign in` : 'Staff accounts and roles'}
      actions={<AddButton label="Add user" onClick={() => openForm(null)} />}
    >
      <Toolbar>
        <DesktopSearch value={search} onChange={setSearch} placeholder="Search name or email" label="Search users" />
        <FilterPills
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
      </Toolbar>

      <DataCard className="mt-4">
        {loading && !data && <LoadingRow />}
        {!loading && error && <ErrorRow message={error} onRetry={() => void reload()} />}
        {!error && data && filtered.length === 0 && (
          <EmptyRow
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
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-100 text-xs text-slate-500">
                <tr>
                  <Th className="pl-6">Name</Th>
                  <Th>Email</Th>
                  <Th>Role</Th>
                  <Th>Status</Th>
                  <Th className="pr-6">
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((account) => (
                  <tr key={account.id} onClick={() => openForm(account)} className="group cursor-pointer hover:bg-slate-50">
                    <td className="py-3 pl-6 pr-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={account.fullName} inactive={!account.isActive} />
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            openForm(account)
                          }}
                          className={`text-left font-medium focus-visible:underline focus-visible:outline-none ${account.isActive ? '' : 'text-slate-400'}`}
                        >
                          {account.fullName}
                          {isSelf(account) && <span className="ml-1.5 text-xs font-medium text-[#1F5E3B]">You</span>}
                        </button>
                      </div>
                    </td>
                    <td className="max-w-72 truncate px-3 py-3 text-slate-600">{account.email}</td>
                    <td className="px-3 py-3">{ROLE_LABELS[account.role]}</td>
                    <td className="px-3 py-3">
                      <StatusCell active={account.isActive} />
                    </td>
                    <td className="py-3 pl-3 pr-6 text-right">
                      <HoverAction label="Edit" ariaLabel={`Edit ${account.fullName}`} onClick={() => openForm(account)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DataCard>

      {open && (
        <Modal
          title={editing ? editing.fullName : 'Add user'}
          description={editing ? (editing.isActive ? ROLE_LABELS[editing.role] : 'Inactive — can’t sign in') : undefined}
          size="lg"
          onClose={requestClose}
          preventClose={busy}
          footer={
            <div className="flex w-full items-center gap-2">
              {editing && editing.isActive && !editingSelf && (
                <TextButton tone="danger" onClick={() => setDeactivate(editing)} disabled={busy} className="h-12">
                  Deactivate
                </TextButton>
              )}
              {editing && !editing.isActive && (
                <TextButton tone="accent" onClick={() => void reactivate(editing)} disabled={busy} className="h-12">
                  {busy ? 'Reactivating…' : 'Reactivate'}
                </TextButton>
              )}
              <div className="flex-1" />
              <TextButton onClick={requestClose} disabled={busy} className="h-12">
                Cancel
              </TextButton>
              <PrimaryButton type="submit" form={FORM_ID} disabled={busy || (editing !== null && !isDirty)} className="h-12 flex-none px-8">
                {busy ? 'Saving…' : editing ? (isDirty ? 'Save changes' : 'No changes') : 'Create account'}
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
            className="space-y-5"
          >
            <div className="grid gap-4 sm:grid-cols-2">
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
            </div>

            <fieldset disabled={editingSelf}>
              <legend className="text-sm font-medium">Role</legend>
              <div className="mt-1.5 grid gap-2 sm:grid-cols-3">
                {ROLES.map((role) => {
                  const selected = form.role === role.value
                  return (
                    <label
                      key={role.value}
                      className={`flex cursor-pointer items-start gap-3 rounded-2xl px-4 py-3 transition ${
                        selected ? 'bg-[#F2F8F4] ring-2 ring-[#1F5E3B]' : 'bg-[#F6F8F7] hover:bg-[#EEF3F0]'
                      } ${editingSelf ? 'cursor-not-allowed opacity-60' : ''}`}
                    >
                      <input
                        type="radio"
                        name="role"
                        value={role.value}
                        checked={selected}
                        onChange={() => setForm({ ...form, role: role.value })}
                        className="mt-0.5 h-4 w-4 accent-[#1F5E3B]"
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{ROLE_LABELS[role.value]}</span>
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
                  onClick={() => setShowPassword((visible) => !visible)}
                  className="h-10 rounded-xl px-3 text-sm font-medium text-[#1F5E3B] hover:bg-[#E6F1EA]"
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              }
            />
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
          title={`Deactivate ${deactivate.fullName}?`}
          message="They won’t be able to sign in. Their sales history is kept, and you can reactivate the account anytime."
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

export default UsersPage
