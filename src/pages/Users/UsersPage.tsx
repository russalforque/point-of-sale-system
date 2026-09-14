import { useMemo, useState } from 'react'
import {
  Pencil,
  Plus,
  Search,
  Trash2,
} from '../../components/ui/Icons'

import { userApi, type UserAccount, type UserPayload } from '../../api/userApi'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Field, Input, Select } from '../../components/ui/Field'
import { ConfirmDialog, Modal } from '../../components/ui/Modal'
import { PageHeader } from '../../components/ui/Page'
import { EmptyState, ErrorState, Spinner } from '../../components/ui/States'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { useAsync } from '../../hooks/useAsync'
import { useIsMobile } from '../../hooks/useIsMobile'
import { ROLE_LABELS, type Role } from '../../utils/permissions'
import { getErrorMessage } from '../../utils/errors'
import { MobileUsers } from '../mobile/MobileUsers'

type StatusFilter = '' | 'active' | 'inactive'

const emptyForm = (): UserPayload => ({
  email: '',
  fullName: '',
  role: 'cashier',
  isActive: true,
  password: '',
})

export function UsersPage() {
  const isMobile = useIsMobile()
  if (isMobile) return <MobileUsers />
  return <DesktopUsersPage />
}

function DesktopUsersPage() {
  const { notify } = useToast()
  const { user: currentUser } = useAuth()

  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<Role | ''>('')
  const [status, setStatus] = useState<StatusFilter>('')

  const [form, setForm] = useState<UserPayload>(emptyForm())
  const [editing, setEditing] = useState<UserAccount | null>(null)
  const [open, setOpen] = useState(false)
  const [deactivate, setDeactivate] = useState<UserAccount | null>(null)
  const [busy, setBusy] = useState(false)

  const { data, loading, error, reload } = useAsync(() => userApi.list(), [])

  const filtered = useMemo(() => {
    if (!data) return []
    let result = [...data]

    if (search.trim()) {
      const keyword = search.trim().toLowerCase()
      result = result.filter(
        (u) => u.fullName.toLowerCase().includes(keyword) || u.email.toLowerCase().includes(keyword),
      )
    }
    if (roleFilter) result = result.filter((u) => u.role === roleFilter)
    if (status === 'active') result = result.filter((u) => u.isActive)
    else if (status === 'inactive') result = result.filter((u) => !u.isActive)

    return result.sort((a, b) => a.fullName.localeCompare(b.fullName))
  }, [data, search, roleFilter, status])

  const totalUsers = data?.length ?? 0
  const activeUsers = data?.filter((u) => u.isActive).length ?? 0
  const adminCount = data?.filter((u) => u.role === 'admin').length ?? 0

  const hasFilters = Boolean(search.trim() || roleFilter || status)

  function resetFilters() {
    setSearch('')
    setRoleFilter('')
    setStatus('')
  }

  function openCreate() {
    setEditing(null)
    setForm(emptyForm())
    setOpen(true)
  }

  function openEdit(account: UserAccount) {
    setEditing(account)
    setForm({ email: account.email, fullName: account.fullName, role: account.role, isActive: account.isActive, password: '' })
    setOpen(true)
  }

  function closeModal() {
    if (busy) return
    setOpen(false)
  }

  async function save() {
    if (!form.email.trim() || !form.fullName.trim()) {
      notify('Email and full name are required.', 'error')
      return
    }
    if (!editing && !form.password?.trim()) {
      notify('Password is required for a new account.', 'error')
      return
    }

    setBusy(true)
    try {
      if (editing) {
        await userApi.update(editing.id, { ...form, password: form.password?.trim() || undefined })
        notify('User account updated.')
      } else {
        await userApi.create(form)
        notify('User account created.')
      }
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
      await userApi.deactivate(deactivate.id)
      notify('User account deactivated.')
      setDeactivate(null)
      await reload()
    } catch (err) {
      notify(getErrorMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#091413]/[0.02] text-[#091413] antialiased">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 md:px-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <PageHeader title="Users" subtitle="Staff accounts, roles, and access" />
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center justify-center gap-2 self-start rounded-lg bg-[#285A48] px-3.5 py-2 text-xs font-medium text-white shadow-xs transition-colors hover:bg-[#1e4537] active:scale-[0.98] sm:self-auto"
          >
            <Plus size={15} />
            <span>Add user</span>
          </button>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-3">
          <MetricCard label="Total accounts" value={totalUsers} isSelected={status === '' && !roleFilter} onClick={resetFilters} />
          <MetricCard label="Active" value={activeUsers} indicator="pine" isSelected={status === 'active'} onClick={() => setStatus((prev) => (prev === 'active' ? '' : 'active'))} />
          <MetricCard label="Admins" value={adminCount} isSelected={roleFilter === 'admin'} onClick={() => setRoleFilter((prev) => (prev === 'admin' ? '' : 'admin'))} />
        </div>

        <div className="mt-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-1 rounded-lg border border-[#091413]/10 bg-[#091413]/[0.04] p-0.5 self-start">
            {(['', 'admin', 'manager', 'cashier'] as const).map((r) => (
              <button
                key={r || 'all'}
                type="button"
                onClick={() => setRoleFilter(r)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                  roleFilter === r ? 'bg-white text-[#091413] shadow-xs' : 'text-[#091413]/60 hover:text-[#091413]'
                }`}
              >
                {r ? ROLE_LABELS[r] : 'All roles'}
              </button>
            ))}
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 flex-1 lg:max-w-md lg:justify-end">
            <div className="relative w-full">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#091413]/40" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name or email..."
                className="h-9 w-full rounded-lg border border-[#091413]/15 bg-white pl-8.5 pr-8 text-xs text-[#091413] placeholder-[#091413]/40 outline-none transition-colors focus:border-[#285A48] focus:ring-1 focus:ring-[#285A48]"
              />
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

          {!loading && !error && filtered.length === 0 && (
            <div className="p-8 text-center">
              <EmptyState
                title="No user accounts found"
                hint={hasFilters ? 'Try clearing filters or search a different keyword.' : 'Create the first staff account.'}
              />
            </div>
          )}

          {!loading && !error && filtered.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-[#091413]/80">
                <thead className="border-b border-[#091413]/10 bg-[#091413]/[0.02] text-[11px] font-medium uppercase tracking-wider text-[#091413]/50">
                  <tr>
                    <th className="py-3 pl-4 pr-3 sm:pl-6 font-medium">Name</th>
                    <th className="py-3 px-3 font-medium">Email</th>
                    <th className="py-3 px-3 font-medium">Role</th>
                    <th className="py-3 px-3 text-center font-medium">Status</th>
                    <th className="py-3 pl-3 pr-4 sm:pr-6 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#091413]/5 font-normal">
                  {filtered.map((account) => (
                    <tr key={account.id} className="transition-colors hover:bg-[#285A48]/[0.03]">
                      <td className="py-3.5 pl-4 pr-3 sm:pl-6 font-medium text-[#091413]">
                        {account.fullName}
                        {currentUser && Number(currentUser.id) === account.id && (
                          <span className="ml-1.5 text-[10px] font-semibold text-[#285A48]">(you)</span>
                        )}
                      </td>
                      <td className="py-3.5 px-3 text-[#091413]/70">{account.email}</td>
                      <td className="py-3.5 px-3">
                        <Badge tone={account.role === 'admin' ? 'blue' : account.role === 'manager' ? 'amber' : 'gray'}>
                          {ROLE_LABELS[account.role]}
                        </Badge>
                      </td>
                      <td className="py-3.5 px-3 text-center">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${
                            account.isActive
                              ? 'bg-[#285A48]/10 text-[#285A48] border border-[#285A48]/20'
                              : 'bg-[#091413]/[0.05] text-[#091413]/60 border border-[#091413]/10'
                          }`}
                        >
                          {account.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="py-3.5 pl-3 pr-4 sm:pr-6 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            title="Edit account"
                            onClick={() => openEdit(account)}
                            className="flex h-8 w-8 items-center justify-center rounded-md text-[#091413]/40 transition-colors hover:bg-[#285A48]/10 hover:text-[#285A48] active:scale-95"
                          >
                            <Pencil size={15} />
                          </button>
                          {account.isActive && !(currentUser && Number(currentUser.id) === account.id) && (
                            <button
                              type="button"
                              title="Deactivate account"
                              onClick={() => setDeactivate(account)}
                              className="flex h-8 w-8 items-center justify-center rounded-md text-[#091413]/40 transition-colors hover:bg-rose-50 hover:text-rose-600 active:scale-95"
                            >
                              <Trash2 size={15} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </main>
      </div>

      {open && (
        <Modal
          title={editing ? 'Edit user account' : 'Add user account'}
          onClose={closeModal}
          preventClose={busy}
          footer={
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="secondary" onClick={closeModal} disabled={busy}>
                Cancel
              </Button>
              <button
                type="button"
                onClick={() => void save()}
                disabled={busy || !form.email.trim() || !form.fullName.trim()}
                className="inline-flex items-center justify-center rounded-lg bg-[#285A48] px-4 py-2 text-xs font-medium text-white shadow-xs transition-colors hover:bg-[#1e4537] disabled:opacity-50"
              >
                {busy ? 'Saving…' : editing ? 'Save changes' : 'Create account'}
              </button>
            </div>
          }
        >
          <div className="space-y-4 text-xs">
            <Field label="Full name" required>
              <Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} required autoFocus />
            </Field>

            <Field label="Email" required>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                required
                disabled={Boolean(editing)}
              />
            </Field>

            <Field label="Role" required>
              <Select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
                disabled={Boolean(editing && currentUser && Number(currentUser.id) === editing.id)}
              >
                <option value="admin">Admin</option>
                <option value="manager">Manager</option>
                <option value="cashier">Cashier</option>
              </Select>
            </Field>

            <Field
              label={editing ? 'New password (leave blank to keep current)' : 'Password'}
              required={!editing}
              hint={editing ? undefined : 'Minimum 8 characters'}
            >
              <Input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder={editing ? '••••••••' : 'Minimum 8 characters'}
                required={!editing}
              />
            </Field>

            <label className="flex items-center gap-2 text-xs font-medium text-[#091413]/80 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                disabled={Boolean(editing && currentUser && Number(currentUser.id) === editing.id)}
                className="h-4 w-4 rounded border-[#091413]/20 text-[#285A48] focus:ring-[#285A48]"
              />
              Active account
            </label>
          </div>
        </Modal>
      )}

      {deactivate && (
        <ConfirmDialog
          title="Deactivate user account"
          message={`Deactivate ${deactivate.fullName}? They will no longer be able to sign in.`}
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

function MetricCard({
  label,
  value,
  indicator,
  isSelected = false,
  onClick,
}: {
  label: string
  value: string | number
  indicator?: 'pine'
  isSelected?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative rounded-xl border p-3.5 sm:p-4 text-left transition-all active:scale-[0.99] ${
        isSelected ? 'border-[#285A48] bg-white ring-1 ring-[#285A48] shadow-xs' : 'border-[#091413]/10 bg-white hover:border-[#285A48]/50'
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wider text-[#091413]/50">{label}</span>
        {indicator === 'pine' && <span className="h-1.5 w-1.5 rounded-full bg-[#285A48]" />}
      </div>
      <p className="mt-2 text-xl font-semibold tracking-tight text-[#091413] sm:text-2xl">{value}</p>
    </button>
  )
}

export default UsersPage
