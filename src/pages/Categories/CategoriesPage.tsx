import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { categoryApi, type CategoryPayload } from '../../api/categoryApi'
import {
  DataCard,
  DesktopPage,
  DesktopSearch,
  DesktopSelect,
  EmptyRow,
  FilterSummary,
  ErrorRow,
  FilterPills,
  HoverAction,
  LoadingRow,
  StatusCell,
  Th,
  Toolbar,
} from '../../components/ui/DesktopKit'
import { AddButton, PrimaryButton, SwitchRow, TextAreaField, TextButton, TextField } from '../../components/ui/MobileKit'
import { ConfirmDialog, Modal } from '../../components/ui/Modal'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { useAsync } from '../../hooks/useAsync'
import { useIsMobile } from '../../hooks/useIsMobile'
import type { Category } from '../../types'
import { getErrorMessage } from '../../utils/errors'
import { MobileCategories } from '../mobile/MobileCategories'

type StatusFilter = 'all' | 'active' | 'inactive'
type SortOption = 'name' | 'products'

const FORM_ID = 'category-form'
const emptyForm: CategoryPayload = { name: '', description: '', isActive: true }

export function CategoriesPage() {
  const isMobile = useIsMobile()
  if (isMobile) return <MobileCategories />
  return <DesktopCategoriesPage />
}

function DesktopCategoriesPage() {
  const { notify } = useToast()
  const { can } = useAuth()
  const navigate = useNavigate()
  const canViewProducts = can('products.view')

  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [sort, setSort] = useState<SortOption>('name')

  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Category | null>(null)
  const [form, setForm] = useState<CategoryPayload>(emptyForm)
  const [initialForm, setInitialForm] = useState<CategoryPayload>(emptyForm)
  const [nameTouched, setNameTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [remove, setRemove] = useState<Category | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  const { data, loading, error, reload } = useAsync(() => categoryApi.list(), [])
  const categories = useMemo(() => data ?? [], [data])

  const counts = useMemo(() => {
    const active = categories.filter((c) => c.isActive).length
    return { all: categories.length, active, inactive: categories.length - active }
  }, [categories])

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    return categories
      .filter((c) => (status === 'all' ? true : status === 'active' ? c.isActive : !c.isActive))
      .filter((c) => !keyword || c.name.toLowerCase().includes(keyword) || (c.description ?? '').toLowerCase().includes(keyword))
      .sort((a, b) => (sort === 'products' ? b.productCount - a.productCount : 0) || a.name.localeCompare(b.name))
  }, [categories, search, status, sort])

  const trimmedName = form.name.trim()
  const nameTaken = categories.some((c) => c.id !== editing?.id && c.name.trim().toLowerCase() === trimmedName.toLowerCase())
  const nameError = !trimmedName ? 'Enter a category name.' : nameTaken ? 'A category with this name already exists.' : undefined
  const isDirty = JSON.stringify(form) !== JSON.stringify(initialForm)
  const hasFilters = search.trim() !== '' || status !== 'all'

  function openForm(category: Category | null) {
    const next = category ? { name: category.name, description: category.description ?? '', isActive: category.isActive } : { ...emptyForm }
    setEditing(category)
    setForm(next)
    setInitialForm(next)
    setNameTouched(false)
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
    setNameTouched(true)
    if (nameError || busy) return
    setBusy(true)
    try {
      const payload: CategoryPayload = { ...form, name: trimmedName, description: form.description?.trim() ?? '' }
      if (editing) await categoryApi.update(editing.id, payload)
      else await categoryApi.create(payload)
      notify(editing ? 'Changes saved.' : `“${trimmedName}” added.`)
      closeForm()
      await reload()
    } catch (err) {
      notify(getErrorMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function confirmDelete() {
    if (!remove) return
    setBusy(true)
    try {
      await categoryApi.remove(remove.id)
      notify(`“${remove.name}” deleted.`)
      setRemove(null)
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
      title="Categories"
      subtitle={data ? `${counts.all} ${counts.all === 1 ? 'category' : 'categories'} · ${counts.active} active` : 'Group products at the register'}
      actions={<AddButton label="Add category" onClick={() => openForm(null)} />}
    >
      <Toolbar>
        <div className="flex min-w-0 flex-1 basis-md items-center gap-2">
          <DesktopSearch value={search} onChange={setSearch} placeholder="Search categories" label="Search categories" className="min-w-0 max-w-md flex-1" />
          <DesktopSelect
            label="Sort by"
            value={sort}
            onChange={(value) => setSort(value as SortOption)}
            options={[
              { value: 'name', label: 'Name (A–Z)' },
              { value: 'products', label: 'Most products' },
            ]}
          />
        </div>
        <FilterPills
          label="Category status"
          value={status}
          onChange={setStatus}
          options={[
            { key: 'all', label: 'All', count: data ? counts.all : undefined },
            { key: 'active', label: 'Active', count: data ? counts.active : undefined },
            { key: 'inactive', label: 'Inactive', count: data ? counts.inactive : undefined },
          ]}
        />
      </Toolbar>

      {hasFilters && data && (
        <FilterSummary
          shown={filtered.length}
          total={counts.all}
          noun={counts.all === 1 ? 'category' : 'categories'}
          onClear={() => {
            setSearch('')
            setStatus('all')
          }}
        />
      )}

      <DataCard className={hasFilters && data ? 'mt-2' : 'mt-4'}>
        {loading && !data && <LoadingRow />}
        {!loading && error && <ErrorRow message={error} onRetry={() => void reload()} />}
        {!error && data && filtered.length === 0 && (
          <EmptyRow
            title={hasFilters ? 'No categories found' : 'No categories yet'}
            hint={search.trim() ? `Nothing matches “${search.trim()}”.` : hasFilters ? 'No categories have this status.' : 'Categories help cashiers find products faster.'}
            actionLabel={hasFilters ? 'Clear filters' : 'Add first category'}
            secondary={hasFilters}
            onAction={
              hasFilters
                ? () => {
                    setSearch('')
                    setStatus('all')
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
                  <Th>Description</Th>
                  <Th align="right">Products</Th>
                  <Th>Status</Th>
                  <Th className="pr-6">
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((category) => (
                  <tr key={category.id} onClick={() => openForm(category)} className="group cursor-pointer hover:bg-slate-50">
                    <td className="py-3 pl-6 pr-3">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          openForm(category)
                        }}
                        className={`text-left font-medium focus-visible:underline focus-visible:outline-none ${category.isActive ? '' : 'text-slate-400'}`}
                      >
                        {category.name}
                      </button>
                    </td>
                    <td className={`max-w-md truncate px-3 py-3 ${category.description ? 'text-slate-600' : 'text-slate-300'}`}>
                      {category.description || '—'}
                    </td>
                    <td className="px-3 py-3 text-right">
                      {canViewProducts && category.productCount > 0 ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            navigate(`/products?category=${category.id}`)
                          }}
                          aria-label={`View ${category.productCount} products in ${category.name}`}
                          title="View products"
                          className="inline-flex h-9 items-center rounded-full px-3 tabular-nums text-[#1F5E3B] hover:bg-[#E6F1EA] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B]"
                        >
                          {category.productCount}
                        </button>
                      ) : (
                        <span className="px-3 tabular-nums text-slate-400">{category.productCount}</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <StatusCell active={category.isActive} />
                    </td>
                    <td className="py-3 pl-3 pr-6 text-right">
                      <HoverAction label="Edit" ariaLabel={`Edit ${category.name}`} onClick={() => openForm(category)} />
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
          title={editing ? 'Edit category' : 'Add category'}
          description={editing ? `Used by ${editing.productCount} ${editing.productCount === 1 ? 'product' : 'products'}` : undefined}
          onClose={requestClose}
          preventClose={busy}
          footer={
            <div className="flex w-full items-center justify-end gap-2">
              <TextButton onClick={requestClose} disabled={busy} className="h-12">
                Cancel
              </TextButton>
              <PrimaryButton type="submit" form={FORM_ID} disabled={busy || (editing !== null && !isDirty)} className="h-12 flex-none px-8">
                {busy ? 'Saving…' : editing ? (isDirty ? 'Save changes' : 'No changes') : 'Add category'}
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
            className="space-y-4"
          >
            <TextField
              label="Name"
              value={form.name}
              onChange={(name) => setForm({ ...form, name })}
              onBlur={() => setNameTouched(true)}
              error={nameTouched ? nameError : undefined}
              placeholder="e.g. Hot drinks"
              autoFocus
              autoCapitalize="words"
            />
            <TextAreaField
              label="Description"
              optional
              value={form.description ?? ''}
              onChange={(description) => setForm({ ...form, description })}
              placeholder="What goes in this category?"
            />
            {editing && (
              <SwitchRow
                label="Available at the register"
                description="Turn off to hide this category without deleting it"
                checked={form.isActive}
                onChange={(isActive) => setForm({ ...form, isActive })}
              />
            )}
            {editing &&
              (editing.productCount > 0 ? (
                <p className="rounded-2xl bg-[#F6F8F7] px-4 py-3 text-sm text-slate-500">
                  This category can’t be deleted while {editing.productCount} {editing.productCount === 1 ? 'product uses' : 'products use'} it. Turn off
                  “Available at the register” to hide it instead.
                </p>
              ) : (
                <TextButton tone="danger" onClick={() => setRemove(editing)} disabled={busy} className="-ml-4 h-11">
                  Delete category
                </TextButton>
              ))}
          </form>
        </Modal>
      )}

      {confirmDiscard && (
        <ConfirmDialog
          title="Discard changes?"
          message="The changes you made will not be saved."
          confirmLabel="Discard"
          danger
          onCancel={() => setConfirmDiscard(false)}
          onConfirm={closeForm}
        />
      )}

      {remove && (
        <ConfirmDialog
          title={`Delete “${remove.name}”?`}
          message="This permanently removes the category. This can’t be undone."
          confirmLabel="Delete"
          danger
          busy={busy}
          onCancel={() => !busy && setRemove(null)}
          onConfirm={() => void confirmDelete()}
        />
      )}
    </DesktopPage>
  )
}

export default CategoriesPage
