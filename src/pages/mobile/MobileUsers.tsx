import { useMemo, useState } from 'react'

import { userApi, type UserAccount, type UserPayload } from '../../api/userApi'
import { Users as UsersIcon } from '../../components/ui/Icons'
import { Button } from '../../components/ui/Button'
import { Field, Input, Select } from '../../components/ui/Field'
import { ConfirmDialog, Modal } from '../../components/ui/Modal'
import { MobileEmpty, MobileError, MobileLoading, StickyToolbar } from '../../components/ui/MobileStates'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { useAsync } from '../../hooks/useAsync'
import { ROLE_LABELS, type Role } from '../../utils/permissions'
import { getErrorMessage } from '../../utils/errors'

const emptyForm = (): UserPayload => ({
  email: '',
  fullName: '',
  role: 'cashier',
  isActive: true,
  password: '',
})

export function MobileUsers() {
  const { notify } = useToast()
  const { user: currentUser } = useAuth()

  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<Role | ''>('')

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
      result = result.filter((u) => u.fullName.toLowerCase().includes(keyword) || u.email.toLowerCase().includes(keyword))
    }
    if (roleFilter) result = result.filter((u) => u.role === roleFilter)
    return result.sort((a, b) => a.fullName.localeCompare(b.fullName))
  }, [data, search, roleFilter])

  const totalUsers = data?.length ?? 0
  const activeUsers = data?.filter((u) => u.isActive).length ?? 0
  const adminCount = data?.filter((u) => u.role === 'admin').length ?? 0

  const hasFilters = Boolean(search.trim() || roleFilter)

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

  const isSelf = (account: UserAccount) => Boolean(currentUser && Number(currentUser.id) === account.id)

  return (
    <div className="min-h-screen bg-[#F6F8F7] pb-28 pt-[max(0.75rem,env(safe-area-inset-top,0px))] text-[#091413] antialiased">
      <main className="mx-auto w-full max-w-2xl px-4 sm:px-6">
        <header className="flex items-center justify-between gap-3 pb-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-black tracking-tight text-[#091413]">Users</h1>
            <p className="mt-0.5 text-xs text-slate-500">Staff accounts &amp; roles</p>
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
          <MetricTile label="Total" value={totalUsers} active={!roleFilter} onClick={() => setRoleFilter('')} />
          <div className="flex min-h-17 flex-col items-center justify-center rounded-2xl border border-[#E5EBE7] bg-white py-2 text-center">
            <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Active
            </span>
            <span className="mt-1 text-lg font-black tabular-nums text-[#091413]">{activeUsers}</span>
          </div>
          <MetricTile label="Admins" value={adminCount} active={roleFilter === 'admin'} onClick={() => setRoleFilter((prev) => (prev === 'admin' ? '' : 'admin'))} />
        </section>

        <StickyToolbar>
          <div className="relative mt-2">
            <SearchIcon size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or email..."
              className="h-12 w-full rounded-2xl border border-[#E5EBE7] bg-white pl-10 pr-9 text-sm font-medium text-[#091413] placeholder-slate-400 shadow-2xs outline-none transition focus:border-[#285A48] focus:ring-2 focus:ring-[#285A48]/15"
            />
          </div>
          <div className="mt-2.5 flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
            {(['', 'admin', 'manager', 'cashier'] as const).map((r) => (
              <button
                key={r || 'all'}
                type="button"
                onClick={() => setRoleFilter(r)}
                className={`shrink-0 rounded-full px-4 py-2 text-xs font-bold transition-all active:scale-95 touch-manipulation ${
                  roleFilter === r ? 'bg-[#091413] text-white shadow-xs' : 'border border-[#E5EBE7] bg-white text-slate-600'
                }`}
              >
                {r ? ROLE_LABELS[r] : 'All roles'}
              </button>
            ))}
          </div>
        </StickyToolbar>

        <section className="mt-2">
          {loading && <MobileLoading label="Loading users…" />}

          {error && <MobileError message={error} onRetry={() => void reload()} />}

          {!loading && !error && filtered.length === 0 && (
            <MobileEmpty
              icon={<UsersIcon size={22} />}
              title="No user accounts found"
              hint={hasFilters ? 'Try clearing filters or search a different keyword.' : 'Create the first staff account.'}
              action={
                !hasFilters ? (
                  <Button onClick={openCreate} className="min-h-12 w-full text-sm">
                    Add User
                  </Button>
                ) : undefined
              }
            />
          )}

          {!loading && !error && filtered.length > 0 && (
            <div className="space-y-3">
              {filtered.map((account) => (
                <article key={account.id} className="rounded-3xl border border-[#E5EBE7] bg-white p-4 shadow-xs">
                  <div className="flex items-start gap-3">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#EAF1EE] text-sm font-black text-[#285A48]">
                      {account.fullName.slice(0, 1).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-[#091413]">
                            {account.fullName}
                            {isSelf(account) && <span className="ml-1.5 text-[10px] font-semibold text-[#285A48]">(you)</span>}
                          </p>
                          <p className="truncate text-[11px] text-slate-400">{account.email}</p>
                        </div>
                        <span
                          className={`shrink-0 inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold ${
                            account.isActive ? 'bg-[#EAF1EE] text-[#285A48]' : 'bg-slate-100 text-slate-500'
                          }`}
                        >
                          {account.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      <span className="mt-1.5 inline-block rounded-lg bg-[#F6F8F7] px-2 py-0.5 text-[11px] font-semibold text-slate-600 border border-[#E5EBE7]">
                        {ROLE_LABELS[account.role]}
                      </span>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3">
                    <button
                      type="button"
                      onClick={() => openEdit(account)}
                      className="flex h-11 flex-1 items-center justify-center rounded-xl border border-[#E5EBE7] bg-white text-xs font-bold text-[#285A48] active:scale-95 touch-manipulation"
                    >
                      Edit
                    </button>
                    {account.isActive && !isSelf(account) && (
                      <button
                        type="button"
                        onClick={() => setDeactivate(account)}
                        aria-label="Deactivate account"
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-rose-200 bg-rose-50 text-rose-600 active:scale-95 touch-manipulation"
                      >
                        <TrashIcon size={15} />
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>

      {open && (
        <Modal
          title={editing ? 'Edit user account' : 'Add user account'}
          onClose={closeModal}
          preventClose={busy}
          footer={
            <div className="flex flex-col-reverse gap-2 w-full">
              <Button variant="secondary" onClick={closeModal} disabled={busy} className="min-h-12 text-sm">
                Cancel
              </Button>
              <Button onClick={() => void save()} disabled={busy || !form.email.trim() || !form.fullName.trim()} className="min-h-12 text-sm">
                {busy ? 'Saving…' : editing ? 'Save changes' : 'Create account'}
              </Button>
            </div>
          }
        >
          <div className="grid gap-4 text-sm">
            <Field label="Full name" required>
              <Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} className="min-h-12 rounded-2xl text-sm" required autoFocus />
            </Field>

            <Field label="Email" required>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="min-h-12 rounded-2xl text-sm"
                required
                disabled={Boolean(editing)}
              />
            </Field>

            <Field label="Role" required>
              <Select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
                className="min-h-12 rounded-2xl text-sm"
                disabled={Boolean(editing && isSelf(editing))}
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
                className="min-h-12 rounded-2xl text-sm"
                required={!editing}
              />
            </Field>

            <label className="flex min-h-12 items-center gap-3 rounded-2xl border border-[#E5EBE7] bg-white px-3.5 text-sm font-bold text-slate-700">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                disabled={Boolean(editing && isSelf(editing))}
                className="h-5 w-5 rounded-md border-[#E5EBE7] text-[#285A48] focus:ring-[#285A48]"
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

function TrashIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </svg>
  )
}

export default MobileUsers
