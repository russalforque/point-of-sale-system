import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Eye,
  Package,
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
import { Field, Input, Select, Textarea } from '../../components/ui/Field'
import { FormSection } from '../../components/ui/FormSection'
import { ConfirmDialog, Modal } from '../../components/ui/Modal'
import { Pagination } from '../../components/ui/Pagination'
import { MobileEmpty, MobileError, MobileLoading, StickyToolbar } from '../../components/ui/MobileStates'

import { useAuth } from '../../context/AuthContext'
import { useSettings } from '../../context/SettingsContext'
import { useToast } from '../../context/ToastContext'
import { useAsync } from '../../hooks/useAsync'

import type { Product } from '../../types'
import { getErrorMessage } from '../../utils/errors'
import { formatMoney } from '../../utils/format'

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

export function MobileProducts() {
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

  function handleImageUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = () => {
        const result = typeof reader.result === 'string' ? reader.result : ''
        setForm((current) => ({ ...current, imageUrl: result }))
      }
      reader.readAsDataURL(file)
    }
    event.target.value = ''
  }

  const hasFilters = Boolean(search.trim() || categoryId || stock)

  const totalProducts = data?.totalCount ?? 0
  const inStockProducts = data?.items.filter((p) => p.stockStatus === 'In Stock').length ?? 0
  const lowStockProducts = data?.items.filter((p) => p.stockStatus === 'Low Stock').length ?? 0
  const outOfStockProducts = data?.items.filter((p) => p.stockStatus === 'Out of Stock').length ?? 0

  const profitMargin = useMemo(() => {
    if (form.sellingPrice <= 0) return 0
    return Math.round(((form.sellingPrice - form.costPrice) / form.sellingPrice) * 100)
  }, [form.sellingPrice, form.costPrice])

  return (
    <div className="min-h-screen bg-[#F6F8F7] pb-28 pt-[max(0.75rem,env(safe-area-inset-top,0px))] text-[#091413] antialiased">
      <main className="mx-auto w-full max-w-2xl px-4 sm:px-6">
        {/* Header */}
        <header className="flex items-center justify-between gap-3 pb-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-black tracking-tight text-[#091413]">Products</h1>
            <p className="mt-0.5 text-xs text-slate-500">Catalog, pricing &amp; stock</p>
          </div>
          {canManage && (
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-2xl bg-[#285A48] px-4 text-sm font-bold text-white shadow-md shadow-[#285A48]/20 active:scale-95 touch-manipulation"
            >
              <Plus size={18} />
              <span>Add</span>
            </button>
          )}
        </header>

        {/* KPI row */}
        <section aria-label="Stock metrics" className="grid grid-cols-4 gap-2">
          <MetricTile label="Total" value={totalProducts} active={stock === ''} onClick={() => handleFilterStock('')} />
          <MetricTile
            label="In Stock"
            value={inStockProducts}
            tone="emerald"
            active={stock === 'In Stock'}
            onClick={() => handleFilterStock('In Stock')}
          />
          <MetricTile
            label="Low"
            value={lowStockProducts}
            tone="amber"
            active={stock === 'Low Stock'}
            onClick={() => handleFilterStock('Low Stock')}
          />
          <MetricTile
            label="Out"
            value={outOfStockProducts}
            tone="rose"
            active={stock === 'Out of Stock'}
            onClick={() => handleFilterStock('Out of Stock')}
          />
        </section>

        {/* Search + category filters stay reachable while the list scrolls */}
        <StickyToolbar>
          <div className="relative mt-2">
            <Search size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
              placeholder="Search product or SKU..."
              className="h-12 w-full rounded-2xl border border-[#E5EBE7] bg-white pl-10 pr-9 text-sm font-medium text-[#091413] placeholder-slate-400 shadow-2xs outline-none transition focus:border-[#285A48] focus:ring-2 focus:ring-[#285A48]/15"
            />
            {search && (
              <button
                type="button"
                onClick={() => {
                  setSearch('')
                  setPage(1)
                }}
                className="absolute right-2.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100"
              >
                ×
              </button>
            )}
          </div>

          <div className="mt-2.5 flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
            <button
              type="button"
              onClick={() => {
                setCategoryId('')
                setPage(1)
              }}
              className={`shrink-0 rounded-full px-4 py-2 text-xs font-bold transition-all active:scale-95 touch-manipulation ${
                !categoryId ? 'bg-[#091413] text-white shadow-xs' : 'border border-[#E5EBE7] bg-white text-slate-600'
              }`}
            >
              All Categories
            </button>
            {(categories.data ?? []).map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  setCategoryId(String(c.id))
                  setPage(1)
                }}
                className={`shrink-0 rounded-full px-4 py-2 text-xs font-bold transition-all active:scale-95 touch-manipulation ${
                  categoryId === String(c.id)
                    ? 'bg-[#091413] text-white shadow-xs'
                    : 'border border-[#E5EBE7] bg-white text-slate-600'
                }`}
              >
                {c.name}
              </button>
            ))}
            {hasFilters && (
              <button
                type="button"
                onClick={resetFilters}
                className="shrink-0 rounded-full border border-[#E5EBE7] bg-white px-4 py-2 text-xs font-bold text-[#285A48]"
              >
                Reset
              </button>
            )}
          </div>
        </StickyToolbar>

        {/* List */}
        <section aria-label="Product list" className="mt-2">
          {loading && <MobileLoading label="Loading products…" />}

          {error && <MobileError message={error} onRetry={() => void reload()} />}

          {!loading && !error && data && data.items.length === 0 && (
            <MobileEmpty
              icon={<Package size={24} />}
              title="No products found"
              hint={hasFilters ? 'Try clearing filters or search a different term.' : 'Add your first product to get started.'}
              action={
                !hasFilters && canManage ? (
                  <Button onClick={openCreate} className="min-h-12 w-full text-sm">
                    Add Product
                  </Button>
                ) : undefined
              }
            />
          )}

          {!loading && !error && data && data.items.length > 0 && (
            <div className="space-y-3">
              {data.items.map((product) => (
                <MobileProductCard
                  key={product.id}
                  product={product}
                  currencySymbol={settings.currencySymbol}
                  onView={() => navigate(`/products/${product.id}`)}
                  onEdit={() => openEdit(product)}
                  onDeactivate={() => setDeactivate(product)}
                  canManage={canManage}
                  canDelete={canDelete}
                />
              ))}

              <div className="pt-1">
                <Pagination page={data.page} totalPages={data.totalPages} onPage={setPage} />
              </div>
            </div>
          )}
        </section>
      </main>

      {/* Add / Edit modal */}
      {open && (
        <Modal
          title={editing ? 'Edit Product' : 'Add New Product'}
          wide
          onClose={closeModals}
          preventClose={busy}
          footer={
            <div className="flex flex-col-reverse gap-2 w-full">
              <Button variant="secondary" onClick={closeModals} className="min-h-12 text-sm">
                Cancel
              </Button>
              <Button
                onClick={() => void save()}
                disabled={busy || !form.name.trim() || !form.sku.trim() || !form.categoryId}
                className="min-h-12 text-sm"
              >
                {busy ? 'Saving…' : editing ? 'Save Changes' : 'Create Product'}
              </Button>
            </div>
          }
        >
          <div className="space-y-5 text-sm">
            <FormSection title="Basic Information">
              <Field label="Product Name" required>
                <Input
                  value={form.name}
                  placeholder="e.g. Matcha Latte"
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="min-h-12 rounded-2xl text-sm"
                  required
                />
              </Field>

              <Field label="SKU / Barcode" required>
                <Input
                  value={form.sku}
                  placeholder="e.g. BEV-001"
                  onChange={(e) => setForm({ ...form, sku: e.target.value })}
                  className="min-h-12 rounded-2xl text-sm"
                  required
                />
              </Field>

              <Field label="Category" required>
                <Select
                  value={form.categoryId || ''}
                  onChange={(e) => setForm({ ...form, categoryId: Number(e.target.value) })}
                  className="min-h-12 rounded-2xl text-sm"
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
                  onChange={(e) => setForm({ ...form, supplierId: e.target.value ? Number(e.target.value) : null })}
                  className="min-h-12 rounded-2xl text-sm"
                >
                  <option value="">None / Internal</option>
                  {(suppliers.data ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.companyName}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Description">
                <Textarea
                  value={form.description}
                  placeholder="Ingredients, sizing, notes, etc."
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="min-h-24 rounded-2xl text-sm"
                />
              </Field>

              <div className="space-y-2">
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-700">Product Image</label>
                <div className="flex items-center gap-3">
                  {form.imageUrl ? (
                    <div className="relative">
                      <img src={form.imageUrl} alt="Preview" className="h-16 w-16 rounded-2xl border border-[#E5EBE7] object-cover" />
                      <button
                        type="button"
                        onClick={() => setForm((prev) => ({ ...prev, imageUrl: '' }))}
                        className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-rose-600 text-white shadow"
                      >
                        ×
                      </button>
                    </div>
                  ) : (
                    <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-dashed border-[#E5EBE7] bg-[#F6F8F7] text-slate-400">
                      ↑
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex h-12 flex-1 items-center justify-center rounded-2xl border border-[#E5EBE7] bg-white text-sm font-bold text-[#091413] active:scale-95 touch-manipulation"
                  >
                    Choose Photo
                  </button>
                  <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                </div>
              </div>
            </FormSection>

            <FormSection title="Pricing">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Cost Price">
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    value={form.costPrice}
                    onChange={(e) => setForm({ ...form, costPrice: Number(e.target.value) })}
                    className="min-h-12 rounded-2xl text-sm"
                  />
                </Field>
                <Field label="Selling Price">
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    value={form.sellingPrice}
                    onChange={(e) => setForm({ ...form, sellingPrice: Number(e.target.value) })}
                    className="min-h-12 rounded-2xl text-sm"
                  />
                </Field>
              </div>

              {form.sellingPrice > 0 && (
                <div className="flex items-center justify-between rounded-xl bg-[#F6F8F7] px-3 py-2 text-xs">
                  <span className="font-medium text-slate-500">Gross Margin</span>
                  <span className={`font-black ${profitMargin >= 40 ? 'text-[#285A48]' : profitMargin > 0 ? 'text-amber-600' : 'text-rose-600'}`}>
                    {profitMargin}% ({formatMoney(form.sellingPrice - form.costPrice, settings.currencySymbol)})
                  </span>
                </div>
              )}
            </FormSection>

            <FormSection title="Inventory">
              {!editing && (
                <Field label="Initial Stock Quantity">
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={form.stockQuantity}
                    onChange={(e) => setForm({ ...form, stockQuantity: Number(e.target.value) })}
                    className="min-h-12 rounded-2xl text-sm"
                  />
                </Field>
              )}

              <Field label="Reorder Level">
                <Input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={form.reorderLevel}
                  onChange={(e) => setForm({ ...form, reorderLevel: Number(e.target.value) })}
                  className="min-h-12 rounded-2xl text-sm"
                />
              </Field>
            </FormSection>

            <FormSection title="Status">
              <label className="flex min-h-12 items-center gap-3 rounded-2xl border border-[#E5EBE7] bg-white px-3.5 text-sm font-bold text-slate-700">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                  className="h-5 w-5 rounded-md border-[#E5EBE7] text-[#285A48] focus:ring-[#285A48]"
                />
                Active in POS register catalog
              </label>
            </FormSection>
          </div>
        </Modal>
      )}

      {/* View modal */}
      {view && (
        <Modal title="Product Overview" onClose={closeModals}>
          <div className="space-y-4 text-sm">
            <div className="flex items-center gap-3.5 rounded-2xl border border-[#E5EBE7] bg-[#F6F8F7] p-3.5">
              <div className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl border border-[#E5EBE7] bg-white">
                {view.imageUrl ? (
                  <img src={view.imageUrl} alt={view.name} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-base font-black text-[#285A48] bg-[#EAF1EE]">
                    {view.name.slice(0, 2).toUpperCase()}
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-base font-extrabold text-[#091413]">{view.name}</h3>
                <p className="text-xs font-semibold text-slate-400">{view.sku}</p>
                <span className="mt-1 inline-block rounded-md bg-white px-2 py-0.5 text-[11px] font-bold text-slate-600 border border-[#E5EBE7]">
                  {view.categoryName}
                </span>
              </div>
            </div>

            <div className="divide-y divide-slate-100 rounded-2xl border border-[#E5EBE7] bg-white px-4">
              <DetailRow label="Selling Price" value={<span className="text-base font-black text-[#091413]">{formatMoney(view.sellingPrice, settings.currencySymbol)}</span>} />
              <DetailRow label="Cost Price" value={formatMoney(view.costPrice, settings.currencySymbol)} />
              <DetailRow label="Stock Level" value={<span className="font-black text-[#285A48]">{view.stockQuantity} units ({view.stockStatus})</span>} />
              <DetailRow label="Reorder Threshold" value={`${view.reorderLevel} units`} />
              <DetailRow label="Supplier" value={view.supplierName ?? 'Internal / None'} />
              <DetailRow label="Description" value={view.description || 'No description provided.'} />
            </div>

            {canManage && (
              <Button onClick={() => openEdit(view)} className="min-h-12 w-full text-sm">
                Edit Product
              </Button>
            )}
          </div>
        </Modal>
      )}

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

function MetricTile({
  label,
  value,
  tone,
  active,
  onClick,
}: {
  label: string
  value: number
  tone?: 'emerald' | 'amber' | 'rose'
  active: boolean
  onClick: () => void
}) {
  const dot = tone === 'emerald' ? 'bg-emerald-500' : tone === 'amber' ? 'bg-amber-500' : tone === 'rose' ? 'bg-rose-500' : null
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-17 flex-col items-center justify-center rounded-2xl border py-2 text-center transition-all active:scale-95 touch-manipulation ${
        active ? 'border-[#285A48] bg-white shadow-xs ring-1 ring-[#285A48]' : 'border-[#E5EBE7] bg-white'
      }`}
    >
      <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
        {dot && <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />}
        {label}
      </span>
      <span className="mt-1 text-lg font-black tabular-nums text-[#091413]">{value}</span>
    </button>
  )
}

function MobileProductCard({
  product,
  currencySymbol,
  onView,
  onEdit,
  onDeactivate,
  canManage,
  canDelete,
}: {
  product: Product
  currencySymbol: string
  onView: () => void
  onEdit: () => void
  onDeactivate: () => void
  canManage: boolean
  canDelete: boolean
}) {
  return (
    <article className="rounded-3xl border border-[#E5EBE7] bg-white p-4 shadow-xs">
      <div className="flex items-start gap-3">
        <div className="h-14 w-14 shrink-0 overflow-hidden rounded-2xl border border-[#E5EBE7] bg-[#F6F8F7]">
          {product.imageUrl ? (
            <img src={product.imageUrl} alt={product.name} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-sm font-black text-[#285A48] bg-[#EAF1EE]">
              {product.name.slice(0, 2).toUpperCase()}
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-[#091413]">{product.name}</p>
              <p className="text-[11px] font-mono text-slate-400">{product.sku}</p>
            </div>
            <span className="shrink-0 text-sm font-black text-[#091413]">
              {formatMoney(product.sellingPrice, currencySymbol)}
            </span>
          </div>

          <div className="mt-2 flex items-center gap-1.5">
            <span className="rounded-lg bg-[#F6F8F7] px-2 py-0.5 text-[11px] font-semibold text-slate-600 border border-[#E5EBE7]">
              {product.categoryName}
            </span>
            <Badge tone={stockTone(product.stockStatus)}>{product.stockQuantity} in stock</Badge>
            {!product.isActive && <Badge tone="gray">Inactive</Badge>}
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3">
        <button
          type="button"
          onClick={onView}
          className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border border-[#E5EBE7] bg-white text-xs font-bold text-slate-600 active:scale-95 touch-manipulation"
        >
          <Eye size={15} />
          View
        </button>
        {canManage && (
          <button
            type="button"
            onClick={onEdit}
            className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border border-[#E5EBE7] bg-white text-xs font-bold text-[#285A48] active:scale-95 touch-manipulation"
          >
            <Pencil size={15} />
            Edit
          </button>
        )}
        {canDelete && product.isActive && (
          <button
            type="button"
            onClick={onDeactivate}
            aria-label="Deactivate product"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-rose-200 bg-rose-50 text-rose-600 active:scale-95 touch-manipulation"
          >
            <Trash2 size={15} />
          </button>
        )}
      </div>
    </article>
  )
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-2.5">
      <span className="text-slate-400 font-medium">{label}</span>
      <span className="text-[#091413] text-right font-bold">{value}</span>
    </div>
  )
}

export default MobileProducts
