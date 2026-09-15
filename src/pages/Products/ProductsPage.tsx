import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'

import { categoryApi } from '../../api/categoryApi'
import { productApi, type ProductPayload } from '../../api/productApi'
import { supplierApi } from '../../api/supplierApi'

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
  SafeImage,
  StatusCell,
  Th,
  Toolbar,
} from '../../components/ui/DesktopKit'
import { ChevronRight } from '../../components/ui/Icons'
import {
  AddButton,
  DetailList,
  DetailRow,
  PrimaryButton,
  SelectField,
  SwitchRow,
  TextAreaField,
  TextButton,
  TextField,
} from '../../components/ui/MobileKit'
import { ConfirmDialog, Modal } from '../../components/ui/Modal'
import { Pagination } from '../../components/ui/Pagination'
import { Spinner } from '../../components/ui/States'

import { useAuth } from '../../context/AuthContext'
import { useSettings } from '../../context/SettingsContext'
import { useToast } from '../../context/ToastContext'
import { useAsync } from '../../hooks/useAsync'
import { useDebounced } from '../../hooks/useDebounced'
import { useIsMobile } from '../../hooks/useIsMobile'

import type { Product } from '../../types'
import { getErrorMessage } from '../../utils/errors'
import { formatMoney } from '../../utils/format'
import { loadImage, resizeImage } from '../../utils/image'
import { MobileProducts } from '../mobile/MobileProducts'

type ProductFilter = '' | 'Low Stock' | 'Out of Stock' | 'inactive'
type FormErrors = Partial<Record<'name' | 'sku' | 'categoryId' | 'sellingPrice' | 'costPrice' | 'stockQuantity' | 'reorderLevel', string>>

const PAGE_SIZE = 20
const FORM_ID = 'product-form'

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

function stockTextClass(status: string) {
  if (status === 'Out of Stock') return 'text-rose-600'
  if (status === 'Low Stock') return 'text-amber-700'
  return 'text-slate-500'
}

export function ProductsPage() {
  const isMobile = useIsMobile()
  if (isMobile) return <MobileProducts />
  return <DesktopProductsPage />
}

function DesktopProductsPage() {
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
  // `?category=<id>` lets the Categories page link straight to a filtered list.
  const [searchParams] = useSearchParams()
  const [categoryId, setCategoryId] = useState(() => searchParams.get('category') ?? '')
  const [filter, setFilter] = useState<ProductFilter>('')
  const [page, setPage] = useState(1)

  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Product | null>(null)
  const [view, setView] = useState<Product | null>(null)
  const [form, setForm] = useState<ProductPayload>(emptyForm())
  const [initialForm, setInitialForm] = useState<ProductPayload>(emptyForm())
  const [showErrors, setShowErrors] = useState(false)
  const [deactivate, setDeactivate] = useState<Product | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [busy, setBusy] = useState(false)

  // Photo
  const [processingImage, setProcessingImage] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [showImageLink, setShowImageLink] = useState(false)
  const [imageLink, setImageLink] = useState('')
  const [imageLinkError, setImageLinkError] = useState<string | null>(null)
  const [checkingImageLink, setCheckingImageLink] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const q = useDebounced(search).trim()
  const categoryFilter = categoryId ? Number(categoryId) : undefined

  const categories = useAsync(() => categoryApi.list(), [])
  const suppliers = useAsync(() => supplierApi.list(), [])

  const { data, loading, error, reload } = useAsync(
    () =>
      productApi.list({
        search: q || undefined,
        categoryId: categoryFilter,
        stockStatus: filter === 'Low Stock' || filter === 'Out of Stock' ? filter : undefined,
        isActive: filter === 'inactive' ? false : undefined,
        page,
        pageSize: PAGE_SIZE,
      }),
    [q, categoryFilter, filter, page],
  )

  // Real totals for the filter pills, respecting search + category.
  const counts = useAsync(async () => {
    const count = (params: { stockStatus?: string; isActive?: boolean }) =>
      productApi
        .list({ search: q || undefined, categoryId: categoryFilter, ...params, page: 1, pageSize: 1 })
        .then((r) => r.totalCount)
    const [all, low, out, inactive] = await Promise.all([
      count({}),
      count({ stockStatus: 'Low Stock' }),
      count({ stockStatus: 'Out of Stock' }),
      count({ isActive: false }),
    ])
    return { all, low, out, inactive }
  }, [q, categoryFilter])

  const items = data?.items ?? []
  const errors = validate(form, !editing)
  const isValid = Object.keys(errors).length === 0
  const isDirty = JSON.stringify(form) !== JSON.stringify(initialForm)
  const hasFilters = Boolean(q || categoryId || filter)
  const margin = form.sellingPrice > 0 ? (form.sellingPrice - form.costPrice) / form.sellingPrice : null
  const fieldError = (key: keyof FormErrors) => (showErrors ? errors[key] : undefined)

  useEffect(() => {
    setPage(1)
  }, [q])

  /* =========================================================
     URL-BASED MODALS (/products/create, /products/:id, /products/edit/:id)
  ========================================================= */

  function resetPhotoControls() {
    setShowImageLink(false)
    setImageLink('')
    setImageLinkError(null)
  }

  function openEditForm(product: Product) {
    setEditing(product)
    setForm(toForm(product))
    setInitialForm(toForm(product))
    setShowErrors(false)
    resetPhotoControls()
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
      resetPhotoControls()
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

  function clearFilters() {
    setSearch('')
    setCategoryId('')
    setFilter('')
    setPage(1)
  }

  /* =========================================================
     PHOTO
  ========================================================= */

  async function applyImageFile(file: File) {
    setProcessingImage(true)
    try {
      const imageUrl = await resizeImage(file)
      setForm((current) => ({ ...current, imageUrl }))
      resetPhotoControls()
    } catch (err) {
      notify(getErrorMessage(err), 'error')
    } finally {
      setProcessingImage(false)
    }
  }

  function toggleImageLink() {
    if (!showImageLink && /^https?:\/\//i.test(form.imageUrl ?? '')) setImageLink(form.imageUrl ?? '')
    setImageLinkError(null)
    setShowImageLink((visible) => !visible)
  }

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
      resetPhotoControls()
    } catch (err) {
      setImageLinkError(err instanceof Error ? err.message : 'Couldn’t load an image from that link.')
    } finally {
      setCheckingImageLink(false)
    }
  }

  /* =========================================================
     ACTIONS
  ========================================================= */

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

  /* =========================================================
     RENDER
  ========================================================= */

  const needRestock = counts.data ? counts.data.low + counts.data.out : 0

  return (
    <DesktopPage
      title="Products"
      subtitle={
        counts.data
          ? `${counts.data.all} ${counts.data.all === 1 ? 'product' : 'products'}${needRestock > 0 ? ` · ${needRestock} need restocking` : ''}`
          : 'Catalog and prices'
      }
      actions={canManage ? <AddButton label="Add product" onClick={() => navigate('/products/create')} /> : undefined}
    >
      <Toolbar>
        <div className="flex min-w-0 flex-1 basis-md items-center gap-2">
          <DesktopSearch
            value={search}
            onChange={setSearch}
            placeholder="Search name or SKU"
            label="Search products"
            className="min-w-0 max-w-md flex-1"
          />
          <DesktopSelect
            label="Category"
            value={categoryId}
            clearValue=""
            onChange={(value) => {
              setCategoryId(value)
              setPage(1)
            }}
            options={[
              { value: '', label: 'All' },
              ...(categories.data ?? []).map((c) => ({
                value: String(c.id),
                label: c.name,
                meta: c.isActive ? String(c.productCount) : 'Inactive',
                muted: !c.isActive,
              })),
            ]}
          />
        </div>
        <FilterPills
          label="Product status"
          value={filter}
          onChange={(value) => {
            setFilter(value)
            setPage(1)
          }}
          options={[
            { key: '', label: 'All', count: counts.data?.all },
            { key: 'Low Stock', label: 'Low stock', count: counts.data?.low, attention: true },
            { key: 'Out of Stock', label: 'Out of stock', count: counts.data?.out, attention: true },
            { key: 'inactive', label: 'Inactive', count: counts.data?.inactive },
          ]}
        />
      </Toolbar>

      {hasFilters && data && (
        <FilterSummary shown={data.totalCount} noun={data.totalCount === 1 ? 'product found' : 'products found'} onClear={clearFilters} />
      )}

      <DataCard className={hasFilters && data ? 'mt-2' : 'mt-4'}>
        {loading && !data && <LoadingRow />}
        {!loading && error && <ErrorRow message={error} onRetry={() => void reload()} />}
        {!loading && !error && items.length === 0 && (
          <EmptyRow
            title={hasFilters ? 'No products found' : 'No products yet'}
            hint={q ? `Nothing matches “${q}”.` : hasFilters ? 'Try another category or status.' : 'Add products so cashiers can sell them.'}
            actionLabel={hasFilters ? 'Clear filters' : canManage ? 'Add first product' : undefined}
            secondary={hasFilters}
            onAction={hasFilters ? clearFilters : () => navigate('/products/create')}
          />
        )}

        {!error && items.length > 0 && (
          <>
            <div className="overflow-x-auto">
              <table className={`w-full text-left text-sm transition-opacity ${loading ? 'opacity-60' : ''}`}>
                <thead className="border-b border-slate-100 text-xs text-slate-500">
                  <tr>
                    <Th className="pl-6">Product</Th>
                    <Th>Category</Th>
                    <Th align="right">Price</Th>
                    <Th align="right" className="hidden lg:table-cell">
                      Cost
                    </Th>
                    <Th align="right">Stock</Th>
                    <Th>Status</Th>
                    <Th className="pr-6">
                      <span className="sr-only">Actions</span>
                    </Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((product) => (
                    <tr key={product.id} onClick={() => navigate(`/products/${product.id}`)} className="group cursor-pointer hover:bg-slate-50">
                      <td className="py-3 pl-6 pr-3">
                        <div className="flex items-center gap-3">
                          <Thumbnail product={product} />
                          <div className="min-w-0">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                navigate(`/products/${product.id}`)
                              }}
                              className={`block max-w-64 truncate text-left font-medium focus-visible:underline focus-visible:outline-none ${
                                product.isActive ? '' : 'text-slate-400'
                              }`}
                            >
                              {product.name}
                            </button>
                            <span className="text-xs text-slate-400">{product.sku}</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-slate-600">{product.categoryName}</td>
                      <td className="px-3 py-3 text-right font-medium tabular-nums">{money(product.sellingPrice)}</td>
                      <td className="hidden px-3 py-3 text-right tabular-nums text-slate-500 lg:table-cell">{money(product.costPrice)}</td>
                      <td className="px-3 py-3 text-right">
                        <span className={`tabular-nums ${product.stockQuantity <= 0 ? 'font-medium text-rose-600' : ''}`}>{product.stockQuantity}</span>
                        {product.stockStatus !== 'In Stock' && (
                          <span className={`block text-xs ${stockTextClass(product.stockStatus)}`}>{product.stockStatus}</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <StatusCell active={product.isActive} />
                      </td>
                      <td className="py-3 pl-3 pr-6">
                        <div className="flex items-center justify-end gap-1">
                          {canManage && (
                            <HoverAction label="Edit" ariaLabel={`Edit ${product.name}`} onClick={() => navigate(`/products/edit/${product.id}`)} />
                          )}
                          <ChevronRight size={12} className="text-slate-300" />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {(data?.totalPages ?? 1) > 1 && (
              <div className="border-t border-slate-100 px-6 py-3">
                <Pagination page={data?.page ?? 1} totalPages={data?.totalPages ?? 1} onPage={setPage} />
              </div>
            )}
          </>
        )}
      </DataCard>

      {/* DETAILS */}
      {view && (
        <Modal
          title={view.name}
          description={`${view.sku} · ${view.categoryName}`}
          size="xl"
          onClose={goToList}
          footer={
            canManage || canDelete ? (
              <div className="flex w-full items-center gap-2">
                {view.isActive
                  ? canDelete && (
                      <TextButton tone="danger" onClick={() => setDeactivate(view)} disabled={busy} className="h-12">
                        Deactivate
                      </TextButton>
                    )
                  : canManage && (
                      <TextButton tone="accent" onClick={() => void reactivate(view)} disabled={busy} className="h-12">
                        {busy ? 'Activating…' : 'Reactivate'}
                      </TextButton>
                    )}
                <div className="flex-1" />
                {canManage && (
                  <PrimaryButton onClick={() => navigate(`/products/edit/${view.id}`)} className="h-12 flex-none px-8">
                    Edit product
                  </PrimaryButton>
                )}
              </div>
            ) : undefined
          }
        >
          <div className="grid gap-6 md:grid-cols-[14rem_1fr]">
            <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-2xl bg-[#F3F5F4]">
              {view.imageUrl ? (
                <SafeImage
                  src={view.imageUrl}
                  className={`h-full w-full object-cover ${view.isActive ? '' : 'opacity-60 grayscale'}`}
                  fallback={<span className="text-4xl font-semibold text-slate-300">{view.name.slice(0, 1).toUpperCase()}</span>}
                />
              ) : (
                <span className="text-4xl font-semibold text-slate-300">{view.name.slice(0, 1).toUpperCase()}</span>
              )}
            </div>

            <div className="space-y-4">
              {!view.isActive && (
                <p className="rounded-2xl bg-slate-100 px-4 py-3 text-sm text-slate-600">Inactive — this product is hidden from the register.</p>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-[#F2F8F4] px-4 py-3">
                  <p className="text-sm text-[#1F5E3B]">Price</p>
                  <p className="mt-0.5 text-2xl font-bold tabular-nums">{money(view.sellingPrice)}</p>
                  <p className="text-xs text-slate-500">
                    Cost {money(view.costPrice)}
                    {view.sellingPrice > 0 && ` · ${Math.round(((view.sellingPrice - view.costPrice) / view.sellingPrice) * 100)}% margin`}
                  </p>
                </div>
                <div className="rounded-2xl bg-[#F6F8F7] px-4 py-3">
                  <p className="text-sm text-slate-500">Stock</p>
                  <p className={`mt-0.5 text-2xl font-bold tabular-nums ${view.stockQuantity <= 0 ? 'text-rose-600' : ''}`}>{view.stockQuantity}</p>
                  <p className={`text-xs ${stockTextClass(view.stockStatus)}`}>
                    {view.stockStatus === 'In Stock' ? `Low-stock alert at ${view.reorderLevel}` : view.stockStatus}
                  </p>
                </div>
              </div>

              {canAdjustStock && (
                <TextButton tone="accent" onClick={() => navigate('/inventory')} className="-ml-4 h-10">
                  Update stock in Inventory →
                </TextButton>
              )}

              <DetailList>
                <DetailRow label="Category" value={view.categoryName} />
                <DetailRow label="Supplier" value={view.supplierName} />
                <DetailRow label="Description" value={view.description} />
              </DetailList>
            </div>
          </div>
        </Modal>
      )}

      {/* ADD / EDIT */}
      {open && (
        <Modal
          title={editing ? 'Edit product' : 'Add product'}
          description={editing ? editing.sku : undefined}
          size="2xl"
          onClose={requestCloseForm}
          preventClose={busy}
          footer={
            <div className="flex w-full items-center gap-3">
              {showErrors && !isValid && <p className="text-sm text-rose-600">Fix the highlighted fields to save.</p>}
              <div className="flex-1" />
              <TextButton onClick={requestCloseForm} disabled={busy} className="h-12">
                Cancel
              </TextButton>
              <PrimaryButton
                type="submit"
                form={FORM_ID}
                disabled={busy || processingImage || checkingImageLink || (editing !== null && !isDirty)}
                className="h-12 flex-none px-8"
              >
                {busy ? 'Saving…' : editing ? (isDirty ? 'Save changes' : 'No changes') : 'Add product'}
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
            className="grid gap-6 md:grid-cols-[14rem_1fr]"
          >
            {/* Photo: drop, upload or link */}
            <div>
              <p className="text-sm font-medium">
                Photo <span className="font-normal text-slate-400">(optional)</span>
              </p>
              <div
                role="button"
                tabIndex={0}
                aria-label={form.imageUrl ? 'Replace photo' : 'Upload photo'}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    fileInputRef.current?.click()
                  }
                }}
                onDragOver={(e) => {
                  e.preventDefault()
                  setIsDragging(true)
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setIsDragging(false)
                  const file = e.dataTransfer.files?.[0]
                  if (file) void applyImageFile(file)
                }}
                className={`mt-1.5 flex aspect-square w-full cursor-pointer items-center justify-center overflow-hidden rounded-2xl transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B] ${
                  isDragging ? 'bg-[#E6F1EA] ring-2 ring-[#1F5E3B]' : 'bg-[#F3F5F4] hover:bg-[#E9EEEB]'
                }`}
              >
                {processingImage || checkingImageLink ? (
                  <Spinner />
                ) : form.imageUrl ? (
                  <SafeImage src={form.imageUrl} className="h-full w-full object-cover" fallback={<CameraIcon />} />
                ) : (
                  <span className="flex flex-col items-center gap-2 px-4 text-center text-sm text-slate-500">
                    <CameraIcon />
                    Drop a photo here or click to upload
                  </span>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (file) void applyImageFile(file)
                }}
              />
              <div className="mt-1 flex flex-wrap">
                <TextButton tone="accent" onClick={toggleImageLink} aria-expanded={showImageLink} className="-ml-4 h-10">
                  {showImageLink ? 'Cancel link' : 'Use image link'}
                </TextButton>
                {form.imageUrl && !showImageLink && (
                  <TextButton tone="danger" onClick={() => setForm((current) => ({ ...current, imageUrl: '' }))} className="h-10">
                    Remove
                  </TextButton>
                )}
              </div>
              {showImageLink && (
                <TextField
                  label="Image link"
                  type="url"
                  inputMode="url"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  autoFocus
                  placeholder="https://…/photo.jpg"
                  value={imageLink}
                  readOnly={checkingImageLink}
                  error={imageLinkError ?? undefined}
                  hint="Linked photos need internet to show."
                  onChange={(value) => {
                    setImageLink(value)
                    setImageLinkError(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      void applyImageLink()
                    }
                  }}
                  trailing={
                    <button
                      type="button"
                      onClick={() => void applyImageLink()}
                      disabled={checkingImageLink || !imageLink.trim()}
                      className="h-10 rounded-xl px-3 text-sm font-medium text-[#1F5E3B] hover:bg-[#E6F1EA] disabled:text-slate-300"
                    >
                      {checkingImageLink ? 'Checking…' : 'Use'}
                    </button>
                  }
                />
              )}
            </div>

            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
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
                  placeholder="Type or scan"
                  autoComplete="off"
                  onKeyDown={(e) => {
                    // Barcode scanners end with Enter — move on instead of submitting a half-filled form.
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      const fields = Array.from(e.currentTarget.form?.querySelectorAll<HTMLElement>('input, select, textarea') ?? [])
                      fields[fields.indexOf(e.currentTarget) + 1]?.focus()
                    }
                  }}
                />
                <SelectField
                  label="Category"
                  value={form.categoryId || ''}
                  onChange={(value) => setForm({ ...form, categoryId: Number(value) })}
                  error={fieldError('categoryId')}
                  hint={
                    categories.data && !categories.data.some((c) => c.isActive)
                      ? 'No active categories yet. Add one in Categories first.'
                      : undefined
                  }
                >
                  <option value="">Choose a category</option>
                  {/* Only active categories can be picked; keep the current one visible when editing. */}
                  {(categories.data ?? [])
                    .filter((c) => c.isActive || c.id === form.categoryId)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.isActive ? '' : ' (inactive)'}
                      </option>
                    ))}
                </SelectField>
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
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
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
                <p className={`-mt-2 text-sm ${margin < 0 ? 'text-rose-600' : margin < 0.15 ? 'text-amber-700' : 'text-[#1F5E3B]'}`}>
                  {margin < 0
                    ? `Selling below cost — you lose ${money(form.costPrice - form.sellingPrice)} per sale.`
                    : `${Math.round(margin * 100)}% margin · ${money(form.sellingPrice - form.costPrice)} profit per sale`}
                </p>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                {editing ? (
                  <div>
                    <p className="text-sm font-medium">Stock</p>
                    <p className="mt-1.5 flex h-12 items-center rounded-2xl bg-[#F6F8F7] px-4 tabular-nums text-slate-500">{form.stockQuantity}</p>
                    <p className="mt-1.5 text-xs text-slate-500">Change stock from Inventory so it’s recorded.</p>
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
                  label="Low-stock alert at"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  value={form.reorderLevel}
                  onChange={setNumber('reorderLevel')}
                  error={fieldError('reorderLevel')}
                />
              </div>

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
            </div>
          </form>
        </Modal>
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
    </DesktopPage>
  )
}

function Thumbnail({ product }: { product: Product }) {
  const initial = <span className="text-sm font-semibold text-slate-400">{product.name.slice(0, 1).toUpperCase()}</span>
  return (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[#F3F5F4]">
      {product.imageUrl ? (
        <SafeImage
          src={product.imageUrl}
          className={`h-full w-full object-cover ${product.isActive ? '' : 'opacity-50 grayscale'}`}
          fallback={initial}
        />
      ) : (
        initial
      )}
    </span>
  )
}

function CameraIcon() {
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-slate-400">
      <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z" />
      <circle cx="12" cy="13" r="3" />
    </svg>
  )
}

export default ProductsPage
