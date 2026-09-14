import { useMemo, useState } from 'react'

import { categoryApi, type CategoryPayload } from '../../api/categoryApi'
import { Button } from '../../components/ui/Button'
import { Field, Input, Textarea } from '../../components/ui/Field'
import { Modal } from '../../components/ui/Modal'
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

type AccentColor =
  | 'gray'
  | 'red'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'blue'
  | 'purple'

const accentColors: Record<AccentColor, string> = {
  gray: 'bg-gray-200 text-gray-700',
  red: 'bg-red-200 text-red-700',
  orange: 'bg-orange-200 text-orange-700',
  yellow: 'bg-yellow-200 text-yellow-700',
  green: 'bg-green-200 text-green-700',
  blue: 'bg-blue-200 text-blue-700',
  purple: 'bg-purple-200 text-purple-700',
}

interface POSCategory extends Category {
  accentColor?: AccentColor
}

interface CategoryCardProps {
  category: POSCategory
  onSelect: (category: POSCategory) => void
  isSelected: boolean
}

/**
 * Minimalist category card for POS interface
 * Displays category name, item count, and subtle visual indicator
 */
function CategoryCard({
  category,
  onSelect,
  isSelected,
}: CategoryCardProps) {
  const accentColor = category.accentColor || 'gray'

  return (
    <button
      type="button"
      onClick={() => onSelect(category)}
      className={[
        'group relative w-full rounded-2xl p-6 text-left transition-all duration-200',
        'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500',
        'hover:shadow-lg active:scale-95',
        isSelected
          ? 'bg-blue-50 ring-2 ring-blue-400 shadow-md'
          : 'bg-white hover:bg-gray-50',
        !category.isActive && 'opacity-60',
      ].join(' ')}
    >
      {/* Accent bar - top left corner */}
      <div
        className={[
          'absolute top-0 left-0 h-1.5 rounded-tl-2xl w-12',
          accentColors[accentColor],
        ].join(' ')}
      />

      {/* Content wrapper */}
      <div className="flex h-full flex-col justify-between">
        {/* Header section */}
        <div className="mb-4">
          <h3 className="text-lg font-bold leading-tight text-gray-900">
            {category.name}
          </h3>

          {category.description && (
            <p className="mt-1 line-clamp-1 text-xs text-gray-500">
              {category.description}
            </p>
          )}
        </div>

        {/* Footer section */}
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
              Items
            </p>
            <p className="text-2xl font-bold text-gray-900">
              {category.productCount}
            </p>
          </div>

          {/* Subtle status indicator dot */}
          <div className="flex items-center gap-2">
            {category.isActive ? (
              <span className="inline-flex h-3 w-3 rounded-full bg-green-400" />
            ) : (
              <span className="inline-flex h-3 w-3 rounded-full bg-gray-300" />
            )}
          </div>
        </div>
      </div>

      {/* Hover overlay effect (very subtle) */}
      <div
        aria-hidden="true"
        className={[
          'absolute inset-0 rounded-2xl transition-opacity duration-200 pointer-events-none',
          'bg-linear-to-br from-white/50 to-transparent',
          isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-50',
        ].join(' ')}
      />
    </button>
  )
}

export function POSCategories() {
  const { notify } = useToast()

  const [selectedId, setSelectedId] =
    useState<number | string | null>(null)

  const [search, setSearch] = useState('')

  const [open, setOpen] = useState(false)

  const [form, setForm] =
    useState<CategoryPayload>(emptyForm)

  const [busy, setBusy] = useState(false)

  const {
    data,
    loading,
    error,
    reload,
  } = useAsync(
    () => categoryApi.list(),
    [],
  )

  const filteredCategories = useMemo(() => {
    if (!data) return []

    if (!search.trim()) return data

    const keyword = search.trim().toLowerCase()

    return data.filter((category) => {
      return (
        category.name
          .toLowerCase()
          .includes(keyword) ||
        (category.description ?? '')
          .toLowerCase()
          .includes(keyword)
      )
    })
  }, [data, search])

  const selectedCategory = useMemo(() => {
    if (!data || selectedId === null) return null

    return (
      data.find(
        (category) =>
          String(category.id) === String(selectedId),
      ) ?? null
    )
  }, [data, selectedId])

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
    setForm({ ...emptyForm })
    setOpen(true)
  }

  function closeModal() {
    if (busy) return
    setOpen(false)
  }

  async function save() {
    const name = form.name.trim()

    if (!name) {
      notify(
        'Category name is required.',
        'error',
      )
      return
    }

    setBusy(true)

    try {
      const payload: CategoryPayload = {
        ...form,
        name,
        description:
          form.description?.trim() ?? '',
      }

      await categoryApi.create(payload)
      notify('Category added.')
      setOpen(false)
      setForm({ ...emptyForm })
      await reload()
    } catch (err) {
      notify(
        getErrorMessage(err),
        'error',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-full bg-white">
      {/* Header */}
      <PageHeader
        title="POS Categories"
        subtitle="Fast and efficient category selection for checkout"
        actions={
          <Button onClick={openCreate}>
            + New category
          </Button>
        }
      />

      {/* Main content area */}
      <div className="mx-auto w-full max-w-[2000px] px-4 sm:px-6 lg:px-8">
        {/* Search toolbar */}
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1 sm:max-w-xs">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-gray-400">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5"
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
              onChange={(event) =>
                setSearch(event.target.value)
              }
              placeholder="Search categories..."
              className="min-h-11 w-full pl-10 pr-4 text-sm"
            />

            {search ? (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="Clear search"
                className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center text-lg text-gray-400 hover:text-gray-600"
              >
                ×
              </button>
            ) : null}
          </div>

          <div className="flex items-center gap-2 text-sm text-gray-600">
            <span className="font-semibold text-gray-900">
              {filteredCategories.length}
            </span>
            <span>
              {filteredCategories.length === 1
                ? 'category'
                : 'categories'}
            </span>
          </div>
        </div>

        {/* Loading state */}
        {loading ? (
          <div className="flex min-h-96 items-center justify-center">
            <Spinner />
          </div>
        ) : null}

        {/* Error state */}
        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-8">
            <ErrorState
              message={error}
              onRetry={() => void reload()}
            />
          </div>
        ) : null}

        {/* Empty state */}
        {!loading &&
        !error &&
        filteredCategories.length === 0 ? (
          <div className="rounded-xl bg-gray-50 p-12">
            <EmptyState
              title={
                search
                  ? 'No categories found'
                  : 'No categories yet'
              }
              hint={
                search
                  ? 'Try another search term.'
                  : 'Create your first category to start organizing products.'
              }
            />

            {!search ? (
              <div className="mt-6 flex justify-center">
                <Button onClick={openCreate}>
                  + Create category
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Category grid */}
        {!loading &&
        !error &&
        filteredCategories.length > 0 ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {filteredCategories.map((category) => {
              const posCategory: POSCategory = {
                ...category,
                accentColor:
                  (category.id % 7) as unknown as AccentColor,
              }

              const isSelected =
                String(selectedId) ===
                String(category.id)

              return (
                <CategoryCard
                  key={category.id}
                  category={posCategory}
                  onSelect={(cat) => {
                    setSelectedId(cat.id)
                  }}
                  isSelected={isSelected}
                />
              )
            })}
          </div>
        ) : null}

        {/* Info text */}
        {!loading &&
        !error &&
        filteredCategories.length > 0 ? (
          <div className="mt-8 flex items-center justify-center gap-2 border-t border-gray-100 pt-6 text-sm text-gray-500">
            <span>✓ Optimized for fast checkout</span>
          </div>
        ) : null}
      </div>

      {/* Create modal */}
      {open ? (
        <Modal
          title="Create category"
          onClose={closeModal}
          preventClose={busy}
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
                disabled={
                  busy || !form.name.trim()
                }
              >
                {busy ? 'Creating…' : 'Create'}
              </Button>
            </div>
          }
        >
          <div className="space-y-4">
            <Field label="Category name" required>
              <Input
                id="category-name"
                value={form.name}
                onChange={(event) =>
                  updateForm(
                    'name',
                    event.target.value,
                  )
                }
                placeholder="e.g., Beverages"
                className="min-h-11"
                required
                autoFocus
              />
            </Field>

            <Field label="Description" hint="Optional">
              <Textarea
                id="category-desc"
                value={form.description}
                onChange={(event) =>
                  updateForm(
                    'description',
                    event.target.value,
                  )
                }
                placeholder="Brief description..."
                className="min-h-20"
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
                Active category (visible in POS)
              </span>
            </label>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
