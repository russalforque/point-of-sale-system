import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import {
  Barcode,
  ChevronLeft,
  ChevronRight,
  History,
  Minus,
  Plus,
  Search,
  Trash2,
  UserRound,
  X,
} from '../components/ui/Icons'

import { categoryApi } from '../api/categoryApi'
import { customerApi } from '../api/customerApi'
import { productApi } from '../api/productApi'
import { salesApi } from '../api/salesApi'

import { Modal } from '../components/ui/Modal'
import { Pagination } from '../components/ui/Pagination'
import { PaymentModal } from '../components/pos/PaymentModal'
import { EmptyState, ErrorState, Spinner } from '../components/ui/States'

import { useAuth } from '../context/AuthContext'
import { useCheckout } from '../context/CheckoutContext'
import { useSettings } from '../context/SettingsContext'
import { useToast } from '../context/ToastContext'
import { useAsync } from '../hooks/useAsync'
import { useDebounced } from '../hooks/useDebounced'
import { useDismissOnBack } from '../hooks/useDismissOnBack'
import { useReceiptPrinter } from '../hooks/useReceiptPrinter'

import { printerErrorMessage } from '../services/printer'
import type { Customer, Product, Sale } from '../types'
import { getErrorMessage } from '../utils/errors'
import { formatDateTime, formatMoney } from '../utils/format'
import { addToCart, calculateTotals, canSell, setLineQty } from '../utils/pos'

// 📱 Mobile Sales Import
import MobileSales from './mobile/MobileSales'

/* =============================================================
   MOBILE DETECTION HOOK
============================================================= */

function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth < breakpoint
    }
    return false
  })

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`)
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches)

    setIsMobile(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [breakpoint])

  return isMobile
}

/* =============================================================
   MAIN EXPORT: AUTO-SWITCHER
============================================================= */

export function SalesPage() {
  const isMobile = useIsMobile(768)

  // 📱 Render MobileSales when screen is < 768px
  if (isMobile) {
    return <MobileSales />
  }

  // 💻 Otherwise render the tablet / desktop register
  return <DesktopSales />
}

/* =============================================================
   TABLET / DESKTOP REGISTER
============================================================= */

const isTypingTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)

function DesktopSales() {
  const { notify } = useToast()
  const { settings } = useSettings()
  const { state: checkout, setState: setCheckout } = useCheckout()

  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [isPaymentOpen, setIsPaymentOpen] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [isPickingCustomer, setIsPickingCustomer] = useState(false)
  const [customerSearch, setCustomerSearch] = useState('')
  const [pickedCustomer, setPickedCustomer] = useState<Customer | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [lastAddedId, setLastAddedId] = useState<number | null>(null)
  const [lookingUp, setLookingUp] = useState(false)

  const searchRef = useRef<HTMLInputElement | null>(null)

  const cart = checkout.cart
  const customerId = checkout.customerId
  const discount = checkout.discount
  const money = (value: number) => formatMoney(value, settings.currencySymbol)

  const q = useDebounced(search)
  const cq = useDebounced(customerSearch)

  const categories = useAsync(() => categoryApi.list(true), [])
  const catalog = useAsync(
    () =>
      productApi.catalog({
        search: q || undefined,
        categoryId: categoryId ? Number(categoryId) : undefined,
      }),
    [q, categoryId],
  )
  const customers = useAsync(() => customerApi.lookup(cq || undefined), [cq])

  const totals = useMemo(
    () => calculateTotals(cart, discount, settings.taxRate),
    [cart, discount, settings.taxRate],
  )

  const itemCount = cart.reduce((sum, line) => sum + line.quantity, 0)
  const taxPercent = Math.round(settings.taxRate * 10000) / 100

  // The lookup list changes as the cashier searches, so remember who was picked.
  const selectedCustomer =
    customerId == null
      ? null
      : pickedCustomer?.id === customerId
      ? pickedCustomer
      : customers.data?.find((customer) => customer.id === customerId) ?? null

  /* ------------------------------------------------------------------
     CART ACTIONS (same cart helpers and checkout context as before)
  ------------------------------------------------------------------ */

  function add(product: Product) {
    if (product.stockQuantity <= 0) {
      notify('This item is out of stock.', 'error')
      return
    }

    if (!canSell(product, cart)) {
      notify(`Only ${product.stockQuantity} of ${product.name} in stock.`, 'error')
      return
    }

    setCheckout({ ...checkout, cart: addToCart(cart, product) })
    setLastAddedId(product.id)
  }

  function changeQty(product: Product, quantity: number) {
    setCheckout({ ...checkout, cart: setLineQty(cart, product.id, quantity) })
  }

  function selectCustomer(customer: Customer | null) {
    setPickedCustomer(customer)
    setCheckout({ ...checkout, customerId: customer?.id ?? null })
    setIsPickingCustomer(false)
    setCustomerSearch('')
  }

  function clearCart() {
    if (cart.length === 0) return
    // Destructive: require a second click.
    if (!confirmClear) {
      setConfirmClear(true)
      return
    }
    setCheckout({ ...checkout, cart: [], discount: 0 })
    setConfirmClear(false)
    notify('Order cleared.')
  }

  function proceedToPayment() {
    if (cart.length === 0) {
      notify('Add items to the order first.', 'error')
      return
    }
    setIsPaymentOpen(true)
  }

  /** Barcode scanners type the code and press Enter: add the exact SKU match directly. */
  async function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      setSearch('')
      return
    }
    if (event.key !== 'Enter') return
    event.preventDefault()

    const term = search.trim()
    if (!term || lookingUp) return

    setLookingUp(true)
    try {
      const results = await productApi.catalog({ search: term })
      const exact = results.find((product) => product.sku.toLowerCase() === term.toLowerCase())
      const match = exact ?? (results.length === 1 ? results[0] : undefined)

      if (match) {
        add(match)
        setSearch('')
      } else if (results.length === 0) {
        notify(`No product matches “${term}”.`, 'error')
      }
      // Several partial matches: leave them in the grid for the cashier to pick.
    } catch (err) {
      notify(getErrorMessage(err), 'error')
    } finally {
      setLookingUp(false)
    }
  }

  /* ------------------------------------------------------------------
     EFFECTS
  ------------------------------------------------------------------ */

  // "/" jumps to search from anywhere on the register.
  useEffect(() => {
    if (isPaymentOpen || showHistory) return
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === '/' && !isTypingTarget(event.target)) {
        event.preventDefault()
        searchRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [isPaymentOpen, showHistory])

  // Auto-cancel the pending "clear order" confirmation.
  useEffect(() => {
    if (!confirmClear) return
    const id = window.setTimeout(() => setConfirmClear(false), 3000)
    return () => window.clearTimeout(id)
  }, [confirmClear])

  // Briefly highlight the line that was just added and keep it in view.
  useEffect(() => {
    if (lastAddedId == null) return
    document.getElementById(`cart-line-${lastAddedId}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    const id = window.setTimeout(() => setLastAddedId(null), 1200)
    return () => window.clearTimeout(id)
  }, [lastAddedId, cart])

  /* ------------------------------------------------------------------
     RENDER
  ------------------------------------------------------------------ */

  const categoryOptions = [
    { id: '', name: 'All' },
    ...(categories.data ?? []).map((category) => ({ id: String(category.id), name: category.name })),
  ]
  const products = catalog.data ?? []

  return (
    <div className="flex h-dvh min-h-0 flex-col bg-[#F6F8F7] pt-[env(safe-area-inset-top,0px)] text-[#091413] antialiased">
      {/* HEADER */}
      <header className="flex shrink-0 items-center justify-between gap-4 px-4 pb-3 pt-4 lg:px-6">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight">New order</h1>
          <p className="text-sm text-slate-500">Tap a product or scan a barcode to add it.</p>
        </div>
        <button
          type="button"
          onClick={() => setShowHistory(true)}
          className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full bg-white px-4 text-sm font-medium ring-1 ring-slate-200 transition hover:bg-slate-50 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B]"
        >
          <History size={15} className="text-[#1F5E3B]" />
          Order history
        </button>
      </header>

      <div className="grid min-h-0 flex-1 gap-4 px-4 pb-4 md:grid-cols-[minmax(0,1fr)_20rem] lg:grid-cols-[minmax(0,1fr)_22rem] lg:px-6 lg:pb-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        {/* ============================ CATALOG ============================ */}
        <main className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl bg-white ring-1 ring-slate-100">
          <div className="shrink-0 border-b border-slate-100 p-4">
            <div className="relative">
              <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                ref={searchRef}
                type="search"
                inputMode="search"
                enterKeyHint="search"
                aria-label="Search products or scan a barcode"
                aria-describedby="register-search-hint"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => void handleSearchKeyDown(e)}
                placeholder="Search products or scan a barcode"
                className="h-12 w-full rounded-2xl border-0 bg-[#F3F5F4] pl-11 pr-12 text-[15px] placeholder:text-slate-400 outline-none transition focus:bg-white focus:ring-2 focus:ring-[#1F5E3B] [&::-webkit-search-cancel-button]:hidden"
              />
              {search ? (
                <button
                  type="button"
                  onClick={() => {
                    setSearch('')
                    searchRef.current?.focus()
                  }}
                  aria-label="Clear search"
                  className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200"
                >
                  <X size={14} />
                </button>
              ) : (
                <Barcode size={18} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-slate-400" />
              )}
            </div>
            <p id="register-search-hint" className="sr-only">
              Press Enter to add an exact SKU match. Press slash to focus search from anywhere.
            </p>

            <div role="tablist" aria-label="Categories" className="mt-3 flex gap-2 overflow-x-auto pb-0.5 scrollbar-none">
              {categoryOptions.map((option) => {
                const active = categoryId === option.id
                return (
                  <button
                    key={option.id || 'all'}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setCategoryId(option.id)}
                    className={`h-9 shrink-0 rounded-full px-4 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B] ${
                      active ? 'bg-[#1F5E3B] text-white' : 'bg-[#F3F5F4] text-slate-600 hover:bg-[#E9EEEB]'
                    }`}
                  >
                    {option.name}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
            {catalog.loading && !catalog.data && (
              <div className="py-16">
                <Spinner />
              </div>
            )}

            {catalog.error && (
              <div className="py-8">
                <ErrorState message={catalog.error} onRetry={() => void catalog.reload()} />
              </div>
            )}

            {!catalog.loading && !catalog.error && products.length === 0 && (
              <div className="py-16 text-center">
                <EmptyState
                  title="No products found"
                  hint={search ? `Nothing matches “${search}”.` : 'Try a different category.'}
                />
              </div>
            )}

            {products.length > 0 && (
              <div
                className={`grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-3 transition-opacity ${
                  catalog.loading ? 'opacity-60' : ''
                }`}
              >
                {products.map((product) => (
                  <CatalogProductCard
                    key={product.id}
                    product={product}
                    price={money(product.sellingPrice)}
                    qtyInCart={cart.find((line) => line.product.id === product.id)?.quantity ?? 0}
                    canAddMore={canSell(product, cart)}
                    onAdd={() => add(product)}
                  />
                ))}
              </div>
            )}
          </div>
        </main>

        {/* ============================ ORDER ============================ */}
        <aside aria-label="Current order" className="flex min-h-0 flex-col overflow-hidden rounded-2xl bg-white ring-1 ring-slate-100">
          <div className="shrink-0 border-b border-slate-100 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">Current order</h2>
                <p className="text-sm text-slate-500">
                  {itemCount} {itemCount === 1 ? 'item' : 'items'}
                </p>
              </div>
              {cart.length > 0 && (
                <button
                  type="button"
                  onClick={clearCart}
                  className={`h-10 rounded-full px-3 text-sm font-medium transition ${
                    confirmClear ? 'bg-rose-600 text-white' : 'text-rose-600 hover:bg-rose-50'
                  }`}
                >
                  {confirmClear ? 'Click to confirm' : 'Clear'}
                </button>
              )}
            </div>

            {/* Customer */}
            <div className="mt-3 rounded-2xl bg-[#F6F8F7]">
              <button
                type="button"
                onClick={() => setIsPickingCustomer((open) => !open)}
                aria-expanded={isPickingCustomer}
                className="flex min-h-12 w-full items-center gap-3 rounded-2xl px-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B]"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-[#1F5E3B]">
                  <UserRound size={13} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{selectedCustomer?.fullName ?? 'Walk-in customer'}</span>
                  {selectedCustomer && (
                    <span className="block text-xs text-[#1F5E3B]">{selectedCustomer.loyaltyPoints} loyalty pts</span>
                  )}
                </span>
                <span className="text-sm font-medium text-[#1F5E3B]">{isPickingCustomer ? 'Done' : 'Change'}</span>
              </button>

              {isPickingCustomer && (
                <div className="px-3 pb-3">
                  <input
                    autoFocus
                    type="search"
                    aria-label="Search customers"
                    placeholder="Search name or phone"
                    value={customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') setIsPickingCustomer(false)
                    }}
                    className="h-10 w-full rounded-xl border-0 bg-white px-3 text-sm placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-[#1F5E3B]"
                  />
                  <ul className="mt-2 max-h-52 overflow-y-auto rounded-xl bg-white">
                    <CustomerOption name="Walk-in customer" selected={customerId == null} onSelect={() => selectCustomer(null)} />
                    {customers.loading && <li className="px-3 py-2.5 text-sm text-slate-400">Searching…</li>}
                    {!customers.loading && customers.data?.length === 0 && customerSearch && (
                      <li className="px-3 py-2.5 text-sm text-slate-400">No customers match “{customerSearch}”.</li>
                    )}
                    {(customers.data ?? []).map((customer) => (
                      <CustomerOption
                        key={customer.id}
                        name={customer.fullName}
                        detail={`${customer.loyaltyPoints} pts`}
                        selected={customer.id === customerId}
                        onSelect={() => selectCustomer(customer)}
                      />
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>

          {/* Lines */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4">
            {cart.length === 0 ? (
              <div className="flex h-full min-h-40 flex-col items-center justify-center py-8 text-center">
                <p className="text-sm font-medium">No items yet</p>
                <p className="mt-1 text-sm text-slate-500">Tap a product or scan a barcode.</p>
              </div>
            ) : (
              <ul>
                {cart.map((line) => {
                  const canIncrease = canSell(line.product, cart)
                  const willRemove = line.quantity <= 1
                  return (
                    <li
                      key={line.product.id}
                      id={`cart-line-${line.product.id}`}
                      className={`-mx-2 flex items-center gap-2 rounded-xl border-b border-slate-100 px-2 py-2.5 transition-colors duration-500 last:border-b-0 ${
                        lastAddedId === line.product.id ? 'bg-[#E6F1EA]' : ''
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm" title={line.product.name}>
                          {line.product.name}
                        </p>
                        <p className="text-xs tabular-nums text-slate-500">
                          {money(line.product.sellingPrice * line.quantity)}
                          {line.quantity > 1 && <span className="text-slate-400"> · {money(line.product.sellingPrice)} each</span>}
                        </p>
                      </div>

                      <div className="flex h-10 shrink-0 items-center rounded-xl bg-[#E6F1EA] text-[#1F5E3B]">
                        <button
                          type="button"
                          onClick={() => changeQty(line.product, line.quantity - 1)}
                          aria-label={willRemove ? `Remove ${line.product.name}` : `Decrease ${line.product.name}`}
                          className="flex h-10 w-10 items-center justify-center rounded-xl hover:bg-[#D3E6DB]"
                        >
                          {willRemove ? <Trash2 size={13} /> : <Minus size={11} />}
                        </button>
                        <span aria-live="polite" className="min-w-7 text-center text-sm font-semibold tabular-nums">
                          {line.quantity}
                        </span>
                        <button
                          type="button"
                          onClick={() => changeQty(line.product, line.quantity + 1)}
                          disabled={!canIncrease}
                          aria-label={`Increase ${line.product.name}`}
                          title={canIncrease ? undefined : 'No more in stock'}
                          className="flex h-10 w-10 items-center justify-center rounded-xl hover:bg-[#D3E6DB] disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          <Plus size={11} />
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {/* Totals + primary action */}
          <div className="shrink-0 border-t border-slate-100 p-4">
            <dl className="space-y-1.5 text-sm">
              <TotalRow label="Subtotal" value={money(totals.subtotal)} />
              <div className="flex items-center justify-between gap-3 text-slate-500">
                <dt>
                  <label htmlFor="register-discount">Discount</label>
                </dt>
                <dd className="flex items-center gap-1.5">
                  <span className="text-slate-400">{settings.currencySymbol}</span>
                  <input
                    id="register-discount"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    value={discount || ''}
                    placeholder="0.00"
                    disabled={cart.length === 0}
                    onChange={(e) =>
                      setCheckout({ ...checkout, discount: Math.max(0, Number(e.target.value) || 0) })
                    }
                    className="h-9 w-24 rounded-lg border-0 bg-[#F3F5F4] px-2.5 text-right text-sm tabular-nums text-[#091413] outline-none focus:bg-white focus:ring-2 focus:ring-[#1F5E3B] disabled:opacity-50"
                  />
                </dd>
              </div>
              {discount > totals.subtotal && cart.length > 0 && (
                <p className="text-right text-xs text-amber-700">Capped at the subtotal ({money(totals.subtotal)}).</p>
              )}
              <TotalRow label={`Tax (${taxPercent}%)`} value={money(totals.tax)} />
            </dl>

            <div className="mt-3 flex items-baseline justify-between border-t border-slate-100 pt-3">
              <span className="text-sm font-medium">Total</span>
              <span className="text-2xl font-bold tabular-nums tracking-tight">{money(totals.total)}</span>
            </div>

            <button
              type="button"
              onClick={proceedToPayment}
              disabled={cart.length === 0}
              className="mt-4 flex h-14 w-full items-center justify-between rounded-2xl bg-[#1F5E3B] px-5 text-white transition active:scale-[0.99] disabled:bg-slate-200 disabled:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B] focus-visible:ring-offset-2"
            >
              <span className="text-[15px] font-semibold">{cart.length === 0 ? 'Add items to charge' : 'Charge'}</span>
              {cart.length > 0 && <span className="text-lg font-semibold tabular-nums">{money(totals.total)}</span>}
            </button>
          </div>
        </aside>
      </div>

      {isPaymentOpen && <PaymentModal onClose={() => setIsPaymentOpen(false)} />}

      {showHistory && <OrderHistoryModal onClose={() => setShowHistory(false)} />}
    </div>
  )
}

/* =============================================================
   ORDER HISTORY
============================================================= */

function OrderHistoryModal({ onClose }: { onClose: () => void }) {
  const { notify } = useToast()
  const { settings } = useSettings()
  const { user } = useAuth()
  const { printReceipt: reprintReceipt, isPrinting, lastPrintError } = useReceiptPrinter()

  const [historySearch, setHistorySearch] = useState('')
  const [historyPage, setHistoryPage] = useState(1)
  const [selectedOrder, setSelectedOrder] = useState<Sale | null>(null)
  const [openingOrderId, setOpeningOrderId] = useState<number | null>(null)

  // Android back (tablets) closes history instead of leaving the register.
  const { close } = useDismissOnBack('orderHistoryOpen', onClose)

  const money = (value: number) => formatMoney(value, settings.currencySymbol)
  const hq = useDebounced(historySearch)

  const history = useAsync(
    () =>
      salesApi.list({
        search: hq || undefined,
        page: historyPage,
        pageSize: 8,
        // Cashiers only see their own orders (unchanged).
        cashierName: user?.role === 'cashier' ? user.fullName : undefined,
      }),
    [hq, historyPage, user],
  )

  useEffect(() => {
    setHistoryPage(1)
  }, [hq])

  function openOrder(order: Sale) {
    setOpeningOrderId(order.id)
    void salesApi
      .get(order.id)
      .then(setSelectedOrder)
      .catch((err: unknown) => notify(getErrorMessage(err), 'error'))
      .finally(() => setOpeningOrderId(null))
  }

  function handleReprint(order: Sale) {
    void reprintReceipt(order, settings).then(
      () => notify('Receipt printed.'),
      (err) => notify(printerErrorMessage(err), 'error'),
    )
  }

  const items = history.data?.items ?? []

  return (
    <Modal title={selectedOrder ? selectedOrder.invoiceNumber : 'Order history'} size="xl" onClose={close}>
      {selectedOrder ? (
        /* ---------------- DETAIL ---------------- */
        <div>
          <button
            type="button"
            onClick={() => setSelectedOrder(null)}
            className="-ml-2 inline-flex h-10 items-center gap-1.5 rounded-full px-2 text-sm font-medium text-[#1F5E3B] hover:bg-[#F2F8F4]"
          >
            <ChevronLeft size={12} />
            Back to orders
          </button>

          <p className="mt-2 text-sm text-slate-500">
            {selectedOrder.customerName || 'Walk-in customer'} · {formatDateTime(selectedOrder.createdAt)} ·{' '}
            {selectedOrder.paymentMethod}
          </p>

          <ul className="mt-4 rounded-2xl px-4 ring-1 ring-slate-100">
            {selectedOrder.items.map((item) => (
              <li
                key={item.productId}
                className="flex items-baseline justify-between gap-3 border-b border-slate-100 py-3 text-sm last:border-b-0"
              >
                <span className="min-w-0 truncate">
                  {item.productName}
                  <span className="text-slate-400"> × {item.quantity}</span>
                </span>
                <span className="shrink-0 tabular-nums">{money(item.lineTotal)}</span>
              </li>
            ))}
          </ul>

          <dl className="mt-4 space-y-1.5 text-sm">
            <TotalRow label="Subtotal" value={money(selectedOrder.subtotal)} />
            {selectedOrder.discount > 0 && <TotalRow label="Discount" value={`−${money(selectedOrder.discount)}`} />}
            <TotalRow label="Tax" value={money(selectedOrder.tax)} />
            <div className="flex justify-between border-t border-slate-100 pt-2 text-base font-semibold text-[#091413]">
              <dt>Total</dt>
              <dd className="tabular-nums">{money(selectedOrder.total)}</dd>
            </div>
            {selectedOrder.amountReceived != null && (
              <TotalRow label="Received" value={money(selectedOrder.amountReceived)} />
            )}
            {selectedOrder.change != null && selectedOrder.change > 0 && (
              <TotalRow label="Change" value={money(selectedOrder.change)} />
            )}
          </dl>

          <button
            type="button"
            onClick={() => handleReprint(selectedOrder)}
            disabled={isPrinting}
            className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#1F5E3B] text-[15px] font-semibold text-white transition active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
          >
            <PrinterIcon size={15} />
            {isPrinting ? 'Printing…' : lastPrintError ? 'Retry print' : 'Reprint receipt'}
          </button>
        </div>
      ) : (
        /* ---------------- LIST ---------------- */
        <div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-500">
              {history.data ? `${history.data.totalCount} orders` : 'Loading orders…'}
            </p>
            <div className="relative w-full sm:max-w-xs">
              <Search size={14} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                autoFocus
                aria-label="Search orders"
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                placeholder="Invoice or customer"
                className="h-10 w-full rounded-xl border-0 bg-[#F3F5F4] pl-10 pr-3 text-sm placeholder:text-slate-400 outline-none focus:bg-white focus:ring-2 focus:ring-[#1F5E3B]"
              />
            </div>
          </div>

          {history.loading && !history.data && (
            <div className="py-12">
              <Spinner />
            </div>
          )}

          {history.error && (
            <div className="py-6">
              <ErrorState message={history.error} onRetry={() => void history.reload()} />
            </div>
          )}

          {!history.loading && !history.error && items.length === 0 && (
            <div className="py-10 text-center">
              <EmptyState title="No orders found" hint={hq ? 'Try a different invoice or name.' : 'Completed sales will appear here.'} />
            </div>
          )}

          {items.length > 0 && (
            <>
              <ul className={`mt-4 rounded-2xl ring-1 ring-slate-100 ${history.loading ? 'opacity-60' : ''}`}>
                {items.map((order) => (
                  <li key={order.id} className="border-b border-slate-100 last:border-b-0">
                    <button
                      type="button"
                      onClick={() => openOrder(order)}
                      disabled={openingOrderId !== null}
                      className="grid min-h-14 w-full grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto_auto] items-center gap-4 px-4 py-2.5 text-left transition hover:bg-slate-50 disabled:cursor-wait focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#1F5E3B]"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{order.invoiceNumber}</span>
                        <span className="block truncate text-xs text-slate-400">{formatDateTime(order.createdAt)}</span>
                      </span>
                      <span className="min-w-0 truncate text-sm text-slate-600">
                        {order.customerName || 'Walk-in customer'}
                        <span className="text-slate-400"> · {order.paymentMethod}</span>
                      </span>
                      <span className="text-sm font-medium tabular-nums">{money(order.total)}</span>
                      <span className="flex w-5 justify-end text-slate-300">
                        {openingOrderId === order.id ? <Spinner /> : <ChevronRight size={12} />}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>

              {history.data && history.data.totalPages > 1 && (
                <div className="mt-3">
                  <Pagination page={history.data.page} totalPages={history.data.totalPages} onPage={setHistoryPage} />
                </div>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  )
}

/* =============================================================
   BUILDING BLOCKS
============================================================= */

function CatalogProductCard({
  product,
  price,
  qtyInCart,
  canAddMore,
  onAdd,
}: {
  product: Product
  price: string
  qtyInCart: number
  canAddMore: boolean
  onAdd: () => void
}) {
  const outOfStock = product.stockQuantity <= 0
  const lowStock = !outOfStock && product.stockStatus === 'Low Stock'
  const allInOrder = !outOfStock && qtyInCart > 0 && !canAddMore
  const initial = <span className="text-2xl font-semibold text-slate-300">{product.name.slice(0, 1).toUpperCase()}</span>

  return (
    <button
      type="button"
      disabled={outOfStock}
      onClick={onAdd}
      aria-label={`Add ${product.name}, ${price}${qtyInCart > 0 ? `, ${qtyInCart} in order` : ''}`}
      className={`group flex min-w-0 flex-col overflow-hidden rounded-2xl bg-white text-left transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B] ${
        qtyInCart > 0 ? 'ring-2 ring-[#1F5E3B]' : 'ring-1 ring-slate-100 hover:ring-slate-300'
      }`}
    >
      <span className="relative flex aspect-4/3 w-full items-center justify-center overflow-hidden bg-[#F3F5F4]">
        {product.imageUrl ? (
          <SafeImage src={product.imageUrl} className="h-full w-full object-cover" fallback={initial} />
        ) : (
          initial
        )}
        {qtyInCart > 0 && (
          <span className="absolute right-2 top-2 flex h-7 min-w-7 items-center justify-center rounded-full bg-[#1F5E3B] px-2 text-sm font-semibold tabular-nums text-white">
            {qtyInCart}
          </span>
        )}
      </span>

      <span className="flex flex-1 flex-col px-3 pb-3 pt-2">
        <span className="line-clamp-2 text-sm leading-5">{product.name}</span>
        <span className="mt-auto flex items-baseline justify-between gap-2 pt-1.5">
          <span className="text-[15px] font-semibold tabular-nums">{price}</span>
          {outOfStock ? (
            <span className="text-xs text-rose-600">Out of stock</span>
          ) : allInOrder ? (
            <span className="text-xs text-amber-700">All in order</span>
          ) : lowStock ? (
            <span className="text-xs text-amber-700">{product.stockQuantity} left</span>
          ) : null}
        </span>
      </span>
    </button>
  )
}

function CustomerOption({
  name,
  detail,
  selected,
  onSelect,
}: {
  name: string
  detail?: string
  selected: boolean
  onSelect: () => void
}) {
  return (
    <li className="border-b border-slate-100 last:border-b-0">
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className="flex min-h-11 w-full items-center gap-3 px-3 text-left text-sm hover:bg-slate-50"
      >
        <span className={`min-w-0 flex-1 truncate ${selected ? 'font-medium text-[#1F5E3B]' : ''}`}>{name}</span>
        {detail && <span className="text-xs text-slate-400">{detail}</span>}
        {selected && <span aria-hidden="true" className="h-2 w-2 rounded-full bg-[#1F5E3B]" />}
      </button>
    </li>
  )
}

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 text-slate-500">
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  )
}

/** Image that swaps to `fallback` when it can't load (e.g. a linked photo while offline). */
function SafeImage({ src, className, fallback }: { src: string; className: string; fallback: ReactNode }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  if (failedSrc === src) return <>{fallback}</>
  return <img src={src} alt="" loading="lazy" className={className} onError={() => setFailedSrc(src)} />
}

function PrinterIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="6 9 6 2 18 2 18 9" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" />
    </svg>
  )
}
