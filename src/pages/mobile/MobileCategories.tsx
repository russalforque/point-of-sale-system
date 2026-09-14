import { useMemo, useState } from 'react'

import { categoryApi, type CategoryPayload } from '../../api/categoryApi'
import { Tags } from '../../components/ui/Icons'
import { Button } from '../../components/ui/Button'
import { Field, Input, Textarea } from '../../components/ui/Field'
import { ConfirmDialog, Modal } from '../../components/ui/Modal'
import { MobileEmpty, MobileError, MobileLoading, StickyToolbar } from '../../components/ui/MobileStates'
import { useToast } from '../../context/ToastContext'
import { useAsync } from '../../hooks/useAsync'
import type { Category } from '../../types'
import { getErrorMessage } from '../../utils/errors'

const emptyForm: CategoryPayload = {
  name: '',
  description: '',
  isActive: true,
}

type StatusFilter = 'all' | 'active' | 'inactive'

export function MobileCategories() {
  const { notify } = useToast()

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  const [editing, setEditing] = useState<Category | null>(null)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<CategoryPayload>(emptyForm)
  const [busy, setBusy] = useState(false)
  const [remove, setRemove] = useState<Category | null>(null)

  const { data, loading, error, reload } = useAsync(() => categoryApi.list(), [])

  const totalCategories = data?.length ?? 0
  const activeCount = data?.filter((c) => c.isActive).length ?? 0
  const inactiveCount = totalCategories - activeCount

  const hasActiveFilters = search.trim() !== '' || statusFilter !== 'all'

  const filtered = useMemo(() => {
    if (!data) return []
    let result = [...data]

    if (search.trim()) {
      const keyword = search.trim().toLowerCase()
      result = result.filter(
        (c) => c.name.toLowerCase().includes(keyword) || (c.description ?? '').toLowerCase().includes(keyword),
      )
    }

    if (statusFilter === 'active') result = result.filter((c) => c.isActive)
    else if (statusFilter === 'inactive') result = result.filter((c) => !c.isActive)

    return result.sort((a, b) => a.name.localeCompare(b.name))
  }, [data, search, statusFilter])

  function resetFilters() {
    setSearch('')
    setStatusFilter('all')
  }

  function updateForm<K extends keyof CategoryPayload>(field: K, value: CategoryPayload[K]) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  function openCreate() {
    setEditing(null)
    setForm({ ...emptyForm })
    setOpen(true)
  }

  function openEdit(category: Category) {
    setEditing(category)
    setForm({ name: category.name, description: category.description ?? '', isActive: category.isActive })
    setOpen(true)
  }

  function closeModal() {
    if (busy) return
    setOpen(false)
  }

  async function save() {
    const name = form.name.trim()
    if (!name) {
      notify('Category name is required.', 'error')
      return
    }

    setBusy(true)
    try {
      const payload: CategoryPayload = { ...form, name, description: form.description?.trim() ?? '' }
      if (editing) {
        await categoryApi.update(editing.id, payload)
        notify('Category updated.')
      } else {
        await categoryApi.create(payload)
        notify('Category added.')
      }
      setOpen(false)
      setForm({ ...emptyForm })
      await reload()
    } catch (err) {
      notify(getErrorMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function confirmDelete() {
    if (!remove) return
    if (remove.productCount > 0) {
      notify('Cannot delete a category that is currently used by products.', 'error')
      setRemove(null)
      return
    }
    setBusy(true)
    try {
      await categoryApi.remove(remove.id)
      notify('Category deleted.')
      setRemove(null)
      await reload()
    } catch (err) {
      notify(getErrorMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#F6F8F7] pb-28 pt-[max(0.75rem,env(safe-area-inset-top,0px))] text-[#091413] antialiased">
      <main className="mx-auto w-full max-w-2xl px-4 sm:px-6">
        <header className="flex items-center justify-between gap-3 pb-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-black tracking-tight text-[#091413]">Categories</h1>
            <p className="mt-0.5 text-xs text-slate-500">Organize your product groups</p>
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
          <MetricTile label="Total" value={totalCategories} active={statusFilter === 'all'} onClick={() => setStatusFilter('all')} />
          <MetricTile label="Active" value={activeCount} tone="emerald" active={statusFilter === 'active'} onClick={() => setStatusFilter('active')} />
          <MetricTile label="Inactive" value={inactiveCount} active={statusFilter === 'inactive'} onClick={() => setStatusFilter('inactive')} />
        </section>

        <StickyToolbar>
          <div className="relative mt-2">
            <SearchIcon size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search categories..."
              className="h-12 w-full rounded-2xl border border-[#E5EBE7] bg-white pl-10 pr-9 text-sm font-medium text-[#091413] placeholder-slate-400 shadow-2xs outline-none transition focus:border-[#285A48] focus:ring-2 focus:ring-[#285A48]/15"
            />
          </div>
          {hasActiveFilters && (
            <button type="button" onClick={resetFilters} className="mt-2 text-xs font-bold text-[#285A48]">
              Reset filters
            </button>
          )}
        </StickyToolbar>

        <section className="mt-2">
          {loading && <MobileLoading label="Loading categories…" />}

          {error && <MobileError message={error} onRetry={() => void reload()} />}

          {!loading && !error && filtered.length === 0 && (
            <MobileEmpty
              icon={<Tags size={22} />}
              title={search ? 'No matching categories' : 'No categories found'}
              hint={search ? 'Try a different search term.' : 'Create your first product category.'}
              action={
                !search ? (
                  <Button onClick={openCreate} className="min-h-12 w-full text-sm">
                    Add Category
                  </Button>
                ) : undefined
              }
            />
          )}

          {!loading && !error && filtered.length > 0 && (
            <div className="space-y-3">
              {filtered.map((category) => (
                <article key={category.id} className="rounded-3xl border border-[#E5EBE7] bg-white p-4 shadow-xs">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-[#091413]">{category.name}</p>
                      <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">
                        {category.description || 'No description provided'}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold ${
                        category.isActive ? 'bg-[#EAF1EE] text-[#285A48]' : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {category.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>

                  <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2.5 text-xs">
                    <span className="text-slate-500">Products linked</span>
                    <span className="font-mono font-bold text-[#091413]">{category.productCount}</span>
                  </div>

                  <div className="mt-3 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => openEdit(category)}
                      className="flex h-11 flex-1 items-center justify-center rounded-xl border border-[#E5EBE7] bg-white text-xs font-bold text-[#091413] active:scale-95 touch-manipulation"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => setRemove(category)}
                      className="flex h-11 flex-1 items-center justify-center rounded-xl border border-rose-200 bg-rose-50 text-xs font-bold text-rose-600 active:scale-95 touch-manipulation"
                    >
                      Delete
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>

      {open && (
        <Modal
          title={editing ? 'Edit category' : 'Add category'}
          onClose={closeModal}
          preventClose={busy}
          footer={
            <div className="flex flex-col-reverse gap-2 w-full">
              <Button variant="secondary" onClick={closeModal} disabled={busy} className="min-h-12 text-sm">
                Cancel
              </Button>
              <Button onClick={() => void save()} disabled={busy || !form.name.trim()} className="min-h-12 text-sm">
                {busy ? 'Saving…' : editing ? 'Save changes' : 'Create category'}
              </Button>
            </div>
          }
        >
          <div className="space-y-4 text-sm">
            <Field label="Category name" required>
              <Input
                value={form.name}
                onChange={(e) => updateForm('name', e.target.value)}
                placeholder="e.g. Hot Drinks, Accessories..."
                className="min-h-12 rounded-2xl text-sm"
                required
                autoFocus
              />
            </Field>

            <Field label="Description">
              <Textarea
                value={form.description}
                onChange={(e) => updateForm('description', e.target.value)}
                placeholder="Optional description of items in this group..."
                className="min-h-24 rounded-2xl text-sm"
              />
            </Field>

            <label className="flex min-h-12 items-center gap-3 rounded-2xl border border-[#E5EBE7] bg-white px-3.5 text-sm font-bold text-slate-700">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => updateForm('isActive', e.target.checked)}
                className="h-5 w-5 rounded-md border-[#E5EBE7] text-[#285A48] focus:ring-[#285A48]"
              />
              Active category
            </label>
          </div>
        </Modal>
      )}

      {remove && (
        <ConfirmDialog
          title="Delete category"
          message={
            remove.productCount > 0
              ? `"${remove.name}" is currently linked to ${remove.productCount} product(s) and cannot be deleted.`
              : `Are you sure you want to delete "${remove.name}"? This action cannot be undone.`
          }
          confirmLabel={remove.productCount > 0 ? 'Understood' : 'Delete'}
          danger={remove.productCount === 0}
          busy={busy}
          onCancel={() => {
            if (!busy) setRemove(null)
          }}
          onConfirm={() => {
            if (remove.productCount > 0) setRemove(null)
            else void confirmDelete()
          }}
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

export default MobileCategories
