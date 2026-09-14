import { useMemo, useState } from 'react'

import { categoryApi, type CategoryPayload } from '../../api/categoryApi'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import {
  Field,
  Input,
  Textarea,
} from '../../components/ui/Field'
import { ChevronDown, Search } from '../../components/ui/Icons'
import {
  ConfirmDialog,
  Modal,
} from '../../components/ui/Modal'
import { PageHeader } from '../../components/ui/Page'
import {
  EmptyState,
  ErrorState,
  Spinner,
} from '../../components/ui/States'
import { useToast } from '../../context/ToastContext'
import { useAsync } from '../../hooks/useAsync'
import { useIsMobile } from '../../hooks/useIsMobile'
import type { Category } from '../../types'
import { getErrorMessage } from '../../utils/errors'
import { MobileCategories } from '../mobile/MobileCategories'

const emptyForm: CategoryPayload = {
  name: '',
  description: '',
  isActive: true,
}

type SortField = 'name' | 'productCount' | 'status'
type SortOrder = 'asc' | 'desc'
type StatusFilter = 'all' | 'active' | 'inactive'

export function CategoriesPage() {
  const isMobile = useIsMobile()
  if (isMobile) return <MobileCategories />
  return <DesktopCategoriesPage />
}

function DesktopCategoriesPage() {
  const { notify } = useToast()

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [sortBy, setSortBy] = useState<SortField>('name')
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc')

  const [editing, setEditing] = useState<Category | null>(null)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<CategoryPayload>(emptyForm)
  const [busy, setBusy] = useState(false)
  const [remove, setRemove] = useState<Category | null>(null)

  const { data, loading, error, reload } = useAsync(
    () => categoryApi.list(),
    [],
  )

  const totalCategories = data?.length ?? 0
  const activeCount = data?.filter((c) => c.isActive).length ?? 0
  const inactiveCount = totalCategories - activeCount
  const totalProducts =
    data?.reduce((sum, category) => sum + category.productCount, 0) ?? 0

  const hasActiveFilters = search.trim() !== '' || statusFilter !== 'all'

  const filteredAndSortedCategories = useMemo(() => {
    if (!data) return []

    let result = [...data]

    // 1. Search keyword filter
    if (search.trim()) {
      const keyword = search.trim().toLowerCase()
      result = result.filter(
        (c) =>
          c.name.toLowerCase().includes(keyword) ||
          (c.description ?? '').toLowerCase().includes(keyword),
      )
    }

    // 2. Status pill filter
    if (statusFilter === 'active') {
      result = result.filter((c) => c.isActive)
    } else if (statusFilter === 'inactive') {
      result = result.filter((c) => !c.isActive)
    }

    // 3. Sorting
    result.sort((a, b) => {
      let aVal: string | number = ''
      let bVal: string | number = ''

      if (sortBy === 'name') {
        aVal = a.name.toLowerCase()
        bVal = b.name.toLowerCase()
      } else if (sortBy === 'productCount') {
        aVal = a.productCount
        bVal = b.productCount
      } else if (sortBy === 'status') {
        aVal = a.isActive ? 1 : 0
        bVal = b.isActive ? 1 : 0
      }

      if (sortOrder === 'asc') {
        return aVal < bVal ? -1 : aVal > bVal ? 1 : 0
      }
      return aVal > bVal ? -1 : aVal < bVal ? 1 : 0
    })

    return result
  }, [data, search, statusFilter, sortBy, sortOrder])

  function handleStatusFilter(status: StatusFilter) {
    setStatusFilter(status)
  }

  function handleSortChange(field: SortField) {
    if (sortBy === field) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortBy(field)
      setSortOrder(field === 'productCount' ? 'desc' : 'asc')
    }
  }

  function resetFilters() {
    setSearch('')
    setStatusFilter('all')
    setSortBy('name')
    setSortOrder('asc')
  }

  function updateForm<K extends keyof CategoryPayload>(
    field: K,
    value: CategoryPayload[K],
  ) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }))
  }

  function openCreate() {
    setEditing(null)
    setForm({ ...emptyForm })
    setOpen(true)
  }

  function openEdit(category: Category) {
    setEditing(category)
    setForm({
      name: category.name,
      description: category.description ?? '',
      isActive: category.isActive,
    })
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
      const payload: CategoryPayload = {
        ...form,
        name,
        description: form.description?.trim() ?? '',
      }

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
      notify(
        'Cannot delete a category that is currently used by products.',
        'error',
      )
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
    <div className="min-h-screen bg-[#091413]/[0.02] text-[#091413] antialiased">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 md:px-8">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <PageHeader
            title="Categories"
            subtitle="Organize product groups, department trees, and catalog structure"
          />
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center justify-center gap-2 self-start rounded-lg bg-[#285A48] px-3.5 py-2 text-xs font-medium text-white shadow-xs transition-colors hover:bg-[#1e4537] active:scale-[0.98] sm:self-auto"
          >
            <PlusIcon size={15} />
            <span>Add category</span>
          </button>
        </div>

        {/* Interactive KPI Cards */}
        <div className="mt-4 grid grid-cols-2 gap-2.5 sm:gap-3 md:grid-cols-4">
          <MetricCard
            label="Total categories"
            value={totalCategories}
            isSelected={statusFilter === 'all' && sortBy === 'name'}
            onClick={() => {
              setStatusFilter('all')
              setSortBy('name')
            }}
          />
          <MetricCard
            label="Active"
            value={activeCount}
            indicator="pine"
            isSelected={statusFilter === 'active'}
            onClick={() => handleStatusFilter('active')}
          />
          <MetricCard
            label="Inactive"
            value={inactiveCount}
            indicator="neutral"
            isSelected={statusFilter === 'inactive'}
            onClick={() => handleStatusFilter('inactive')}
          />
          <MetricCard
            label="Products linked"
            value={totalProducts}
            isSelected={sortBy === 'productCount'}
            onClick={() => {
              setSortBy('productCount')
              setSortOrder('desc')
            }}
          />
        </div>

        {/* Filter Toolbar */}
        <div className="mt-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          {/* Status Segmented Pills */}
          <div className="flex flex-wrap items-center gap-1 rounded-2xl border border-[#E5EBE7] bg-white p-1 self-start shadow-2xs">
            <button
              type="button"
              onClick={() => handleStatusFilter('all')}
              className={`rounded-xl px-3.5 py-1.5 text-xs font-bold transition-all active:scale-95 touch-manipulation ${
                statusFilter === 'all'
                  ? 'bg-[#285A48] text-white shadow-xs'
                  : 'text-slate-500 hover:text-[#091413]'
              }`}
            >
              All ({totalCategories})
            </button>
            <button
              type="button"
              onClick={() => handleStatusFilter('active')}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-bold transition-all active:scale-95 touch-manipulation ${
                statusFilter === 'active'
                  ? 'bg-[#285A48] text-white shadow-xs'
                  : 'text-slate-500 hover:text-[#091413]'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${statusFilter === 'active' ? 'bg-white/80' : 'bg-[#285A48]'}`} />
              Active ({activeCount})
            </button>
            <button
              type="button"
              onClick={() => handleStatusFilter('inactive')}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-bold transition-all active:scale-95 touch-manipulation ${
                statusFilter === 'inactive'
                  ? 'bg-[#285A48] text-white shadow-xs'
                  : 'text-slate-500 hover:text-[#091413]'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${statusFilter === 'inactive' ? 'bg-white/80' : 'bg-slate-400'}`} />
              Inactive ({inactiveCount})
            </button>
          </div>

          {/* Sort, Search & Reset */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 flex-1 lg:max-w-lg lg:justify-end">
            {/* Sort Selector */}
            <div className="relative w-full sm:w-40 shrink-0">
              <select
                value={`${sortBy}-${sortOrder}`}
                onChange={(e) => {
                  const [field, order] = e.target.value.split('-') as [
                    SortField,
                    SortOrder,
                  ]
                  setSortBy(field)
                  setSortOrder(order)
                }}
                className="h-11 w-full appearance-none rounded-2xl border border-[#E5EBE7] bg-white px-3.5 pr-9 text-xs font-semibold text-[#091413] outline-none transition focus:border-[#285A48] focus:ring-2 focus:ring-[#285A48]/15"
              >
                <option value="name-asc">Name (A–Z)</option>
                <option value="name-desc">Name (Z–A)</option>
                <option value="productCount-desc">Products (High–Low)</option>
                <option value="productCount-asc">Products (Low–High)</option>
                <option value="status-desc">Status (Active first)</option>
              </select>
              <ChevronDown
                size={14}
                className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
            </div>

            {/* Search Input with Clear Button */}
            <div className="relative w-full">
              <Search
                size={16}
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search categories..."
                className="h-11 w-full rounded-2xl border border-[#E5EBE7] bg-white pl-10 pr-9 text-xs font-semibold text-[#091413] placeholder-slate-400 outline-none transition focus:border-[#285A48] focus:ring-2 focus:ring-[#285A48]/15"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
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
                onClick={resetFilters}
                className="flex h-11 shrink-0 items-center justify-center rounded-2xl border border-[#E5EBE7] bg-white px-3.5 text-xs font-bold text-slate-600 shadow-2xs hover:bg-[#F0F5F2] hover:text-[#091413] active:scale-95 touch-manipulation"
              >
                Reset
              </button>
            )}
          </div>
        </div>

        {/* Directory Table Container */}
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

          {!loading && !error && filteredAndSortedCategories.length === 0 && (
            <div className="p-8 text-center">
              <EmptyState
                title={search ? 'No matching categories' : 'No categories found'}
                hint={
                  search
                    ? 'Try adjusting your search terms or clearing active filters.'
                    : 'Get started by creating your first product category.'
                }
              />
              {hasActiveFilters ? (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-[#285A48] underline hover:text-[#1e4537]"
                >
                  Clear filters
                </button>
              ) : (
                <div className="mt-4 flex justify-center">
                  <button
                    type="button"
                    onClick={openCreate}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#285A48] px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-[#1e4537]"
                  >
                    <PlusIcon size={14} />
                    <span>Create category</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {!loading && !error && filteredAndSortedCategories.length > 0 && (
            <>
              {/* Tablet & Desktop Fluid Table */}
              <div className="hidden md:block w-full overflow-x-auto">
                <table className="w-full text-left text-xs text-[#091413]/80">
                  <thead className="border-b border-[#091413]/10 bg-[#091413]/[0.02] text-[11px] font-medium uppercase tracking-wider text-[#091413]/50">
                    <tr>
                      <th className="py-3 pl-4 pr-3 sm:pl-6 font-medium">
                        <button
                          type="button"
                          onClick={() => handleSortChange('name')}
                          className="group inline-flex items-center gap-1 font-medium hover:text-[#091413] uppercase"
                        >
                          Name
                          {sortBy === 'name' && (
                            <span className="text-[#285A48] font-bold">
                              {sortOrder === 'asc' ? '↑' : '↓'}
                            </span>
                          )}
                        </button>
                      </th>
                      <th className="py-3 px-3 font-medium">Description</th>
                      <th className="py-3 px-3 text-center font-medium">
                        <button
                          type="button"
                          onClick={() => handleSortChange('productCount')}
                          className="group inline-flex items-center gap-1 font-medium hover:text-[#091413] uppercase"
                        >
                          Products
                          {sortBy === 'productCount' && (
                            <span className="text-[#285A48] font-bold">
                              {sortOrder === 'asc' ? '↑' : '↓'}
                            </span>
                          )}
                        </button>
                      </th>
                      <th className="py-3 px-3 text-center font-medium">
                        <button
                          type="button"
                          onClick={() => handleSortChange('status')}
                          className="group inline-flex items-center gap-1 font-medium hover:text-[#091413] uppercase"
                        >
                          Status
                          {sortBy === 'status' && (
                            <span className="text-[#285A48] font-bold">
                              {sortOrder === 'asc' ? '↑' : '↓'}
                            </span>
                          )}
                        </button>
                      </th>
                      <th className="py-3 pl-3 pr-4 sm:pr-6 text-right font-medium">
                        Actions
                      </th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-[#091413]/5 font-normal">
                    {filteredAndSortedCategories.map((category) => (
                      <tr
                        key={category.id}
                        className="transition-colors hover:bg-[#285A48]/[0.03]"
                      >
                        <td className="py-3.5 pl-4 pr-3 sm:pl-6 font-medium text-[#091413]">
                          {category.name}
                        </td>

                        <td
                          className="py-3.5 px-3 max-w-xs truncate text-[#091413]/60"
                          title={category.description ?? ''}
                        >
                          {category.description || '—'}
                        </td>

                        <td className="py-3.5 px-3 text-center">
                          <span className="inline-flex font-mono text-xs px-2 py-0.5 rounded bg-[#091413]/[0.05] text-[#091413]/80">
                            {category.productCount}
                          </span>
                        </td>

                        <td className="py-3.5 px-3 text-center">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${
                              category.isActive
                                ? 'bg-[#285A48]/10 text-[#285A48] border border-[#285A48]/20'
                                : 'bg-[#091413]/[0.05] text-[#091413]/60 border border-[#091413]/10'
                            }`}
                          >
                            {category.isActive ? 'Active' : 'Inactive'}
                          </span>
                        </td>

                        <td className="py-3.5 pl-3 pr-4 sm:pr-6 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => openEdit(category)}
                              className="rounded px-2 py-1 text-xs font-medium text-[#091413]/70 transition-colors hover:bg-[#285A48]/10 hover:text-[#285A48] active:scale-95"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => setRemove(category)}
                              className="rounded px-2 py-1 text-xs font-medium text-rose-700 transition-colors hover:bg-rose-50 active:scale-95"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile Card List (<md) */}
              <div className="divide-y divide-[#091413]/5 md:hidden">
                {filteredAndSortedCategories.map((category) => (
                  <div key={category.id} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-sm font-medium text-[#091413]">
                          {category.name}
                        </h3>
                        <p className="mt-0.5 text-xs text-[#091413]/60 line-clamp-2">
                          {category.description || 'No description provided'}
                        </p>
                      </div>

                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${
                          category.isActive
                            ? 'bg-[#285A48]/10 text-[#285A48] border border-[#285A48]/20'
                            : 'bg-[#091413]/[0.05] text-[#091413]/60 border border-[#091413]/10'
                        }`}
                      >
                        {category.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </div>

                    <div className="mt-3 flex items-center justify-between pt-2.5 border-t border-[#091413]/5 text-xs">
                      <span className="text-[#091413]/50">Products assigned</span>
                      <span className="font-mono font-medium text-[#091413]">
                        {category.productCount}
                      </span>
                    </div>

                    <div className="mt-3 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openEdit(category)}
                        className="flex-1 rounded-lg border border-[#091413]/15 bg-white py-1.5 text-xs font-medium text-[#091413] shadow-xs hover:bg-[#091413]/[0.02]"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => setRemove(category)}
                        className="flex-1 rounded-lg border border-rose-200 bg-rose-50/50 py-1.5 text-xs font-medium text-rose-700 shadow-xs hover:bg-rose-50"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </main>
      </div>

      {/* =====================================================
          ADD / EDIT CATEGORY MODAL
      ====================================================== */}
      {open && (
        <Modal
          title={editing ? 'Edit category' : 'Add category'}
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
                disabled={busy || !form.name.trim()}
                className="inline-flex items-center justify-center rounded-lg bg-[#285A48] px-4 py-2 text-xs font-medium text-white shadow-xs transition-colors hover:bg-[#1e4537] disabled:opacity-50"
              >
                {busy ? 'Saving…' : editing ? 'Save changes' : 'Create category'}
              </button>
            </div>
          }
        >
          <div className="space-y-4 text-xs">
            <Field label="Category name" required>
              <Input
                value={form.name}
                onChange={(e) => updateForm('name', e.target.value)}
                placeholder="e.g. Hot Drinks, Accessories..."
                required
                autoFocus
              />
            </Field>

            <Field label="Description">
              <Textarea
                value={form.description}
                onChange={(e) => updateForm('description', e.target.value)}
                placeholder="Optional description of items in this group..."
              />
            </Field>

            <label className="flex items-center gap-2 text-xs font-medium text-[#091413]/80 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => updateForm('isActive', e.target.checked)}
                className="h-4 w-4 rounded border-[#091413]/20 text-[#285A48] focus:ring-[#285A48]"
              />
              Active category
            </label>
          </div>
        </Modal>
      )}

      {/* =====================================================
          DELETE CONFIRMATION
      ====================================================== */}
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
            if (remove.productCount > 0) {
              setRemove(null)
            } else {
              void confirmDelete()
            }
          }}
        />
      )}
    </div>
  )
}

/* =============================================================
   STAT CARD & ICONS
============================================================= */

function MetricCard({
  label,
  value,
  indicator,
  isSelected = false,
  onClick,
}: {
  label: string
  value: string | number
  indicator?: 'pine' | 'neutral'
  isSelected?: boolean
  onClick: () => void
}) {
  const dotColor = indicator === 'pine' ? 'bg-[#285A48]' : indicator === 'neutral' ? 'bg-slate-400' : null

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative rounded-3xl border p-4 text-left transition-all active:scale-[0.98] touch-manipulation ${
        isSelected
          ? 'border-[#285A48] bg-white ring-2 ring-[#285A48]/20 shadow-sm'
          : 'border-[#E5EBE7] bg-white hover:border-slate-300'
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
          {label}
        </span>
        {dotColor && <span className={`h-2 w-2 rounded-full ${dotColor} animate-pulse`} />}
      </div>
      <p className="mt-2 text-xl font-black tracking-tight text-[#091413] sm:text-2xl">
        {value}
      </p>
    </button>
  )
}

function PlusIcon({ size = 15 }: { size?: number }) {
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
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

function ClearIcon({ size = 13 }: { size?: number }) {
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