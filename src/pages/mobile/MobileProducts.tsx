import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { categoryApi } from '../../api/categoryApi'
import { productApi, type ProductPayload } from '../../api/productApi'
import { supplierApi } from '../../api/supplierApi'

import {
  AddButton,
  DetailList,
  DetailRow,
  EmptyBlock,
  ErrorBlock,
  LoadingBlock,
  PageHeader,
  PrimaryButton,
  RowButton,
  SearchField,
  Segmented,
  SelectField,
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
import { Pagination } from '../../components/ui/Pagination'

import { useAuth } from '../../context/AuthContext'
import { useSettings } from '../../context/SettingsContext'
import { useToast } from '../../context/ToastContext'
import { useAsync } from '../../hooks/useAsync'
import { useDebounced } from '../../hooks/useDebounced'

import type { Product } from '../../types'
import { getErrorMessage } from '../../utils/errors'
import { formatMoney } from '../../utils/format'
import { loadImage, resizeImage } from '../../utils/image'

type StockFilter = '' | 'Low Stock' | 'Out of Stock' | 'In Stock'
type FormErrors = Partial<Record<'name' | 'sku' | 'categoryId' | 'sellingPrice' | 'costPrice' | 'stockQuantity' | 'reorderLevel', string>>

const PAGE_SIZE = 20

const emptyForm = (): ProductPayload => ({
  sku: '',
  name: '',
  description: '',
  categoryId: 0,
  supplierId: null,
  costPrice: 0,
  sellingPrice: 0,
  stockQuantity: 0,
  reorderLevel: 5,
  isActive: true,
  imageUrl: '',
})

function toForm(product: Product): ProductPayload {
  return {
    sku: product.sku,
    name: product.name,
    description: product.description ?? '',
    categoryId: product.categoryId,
    supplierId: product.supplierId,
    costPrice: product.costPrice,
    sellingPrice: product.sellingPrice,
    stockQuantity: product.stockQuantity,
    reorderLevel: product.reorderLevel,
    isActive: product.isActive,
    imageUrl: product.imageUrl ?? '',
  }
}

function validate(form: ProductPayload, isNew: boolean): FormErrors {
  const errors: FormErrors = {}
  if (!form.name.trim()) errors.name = 'Enter a product name.'
  if (!form.sku.trim()) errors.sku = 'Enter a SKU or scan the barcode.'
  if (!form.categoryId) errors.categoryId = 'Choose a category.'
  if (!(form.sellingPrice > 0)) errors.sellingPrice = 'Enter the selling price.'
  if (form.costPrice < 0) errors.costPrice = 'Cost can’t be negative.'
  if (isNew && (form.stockQuantity < 0 || !Number.isInteger(form.stockQuantity))) errors.stockQuantity = 'Use a whole number, 0 or more.'
  if (form.reorderLevel < 0 || !Number.isInteger(form.reorderLevel)) errors.reorderLevel = 'Use a whole number, 0 or more.'
  return errors
}

function stockTone(status: string) {
  if (status === 'Out of Stock') return 'text-rose-600'
  if (status === 'Low Stock') return 'text-amber-700'
  return 'text-slate-500'
}

export function MobileProducts() {
  const { notify } = useToast()
  const { settings } = useSettings()
  const { can } = useAuth()
  const canManage = can('products.manage')
  const canDelete = can('products.delete')
  const canAdjustStock = can('inventory.manage')
  const navigate = useNavigate()
  const location = useLocation()
  const money = (value: number) => formatMoney(value, settings.currencySymbol)

  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [stock, setStock] = useState<StockFilter>('')
  const [page, setPage] = useState(1)

  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Product | null>(null)
  const [view, setView] = useState<Product | null>(null)
  const [form, setForm] = useState<ProductPayload>(emptyForm())
  const [initialForm, setInitialForm] = useState<ProductPayload>(emptyForm())
  const [showErrors, setShowErrors] = useState(false)
  const [deactivate, setDeactivate] = useState<Product | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [processingImage, setProcessingImage] = useState(false)
  const [showImageLink, setShowImageLink] = useState(false)
  const [imageLink, setImageLink] = useState('')
  const [imageLinkError, setImageLinkError] = useState<string | null>(null)
  const [checkingImageLink, setCheckingImageLink] = useState(false)
  const [busy, setBusy] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // Start every add / edit with the image-link field closed and empty.
  useEffect(() => {
    if (!open) return
    setShowImageLink(false)
    setImageLink('')
    setImageLinkError(null)
  }, [open])

  const q = useDebounced(search).trim()
  const categoryFilter = categoryId ? Number(categoryId) : undefined

  const categories = useAsync(() => categoryApi.list(), [])
  const suppliers = useAsync(() => supplierApi.list(), [])

  const { data, loading, error, reload } = useAsync(
    () =>
      productApi.list({
        search: q || undefined,
        categoryId: categoryFilter,
        stockStatus: stock || undefined,
        page,
        pageSize: PAGE_SIZE,
      }),
    [q, categoryFilter, stock, page],
  )

  // Real totals for the status filter, respecting search + category.
  const counts = useAsync(async () => {
    const count = (stockStatus?: string) =>
      productApi
        .list({ search: q || undefined, categoryId: categoryFilter, stockStatus, page: 1, pageSize: 1 })
        .then((r) => r.totalCount)
    const [all, low, out] = await Promise.all([count(), count('Low Stock'), count('Out of Stock')])
    return { all, low, out, inStock: Math.max(0, all - low - out) }
  }, [q, categoryFilter])

  const items = data?.items ?? []
  const errors = validate(form, !editing)
  const isValid = Object.keys(errors).length === 0
  const isDirty = JSON.stringify(form) !== JSON.stringify(initialForm)
  const hasFilters = Boolean(q || categoryId || stock)
  const margin = form.sellingPrice > 0 ? (form.sellingPrice - form.costPrice) / form.sellingPrice : null
  const fieldError = (key: keyof FormErrors) => (showErrors ? errors[key] : undefined)

  useEffect(() => {
    setPage(1)
  }, [q])

  /* ------------------------------------------------------------------
     ROUTE-DRIVEN SHEETS (/products/create, /products/:id, /products/edit/:id)
  ------------------------------------------------------------------ */

  function openEditForm(product: Product) {
    setEditing(product)
    setForm(toForm(product))
    setInitialForm(toForm(product))
    setShowErrors(false)
    setOpen(true)
    setView(null)
  }

  useEffect(() => {
    const path = location.pathname

    if (path === '/products/create') {
      if (!canManage) {
        navigate('/products', { replace: true })
        return
      }
      // Pre-select the category being browsed; otherwise ask explicitly.
      const next = { ...emptyForm(), categoryId: categoryFilter ?? 0 }
      setEditing(null)
      setForm(next)
      setInitialForm(next)
      setShowErrors(false)
      setOpen(true)
      setView(null)
      return
    }

    const editMatch = path.match(/^\/products\/edit\/(\d+)$/)
    const viewMatch = path.match(/^\/products\/(\d+)$/)
    const id = editMatch?.[1] ?? viewMatch?.[1]

    if (!id) {
      setOpen(false)
      setView(null)
      return
    }

    if (editMatch && !canManage) {
      navigate('/products', { replace: true })
      return
    }

    void productApi
      .get(Number(id))
      .then((product) => {
        if (editMatch) openEditForm(product)
        else {
          setView(product)
          setOpen(false)
        }
      })
      .catch((err) => {
        notify(getErrorMessage(err), 'error')
        navigate('/products')
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, navigate, notify, canManage])

  function goToList() {
    setOpen(false)
    setView(null)
    setConfirmDiscard(false)
    if (location.pathname !== '/products') navigate('/products')
  }

  function requestCloseForm() {
    if (busy) return
    if (isDirty) setConfirmDiscard(true)
    else goToList()
  }

  useEscapeKey(() => (open ? requestCloseForm() : goToList()), (open || view !== null) && !deactivate && !confirmDiscard)

  /* ------------------------------------------------------------------
     ACTIONS
  ------------------------------------------------------------------ */

  async function handleImageUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setProcessingImage(true)
    try {
      const imageUrl = await resizeImage(file)
      setForm((current) => ({ ...current, imageUrl }))
      setShowImageLink(false)
    } catch (err) {
      notify(getErrorMessage(err), 'error')
    } finally {
      setProcessingImage(false)
    }
  }

  function toggleImageLink() {
    if (!showImageLink && /^https?:\/\//i.test(form.imageUrl ?? '')) {
      // Editing a product that already uses a link: start from that link.
      setImageLink(form.imageUrl ?? '')
    }
    setImageLinkError(null)
    setShowImageLink((open) => !open)
  }

  /** Uses a web image link as the product photo — loaded first so a broken link is caught before saving. */
  async function applyImageLink() {
    const url = imageLink.trim()
    if (!url) {
      setImageLinkError('Paste a link to an image.')
      return
    }
    if (!/^https?:\/\//i.test(url)) {
      setImageLinkError('Use a full link that starts with https://')
      return
    }

    setCheckingImageLink(true)
    setImageLinkError(null)
    try {
      await loadImage(url)
      setForm((current) => ({ ...current, imageUrl: url }))
      setShowImageLink(false)
      setImageLink('')
    } catch (err) {
      setImageLinkError(err instanceof Error ? err.message : 'Couldn’t load an image from that link.')
    } finally {
      setCheckingImageLink(false)
    }
  }

  async function save() {
    setShowErrors(true)
    if (!isValid || busy) return

    setBusy(true)
    try {
      const payload: ProductPayload = {
        ...form,
        name: form.name.trim(),
        sku: form.sku.trim(),
        description: form.description?.trim(),
        supplierId: form.supplierId || null,
        imageUrl: form.imageUrl || undefined,
      }
      const saved = editing ? await productApi.update(editing.id, payload) : await productApi.create(payload)
      notify(editing ? 'Changes saved.' : `${saved.name} added.`)
      setInitialForm(form)
      await Promise.all([reload(), counts.reload()])
      navigate(`/products/${saved.id}`, { replace: true })
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
      await productApi.deactivate(deactivate.id)
      notify(`${deactivate.name} is hidden from the register.`)
      if (view?.id === deactivate.id) setView({ ...view, isActive: false })
      setDeactivate(null)
      await Promise.all([reload(), counts.reload()])
    } catch (err) {
      notify(getErrorMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function reactivate(product: Product) {
    setBusy(true)
    try {
      const updated = await productApi.update(product.id, {
        ...toForm(product),
        imageUrl: product.imageUrl || undefined,
        isActive: true,
      })
      notify(`${product.name} is back on the register.`)
      setView(updated)
      await Promise.all([reload(), counts.reload()])
    } catch (err) {
      notify(getErrorMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  const setNumber = (key: keyof ProductPayload) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value === '' ? 0 : Number(value) }))

  /* ------------------------------------------------------------------
     RENDER
  ------------------------------------------------------------------ */

  return (
    <div className="flex min-h-full flex-col bg-white text-[#091413] antialiased">
      <PageHeader
        title="Products"
        subtitle={
          counts.data
            ? counts.data.low + counts.data.out > 0
              ? `${counts.data.all} products · ${counts.data.low + counts.data.out} need restocking`
              : `${counts.data.all} products`
            : 'Catalog and prices'
        }
        action={canManage ? <AddButton onClick={() => navigate('/products/create')} /> : undefined}
      >
        <SearchField value={search} onChange={setSearch} placeholder="Product name or SKU" label="Search products" />

        <Segmented
          scroll
          label="Category"
          value={categoryId}
          onChange={(value) => {
            setCategoryId(value)
            setPage(1)
          }}
          options={[
            { key: '', label: 'All categories' },
            ...(categories.data ?? []).map((c) => ({ key: String(c.id), label: c.name })),
          ]}
        />

        <Segmented
          label="Stock status"
          value={stock}
          onChange={(value) => {
            setStock(value)
            setPage(1)
          }}
          options={[
            { key: '', label: 'All', count: counts.data?.all },
            { key: 'Low Stock', label: 'Low', count: counts.data?.low, attention: true },
            { key: 'Out of Stock', label: 'Out', count: counts.data?.out, attention: true },
          ]}
        />
      </PageHeader>

      <main className="flex-1 px-5 pb-6">
        {loading && !data && <LoadingBlock />}
        {!loading && error && <ErrorBlock message={error} onRetry={() => void reload()} />}

        {!loading && !error && items.length === 0 && (
          <EmptyBlock
            title={hasFilters ? 'No products found' : 'No products yet'}
            hint={q ? `Nothing matches “${q}”.` : hasFilters ? 'Try another category or status.' : 'Add products so cashiers can sell them.'}
            actionLabel={hasFilters ? 'Clear filters' : canManage ? 'Add first product' : undefined}
            secondary={hasFilters}
            onAction={
              hasFilters
                ? () => {
                    setSearch('')
                    setCategoryId('')
                    setStock('')
                    setPage(1)
                  }
                : () => navigate('/products/create')
            }
          />
        )}

        {!error && items.length > 0 && (
          <>
            <ul className={`transition-opacity ${loading ? 'opacity-60' : ''}`}>
              {items.map((product) => (
                <li key={product.id} className="border-b border-slate-100 last:border-b-0">
                  <RowButton onClick={() => navigate(`/products/${product.id}`)}>
                    <Thumbnail product={product} />
                    <div className="min-w-0 flex-1">
                      <p className={`truncate text-[15px] ${product.isActive ? '' : 'text-slate-400'}`}>{product.name}</p>
                      <p className="mt-0.5 truncate text-xs text-slate-400">
                        {product.sku} · {product.categoryName}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-[15px] font-medium tabular-nums">{money(product.sellingPrice)}</p>
                      {product.isActive ? (
                        <p className={`text-xs tabular-nums ${stockTone(product.stockStatus)}`}>
                          {product.stockQuantity <= 0 ? 'Out of stock' : `${product.stockQuantity} in stock`}
                        </p>
                      ) : (
                        <p className="text-xs text-slate-400">Inactive</p>
                      )}
                    </div>
                  </RowButton>
                </li>
              ))}
            </ul>

            {(data?.totalPages ?? 1) > 1 && (
              <div className="pt-4">
                <Pagination page={data?.page ?? 1} totalPages={data?.totalPages ?? 1} onPage={setPage} />
              </div>
            )}
          </>
        )}
      </main>

      {/* DETAILS */}
      {view && (
        <Sheet label={`${view.name} details`} onClose={goToList}>
          <SheetHeader
            title={view.name}
            subtitle={`${view.sku} · ${view.categoryName}`}
            leading={<Thumbnail product={view} large />}
            onClose={goToList}
          />

          <SheetBody>
            {!view.isActive && (
              <p className="rounded-2xl bg-slate-100 px-4 py-3 text-sm text-slate-600">
                Inactive — this product is hidden from the register.
              </p>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-2xl bg-[#F2F8F4] px-4 py-3">
                <p className="text-sm text-[#1F5E3B]">Price</p>
                <p className="mt-0.5 text-2xl font-bold tabular-nums">{money(view.sellingPrice)}</p>
                <p className="text-xs text-slate-500">
                  Cost {money(view.costPrice)}
                  {view.sellingPrice > 0 &&
                    ` · ${Math.round(((view.sellingPrice - view.costPrice) / view.sellingPrice) * 100)}% margin`}
                </p>
              </div>
              <div className="rounded-2xl bg-[#F6F8F7] px-4 py-3">
                <p className="text-sm text-slate-500">Stock</p>
                <p className={`mt-0.5 text-2xl font-bold tabular-nums ${view.stockQuantity <= 0 ? 'text-rose-600' : ''}`}>
                  {view.stockQuantity}
                </p>
                <p className={`text-xs ${stockTone(view.stockStatus)}`}>
                  {view.stockStatus === 'In Stock' ? `Low at ${view.reorderLevel}` : view.stockStatus}
                </p>
              </div>
            </div>

            {canAdjustStock && (
              <TextButton tone="accent" onClick={() => navigate('/inventory')} className="-ml-4 h-11">
                Update stock in Inventory →
              </TextButton>
            )}

            <DetailList>
              <DetailRow label="Category" value={view.categoryName} />
              <DetailRow label="Supplier" value={view.supplierName} />
              <DetailRow label="Description" value={view.description} />
            </DetailList>
          </SheetBody>

          {(canManage || canDelete) && (
            <SheetFooter>
              {view.isActive
                ? canDelete && (
                    <TextButton tone="danger" onClick={() => setDeactivate(view)} disabled={busy}>
                      Deactivate
                    </TextButton>
                  )
                : canManage && (
                    <TextButton tone="accent" onClick={() => void reactivate(view)} disabled={busy}>
                      {busy ? 'Activating…' : 'Reactivate'}
                    </TextButton>
                  )}
              {canManage && (
                <PrimaryButton onClick={() => navigate(`/products/edit/${view.id}`)}>Edit product</PrimaryButton>
              )}
            </SheetFooter>
          )}
        </Sheet>
      )}

      {/* FORM */}
      {open && (
        <Sheet label={editing ? 'Edit product' : 'Add product'} onClose={requestCloseForm}>
          <form
            noValidate
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(e) => {
              e.preventDefault()
              void save()
            }}
          >
            <SheetHeader title={editing ? 'Edit product' : 'Add product'} onClose={requestCloseForm} closeDisabled={busy} />

            <SheetBody>
              {/* Photo — upload from the device, or use a web image link */}
              <div>
                <div className="flex items-center gap-4">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    aria-label={form.imageUrl ? 'Upload a new photo' : 'Upload a photo'}
                    className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-[#F3F5F4] text-sm text-slate-400 active:bg-[#E9EEEB]"
                  >
                    {processingImage || checkingImageLink ? (
                      'Loading…'
                    ) : form.imageUrl ? (
                      <SafeImage src={form.imageUrl} className="h-full w-full object-cover" fallback={<CameraIcon />} />
                    ) : (
                      <CameraIcon />
                    )}
                  </button>
                  <div className="flex flex-col items-start">
                    <TextButton tone="accent" onClick={() => fileInputRef.current?.click()} className="-ml-4 h-11">
                      {form.imageUrl ? 'Upload new photo' : 'Upload photo'}
                    </TextButton>
                    <TextButton
                      tone="accent"
                      onClick={toggleImageLink}
                      aria-expanded={showImageLink}
                      className="-ml-4 h-11"
                    >
                      {showImageLink ? 'Cancel link' : 'Use image link'}
                    </TextButton>
                    {form.imageUrl && !showImageLink && (
                      <TextButton
                        tone="danger"
                        onClick={() => setForm((current) => ({ ...current, imageUrl: '' }))}
                        className="-ml-4 h-11"
                      >
                        Remove photo
                      </TextButton>
                    )}
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => void handleImageUpload(e)}
                  />
                </div>

                {showImageLink && (
                  <div className="mt-3">
                    <TextField
                      label="Image link"
                      type="url"
                      inputMode="url"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      enterKeyHint="done"
                      autoFocus
                      placeholder="https://example.com/photo.jpg"
                      value={imageLink}
                      readOnly={checkingImageLink}
                      error={imageLinkError ?? undefined}
                      hint="Linked photos need an internet connection to show."
                      onChange={(value) => {
                        setImageLink(value)
                        setImageLinkError(null)
                      }}
                      onKeyDown={(event) => {
                        // Enter applies the link instead of submitting the whole form.
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          void applyImageLink()
                        }
                      }}
                      trailing={
                        <button
                          type="button"
                          onClick={() => void applyImageLink()}
                          disabled={checkingImageLink || !imageLink.trim()}
                          className="h-10 rounded-xl px-3 text-sm font-medium text-[#1F5E3B] transition active:bg-[#E6F1EA] disabled:text-slate-300"
                        >
                          {checkingImageLink ? 'Checking…' : 'Use'}
                        </button>
                      }
                    />
                  </div>
                )}
              </div>

              <TextField
                label="Product name"
                value={form.name}
                onChange={(name) => setForm({ ...form, name })}
                error={fieldError('name')}
                placeholder="e.g. Coke 1.5L"
                autoFocus={!editing}
                autoCapitalize="words"
              />

              <TextField
                label="SKU / barcode"
                value={form.sku}
                onChange={(sku) => setForm({ ...form, sku })}
                error={fieldError('sku')}
                placeholder="e.g. BEV-001"
                autoCapitalize="characters"
                autoComplete="off"
              />

              <SelectField
                label="Category"
                value={form.categoryId || ''}
                onChange={(value) => setForm({ ...form, categoryId: Number(value) })}
                error={fieldError('categoryId')}
              >
                <option value="">Choose a category</option>
                {(categories.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </SelectField>

              <div className="grid grid-cols-2 gap-3">
                <TextField
                  label="Selling price"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  prefix={settings.currencySymbol}
                  value={form.sellingPrice || ''}
                  onChange={setNumber('sellingPrice')}
                  error={fieldError('sellingPrice')}
                  placeholder="0.00"
                />
                <TextField
                  label="Cost"
                  optional
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  prefix={settings.currencySymbol}
                  value={form.costPrice || ''}
                  onChange={setNumber('costPrice')}
                  error={fieldError('costPrice')}
                  placeholder="0.00"
                />
              </div>

              {margin !== null && form.costPrice > 0 && (
                <p
                  className={`-mt-1 text-sm ${
                    margin < 0 ? 'text-rose-600' : margin < 0.15 ? 'text-amber-700' : 'text-[#1F5E3B]'
                  }`}
                >
                  {margin < 0
                    ? `Selling below cost — you lose ${money(form.costPrice - form.sellingPrice)} per sale.`
                    : `${Math.round(margin * 100)}% margin · ${money(form.sellingPrice - form.costPrice)} profit per sale`}
                </p>
              )}

              <div className="grid grid-cols-2 gap-3">
                {editing ? (
                  <div>
                    <p className="text-sm font-medium">Stock</p>
                    <p className="mt-1.5 flex h-12 items-center rounded-2xl bg-[#F6F8F7] px-4 text-[15px] tabular-nums text-slate-500">
                      {form.stockQuantity}
                    </p>
                  </div>
                ) : (
                  <TextField
                    label="Starting stock"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={1}
                    value={form.stockQuantity || ''}
                    onChange={setNumber('stockQuantity')}
                    error={fieldError('stockQuantity')}
                    placeholder="0"
                  />
                )}
                <TextField
                  label="Low-stock alert"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  value={form.reorderLevel}
                  onChange={setNumber('reorderLevel')}
                  error={fieldError('reorderLevel')}
                  placeholder="5"
                />
              </div>
              {editing && (
                <p className="-mt-2 text-xs text-slate-500">To change stock, use Inventory so the change is recorded.</p>
              )}

              <SelectField
                label="Supplier"
                optional
                value={form.supplierId ?? ''}
                onChange={(value) => setForm({ ...form, supplierId: value ? Number(value) : null })}
              >
                <option value="">No supplier</option>
                {(suppliers.data ?? [])
                  .filter((s) => s.isActive || s.id === form.supplierId)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.companyName}
                    </option>
                  ))}
              </SelectField>

              <TextAreaField
                label="Description"
                optional
                value={form.description ?? ''}
                onChange={(description) => setForm({ ...form, description })}
                placeholder="Size, flavor, notes"
              />

              {editing && (
                <SwitchRow
                  label="Available at the register"
                  description="Turn off to hide without deleting"
                  checked={form.isActive}
                  onChange={(isActive) => setForm({ ...form, isActive })}
                />
              )}

              {showErrors && !isValid && (
                <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  Fix the highlighted fields to save.
                </p>
              )}
            </SheetBody>

            <SheetFooter>
              <PrimaryButton type="submit" disabled={busy || processingImage || checkingImageLink || (editing !== null && !isDirty)}>
                {busy ? 'Saving…' : editing ? (isDirty ? 'Save changes' : 'No changes') : 'Add product'}
              </PrimaryButton>
            </SheetFooter>
          </form>
        </Sheet>
      )}

      {confirmDiscard && (
        <ConfirmDialog
          title="Discard changes?"
          message="The information you entered will not be saved."
          confirmLabel="Discard"
          danger
          onCancel={() => setConfirmDiscard(false)}
          onConfirm={goToList}
        />
      )}

      {deactivate && (
        <ConfirmDialog
          title={`Deactivate ${deactivate.name}?`}
          message="It will be hidden from the register. Sales history and stock are kept, and you can reactivate it anytime."
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

function Thumbnail({ product, large = false }: { product: Product; large?: boolean }) {
  const size = large ? 'h-14 w-14' : 'h-12 w-12'
  const initial = <span className="text-sm font-semibold text-slate-400">{product.name.slice(0, 1).toUpperCase()}</span>
  return (
    <span className={`${size} flex shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[#F3F5F4]`}>
      {product.imageUrl ? (
        <SafeImage
          src={product.imageUrl}
          loading="lazy"
          className={`h-full w-full object-cover ${product.isActive ? '' : 'opacity-50 grayscale'}`}
          fallback={initial}
        />
      ) : (
        initial
      )}
    </span>
  )
}

/** Image that swaps to `fallback` when it can't load (e.g. a linked photo while offline). */
function SafeImage({
  src,
  className,
  fallback,
  loading,
}: {
  src: string
  className: string
  fallback: ReactNode
  loading?: 'lazy' | 'eager'
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  if (failedSrc === src) return <>{fallback}</>
  return <img src={src} alt="" loading={loading} className={className} onError={() => setFailedSrc(src)} />
}

function CameraIcon() {
  return (
    <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z" />
      <circle cx="12" cy="13" r="3" />
    </svg>
  )
}

export default MobileProducts
