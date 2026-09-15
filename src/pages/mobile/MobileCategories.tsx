import { useMemo, useState } from 'react'

import { categoryApi, type CategoryPayload } from '../../api/categoryApi'
import {
  AddButton,
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
  SwitchRow,
  TextAreaField,
  TextButton,
  TextField,
  useEscapeKey,
} from '../../components/ui/MobileKit'
import { ConfirmDialog } from '../../components/ui/Modal'
import { useToast } from '../../context/ToastContext'
import { useAsync } from '../../hooks/useAsync'
import type { Category } from '../../types'
import { getErrorMessage } from '../../utils/errors'

type StatusFilter = 'all' | 'active' | 'inactive'

const emptyForm: CategoryPayload = { name: '', description: '', isActive: true }

export function MobileCategories() {
  const { notify } = useToast()

  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')

  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Category | null>(null)
  const [form, setForm] = useState<CategoryPayload>(emptyForm)
  const [initialForm, setInitialForm] = useState<CategoryPayload>(emptyForm)
  const [nameTouched, setNameTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [remove, setRemove] = useState<Category | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  const { data, loading, error, reload } = useAsync(() => categoryApi.list(), [])
  const categories = data ?? []

  const counts = useMemo(() => {
    const active = categories.filter((c) => c.isActive).length
    return { all: categories.length, active, inactive: categories.length - active }
  }, [categories])

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    return categories
      .filter((c) => (status === 'all' ? true : status === 'active' ? c.isActive : !c.isActive))
      .filter(
        (c) =>
          !keyword || c.name.toLowerCase().includes(keyword) || (c.description ?? '').toLowerCase().includes(keyword),
      )
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [categories, search, status])

  const trimmedName = form.name.trim()
  const nameTaken = categories.some(
    (c) => c.id !== editing?.id && c.name.trim().toLowerCase() === trimmedName.toLowerCase(),
  )
  const nameError = !trimmedName ? 'Enter a category name.' : nameTaken ? 'A category with this name already exists.' : undefined
  const isDirty = JSON.stringify(form) !== JSON.stringify(initialForm)
  const hasFilters = search.trim() !== '' || status !== 'all'

  function openForm(category: Category | null) {
    const next = category
      ? { name: category.name, description: category.description ?? '', isActive: category.isActive }
      : { ...emptyForm }
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

  useEscapeKey(requestClose, open && !remove && !confirmDiscard)

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
    <div className="flex min-h-full flex-col bg-white text-[#091413] antialiased">
      <PageHeader
        title="Categories"
        subtitle={data ? `${counts.active} active · group products at the register` : 'Group products at the register'}
        action={<AddButton onClick={() => openForm(null)} />}
      >
        <SearchField value={search} onChange={setSearch} placeholder="Search categories" label="Search categories" />
        <Segmented
          label="Category status"
          value={status}
          onChange={setStatus}
          options={[
            { key: 'all', label: 'All', count: data ? counts.all : undefined },
            { key: 'active', label: 'Active', count: data ? counts.active : undefined },
            { key: 'inactive', label: 'Inactive', count: data ? counts.inactive : undefined },
          ]}
        />
      </PageHeader>

      <main className="flex-1 px-5 pb-6">
        {loading && !data && <LoadingBlock />}
        {!loading && error && <ErrorBlock message={error} onRetry={() => void reload()} />}

        {!error && data && filtered.length === 0 && (
          <EmptyBlock
            title={hasFilters ? 'No categories found' : 'No categories yet'}
            hint={
              search.trim()
                ? `Nothing matches “${search.trim()}”.`
                : hasFilters
                ? 'No categories have this status.'
                : 'Categories help cashiers find products faster.'
            }
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
          <ul>
            {filtered.map((category) => (
              <li key={category.id} className="border-b border-slate-100 last:border-b-0">
                <RowButton onClick={() => openForm(category)}>
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-[15px] ${category.isActive ? '' : 'text-slate-400'}`}>{category.name}</p>
                    <p className={`mt-0.5 truncate text-xs ${category.description ? 'text-slate-400' : 'text-slate-300'}`}>
                      {category.description || 'No description'}
                    </p>
                  </div>
                  {category.isActive ? (
                    <span className="shrink-0 text-sm tabular-nums text-slate-500">
                      {category.productCount} {category.productCount === 1 ? 'product' : 'products'}
                    </span>
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
        <Sheet label={editing ? 'Edit category' : 'Add category'} onClose={requestClose}>
          <form
            noValidate
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(e) => {
              e.preventDefault()
              void save()
            }}
          >
            <SheetHeader
              title={editing ? 'Edit category' : 'Add category'}
              subtitle={editing ? `Used by ${editing.productCount} ${editing.productCount === 1 ? 'product' : 'products'}` : undefined}
              onClose={requestClose}
              closeDisabled={busy}
            />

            <SheetBody>
              <TextField
                label="Name"
                value={form.name}
                onChange={(name) => setForm({ ...form, name })}
                onBlur={() => setNameTouched(true)}
                error={nameTouched ? nameError : undefined}
                placeholder="e.g. Hot drinks"
                autoFocus={!editing}
                autoCapitalize="words"
                enterKeyHint="done"
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
                  label="Active"
                  description="Inactive categories are hidden at the register"
                  checked={form.isActive}
                  onChange={(isActive) => setForm({ ...form, isActive })}
                />
              )}

              {editing &&
                (editing.productCount > 0 ? (
                  <p className="rounded-2xl bg-[#F6F8F7] px-4 py-3 text-sm text-slate-500">
                    This category can’t be deleted while {editing.productCount}{' '}
                    {editing.productCount === 1 ? 'product uses' : 'products use'} it. Turn off “Active” to hide it instead.
                  </p>
                ) : (
                  <TextButton tone="danger" onClick={() => setRemove(editing)} disabled={busy} className="-ml-4">
                    Delete category
                  </TextButton>
                ))}
            </SheetBody>

            <SheetFooter>
              <PrimaryButton type="submit" disabled={busy || (editing !== null && !isDirty)}>
                {busy ? 'Saving…' : editing ? (isDirty ? 'Save changes' : 'No changes') : 'Add category'}
              </PrimaryButton>
            </SheetFooter>
          </form>
        </Sheet>
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
    </div>
  )
}

export default MobileCategories
