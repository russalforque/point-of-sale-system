import { useMemo, useState } from 'react'

import { categoryApi, type CategoryPayload } from '../../api/categoryApi'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import {
  Field,
  Input,
  Textarea,
} from '../../components/ui/Field'
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
import type { Category } from '../../types'
import { getErrorMessage } from '../../utils/errors'

const emptyForm: CategoryPayload = {
  name: '',
  description: '',
  isActive: true,
}

type SortField = 'name' | 'productCount' | 'status'
type SortOrder = 'asc' | 'desc'
type StatusFilter = 'all' | 'active' | 'inactive'

export function CategoriesPage() {
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

        {/* Minimalist Metric Cards */}
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
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

        {/* Filters Toolbar */}
        <div className="mt-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          {/* Status Segmented Pills */}
          <div className="flex items-center gap-1 rounded-lg border border-[#091413]/10 bg-[#091413]/[0.04] p-0.5 self-start">
            <button
              type="button"
              onClick={() => handleStatusFilter('all')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                statusFilter === 'all'
                  ? 'bg-white text-[#091413] shadow-xs'
                  : 'text-[#091413]/60 hover:text-[#091413]'
              }`}
            >
              All ({totalCategories})
            </button>
            <button
              type="button"
              onClick={() => handleStatusFilter('active')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                statusFilter === 'active'
                  ? 'bg-white text-[#091413] shadow-xs'
                  : 'text-[#091413]/60 hover:text-[#091413]'
              }`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-[#285A48]" />
              Active ({activeCount})
            </button>
            <button
              type="button"
              onClick={() => handleStatusFilter('inactive')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                statusFilter === 'inactive'
                  ? 'bg-white text-[#091413] shadow-xs'
                  : 'text-[#091413]/60 hover:text-[#091413]'
              }`}
            >
              Inactive ({inactiveCount})
            </button>
          </div>

          {/* Search, Sort Dropdown & Reset */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 flex-1 lg:max-w-lg lg:justify-end">
            {/* Sort Selector */}
            <div className="relative w-full sm:w-36 shrink-0">
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
                className="h-9 w-full appearance-none rounded-lg border border-[#091413]/15 bg-white px-3 pr-8 text-xs text-[#091413] outline-none transition-colors focus:border-[#285A48] focus:ring-1 focus:ring-[#285A48]"
              >
                <option value="name-asc">Name (A–Z)</option>
                <option value="name-desc">Name (Z–A)</option>
                <option value="productCount-desc">Products (High–Low)</option>
                <option value="productCount-asc">Products (Low–High)</option>
                <option value="status-desc">Status (Active first)</option>
              </select>
              <ChevronDownIcon
                size={13}
                className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[#091413]/40"
              />
            </div>

            {/* Search Input */}
            <div className="relative w-full">
              <SearchIcon
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#091413]/40"
              />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search categories..."
                className="h-9 w-full rounded-lg border border-[#091413]/15 bg-white pl-8.5 pr-8 text-xs text-[#091413] placeholder-[#091413]/40 outline-none transition-colors focus:border-[#285A48] focus:ring-1 focus:ring-[#285A48]"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-[#091413]/40 hover:text-[#091413]"
                  title="Clear search"
                >
                  <ClearIcon size={13} />
                </button>
              )}
            </div>

            {hasActiveFilters && (
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
            <Field label="Category name">
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
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative rounded-xl border p-3.5 sm:p-4 text-left transition-all active:scale-[0.99] ${
        isSelected
          ? 'border-[#285A48] bg-white ring-1 ring-[#285A48] shadow-xs'
          : 'border-[#091413]/10 bg-white hover:border-[#285A48]/50'
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wider text-[#091413]/50">
          {label}
        </span>
        {indicator === 'pine' && (
          <span className="h-1.5 w-1.5 rounded-full bg-[#285A48]" />
        )}
      </div>
      <p className="mt-2 text-xl font-semibold tracking-tight text-[#091413] sm:text-2xl">
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

function SearchIcon({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}

function ChevronDownIcon({ size = 13, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <polyline points="6 9 12 15 18 9" />
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