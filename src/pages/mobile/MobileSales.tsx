import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
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
} from '../../components/ui/Icons'

import { categoryApi } from '../../api/categoryApi'
import { customerApi } from '../../api/customerApi'
import { productApi } from '../../api/productApi'
import { salesApi } from '../../api/salesApi'

import { Pagination } from '../../components/ui/Pagination'
import { EmptyState, ErrorState, Spinner } from '../../components/ui/States'
import { PaymentModal } from '../../components/pos/PaymentModal'

import { useAuth } from '../../context/AuthContext'
import { useCheckout } from '../../context/CheckoutContext'
import { useSettings } from '../../context/SettingsContext'
import { useToast } from '../../context/ToastContext'
import { useReceiptPrinter } from '../../hooks/useReceiptPrinter'
import { printerErrorMessage } from '../../services/printer'
import { useAsync } from '../../hooks/useAsync'
import { useDebounced } from '../../hooks/useDebounced'

import type { Category, Customer, Product, Sale, SaleItem } from '../../types'
import { getErrorMessage } from '../../utils/errors'
import { formatDateTime, formatMoney } from '../../utils/format'
import {
  addToCart,
  calculateTotals,
  canSell,
  setLineQty,
} from '../../utils/pos'

export interface CartLine {
  product: Product
  quantity: number
}

// Keeps floating UI above the layout's fixed bottom navigation.
const ABOVE_BOTTOM_NAV =
  'calc(4.5rem + max(0.35rem, env(safe-area-inset-bottom, 0px)))'

export function MobileSales() {
  const { notify } = useToast()
  const { settings } = useSettings()
  const { user } = useAuth()
  const { state: checkout, setState: setCheckout } = useCheckout()
  const { printReceipt: reprintReceipt, isPrinting, lastPrintError } = useReceiptPrinter()

  // UI state
  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [isCartOpen, setIsCartOpen] = useState(false)
  const [isPaymentOpen, setIsPaymentOpen] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [isPickingCustomer, setIsPickingCustomer] = useState(false)
  const [customerSearch, setCustomerSearch] = useState('')
  const [pickedCustomer, setPickedCustomer] = useState<Customer | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [historySearch, setHistorySearch] = useState('')
  const [historyPage, setHistoryPage] = useState(1)
  const [selectedOrder, setSelectedOrder] = useState<Sale | null>(null)
  const [openingOrderId, setOpeningOrderId] = useState<number | null>(null)

  const cart: CartLine[] = checkout.cart
  const customerId = checkout.customerId
  const discount = checkout.discount
  const money = (value: number) => formatMoney(value, settings.currencySymbol)

  const q = useDebounced(search)
  const cq = useDebounced(customerSearch)

  // API queries
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
  const history = useAsync(
    () =>
      showHistory
        ? salesApi.list({
            search: historySearch || undefined,
            page: historyPage,
            pageSize: 8,
            cashierName: user?.role === 'cashier' ? user.fullName : undefined,
          })
        : Promise.resolve(null),
    [historySearch, historyPage, showHistory, user],
  )

  const totals = useMemo(
    () => calculateTotals(cart, discount, settings.taxRate),
    [cart, discount, settings.taxRate],
  )

  // The lookup list changes as the user searches, so remember the picked customer.
  const selectedCustomer =
    customerId == null
      ? null
      : pickedCustomer?.id === customerId
      ? pickedCustomer
      : customers.data?.find((c: Customer) => c.id === customerId) ?? null

  const totalItemCount = useMemo(
    () => cart.reduce((acc: number, line: CartLine) => acc + line.quantity, 0),
    [cart],
  )

  /* ------------------------------------------------------------------
     CART ACTIONS
  ------------------------------------------------------------------ */

  function add(product: Product) {
    if (product.stockQuantity <= 0) {
      notify('This item is out of stock.', 'error')
      return
    }

    if (!canSell(product, cart)) {
      notify(`Only ${product.stockQuantity} in stock.`, 'error')
      return
    }

    setCheckout({ ...checkout, cart: addToCart(cart, product) })
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

    // Destructive: require a second tap.
    if (!confirmClear) {
      setConfirmClear(true)
      return
    }

    setCheckout({ ...checkout, cart: [], discount: 0 })
    setConfirmClear(false)
    setIsCartOpen(false)
    notify('Cart cleared.')
  }

  function proceedToPayment() {
    if (cart.length === 0) {
      notify('Add items to the cart first.', 'error')
      return
    }
    setIsCartOpen(false)
    setIsPaymentOpen(true)
  }

  function openOrder(order: Sale) {
    setOpeningOrderId(order.id)
    void salesApi
      .get(order.id)
      .then(setSelectedOrder)
      .catch((err: unknown) => notify(getErrorMessage(err), 'error'))
      .finally(() => setOpeningOrderId(null))
  }

  function closeHistory() {
    setShowHistory(false)
    setSelectedOrder(null)
  }

  function handleReprint(order: Sale) {
    void reprintReceipt(order, settings).then(
      () => notify('Receipt printed successfully.'),
      (err) => notify(printerErrorMessage(err), 'error'),
    )
  }

  /* ------------------------------------------------------------------
     EFFECTS
  ------------------------------------------------------------------ */

  // Auto-cancel the pending "clear cart" confirmation.
  useEffect(() => {
    if (!confirmClear) return
    const id = window.setTimeout(() => setConfirmClear(false), 3000)
    return () => window.clearTimeout(id)
  }, [confirmClear])

  // Close the cart sheet automatically once it becomes empty.
  useEffect(() => {
    if (cart.length === 0) setIsCartOpen(false)
  }, [cart.length])

  useEffect(() => {
    const locked = isCartOpen || showHistory
    document.body.style.overflow = locked ? 'hidden' : 'unset'
    return () => {
      document.body.style.overflow = 'unset'
    }
  }, [isCartOpen, showHistory])

  // Escape closes the top-most layer.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (selectedOrder) setSelectedOrder(null)
      else if (showHistory) closeHistory()
      else if (isCartOpen) setIsCartOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [selectedOrder, showHistory, isCartOpen])

  /* ------------------------------------------------------------------
     RENDER
  ------------------------------------------------------------------ */

  const categoryOptions: { id: string; name: string }[] = [
    { id: '', name: 'All' },
    ...(categories.data ?? []).map((cat: Category) => ({
      id: String(cat.id),
      name: cat.name,
    })),
  ]

  return (
    <div className="flex min-h-full flex-col bg-white text-[#091413] antialiased">
      {/* HEADER */}
      <header className="sticky top-0 z-30 bg-white/95 px-5 pb-3 pt-4 backdrop-blur-md">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight">New order</h1>
            <p className="mt-0.5 text-sm text-slate-500">Tap a product to add it.</p>
          </div>

          <button
            type="button"
            onClick={() => {
              setHistoryPage(1)
              setShowHistory(true)
            }}
            className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full bg-[#F3F5F4] px-4 text-sm font-medium transition hover:bg-[#E9EEEB] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B]"
          >
            <History size={15} className="text-[#1F5E3B]" />
            History
          </button>
        </div>

        {/* Search */}
        <div className="relative mt-4">
          <Search
            size={16}
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            type="search"
            inputMode="search"
            enterKeyHint="search"
            aria-label="Search products"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search or scan an item"
            className="h-12 w-full rounded-2xl border-0 bg-[#F3F5F4] pl-11 pr-12 text-[15px] placeholder:text-slate-400 outline-none transition focus:bg-white focus:ring-2 focus:ring-[#1F5E3B] [&::-webkit-search-cancel-button]:hidden"
          />
          {search ? (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label="Clear search"
              className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 active:bg-slate-200"
            >
              <X size={14} />
            </button>
          ) : (
            <Barcode
              size={18}
              className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-slate-400"
            />
          )}
        </div>

        {/* Categories */}
        <div
          role="tablist"
          aria-label="Categories"
          className="-mx-5 mt-3 flex gap-2 overflow-x-auto px-5 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {categoryOptions.map((cat) => {
            const isActive = categoryId === cat.id
            return (
              <button
                key={cat.id || 'all'}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setCategoryId(cat.id)}
                className={`h-10 shrink-0 rounded-full px-4 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B] focus-visible:ring-offset-2 ${
                  isActive
                    ? 'bg-[#1F5E3B] text-white'
                    : 'bg-[#F3F5F4] text-slate-600 active:bg-[#E9EEEB]'
                }`}
              >
                {cat.name}
              </button>
            )
          })}
        </div>
      </header>

      {/* CATALOG */}
      <main className={`flex-1 px-5 pt-2 ${cart.length > 0 ? 'pb-24' : 'pb-6'}`}>
        {catalog.loading && !catalog.data && (
          <div className="flex h-56 items-center justify-center">
            <Spinner />
          </div>
        )}

        {catalog.error && (
          <div className="py-8">
            <ErrorState message={catalog.error} onRetry={() => void catalog.reload()} />
          </div>
        )}

        {!catalog.loading && !catalog.error && catalog.data?.length === 0 && (
          <div className="py-16 text-center">
            <EmptyState
              title="No products found"
              hint={search ? `Nothing matches “${search}”.` : 'Try a different category.'}
            />
          </div>
        )}

        {catalog.data && catalog.data.length > 0 && (
          <div
            className={`grid grid-cols-2 gap-3 transition-opacity sm:grid-cols-3 ${
              catalog.loading ? 'opacity-60' : ''
            }`}
          >
            {catalog.data.map((product: Product) => (
              <ProductCard
                key={product.id}
                product={product}
                qtyInCart={cart.find((l: CartLine) => l.product.id === product.id)?.quantity ?? 0}
                canAddMore={canSell(product, cart)}
                price={money(product.sellingPrice)}
                onAdd={() => add(product)}
                onChangeQty={(qty) => changeQty(product, qty)}
              />
            ))}
          </div>
        )}
      </main>

      {/* CART BAR — one clear primary action, sits above the bottom nav */}
      {cart.length > 0 && !isCartOpen && (
        <div
          className="fixed inset-x-0 z-40 px-4 pb-3"
          style={{ bottom: ABOVE_BOTTOM_NAV }}
        >
          <button
            type="button"
            onClick={() => setIsCartOpen(true)}
            className="mx-auto flex h-14 w-full max-w-lg items-center gap-3 rounded-2xl bg-[#1F5E3B] pl-4 pr-3 text-white shadow-[0_8px_24px_rgba(31,94,59,0.35)] transition active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B] focus-visible:ring-offset-2"
          >
            <span className="flex h-8 min-w-8 items-center justify-center rounded-full bg-white/15 px-2 text-sm font-semibold tabular-nums">
              {totalItemCount}
            </span>
            <span className="flex-1 text-left text-[15px] font-medium">View order</span>
            <span className="text-[15px] font-semibold tabular-nums">{money(totals.total)}</span>
            <ChevronRight size={14} className="text-white/70" />
          </button>
        </div>
      )}

      {/* CART SHEET */}
      {isCartOpen && (
        <Sheet onClose={() => setIsCartOpen(false)} label="Current order">
          <div className="flex items-center justify-between gap-3 px-5 pb-3">
            <div>
              <h2 className="text-lg font-semibold">Current order</h2>
              <p className="text-sm text-slate-500">
                {totalItemCount} {totalItemCount === 1 ? 'item' : 'items'}
              </p>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={clearCart}
                className={`h-10 rounded-full px-3 text-sm font-medium transition ${
                  confirmClear
                    ? 'bg-rose-600 text-white'
                    : 'text-rose-600 active:bg-rose-50'
                }`}
              >
                {confirmClear ? 'Tap to confirm' : 'Clear'}
              </button>
              <CloseButton onClick={() => setIsCartOpen(false)} label="Close order" />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto overscroll-contain px-5">
            {/* Customer */}
            <div className="rounded-2xl bg-[#F6F8F7]">
              <button
                type="button"
                onClick={() => setIsPickingCustomer((open) => !open)}
                aria-expanded={isPickingCustomer}
                className="flex min-h-14 w-full items-center gap-3 px-4 text-left"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-[#1F5E3B]">
                  <UserRound size={14} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px]">
                    {selectedCustomer?.fullName ?? 'Walk-in customer'}
                  </span>
                  {selectedCustomer && (
                    <span className="block text-xs text-[#1F5E3B]">
                      {selectedCustomer.loyaltyPoints} loyalty pts
                    </span>
                  )}
                </span>
                <span className="text-sm font-medium text-[#1F5E3B]">
                  {isPickingCustomer ? 'Done' : 'Change'}
                </span>
              </button>

              {isPickingCustomer && (
                <div className="px-4 pb-3">
                  <div className="relative">
                    <Search
                      size={14}
                      className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
                    />
                    <input
                      autoFocus
                      type="search"
                      aria-label="Search customers"
                      placeholder="Search customers"
                      value={customerSearch}
                      onChange={(e) => setCustomerSearch(e.target.value)}
                      className="h-11 w-full rounded-xl border-0 bg-white pl-10 pr-3 text-[15px] placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-[#1F5E3B]"
                    />
                  </div>

                  <ul className="mt-2 max-h-48 overflow-y-auto rounded-xl bg-white">
                    <CustomerOption
                      name="Walk-in customer"
                      selected={customerId == null}
                      onSelect={() => selectCustomer(null)}
                    />
                    {customers.loading && (
                      <li className="px-4 py-3 text-sm text-slate-400">Searching…</li>
                    )}
                    {(customers.data ?? []).map((c: Customer) => (
                      <CustomerOption
                        key={c.id}
                        name={c.fullName}
                        detail={`${c.loyaltyPoints} pts`}
                        selected={c.id === customerId}
                        onSelect={() => selectCustomer(c)}
                      />
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Items */}
            <ul className="mt-2">
              {cart.map((line: CartLine) => (
                <li
                  key={line.product.id}
                  className="flex items-center gap-3 border-b border-slate-100 py-3 last:border-b-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px]">{line.product.name}</p>
                    <p className="text-sm tabular-nums text-slate-500">
                      {money(line.product.sellingPrice * line.quantity)}
                      {line.quantity > 1 && (
                        <span className="text-slate-400"> · {money(line.product.sellingPrice)} each</span>
                      )}
                    </p>
                  </div>

                  <Stepper
                    name={line.product.name}
                    quantity={line.quantity}
                    canIncrease={canSell(line.product, cart)}
                    onChange={(qty) => changeQty(line.product, qty)}
                  />
                </li>
              ))}
            </ul>

            {/* Discount */}
            <label className="mb-4 mt-2 flex min-h-14 items-center justify-between gap-3 rounded-2xl bg-[#F6F8F7] px-4">
              <span className="text-[15px]">Discount</span>
              <span className="flex items-center gap-1.5">
                <span className="text-sm text-slate-400">{settings.currencySymbol}</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={totals.subtotal}
                  value={discount || ''}
                  placeholder="0.00"
                  onChange={(e) =>
                    setCheckout({ ...checkout, discount: Math.max(0, Number(e.target.value) || 0) })
                  }
                  className="h-10 w-24 rounded-xl border-0 bg-white px-3 text-right text-[15px] tabular-nums outline-none focus:ring-2 focus:ring-[#1F5E3B]"
                />
              </span>
            </label>
            {discount > totals.subtotal && (
              <p className="-mt-2 mb-4 px-1 text-xs text-amber-700">
                Discount is capped at the subtotal ({money(totals.subtotal)}).
              </p>
            )}
          </div>

          {/* Totals + primary action */}
          <div className="border-t border-slate-100 px-5 pb-[max(1rem,env(safe-area-inset-bottom,0px))] pt-4">
            <dl className="space-y-1.5 text-sm">
              <TotalRow label="Subtotal" value={money(totals.subtotal)} />
              {totals.discount > 0 && (
                <TotalRow label="Discount" value={`−${money(totals.discount)}`} />
              )}
              <TotalRow label={`Tax (${Math.round(settings.taxRate * 10000) / 100}%)`} value={money(totals.tax)} />
            </dl>

            <button
              type="button"
              onClick={proceedToPayment}
              className="mt-4 flex h-14 w-full items-center justify-between rounded-2xl bg-[#1F5E3B] px-5 text-white transition active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B] focus-visible:ring-offset-2"
            >
              <span className="text-[15px] font-medium">Charge</span>
              <span className="text-lg font-semibold tabular-nums">{money(totals.total)}</span>
            </button>
          </div>
        </Sheet>
      )}

      {/* PAYMENT */}
      {isPaymentOpen && <PaymentModal onClose={() => setIsPaymentOpen(false)} />}

      {/* HISTORY — full-screen page */}
      {showHistory && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Order history"
          className="fixed inset-0 z-50 flex flex-col bg-white pt-[env(safe-area-inset-top,0px)] animate-in slide-in-from-right duration-200"
        >
          <div className="flex items-center gap-2 px-2 pt-2">
            <button
              type="button"
              onClick={closeHistory}
              aria-label="Back to order"
              className="flex h-11 w-11 items-center justify-center rounded-full active:bg-slate-100"
            >
              <ChevronLeft size={16} />
            </button>
            <div>
              <h2 className="text-lg font-semibold">Order history</h2>
              <p className="text-xs text-slate-500">
                {history.data?.totalCount ?? 0} orders
              </p>
            </div>
          </div>

          <div className="px-5 py-3">
            <div className="relative">
              <Search
                size={15}
                className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                type="search"
                aria-label="Search orders"
                value={historySearch}
                onChange={(e) => {
                  setHistorySearch(e.target.value)
                  setHistoryPage(1)
                }}
                placeholder="Invoice or customer"
                className="h-12 w-full rounded-2xl border-0 bg-[#F3F5F4] pl-11 pr-4 text-[15px] placeholder:text-slate-400 outline-none focus:bg-white focus:ring-2 focus:ring-[#1F5E3B]"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto overscroll-contain px-5">
            {history.loading && (
              <div className="py-16 text-center">
                <Spinner />
              </div>
            )}

            {history.error && (
              <div className="py-8">
                <ErrorState message={history.error} onRetry={() => void history.reload()} />
              </div>
            )}

            {!history.loading && !history.error && history.data?.items.length === 0 && (
              <div className="py-16 text-center">
                <EmptyState title="No orders found" hint="Try another search term." />
              </div>
            )}

            <ul>
              {history.data?.items.map((order: Sale) => (
                <li key={order.id} className="border-b border-slate-100 last:border-b-0">
                  <button
                    type="button"
                    onClick={() => openOrder(order)}
                    disabled={openingOrderId !== null}
                    className="flex min-h-[72px] w-full items-center gap-3 py-3 text-left transition active:bg-slate-50 disabled:opacity-60"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px]">
                        {order.customerName || 'Walk-in customer'}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-slate-400">
                        {order.invoiceNumber} · {formatDateTime(order.createdAt)}
                      </p>
                    </div>

                    <div className="shrink-0 text-right">
                      <p className="text-[15px] font-medium tabular-nums">{money(order.total)}</p>
                      <p className="text-xs text-slate-400">{order.paymentMethod}</p>
                    </div>

                    {openingOrderId === order.id ? (
                      <Spinner />
                    ) : (
                      <ChevronRight size={12} className="text-slate-300" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {history.data && history.data.totalPages > 1 && (
            <div className="border-t border-slate-100 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))]">
              <Pagination
                page={history.data.page}
                totalPages={history.data.totalPages}
                onPage={setHistoryPage}
              />
            </div>
          )}

          {/* Order detail */}
          {selectedOrder && (
            <Sheet onClose={() => setSelectedOrder(null)} label="Order details" elevated>
              <div className="flex items-start justify-between gap-3 px-5 pb-3">
                <div className="min-w-0">
                  <h3 className="truncate text-lg font-semibold">{selectedOrder.invoiceNumber}</h3>
                  <p className="text-sm text-slate-500">
                    {selectedOrder.customerName || 'Walk-in customer'} ·{' '}
                    {formatDateTime(selectedOrder.createdAt)}
                  </p>
                </div>
                <CloseButton onClick={() => setSelectedOrder(null)} label="Close order details" />
              </div>

              <ul className="flex-1 overflow-y-auto px-5">
                {selectedOrder.items.map((item: SaleItem) => (
                  <li
                    key={item.productId}
                    className="flex items-baseline justify-between gap-3 border-b border-slate-100 py-3 text-[15px] last:border-b-0"
                  >
                    <span className="min-w-0 truncate">
                      {item.productName}
                      <span className="text-slate-400"> × {item.quantity}</span>
                    </span>
                    <span className="shrink-0 tabular-nums">{money(item.lineTotal)}</span>
                  </li>
                ))}
              </ul>

              <div className="border-t border-slate-100 px-5 pb-[max(1rem,env(safe-area-inset-bottom,0px))] pt-4">
                <div className="flex items-baseline justify-between">
                  <span className="text-[15px]">Total</span>
                  <span className="text-xl font-semibold tabular-nums">{money(selectedOrder.total)}</span>
                </div>

                <button
                  type="button"
                  onClick={() => handleReprint(selectedOrder)}
                  disabled={isPrinting}
                  className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#F3F5F4] text-[15px] font-medium transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <PrinterIcon size={16} />
                  {isPrinting ? 'Printing…' : lastPrintError ? 'Retry print' : 'Reprint receipt'}
                </button>
              </div>
            </Sheet>
          )}
        </div>
      )}
    </div>
  )
}

/* ====================================================================
   PRODUCT CARD
==================================================================== */

function ProductCard({
  product,
  qtyInCart,
  canAddMore,
  price,
  onAdd,
  onChangeQty,
}: {
  product: Product
  qtyInCart: number
  canAddMore: boolean
  price: string
  onAdd: () => void
  onChangeQty: (qty: number) => void
}) {
  const outOfStock = product.stockQuantity <= 0
  const lowStock = !outOfStock && product.stockStatus === 'Low Stock'
  const inCart = qtyInCart > 0

  return (
    <div
      className={`relative flex flex-col overflow-hidden rounded-2xl bg-white transition ${
        inCart ? 'ring-2 ring-[#1F5E3B]' : 'ring-1 ring-slate-100'
      } ${outOfStock ? 'opacity-50' : ''}`}
    >
      {/* Whole top area is the add target */}
      <button
        type="button"
        onClick={onAdd}
        disabled={outOfStock || !canAddMore}
        aria-label={`Add ${product.name}`}
        className="flex flex-1 flex-col text-left active:bg-slate-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#1F5E3B]"
      >
        <div className="aspect-4/3 w-full bg-[#F3F5F4]">
          {product.imageUrl ? (
            <img
              src={product.imageUrl}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-2xl font-semibold text-slate-300">
              {product.name.slice(0, 1).toUpperCase()}
            </div>
          )}
        </div>

        <div className="flex flex-1 flex-col px-3 pt-2.5">
          <p className="line-clamp-2 text-sm leading-5">{product.name}</p>
          <p className="mt-auto pt-1 text-[15px] font-semibold tabular-nums">{price}</p>
          {(outOfStock || lowStock) && (
            <p className={`text-xs ${outOfStock ? 'text-rose-600' : 'text-amber-700'}`}>
              {outOfStock ? 'Out of stock' : `${product.stockQuantity} left`}
            </p>
          )}
        </div>
      </button>

      <div className="px-3 pb-3 pt-2">
        {inCart ? (
          <Stepper
            name={product.name}
            quantity={qtyInCart}
            canIncrease={canAddMore}
            onChange={onChangeQty}
            fullWidth
          />
        ) : (
          <button
            type="button"
            onClick={onAdd}
            disabled={outOfStock}
            tabIndex={-1}
            aria-hidden="true"
            className="flex h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-[#F3F5F4] text-sm font-medium text-[#1F5E3B] active:bg-[#E6F1EA] disabled:text-slate-400"
          >
            <Plus size={11} />
            Add
          </button>
        )}
      </div>
    </div>
  )
}

/* ====================================================================
   BUILDING BLOCKS
==================================================================== */

function Stepper({
  name,
  quantity,
  canIncrease,
  onChange,
  fullWidth = false,
}: {
  name: string
  quantity: number
  canIncrease: boolean
  onChange: (qty: number) => void
  fullWidth?: boolean
}) {
  // At quantity 1 the minus becomes a remove action.
  const willRemove = quantity <= 1

  return (
    <div
      className={`flex h-10 items-center rounded-xl bg-[#E6F1EA] text-[#1F5E3B] ${
        fullWidth ? 'w-full justify-between' : ''
      }`}
    >
      <button
        type="button"
        onClick={() => onChange(quantity - 1)}
        aria-label={willRemove ? `Remove ${name}` : `Decrease ${name}`}
        className="flex h-10 w-10 items-center justify-center rounded-xl active:bg-[#D3E6DB]"
      >
        {willRemove ? <Trash2 size={13} /> : <Minus size={11} />}
      </button>

      <span
        aria-live="polite"
        className="min-w-8 text-center text-[15px] font-semibold tabular-nums"
      >
        {quantity}
      </span>

      <button
        type="button"
        onClick={() => onChange(quantity + 1)}
        disabled={!canIncrease}
        aria-label={`Increase ${name}`}
        className="flex h-10 w-10 items-center justify-center rounded-xl active:bg-[#D3E6DB] disabled:opacity-30"
      >
        <Plus size={11} />
      </button>
    </div>
  )
}

function Sheet({
  label,
  onClose,
  elevated = false,
  children,
}: {
  label: string
  onClose: () => void
  elevated?: boolean
  children: ReactNode
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      className={`fixed inset-0 flex flex-col justify-end ${elevated ? 'z-60' : 'z-50'}`}
    >
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden="true" />

      <div className="relative flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-white animate-in slide-in-from-bottom duration-200">
        <div className="flex justify-center pb-2 pt-2.5">
          <span className="h-1 w-10 rounded-full bg-slate-200" />
        </div>
        {children}
      </div>
    </div>
  )
}

function CloseButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex h-10 w-10 items-center justify-center rounded-full bg-[#F3F5F4] text-slate-500 active:bg-[#E9EEEB]"
    >
      <X size={14} />
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
        className="flex min-h-11 w-full items-center gap-3 px-4 text-left text-[15px] active:bg-slate-50"
      >
        <span className={`min-w-0 flex-1 truncate ${selected ? 'font-medium text-[#1F5E3B]' : ''}`}>
          {name}
        </span>
        {detail && <span className="text-xs text-slate-400">{detail}</span>}
        {selected && <span className="h-2 w-2 rounded-full bg-[#1F5E3B]" />}
      </button>
    </li>
  )
}

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-slate-500">
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  )
}

function PrinterIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="6 9 6 2 18 2 18 9" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" />
    </svg>
  )
}

export default MobileSales
