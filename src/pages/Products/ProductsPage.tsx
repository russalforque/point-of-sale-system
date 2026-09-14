import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  ChevronDown,
  Eye,
  Pencil,
  Plus,
  Search,
  Trash2,
} from '../../components/ui/Icons'

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
import { FormSection } from '../../components/ui/FormSection'

import { ConfirmDialog, Modal } from '../../components/ui/Modal'
import { PageHeader } from '../../components/ui/Page'
import { Pagination } from '../../components/ui/Pagination'

import {
  EmptyState,
  ErrorState,
  Spinner,
} from '../../components/ui/States'

import { useAuth } from '../../context/AuthContext'
import { useSettings } from '../../context/SettingsContext'
import { useToast } from '../../context/ToastContext'
import { useAsync } from '../../hooks/useAsync'
import { useIsMobile } from '../../hooks/useIsMobile'

import type { Product } from '../../types'
import { getErrorMessage } from '../../utils/errors'
import { formatMoney } from '../../utils/format'
import { MobileProducts } from '../mobile/MobileProducts'

type StockFilter = '' | 'In Stock' | 'Low Stock' | 'Out of Stock'

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
  const navigate = useNavigate()
  const location = useLocation()

  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [stock, setStock] = useState<StockFilter>('')
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
        search: search.trim() || undefined,
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
      if (!canManage) {
        navigate('/products', { replace: true })
        return
      }
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

  function handleFilterStock(status: StockFilter) {
    setStock((prev) => (prev === status ? '' : status))
    setPage(1)
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

  const hasFilters = Boolean(search.trim() || categoryId || stock)

  const totalProducts = data?.totalCount ?? 0
  const inStockProducts =
    data?.items.filter((item) => item.stockStatus === 'In Stock').length ?? 0
  const lowStockProducts =
    data?.items.filter((item) => item.stockStatus === 'Low Stock').length ?? 0
  const outOfStockProducts =
    data?.items.filter((item) => item.stockStatus === 'Out of Stock').length ?? 0

  // Real-time margin calculation for add/edit modal
  const profitMargin = useMemo(() => {
    if (form.sellingPrice <= 0) return 0
    const profit = form.sellingPrice - form.costPrice
    return Math.round((profit / form.sellingPrice) * 100)
  }, [form.sellingPrice, form.costPrice])

  return (
    <div className="min-h-screen bg-[#F6F8F7] text-[#091413] pb-24 antialiased selection:bg-[#285A48] selection:text-white">
      <div className="mx-auto max-w-7xl px-3.5 pt-4 sm:px-6 sm:pt-6 md:px-8">
        
        {/* =========================================================
            PAGE HEADER & PRIMARY ACTION
        ========================================================= */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between pb-2">
          <PageHeader
            title="Products"
            subtitle="Catalog inventory, pricing, and stock status"
          />
          {canManage && (
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 self-start rounded-2xl bg-[#285A48] px-4 py-2.5 text-xs font-bold text-white shadow-md shadow-[#285A48]/20 transition-all hover:bg-[#1f4739] active:scale-95 touch-manipulation sm:self-auto"
            >
              <Plus size={16} />
              <span>Add Product</span>
            </button>
          )}
        </div>

        {/* =========================================================
            INTERACTIVE KPI CARDS (Click to Quick-Filter)
        ========================================================= */}
        <div className="mt-2 grid grid-cols-2 gap-2.5 sm:gap-3 md:grid-cols-4">
          <MetricCard
            label="Total Products"
            value={totalProducts}
            isSelected={stock === ''}
            onClick={() => handleFilterStock('')}
          />
          <MetricCard
            label="In Stock"
            value={inStockProducts}
            indicator="emerald"
            isSelected={stock === 'In Stock'}
            onClick={() => handleFilterStock('In Stock')}
          />
          <MetricCard
            label="Low Stock"
            value={lowStockProducts}
            indicator="amber"
            isSelected={stock === 'Low Stock'}
            onClick={() => handleFilterStock('Low Stock')}
          />
          <MetricCard
            label="Out of Stock"
            value={outOfStockProducts}
            indicator="rose"
            isSelected={stock === 'Out of Stock'}
            onClick={() => handleFilterStock('Out of Stock')}
          />
        </div>

        {/* =========================================================
            FILTER TOOLBAR (Pills, Category Select & Search)
        ========================================================= */}
        <div className="mt-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          {/* Segmented Stock Status Pills */}
          <div className="flex flex-wrap items-center gap-1 rounded-2xl border border-[#E5EBE7] bg-white p-1 self-start shadow-2xs">
            <button
              type="button"
              onClick={() => handleFilterStock('')}
              className={`rounded-xl px-3.5 py-1.5 text-xs font-bold transition-all active:scale-95 touch-manipulation ${
                stock === ''
                  ? 'bg-[#285A48] text-white shadow-xs'
                  : 'text-slate-500 hover:text-[#091413]'
              }`}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => handleFilterStock('In Stock')}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-bold transition-all active:scale-95 touch-manipulation ${
                stock === 'In Stock'
                  ? 'bg-[#285A48] text-white shadow-xs'
                  : 'text-slate-500 hover:text-[#091413]'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${stock === 'In Stock' ? 'bg-emerald-300' : 'bg-emerald-500'}`} />
              In Stock
            </button>
            <button
              type="button"
              onClick={() => handleFilterStock('Low Stock')}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-bold transition-all active:scale-95 touch-manipulation ${
                stock === 'Low Stock'
                  ? 'bg-[#285A48] text-white shadow-xs'
                  : 'text-slate-500 hover:text-[#091413]'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${stock === 'Low Stock' ? 'bg-amber-300' : 'bg-amber-500'}`} />
              Low Stock
            </button>
            <button
              type="button"
              onClick={() => handleFilterStock('Out of Stock')}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-bold transition-all active:scale-95 touch-manipulation ${
                stock === 'Out of Stock'
                  ? 'bg-[#285A48] text-white shadow-xs'
                  : 'text-slate-500 hover:text-[#091413]'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${stock === 'Out of Stock' ? 'bg-rose-300' : 'bg-rose-500'}`} />
              Depleted
            </button>
          </div>

          {/* Category Dropdown, Search Input & Reset */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 flex-1 lg:max-w-xl lg:justify-end">
            {/* Category Select */}
            <div className="relative w-full sm:w-48 shrink-0">
              <label className="sr-only">Filter by Category</label>
              <select
                value={categoryId}
                onChange={(e) => {
                  setCategoryId(e.target.value)
                  setPage(1)
                }}
                className="h-11 w-full appearance-none rounded-2xl border border-[#E5EBE7] bg-white px-3.5 pr-9 text-xs font-semibold text-[#091413] outline-none transition focus:border-[#285A48] focus:ring-2 focus:ring-[#285A48]/15"
              >
                <option value="">All Categories</option>
                {(categories.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
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
                onChange={(e) => {
                  setSearch(e.target.value)
                  setPage(1)
                }}
                placeholder="Search product or SKU..."
                className="h-11 w-full rounded-2xl border border-[#E5EBE7] bg-white pl-10 pr-9 text-xs font-semibold text-[#091413] placeholder-slate-400 outline-none transition focus:border-[#285A48] focus:ring-2 focus:ring-[#285A48]/15"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => {
                    setSearch('')
                    setPage(1)
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1 text-slate-400 hover:text-slate-700"
                  title="Clear search"
                >
                  <ClearIcon size={14} />
                </button>
              )}
            </div>

            {hasFilters && (
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

        {/* =========================================================
            CATALOG TABLE / MOBILE CARD CONTAINER
        ========================================================= */}
        <main className="mt-4 overflow-hidden rounded-3xl border border-[#E5EBE7] bg-white shadow-sm">
          {loading && (
            <div className="py-20 flex flex-col items-center justify-center text-center">
              <Spinner />
              <p className="mt-3 text-xs font-semibold text-slate-400">
                Fetching catalog items...
              </p>
            </div>
          )}

          {error && (
            <div className="p-6">
              <ErrorState message={error} onRetry={() => void reload()} />
            </div>
          )}

          {!loading && !error && data && data.items.length === 0 && (
            <div className="p-10 text-center">
              <EmptyState
                title="No products found"
                hint={
                  hasFilters
                    ? 'Try clearing active filters or searching a different term.'
                    : 'Get started by adding your first product to the catalog.'
                }
              />
              {hasFilters && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-[#285A48] underline hover:text-[#1a3b2f]"
                >
                  Clear all filters
                </button>
              )}
            </div>
          )}

          {!loading && !error && data && data.items.length > 0 && (
            <>
              {/* ---------------------------------------------------
                  DESKTOP FLUID TABLE VIEW (md and up)
              ---------------------------------------------------- */}
              <div className="hidden md:block w-full overflow-x-auto">
                <table className="w-full text-left text-xs text-slate-600">
                  <thead className="border-b border-[#E5EBE7] bg-[#FBFDFB] text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    <tr>
                      <th className="py-3.5 pl-6 pr-3">Product</th>
                      <th className="py-3.5 px-3">Category</th>
                      <th className="py-3.5 px-3 text-right">Selling Price</th>
                      <th className="hidden py-3.5 px-3 text-right lg:table-cell">
                        Cost
                      </th>
                      <th className="py-3.5 px-3 text-center">Stock</th>
                      <th className="hidden py-3.5 px-3 text-center xl:table-cell">
                        Status
                      </th>
                      <th className="py-3.5 pl-3 pr-6 text-right">Actions</th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-slate-100">
                    {data.items.map((product) => (
                      <tr
                        key={product.id}
                        className="transition-colors hover:bg-[#F9FAF9]"
                      >
                        <td className="py-3.5 pl-6 pr-3">
                          <ProductIdentity product={product} />
                        </td>

                        <td className="py-3.5 px-3">
                          <span className="inline-flex rounded-xl bg-[#F6F8F7] px-2.5 py-1 text-[11px] font-semibold text-slate-600 border border-[#E5EBE7]">
                            {product.categoryName}
                          </span>
                        </td>

                        <td className="py-3.5 px-3 text-right font-black text-xs text-[#091413]">
                          {formatMoney(product.sellingPrice, settings.currencySymbol)}
                        </td>

                        <td className="hidden py-3.5 px-3 text-right text-xs font-semibold text-slate-400 lg:table-cell">
                          {formatMoney(product.costPrice, settings.currencySymbol)}
                        </td>

                        <td className="py-3.5 px-3 text-center">
                          <Badge tone={stockTone(product.stockStatus)}>
                            {product.stockQuantity}
                          </Badge>
                        </td>

                        <td className="hidden py-3.5 px-3 text-center xl:table-cell">
                          <span
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                              product.isActive
                                ? 'bg-[#EAF1EE] text-[#285A48]'
                                : 'bg-slate-100 text-slate-500'
                            }`}
                          >
                            {product.isActive ? 'Active' : 'Inactive'}
                          </span>
                        </td>

                        <td className="py-3.5 pl-3 pr-6 text-right">
                          <RowActions
                            onView={() => navigate(`/products/${product.id}`)}
                            onEdit={() => openEdit(product)}
                            onDeactivate={() => setDeactivate(product)}
                            showEdit={canManage}
                            showDeactivate={canDelete && product.isActive}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* ---------------------------------------------------
                  MOBILE TOUCH-CARD VIEW (< md)
              ---------------------------------------------------- */}
              <div className="divide-y divide-slate-100 md:hidden">
                {data.items.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    currencySymbol={settings.currencySymbol}
                    onEdit={() => openEdit(product)}
                    onView={() => navigate(`/products/${product.id}`)}
                    onDeactivate={() => setDeactivate(product)}
                    canManage={canManage}
                    canDelete={canDelete}
                  />
                ))}
              </div>

              {/* Pagination Bar */}
              <div className="border-t border-[#E5EBE7] bg-[#FBFDFB] px-4 py-3 sm:px-6">
                <Pagination
                  page={data.page}
                  totalPages={data.totalPages}
                  onPage={setPage}
                />
              </div>
            </>
          )}
        </main>
      </div>

      {/* =====================================================
          ADD / EDIT PRODUCT MODAL
      ====================================================== */}
      {open && (
        <Modal
          title={editing ? 'Edit Product' : 'Add New Product'}
          wide
          onClose={closeModals}
          preventClose={busy}
          footer={
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end w-full">
              <Button variant="secondary" onClick={closeModals}>
                Cancel
              </Button>
              <Button
                onClick={() => void save()}
                disabled={
                  busy ||
                  !form.name.trim() ||
                  !form.sku.trim() ||
                  !form.categoryId
                }
              >
                {busy ? 'Saving…' : editing ? 'Save Changes' : 'Create Product'}
              </Button>
            </div>
          }
        >
          <div className="space-y-5 text-xs">
            <FormSection title="Basic Information">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Product Name" required>
                  <Input
                    value={form.name}
                    placeholder="e.g. Matcha Latte"
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    required
                  />
                </Field>

                <Field label="SKU / Barcode" required>
                  <Input
                    value={form.sku}
                    placeholder="e.g. BEV-001"
                    onChange={(e) => setForm({ ...form, sku: e.target.value })}
                    required
                  />
                </Field>

                <Field label="Category" required>
                  <Select
                    value={form.categoryId || ''}
                    onChange={(e) =>
                      setForm({ ...form, categoryId: Number(e.target.value) })
                    }
                    required
                  >
                    <option value="">Select Category</option>
                    {(categories.data ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field label="Supplier" hint="Optional">
                  <Select
                    value={form.supplierId ?? ''}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        supplierId: e.target.value ? Number(e.target.value) : null,
                      })
                    }
                  >
                    <option value="">None / Internal</option>
                    {(suppliers.data ?? []).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.companyName}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>

              <Field label="Product Description">
                <Textarea
                  value={form.description}
                  placeholder="Ingredients, sizing, notes, etc."
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                />
              </Field>

              {/* Media Uploader Box */}
              <div className="space-y-2">
                <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider">
                  Product Image
                </label>

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
                  className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-4 text-center transition-all ${
                    isDraggingImage
                      ? 'border-[#285A48] bg-[#EAF1EE]'
                      : 'border-[#E5EBE7] bg-[#F6F8F7] hover:border-[#285A48]/50 hover:bg-[#EAF1EE]/50'
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
                    <div className="relative group">
                      <img
                        src={form.imageUrl}
                        alt="Product preview"
                        className="h-32 w-32 rounded-2xl object-cover border border-[#E5EBE7] shadow-sm"
                      />
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setForm((prev) => ({ ...prev, imageUrl: '' }))
                        }}
                        className="absolute -top-2 -right-2 rounded-full bg-rose-600 p-1 text-white shadow hover:bg-rose-700"
                        title="Remove image"
                      >
                        <ClearIcon size={12} />
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-slate-500 py-2">
                      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-[#285A48] shadow-2xs border border-[#E5EBE7]">
                        ↑
                      </div>
                      <div>
                        <p className="text-xs font-bold text-[#091413]">
                          Upload Product Photo
                        </p>
                        <p className="text-[11px] text-slate-400">
                          Drag and drop or browse from device
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                <Input
                  placeholder="Or paste an image web URL"
                  value={form.imageUrl}
                  onChange={(e) =>
                    setForm({ ...form, imageUrl: e.target.value })
                  }
                />
              </div>
            </FormSection>

            <FormSection title="Pricing">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Cost Price">
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={form.costPrice}
                    onChange={(e) =>
                      setForm({ ...form, costPrice: Number(e.target.value) })
                    }
                  />
                </Field>

                <div>
                  <Field label="Selling Price">
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={form.sellingPrice}
                      onChange={(e) =>
                        setForm({ ...form, sellingPrice: Number(e.target.value) })
                      }
                    />
                  </Field>

                  {/* Real-time Margin Preview */}
                  {form.sellingPrice > 0 && (
                    <div className="mt-1 flex items-center justify-between text-[11px]">
                      <span className="text-slate-400 font-medium">Gross Margin:</span>
                      <span
                        className={`font-black ${
                          profitMargin >= 40
                            ? 'text-[#285A48]'
                            : profitMargin > 0
                            ? 'text-amber-600'
                            : 'text-rose-600'
                        }`}
                      >
                        {profitMargin}% ({formatMoney(form.sellingPrice - form.costPrice, settings.currencySymbol)} profit)
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </FormSection>

            <FormSection title="Inventory">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {!editing && (
                  <Field label="Initial Stock Quantity">
                    <Input
                      type="number"
                      min={0}
                      value={form.stockQuantity}
                      onChange={(e) =>
                        setForm({ ...form, stockQuantity: Number(e.target.value) })
                      }
                    />
                  </Field>
                )}

                <Field label="Reorder Level (Par Threshold)">
                  <Input
                    type="number"
                    min={0}
                    value={form.reorderLevel}
                    onChange={(e) =>
                      setForm({ ...form, reorderLevel: Number(e.target.value) })
                    }
                  />
                </Field>
              </div>
            </FormSection>

            <FormSection title="Status">
              <label className="flex items-center gap-2.5 text-xs font-bold text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) =>
                    setForm({ ...form, isActive: e.target.checked })
                  }
                  className="h-4 w-4 rounded-md border-[#E5EBE7] text-[#285A48] focus:ring-[#285A48]"
                />
                Active in POS register catalog
              </label>
            </FormSection>
          </div>
        </Modal>
      )}

      {/* =====================================================
          PRODUCT DETAIL MODAL
      ====================================================== */}
      {view && (
        <Modal title="Product Overview" onClose={closeModals}>
          <div className="text-xs space-y-4">
            {/* Identity Card */}
            <div className="flex items-center gap-3.5 rounded-2xl bg-[#F6F8F7] p-3.5 border border-[#E5EBE7]">
              <div className="h-14 w-14 shrink-0 overflow-hidden rounded-2xl border border-[#E5EBE7] bg-white">
                {view.imageUrl ? (
                  <img src={view.imageUrl} alt={view.name} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-sm font-black text-[#285A48] bg-[#EAF1EE]">
                    {view.name.slice(0, 2).toUpperCase()}
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="font-extrabold text-sm text-[#091413] truncate">{view.name}</h3>
                <p className="text-[11px] font-semibold text-slate-400">{view.sku}</p>
                <span className="inline-block mt-1 rounded-md bg-white px-2 py-0.5 text-[10px] font-bold text-slate-600 border border-[#E5EBE7]">
                  {view.categoryName}
                </span>
              </div>
            </div>

            {/* Spec Ledger */}
            <div className="divide-y divide-slate-100 rounded-2xl border border-[#E5EBE7] bg-white px-4">
              <DetailRow label="Selling Price" value={<span className="font-black text-[#091413] text-sm">{formatMoney(view.sellingPrice, settings.currencySymbol)}</span>} />
              <DetailRow label="Cost Price" value={formatMoney(view.costPrice, settings.currencySymbol)} />
              <DetailRow
                label="Stock Level"
                value={
                  <span className="font-black text-[#285A48]">
                    {view.stockQuantity} units ({view.stockStatus})
                  </span>
                }
              />
              <DetailRow label="Reorder Threshold" value={`${view.reorderLevel} units`} />
              <DetailRow label="Supplier" value={view.supplierName ?? 'Internal / None'} />
              <DetailRow label="Description" value={view.description || 'No description provided.'} />
            </div>
          </div>
        </Modal>
      )}

      {/* =====================================================
          DEACTIVATE DIALOG
      ====================================================== */}
      {deactivate && (
        <ConfirmDialog
          title="Deactivate Product"
          message={`Deactivate "${deactivate.name}"? It will no longer appear in the cashier's active terminal catalog.`}
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

/* =============================================================
   REFINED MICRO-COMPONENTS
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
  indicator?: 'emerald' | 'amber' | 'rose'
  isSelected?: boolean
  onClick: () => void
}) {
  const dotColor =
    indicator === 'emerald'
      ? 'bg-emerald-500'
      : indicator === 'amber'
      ? 'bg-amber-500'
      : indicator === 'rose'
      ? 'bg-rose-500'
      : null

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

function ProductIdentity({ product }: { product: Product }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className="h-10 w-10 shrink-0 overflow-hidden rounded-2xl border border-[#E5EBE7] bg-[#F6F8F7]">
        {product.imageUrl ? (
          <img
            src={product.imageUrl}
            alt={product.name}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs font-black text-[#285A48] bg-[#EAF1EE]">
            {product.name.slice(0, 2).toUpperCase()}
          </div>
        )}
      </div>

      <div className="min-w-0">
        <p className="truncate text-xs font-bold text-[#091413]">
          {product.name}
        </p>
        <p className="truncate font-mono text-[11px] text-slate-400">
          {product.sku}
        </p>
      </div>
    </div>
  )
}

function RowActions({
  onView,
  onEdit,
  onDeactivate,
  showEdit,
  showDeactivate,
}: {
  onView: () => void
  onEdit: () => void
  onDeactivate: () => void
  showEdit: boolean
  showDeactivate: boolean
}) {
  return (
    <div className="flex items-center justify-end gap-1">
      <button
        type="button"
        title="View details"
        aria-label="View details"
        onClick={onView}
        className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 transition-all hover:bg-[#EAF1EE] hover:text-[#285A48] active:scale-95 touch-manipulation"
      >
        <Eye size={15} />
      </button>

      {showEdit && (
        <button
          type="button"
          title="Edit product"
          aria-label="Edit product"
          onClick={onEdit}
          className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 transition-all hover:bg-[#EAF1EE] hover:text-[#285A48] active:scale-95 touch-manipulation"
        >
          <Pencil size={15} />
        </button>
      )}

      {showDeactivate && (
        <button
          type="button"
          title="Deactivate product"
          aria-label="Deactivate product"
          onClick={onDeactivate}
          className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 transition-all hover:bg-rose-50 hover:text-rose-600 active:scale-95 touch-manipulation"
        >
          <Trash2 size={15} />
        </button>
      )}
    </div>
  )
}

function ProductCard({
  product,
  currencySymbol,
  onEdit,
  onView,
  onDeactivate,
  canManage,
  canDelete,
}: {
  product: Product
  currencySymbol: string
  onEdit: () => void
  onView: () => void
  onDeactivate: () => void
  canManage: boolean
  canDelete: boolean
}) {
  return (
    <div className="p-4 hover:bg-[#FBFDFB] transition-colors">
      <div className="flex items-start gap-3">
        {/* Photo */}
        <div className="h-12 w-12 shrink-0 overflow-hidden rounded-2xl border border-[#E5EBE7] bg-[#F6F8F7]">
          {product.imageUrl ? (
            <img src={product.imageUrl} alt={product.name} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs font-black text-[#285A48] bg-[#EAF1EE]">
              {product.name.slice(0, 2).toUpperCase()}
            </div>
          )}
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-bold text-xs text-[#091413] truncate">{product.name}</p>
              <p className="text-[10px] text-slate-400">{product.sku}</p>
            </div>
            <span className="font-black text-xs text-[#091413]">
              {formatMoney(product.sellingPrice, currencySymbol)}
            </span>
          </div>

          <div className="mt-2 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="rounded-lg bg-[#F6F8F7] px-2 py-0.5 text-[10px] font-semibold text-slate-600 border border-[#E5EBE7]">
                {product.categoryName}
              </span>
              <Badge tone={stockTone(product.stockStatus)}>
                {product.stockQuantity} in stock
              </Badge>
            </div>

            <RowActions
              onView={onView}
              onEdit={onEdit}
              onDeactivate={onDeactivate}
              showEdit={canManage}
              showDeactivate={canDelete && product.isActive}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

function DetailRow({
  label,
  value,
  mono = false,
}: {
  label: string
  value: React.ReactNode
  mono?: boolean
}) {
  return (
    <div className="flex justify-between py-2.5">
      <span className="text-slate-400 font-medium">{label}</span>
      <span className={`text-[#091413] text-right ${mono ? 'font-mono' : 'font-bold'}`}>
        {value}
      </span>
    </div>
  )
}

function ClearIcon({ size = 14 }: { size?: number }) {
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

export default ProductsPage