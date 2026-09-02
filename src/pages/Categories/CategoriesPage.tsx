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
import { Card, PageHeader } from '../../components/ui/Page'
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

export function CategoriesPage() {
  const { notify } = useToast()

  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<SortField>('name')
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc')
  const [showInactive, setShowInactive] = useState(false)

  const [editing, setEditing] = useState<Category | null>(null)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<CategoryPayload>(emptyForm)
  const [busy, setBusy] = useState(false)
  const [remove, setRemove] = useState<Category | null>(null)

  const { data, loading, error, reload } = useAsync(
    () => categoryApi.list(),
    [],
  )

  const filteredAndSortedCategories = useMemo(() => {
    if (!data) return []

    let result = [...data]

    // Filter by search
    if (search.trim()) {
      const keyword = search.trim().toLowerCase()
      result = result.filter((category) => {
        return (
          category.name.toLowerCase().includes(keyword) ||
          (category.description ?? '').toLowerCase().includes(keyword)
        )
      })
    }

    // Filter by active status
    if (!showInactive) {
      result = result.filter((c) => c.isActive)
    }

    // Sort
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
      } else {
        return aVal > bVal ? -1 : aVal < bVal ? 1 : 0
      }
    })

    return result
  }, [data, search, sortBy, sortOrder, showInactive])

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

  const totalProducts = data?.reduce((sum, category) => sum + category.productCount, 0) ?? 0
  const activeCount = data?.filter((category) => category.isActive).length ?? 0
  const inactiveCount = (data?.length ?? 0) - activeCount

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-7xl px-4 pb-6 pt-4 sm:px-5 lg:px-6">
        <PageHeader
          title="Categories"
          subtitle="Organize product groups and catalog structure"
          actions={
            <Button
              onClick={openCreate}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-900 px-3.5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-slate-200/50 transition-all duration-150 hover:-translate-y-0.5 hover:bg-slate-700 active:translate-y-0"
            >
              + Add category
            </Button>
          }
        />

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card className="overflow-hidden border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/50 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Total categories
              </p>
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-sm shadow-emerald-200" />
            </div>
            <p className="mt-4 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
              {data?.length ?? 0}
            </p>
            <div className="mt-3 flex items-center gap-2 text-[11px] text-slate-500">
              <span className="rounded-full bg-slate-100 px-2 py-1 font-medium text-slate-600">
                Catalog
              </span>
              <span>Updated now</span>
            </div>
          </Card>

          <Card className="overflow-hidden border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/50 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Active
              </p>
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-sm shadow-emerald-200" />
            </div>
            <p className="mt-4 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
              {activeCount}
            </p>
            <div className="mt-3 flex items-center gap-2 text-[11px] text-slate-500">
              <span className="rounded-full bg-emerald-50 px-2 py-1 font-medium text-emerald-700">
                Live
              </span>
              <span>Visible</span>
            </div>
          </Card>

          <Card className="overflow-hidden border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/50 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Inactive
              </p>
              <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
            </div>
            <p className="mt-4 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
              {inactiveCount}
            </p>
            <div className="mt-3 flex items-center gap-2 text-[11px] text-slate-500">
              <span className="rounded-full bg-slate-100 px-2 py-1 font-medium text-slate-600">
                Hidden
              </span>
              <span>Out of stock</span>
            </div>
          </Card>

          <Card className="overflow-hidden border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/50 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Products linked
              </p>
              <span className="h-2.5 w-2.5 rounded-full bg-violet-400 shadow-sm shadow-violet-200" />
            </div>
            <p className="mt-4 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
              {totalProducts}
            </p>
            <div className="mt-3 flex items-center gap-2 text-[11px] text-slate-500">
              <span className="rounded-full bg-violet-50 px-2 py-1 font-medium text-violet-700">
                Items
              </span>
              <span>Across all groups</span>
            </div>
          </Card>
        </section>

        <section className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/50">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="relative w-full md:max-w-md">
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="m21 21-4.35-4.35m1.35-5.65a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z"
                    />
                  </svg>
                </span>
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search categories"
                  className="h-11 w-full appearance-none rounded-full border border-slate-200 bg-white pl-10 pr-10 text-sm text-slate-700 shadow-sm shadow-slate-200/60 outline-none transition-all duration-150 focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    aria-label="Clear search"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    ×
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2 sm:justify-end">
                <label className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm shadow-slate-200/50">
                  <input
                    type="checkbox"
                    checked={showInactive}
                    onChange={(event) => setShowInactive(event.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-500"
                  />
                  Show inactive
                </label>

                <div className="rounded-full border border-slate-200 bg-white px-3 py-2 shadow-sm shadow-slate-200/50">
                  <select
                    value={sortBy}
                    onChange={(event) => {
                      const value = event.target.value as SortField
                      setSortBy(value)
                      if (value !== sortBy) {
                        setSortOrder(value === 'name' ? 'asc' : 'desc')
                      }
                    }}
                    className="bg-transparent text-sm text-slate-700 outline-none"
                  >
                    <option value="name">Name</option>
                    <option value="productCount">Products</option>
                    <option value="status">Status</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          {loading && (
            <div className="flex min-h-72 items-center justify-center p-6">
              <Spinner />
            </div>
          )}

          {error && (
            <div className="p-6">
              <ErrorState message={error} onRetry={() => void reload()} />
            </div>
          )}

          {!loading && !error && filteredAndSortedCategories.length === 0 ? (
            <div className="p-8">
              <EmptyState
                title={search ? 'No categories found' : 'No categories yet'}
                hint={
                  search
                    ? 'Try another keyword or filter.'
                    : 'Create the first category to start organizing your catalog.'
                }
              />
              {!search && (
                <div className="mt-5 flex justify-center">
                  <Button onClick={openCreate} className="bg-slate-900 text-white hover:bg-slate-700">
                    + Add category
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[680px] border-separate border-spacing-0 text-left text-sm">
                  <thead className="bg-white">
                    <tr>
                      <th className="border-b border-slate-200 px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                        <button
                          type="button"
                          onClick={() => {
                            if (sortBy === 'name') {
                              setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
                            } else {
                              setSortBy('name')
                              setSortOrder('asc')
                            }
                          }}
                          className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 hover:text-slate-800"
                        >
                          Name
                          {sortBy === 'name' && <span>{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                        </button>
                      </th>
                      <th className="border-b border-slate-200 px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Description
                      </th>
                      <th className="border-b border-slate-200 px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                        <button
                          type="button"
                          onClick={() => {
                            if (sortBy === 'productCount') {
                              setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
                            } else {
                              setSortBy('productCount')
                              setSortOrder('desc')
                            }
                          }}
                          className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 hover:text-slate-800"
                        >
                          Products
                          {sortBy === 'productCount' && <span>{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                        </button>
                      </th>
                      <th className="border-b border-slate-200 px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                        <button
                          type="button"
                          onClick={() => {
                            if (sortBy === 'status') {
                              setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
                            } else {
                              setSortBy('status')
                              setSortOrder('desc')
                            }
                          }}
                          className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 hover:text-slate-800"
                        >
                          Status
                          {sortBy === 'status' && <span>{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                        </button>
                      </th>
                      <th className="border-b border-slate-200 px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAndSortedCategories.map((category) => (
                      <tr key={category.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                        <td className="px-4 py-3 text-[13px] font-medium text-slate-800">
                          {category.name}
                        </td>
                        <td className="max-w-[260px] truncate px-4 py-3 text-[13px] text-slate-600" title={category.description ?? ''}>
                          {category.description || '—'}
                        </td>
                        <td className="px-4 py-3 text-[13px] font-medium text-slate-700">
                          <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                            {category.productCount}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <Badge tone={category.isActive ? 'green' : 'gray'}>
                            {category.isActive ? 'Active' : 'Inactive'}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => openEdit(category)}
                              className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => setRemove(category)}
                              className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-red-600 transition hover:bg-red-50"
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

              <div className="space-y-3 p-3 md:hidden">
                {filteredAndSortedCategories.map((category) => (
                  <div key={category.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-base font-semibold text-slate-900">
                          {category.name}
                        </h3>
                        <p className="mt-1 text-sm text-slate-600">
                          {category.description || 'No description'}
                        </p>
                      </div>
                      <Badge tone={category.isActive ? 'green' : 'gray'}>
                        {category.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>

                    <div className="mt-3 flex items-center justify-between border-t border-slate-200 pt-3 text-sm">
                      <span className="text-slate-500">Products</span>
                      <span className="font-semibold text-slate-900">{category.productCount}</span>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => openEdit(category)}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => setRemove(category)}
                        className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      </div>

      {/* Modal */}
      {open ? (
        <Modal
          title={
            editing ? 'Edit category' : 'Add category'
          }
          onClose={closeModal}
          footer={
            <div className="flex w-full flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button
                variant="secondary"
                onClick={closeModal}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button
                onClick={() => void save()}
                disabled={busy || !form.name.trim()}
              >
                {busy
                  ? 'Saving…'
                  : editing
                    ? 'Save changes'
                    : 'Create category'}
              </Button>
            </div>
          }
        >
          <div className="space-y-5">
            <Field label="Category name">
              <Input
                value={form.name}
                onChange={(event) =>
                  updateForm('name', event.target.value)
                }
                placeholder="e.g. Beverages"
                className="min-h-11"
                autoFocus
              />
            </Field>

            <Field label="Description">
              <Textarea
                value={form.description}
                onChange={(event) =>
                  updateForm(
                    'description',
                    event.target.value,
                  )
                }
                placeholder="Describe this category..."
                className="min-h-28"
              />
            </Field>

            <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-gray-200 p-4">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(event) =>
                  updateForm(
                    'isActive',
                    event.target.checked,
                  )
                }
                className="h-5 w-5"
              />
              <span className="text-sm font-medium text-gray-900">
                Active category
              </span>
            </label>
          </div>
        </Modal>
      ) : null}

      {/* Delete Confirmation */}
      {remove ? (
        <ConfirmDialog
          title="Delete category"
          message={
            remove.productCount > 0
              ? `${remove.name} is currently used by ${remove.productCount} product(s) and cannot be deleted.`
              : `Delete ${remove.name}? This action cannot be undone.`
          }
          confirmLabel="Delete"
          danger
          busy={busy}
          onCancel={() => {
            if (!busy) setRemove(null)
          }}
          onConfirm={() => void confirmDelete()}
        />
      ) : null}
    </div>
  )
}
