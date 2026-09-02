import {
  ChevronDown,
  Plus,
  Search,
  Trash2,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { categoryApi } from '../../api/categoryApi'
import { productApi, type ProductPayload } from '../../api/productApi'
import { supplierApi } from '../../api/supplierApi'

import { Badge, stockTone } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import {
  Field,
  Input,
  Select,
  Textarea,
} from '../../components/ui/Field'

import { ConfirmDialog, Modal } from '../../components/ui/Modal'
import { Card, PageHeader } from '../../components/ui/Page'
import { Pagination } from '../../components/ui/Pagination'

import {
  EmptyState,
  ErrorState,
  Spinner,
} from '../../components/ui/States'

import { useToast } from '../../context/ToastContext'
import { useSettings } from '../../context/SettingsContext'
import { useAsync } from '../../hooks/useAsync'

import type { Product } from '../../types'

import { getErrorMessage } from '../../utils/errors'
import { formatMoney } from '../../utils/format'

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

export function ProductsPage() {
  const { notify } = useToast()
  const { settings } = useSettings()
  const navigate = useNavigate()
  const location = useLocation()
  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [stock, setStock] = useState('')
  const [page, setPage] = useState(1)
  const [form, setForm] = useState<ProductPayload>(emptyForm())
  const [editing, setEditing] = useState<Product | null>(null)
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<Product | null>(null)
  const [deactivate, setDeactivate] = useState<Product | null>(null)
  const [busy, setBusy] = useState(false)
  const [isDraggingImage, setIsDraggingImage] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const categories = useAsync(() => categoryApi.list(), [])
  const suppliers = useAsync(() => supplierApi.list(), [])
  const { data, loading, error, reload } = useAsync(
    () =>
      productApi.list({
        search: search || undefined,
        categoryId: categoryId ? Number(categoryId) : undefined,
        stockStatus: stock || undefined,
        page,
        pageSize: 10,
      }),
    [search, categoryId, stock, page],
  )

  useEffect(() => {
    const path = location.pathname
    if (path === '/products/create') {
      const first = categories.data?.[0]
      setEditing(null)
      setForm({ ...emptyForm(), categoryId: first?.id ?? 0 })
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
    // categories.data is only used as a default for create
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, navigate, notify])

  function closeModals() {
    setOpen(false)
    setView(null)
    if (location.pathname !== '/products') navigate('/products')
  }

  function openCreate() {
    navigate('/products/create')
  }

  function openEditForm(product: Product) {
    setEditing(product)
    setForm({
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
    })
    setOpen(true)
    setView(null)
  }

  function openEdit(product: Product) {
    navigate(`/products/edit/${product.id}`)
  }

  async function save() {
    setBusy(true)
    try {
      const payload = {
        ...form,
        supplierId: form.supplierId || null,
        imageUrl: form.imageUrl || undefined,
      }
      if (editing) await productApi.update(editing.id, payload)
      else await productApi.create(payload)
      notify(editing ? 'Product updated.' : 'Product added.')
      closeModals()
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
      await productApi.deactivate(deactivate.id)
      notify('Product deactivated.')
      setDeactivate(null)
      await reload()
    } catch (err) {
      notify(getErrorMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  function resetFilters() {
    setSearch('')
    setCategoryId('')
    setStock('')
    setPage(1)
  }

  function readImageFile(file: File) {
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      setForm((current) => ({ ...current, imageUrl: result }))
    }
    reader.readAsDataURL(file)
  }

  function handleImageUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (file) readImageFile(file)
    event.target.value = ''
  }

  const stats = [
    {
      label: 'Total products',
      value: String(data?.totalCount ?? 0),
      accent: 'slate',
    },
    {
      label: 'In stock',
      value: String(
        data?.items.filter((item) => item.stockStatus === 'In Stock').length ?? 0,
      ),
      accent: 'emerald',
    },
    {
      label: 'Low stock',
      value: String(
        data?.items.filter((item) => item.stockStatus === 'Low Stock').length ?? 0,
      ),
      accent: 'amber',
    },
    {
      label: 'Out of stock',
      value: String(
        data?.items.filter((item) => item.stockStatus === 'Out of Stock').length ?? 0,
      ),
      accent: 'rose',
    },
  ]

  return (
    <div className="min-h-full bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-7xl px-4 pb-6 pt-4 sm:px-5 lg:px-6">
        <PageHeader
          title="Products"
          subtitle="Catalog, pricing, and stock status"
          actions={
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-700 shadow-sm shadow-slate-200/50 transition-all duration-150 hover:-translate-y-0.5 hover:border-slate-300 hover:bg-slate-50 active:translate-y-0"
            >
              <Plus size={16} />
              <span>Add product</span>
            </button>
          }
        />

        <section className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {stats.map((stat) => (
            <Card
              key={stat.label}
              className="overflow-hidden border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/50 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  {stat.label}
                </p>
                <span
                  className={`h-2.5 w-2.5 rounded-full ${
                    stat.accent === 'slate'
                      ? 'bg-slate-400'
                      : stat.accent === 'emerald'
                        ? 'bg-emerald-400'
                        : stat.accent === 'amber'
                          ? 'bg-amber-400'
                          : 'bg-rose-400'
                  } shadow-sm`}
                />
              </div>

              <p className="mt-4 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
                {stat.value}
              </p>

              <div className="mt-3 flex items-center gap-2 text-[11px] text-slate-500">
                <span
                  className={`rounded-full px-2 py-1 font-medium ${
                    stat.accent === 'slate'
                      ? 'bg-slate-100 text-slate-600'
                      : stat.accent === 'emerald'
                        ? 'bg-emerald-100 text-emerald-700'
                        : stat.accent === 'amber'
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-rose-100 text-rose-700'
                  }`}
                >
                  Live
                </span>
                <span>Updated now</span>
              </div>
            </Card>
          ))}
        </section>

        <Card className="mb-4 overflow-hidden border border-slate-200 bg-white shadow-sm shadow-slate-200/50">
          <div className="flex flex-col gap-3 p-3 sm:p-4 md:flex-row md:items-center">
            <div className="relative min-w-0 flex-1">
              <Search
                size={18}
                className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
              />

              <input
                autoFocus
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  setPage(1)
                }}
                placeholder="Search product or SKU..."
                className="h-12 w-full rounded-full border border-slate-200 bg-slate-50 pl-11 pr-4 text-sm text-slate-700 outline-none transition-all duration-150 placeholder:text-slate-400 focus:border-slate-900 focus:bg-white focus:ring-2 focus:ring-slate-200"
              />
            </div>

            <div className="relative w-full md:w-52">
              <label className="sr-only">Category</label>
              <Select
                value={categoryId}
                onChange={(e) => {
                  setCategoryId(e.target.value)
                  setPage(1)
                }}
                className="h-12 w-full appearance-none rounded-full border border-slate-900 bg-white pr-10 text-sm text-slate-700 shadow-sm shadow-slate-200/60 outline-none transition-all duration-150 focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
              >
                <option value="">All categories</option>
                {(categories.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
              <ChevronDown
                size={16}
                className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-slate-600"
              />
            </div>

            <div className="relative w-full md:w-48">
              <label className="sr-only">Stock status</label>
              <Select
                value={stock}
                onChange={(e) => {
                  setStock(e.target.value)
                  setPage(1)
                }}
                className="h-12 w-full appearance-none rounded-full border border-slate-900 bg-white pr-10 text-sm text-slate-700 shadow-sm shadow-slate-200/60 outline-none transition-all duration-150 focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
              >
                <option value="">All stock</option>
                <option value="In Stock">In stock</option>
                <option value="Low Stock">Low stock</option>
                <option value="Out of Stock">Out of stock</option>
              </Select>
              <ChevronDown
                size={16}
                className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-slate-600"
              />
            </div>

            {(search || categoryId || stock) && (
              <button
                type="button"
                onClick={resetFilters}
                className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-600 transition-all duration-150 hover:border-slate-300 hover:bg-slate-50"
              >
                Clear
              </button>
            )}
          </div>
        </Card>

        <main className="min-w-0">
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/50">
            <div className="flex flex-col gap-2 border-b border-slate-200 bg-slate-50/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Product records
                </p>
                <h2 className="mt-1 text-lg font-semibold text-slate-900">Product listing</h2>
              </div>

              {data && (
                <div className="inline-flex items-center rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-600 shadow-sm ring-1 ring-slate-200">
                  {data.items.length} shown
                </div>
              )}
            </div>

            <div className="p-2 sm:p-3">
              {loading && (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6">
                  <Spinner />
                </div>
              )}

              {error && (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <ErrorState
                    message={error}
                    onRetry={() => void reload()}
                  />
                </div>
              )}

              {!loading && !error && data && data.items.length === 0 && (
                <div className="rounded-2xl border border-slate-200 bg-slate-50">
                  <EmptyState
                    title="No products found"
                    hint="Adjust filters or add a product."
                  />
                </div>
              )}

              {!loading && !error && data && data.items.length > 0 && (
                <div className="overflow-hidden rounded-2xl border border-slate-200">
                  <div className="hidden min-h-10 grid-cols-[minmax(140px,2fr)_100px_120px_100px_110px_90px_100px] items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 xl:grid">
                    <div>Product</div>
                    <div>Category</div>
                    <div className="text-right">Price</div>
                    <div className="text-right">Cost</div>
                    <div>Status</div>
                    <div>Stock</div>
                    <div />
                  </div>

                  <div>
                    {data.items.map((product) => (
                      <ProductRow
                        key={product.id}
                        product={product}
                        settings={settings}
                        onEdit={() => openEdit(product)}
                        onView={() => navigate(`/products/${product.id}`)}
                        onDeactivate={() => setDeactivate(product)}
                      />
                    ))}
                  </div>

                  <div className="border-t border-slate-200 bg-slate-50/60 px-2 py-2 sm:px-3">
                    <Pagination
                      page={data.page}
                      totalPages={data.totalPages}
                      onPage={setPage}
                    />
                  </div>
                </div>
              )}
            </div>
          </section>
        </main>
      </div>

      {open && (
        <Modal
          title={editing ? 'Edit product' : 'Add product'}
          wide
          onClose={closeModals}
          footer={
            <div className="flex gap-2">
              <Button variant="secondary" onClick={closeModals}>
                Cancel
              </Button>

              <Button
                onClick={() => void save()}
                disabled={busy || !form.name.trim() || !form.sku.trim() || !form.categoryId}
              >
                {busy ? 'Saving…' : 'Save'}
              </Button>
            </div>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="SKU">
              <Input
                value={form.sku}
                onChange={(e) => setForm({ ...form, sku: e.target.value })}
              />
            </Field>

            <Field label="Name">
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>

            <Field label="Category">
              <Select
                value={form.categoryId || ''}
                onChange={(e) => setForm({ ...form, categoryId: Number(e.target.value) })}
              >
                <option value="">Select category</option>
                {(categories.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Supplier">
              <Select
                value={form.supplierId ?? ''}
                onChange={(e) =>
                  setForm({
                    ...form,
                    supplierId: e.target.value ? Number(e.target.value) : null,
                  })
                }
              >
                <option value="">None</option>
                {(suppliers.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.companyName}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Cost price">
              <Input
                type="number"
                min={0}
                step="0.01"
                value={form.costPrice}
                onChange={(e) => setForm({ ...form, costPrice: Number(e.target.value) })}
              />
            </Field>

            <Field label="Selling price">
              <Input
                type="number"
                min={0}
                step="0.01"
                value={form.sellingPrice}
                onChange={(e) => setForm({ ...form, sellingPrice: Number(e.target.value) })}
              />
            </Field>

            {!editing && (
              <Field label="Initial stock">
                <Input
                  type="number"
                  min={0}
                  value={form.stockQuantity}
                  onChange={(e) => setForm({ ...form, stockQuantity: Number(e.target.value) })}
                />
              </Field>
            )}

            <Field label="Reorder level">
              <Input
                type="number"
                min={0}
                value={form.reorderLevel}
                onChange={(e) => setForm({ ...form, reorderLevel: Number(e.target.value) })}
              />
            </Field>

            <div className="sm:col-span-2">
              <Field label="Description">
                <Textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </Field>
            </div>

            <div className="sm:col-span-2 space-y-3">
              <Field label="Product image">
                <div className="space-y-3">
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => fileInputRef.current?.click()}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        fileInputRef.current?.click()
                      }
                    }}
                    onDragOver={(event) => {
                      event.preventDefault()
                      setIsDraggingImage(true)
                    }}
                    onDragLeave={() => setIsDraggingImage(false)}
                    onDrop={(event) => {
                      event.preventDefault()
                      setIsDraggingImage(false)
                      const file = event.dataTransfer.files?.[0]
                      if (file) readImageFile(file)
                    }}
                    className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed p-4 text-center transition-colors ${
                      isDraggingImage
                        ? 'border-slate-400 bg-slate-100'
                        : 'border-slate-300 bg-slate-50 hover:border-slate-400 hover:bg-slate-100'
                    }`}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleImageUpload}
                    />

                    {form.imageUrl ? (
                      <img
                        src={form.imageUrl}
                        alt="Product preview"
                        className="h-28 w-full rounded-lg object-cover"
                      />
                    ) : (
                      <div className="flex flex-col items-center gap-2 text-slate-500">
                        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-xl text-slate-400 shadow-sm ring-1 ring-slate-200">
                          ⤴
                        </div>
                        <div>
                          <p className="text-sm font-medium text-slate-700">Upload image</p>
                          <p className="text-xs">Drag and drop or tap to browse</p>
                        </div>
                      </div>
                    )}
                  </div>

                  <Input
                    placeholder="Or paste image URL"
                    value={form.imageUrl}
                    onChange={(e) => setForm({ ...form, imageUrl: e.target.value })}
                  />
                </div>
              </Field>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              />
              Active
            </label>
          </div>
        </Modal>
      )}

      {view && (
        <Modal title="Product details" onClose={closeModals}>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-slate-500">SKU</dt>
              <dd className="mt-1 font-medium">{view.sku}</dd>
            </div>

            <div>
              <dt className="text-slate-500">Name</dt>
              <dd className="mt-1 font-medium">{view.name}</dd>
            </div>

            <div>
              <dt className="text-slate-500">Category</dt>
              <dd className="mt-1 font-medium">{view.categoryName}</dd>
            </div>

            <div>
              <dt className="text-slate-500">Supplier</dt>
              <dd className="mt-1 font-medium">{view.supplierName ?? '—'}</dd>
            </div>

            <div>
              <dt className="text-slate-500">Cost</dt>
              <dd className="mt-1 font-medium">
                {formatMoney(view.costPrice, settings.currencySymbol)}
              </dd>
            </div>

            <div>
              <dt className="text-slate-500">Price</dt>
              <dd className="mt-1 font-medium">
                {formatMoney(view.sellingPrice, settings.currencySymbol)}
              </dd>
            </div>

            <div>
              <dt className="text-slate-500">Stock</dt>
              <dd className="mt-1 font-medium">
                {view.stockQuantity} ({view.stockStatus})
              </dd>
            </div>

            <div>
              <dt className="text-slate-500">Reorder level</dt>
              <dd className="mt-1 font-medium">{view.reorderLevel}</dd>
            </div>

            <div className="col-span-2">
              <dt className="text-slate-500">Description</dt>
              <dd className="mt-1 font-medium">{view.description ?? '—'}</dd>
            </div>
          </dl>
        </Modal>
      )}

      {deactivate && (
        <ConfirmDialog
          title="Deactivate product"
          message={`Deactivate ${deactivate.name}? It will no longer appear in the POS catalog.`}
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

function ProductRow({
  product,
  settings,
  onEdit,
  onView,
  onDeactivate,
}: {
  product: Product
  settings: any
  onEdit: () => void
  onView: () => void
  onDeactivate: () => void
}) {
  return (
    <div className="border-b border-slate-200 last:border-b-0 transition-colors duration-150 hover:bg-slate-50/80">
      <div className="hidden min-h-12 grid-cols-[minmax(140px,2fr)_100px_120px_100px_110px_90px_100px] items-center gap-2 px-3 xl:grid">
        <div className="flex min-w-0 items-center gap-3">
          <div className="h-10 w-10 overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
            {product.imageUrl ? (
              <img src={product.imageUrl} alt={product.name} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xs font-semibold text-slate-400">
                {product.name.slice(0, 1).toUpperCase()}
              </div>
            )}
          </div>

          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">{product.name}</p>
            <p className="truncate font-mono text-xs text-slate-500">{product.sku}</p>
          </div>
        </div>

        <div className="text-sm text-slate-600">{product.categoryName}</div>

        <div className="text-right text-sm font-semibold text-slate-900">
          {formatMoney(product.sellingPrice, settings.currencySymbol)}
        </div>

        <div className="text-right text-sm text-slate-600">
          {formatMoney(product.costPrice, settings.currencySymbol)}
        </div>

        <div>
          <Badge tone={product.isActive ? 'green' : 'gray'}>
            {product.isActive ? 'Active' : 'Inactive'}
          </Badge>
        </div>

        <div>
          <Badge tone={stockTone(product.stockStatus)}>{product.stockQuantity}</Badge>
        </div>

        <div className="flex justify-end gap-1">
          <ActionButton
            label="View"
            onClick={onView}
            variant="info"
          />
          <ActionButton
            label="Edit"
            onClick={onEdit}
            variant="primary"
          />
          {product.isActive && (
            <ActionButton
              label=""
              onClick={onDeactivate}
              variant="danger"
              icon={<Trash2 size={16} />}
            />
          )}
        </div>
      </div>

      <div className="flex min-h-14 items-center gap-3 px-3 py-2 xl:hidden">
        <div className="h-10 w-10 overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
          {product.imageUrl ? (
            <img src={product.imageUrl} alt={product.name} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs font-semibold text-slate-400">
              {product.name.slice(0, 1).toUpperCase()}
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900">{product.name}</p>
              <p className="truncate font-mono text-xs text-slate-500">{product.sku}</p>
            </div>

            <Badge tone={product.isActive ? 'green' : 'gray'}>
              {product.isActive ? 'Active' : 'Inactive'}
            </Badge>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-600">
            <span>{product.categoryName}</span>
            <span className="font-semibold text-slate-900">
              {formatMoney(product.sellingPrice, settings.currencySymbol)}
            </span>
            <Badge tone={stockTone(product.stockStatus)}>{product.stockQuantity}</Badge>
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-1">
          <ActionButton
            label="View"
            onClick={onView}
            variant="info"
            compact
          />
          <ActionButton
            label="Edit"
            onClick={onEdit}
            variant="primary"
            compact
          />
          {product.isActive && (
            <ActionButton
              label=""
              onClick={onDeactivate}
              variant="danger"
              icon={<Trash2 size={16} />}
              compact
            />
          )}
        </div>
      </div>
    </div>
  )
}

function ActionButton({
  label,
  onClick,
  variant,
  icon,
  compact,
}: {
  label: string
  onClick: () => void
  variant: 'info' | 'primary' | 'danger'
  icon?: React.ReactNode
  compact?: boolean
}) {
  const buttonVariant = variant === 'danger' ? 'danger' : 'secondary'

  return (
    <Button
      variant={buttonVariant}
      onClick={onClick}
      className={compact ? 'min-h-8 px-2 py-1 text-xs' : 'px-2.5 py-2 text-xs sm:px-3 sm:py-2.5 sm:text-sm'}
    >
      {icon || label}
      {icon && label && <span>{label}</span>}
    </Button>
  )
}
