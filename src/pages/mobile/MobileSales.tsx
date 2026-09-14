import { useEffect, useMemo, useState } from 'react'
import {
  Barcode,
  ChevronDown,
  History,
  Minus,
  Plus,
  Search,
  Trash2,
  UserRound,
} from '../../components/ui/Icons'

import { categoryApi } from '../../api/categoryApi'
import { customerApi } from '../../api/customerApi'
import { productApi } from '../../api/productApi'
import { salesApi } from '../../api/salesApi'

import { Badge, stockTone } from '../../components/ui/Badge'
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
  removeLine,
  setLineQty,
} from '../../utils/pos'

export interface CartLine {
  product: Product
  quantity: number
}

export function MobileSales() {
  const { notify } = useToast()
  const { settings } = useSettings()
  const { user } = useAuth()
  const { state: checkout, setState: setCheckout } = useCheckout()
  const { printReceipt: reprintReceipt, isPrinting, lastPrintError } = useReceiptPrinter()

  // UI States
  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [isCartOpen, setIsCartOpen] = useState(false)
  const [isPaymentOpen, setIsPaymentOpen] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [customerSearch, setCustomerSearch] = useState('')
  const [historySearch, setHistorySearch] = useState('')
  const [historyPage, setHistoryPage] = useState(1)
  const [selectedOrder, setSelectedOrder] = useState<Sale | null>(null)

  const cart: CartLine[] = checkout.cart
  const customerId = checkout.customerId
  const discount = checkout.discount

  const q = useDebounced(search)
  const cq = useDebounced(customerSearch)

  // API Queries
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

  const selectedCustomer = customers.data?.find(
    (c: Customer) => c.id === customerId,
  )

  const totalItemCount = useMemo(
    () => cart.reduce((acc: number, line: CartLine) => acc + line.quantity, 0),
    [cart],
  )

  function add(product: Product) {
    if (product.stockQuantity <= 0) {
      notify('This item is out of stock.', 'error')
      return
    }

    if (!canSell(product, cart)) {
      notify('Not enough stock available.', 'error')
      return
    }

    setCheckout({
      ...checkout,
      cart: addToCart(cart, product),
    })
  }

  function clearCart() {
    if (cart.length === 0) return
    setCheckout({
      ...checkout,
      cart: [],
      discount: 0,
    })
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

  function handleReprint(order: Sale) {
    void reprintReceipt(order, settings).then(
      () => notify('Receipt printed successfully.'),
      (err) => notify(printerErrorMessage(err), 'error'),
    )
  }

  useEffect(() => {
    if (isCartOpen || showHistory) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = 'unset'
    }
    return () => {
      document.body.style.overflow = 'unset'
    }
  }, [isCartOpen, showHistory])

  return (
    <div className="flex min-h-[100dvh] flex-col bg-[#091413]/[0.02] text-[#091413] antialiased">
      {/* Top Header */}
      <header className="sticky top-0 z-30 border-b border-[#091413]/10 bg-white/95 px-3.5 py-2.5 backdrop-blur-md">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-base font-bold tracking-tight text-[#091413]">Order Process</h1>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setHistoryPage(1)
                setShowHistory(true)
              }}
              className="flex h-9 items-center gap-1.5 rounded-lg border border-[#091413]/10 bg-white px-2.5 text-xs font-medium text-[#091413]/70 shadow-xs active:bg-[#285A48]/10"
              aria-label="Order History"
            >
              <History size={14} className="text-[#285A48]" />
              <span className="hidden sm:inline">History</span>
            </button>

            <button
              type="button"
              onClick={() => setIsCartOpen(true)}
              className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-[#091413]/10 bg-white text-[#091413] shadow-xs active:bg-[#285A48]/10"
              aria-label="Open Cart"
            >
              <CartIcon size={16} />
              {totalItemCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#285A48] px-1 text-[10px] font-bold text-white shadow-xs">
                  {totalItemCount}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Search Input */}
        <div className="mt-2.5 flex items-center gap-2">
          <div className="relative flex-1">
            <Search
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#091413]/40"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search or scan item..."
              className="h-9 w-full rounded-lg border border-[#091413]/15 bg-white pl-8.5 pr-8 text-xs text-[#091413] placeholder-[#091413]/40 outline-none transition-colors focus:border-[#285A48] focus:ring-1 focus:ring-[#285A48]"
            />
            {search ? (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-[#091413]/40 active:text-[#091413]"
              >
                <ClearIcon size={12} />
              </button>
            ) : (
              <Barcode
                size={15}
                className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[#285A48]/70"
              />
            )}
          </div>
        </div>

        {/* Category Carousel */}
        <div className="mt-2.5 flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          <button
            type="button"
            onClick={() => setCategoryId('')}
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-all ${
              !categoryId
                ? 'bg-[#285A48] text-white shadow-xs'
                : 'border border-[#091413]/10 bg-white text-[#091413]/70 active:bg-[#091413]/5'
            }`}
          >
            All Items
          </button>

          {(categories.data ?? []).map((cat: Category) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setCategoryId(String(cat.id))}
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-all ${
                categoryId === String(cat.id)
                  ? 'bg-[#285A48] text-white shadow-xs'
                  : 'border border-[#091413]/10 bg-white text-[#091413]/70 active:bg-[#091413]/5'
              }`}
            >
              {cat.name}
            </button>
          ))}
        </div>
      </header>

      {/* Catalog Grid */}
      <main className="flex-1 px-3 py-3 pb-24">
        {catalog.loading && (
          <div className="flex h-56 items-center justify-center">
            <Spinner />
          </div>
        )}

        {catalog.error && (
          <div className="p-4">
            <ErrorState message={catalog.error} onRetry={() => void catalog.reload()} />
          </div>
        )}

        {!catalog.loading && !catalog.error && catalog.data?.length === 0 && (
          <div className="py-16 text-center">
            <EmptyState
              title="No products found"
              hint="Try searching a different item or category."
            />
          </div>
        )}

        {catalog.data && catalog.data.length > 0 && (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {catalog.data.map((product: Product) => {
              const lineItem = cart.find((l: CartLine) => l.product.id === product.id)
              const qtyInCart = lineItem?.quantity ?? 0

              return (
                <MobileProductCard
                  key={product.id}
                  product={product}
                  qtyInCart={qtyInCart}
                  currencySymbol={settings.currencySymbol}
                  onAdd={add}
                />
              )
            })}
          </div>
        )}
      </main>

      {/* Bottom Cart Bar */}
      {cart.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[#091413]/10 bg-white/95 p-3 shadow-lg backdrop-blur-md">
          <div className="mx-auto flex max-w-lg items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setIsCartOpen(true)}
              className="flex min-w-0 flex-col text-left active:opacity-80"
            >
              <div className="flex items-center gap-1.5">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#285A48] text-[10px] font-bold text-white">
                  {totalItemCount}
                </span>
                <span className="text-xs font-semibold uppercase tracking-wider text-[#091413]/60">
                  Cart Subtotal
                </span>
              </div>
              <p className="font-mono text-base font-bold text-[#091413]">
                {formatMoney(totals.total, settings.currencySymbol)}
              </p>
            </button>

            <button
              type="button"
              onClick={() => setIsCartOpen(true)}
              className="flex h-11 items-center justify-center gap-2 rounded-xl bg-[#285A48] px-5 text-xs font-semibold text-white shadow-xs transition-all active:scale-[0.98] active:bg-[#1e4436]"
            >
              <span>Review & Pay</span>
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Cart Drawer */}
      {isCartOpen && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40 backdrop-blur-xs">
          <div className="flex-1" onClick={() => setIsCartOpen(false)} />

          <div className="max-h-[88dvh] w-full rounded-t-2xl bg-white shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom duration-200">
            <div className="flex justify-center pt-2 pb-1">
              <div className="h-1.25 w-10 rounded-full bg-[#091413]/20" />
            </div>

            <div className="flex items-center justify-between border-b border-[#091413]/10 px-4 py-2.5">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-[#091413]">Current Order</h2>
                <span className="rounded-md border border-[#285A48]/20 bg-[#285A48]/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-[#285A48]">
                  {totalItemCount} {totalItemCount === 1 ? 'item' : 'items'}
                </span>
              </div>

              <div className="flex items-center gap-2">
                {cart.length > 0 && (
                  <button
                    type="button"
                    onClick={clearCart}
                    className="text-xs font-medium text-rose-600 hover:text-rose-700 active:underline"
                  >
                    Clear
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setIsCartOpen(false)}
                  className="rounded-full p-1 text-[#091413]/40 active:bg-[#091413]/5"
                  aria-label="Close drawer"
                >
                  <ClearIcon size={16} />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {/* Customer Selector */}
              <div className="rounded-xl border border-[#091413]/10 bg-[#091413]/[0.02] p-3">
                <div className="relative mb-2">
                  <UserRound
                    size={14}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#091413]/40"
                  />
                  <input
                    placeholder="Search registered customer..."
                    value={customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                    className="h-8.5 w-full rounded-lg border border-[#091413]/15 bg-white pl-8.5 pr-8 text-xs text-[#091413] placeholder-[#091413]/40 outline-none focus:border-[#285A48]"
                  />
                  {customerSearch && (
                    <button
                      type="button"
                      onClick={() => setCustomerSearch('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[#091413]/40"
                    >
                      <ClearIcon size={12} />
                    </button>
                  )}
                </div>

                <div className="relative">
                  <select
                    value={customerId ?? ''}
                    onChange={(e) =>
                      setCheckout({
                        ...checkout,
                        customerId: e.target.value ? Number(e.target.value) : null,
                      })
                    }
                    className="h-8.5 w-full appearance-none rounded-lg border border-[#091413]/15 bg-white px-3 pr-8 text-xs text-[#091413] outline-none focus:border-[#285A48]"
                  >
                    <option value="">Walk-in customer</option>
                    {(customers.data ?? []).map((c: Customer) => (
                      <option key={c.id} value={c.id}>
                        {c.fullName}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    size={14}
                    className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[#091413]/40"
                  />
                </div>

                {selectedCustomer && (
                  <div className="mt-2 flex items-center justify-between text-xs">
                    <span className="text-[#091413]/60">Customer Loyalty</span>
                    <span className="font-semibold text-[#285A48]">
                      {selectedCustomer.loyaltyPoints} pts
                    </span>
                  </div>
                )}
              </div>

              {/* Items List */}
              {cart.length === 0 ? (
                <div className="py-10 text-center">
                  <EmptyState title="Cart is empty" hint="Tap any product to add to cart." />
                </div>
              ) : (
                <div className="space-y-2">
                  {cart.map((line: CartLine) => (
                    <div
                      key={line.product.id}
                      className="flex items-center justify-between gap-2 rounded-xl border border-[#091413]/10 bg-white p-3 shadow-2xs"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold text-[#091413]">
                          {line.product.name}
                        </p>
                        <p className="font-mono text-[11px] text-[#091413]/50">
                          {formatMoney(line.product.sellingPrice, settings.currencySymbol)} each
                        </p>
                      </div>

                      <div className="flex h-8 items-center rounded-lg border border-[#091413]/15 bg-white">
                        <button
                          type="button"
                          aria-label="Decrease quantity"
                          onClick={() =>
                            setCheckout({
                              ...checkout,
                              cart: setLineQty(cart, line.product.id, line.quantity - 1),
                            })
                          }
                          className="flex h-8 w-8 items-center justify-center text-[#091413]/60 active:bg-[#285A48]/10 active:text-[#285A48]"
                        >
                          <Minus size={13} />
                        </button>

                        <span className="flex h-8 min-w-[28px] items-center justify-center font-mono text-xs font-bold text-[#091413]">
                          {line.quantity}
                        </span>

                        <button
                          type="button"
                          aria-label="Increase quantity"
                          disabled={!canSell(line.product, cart)}
                          onClick={() =>
                            setCheckout({
                              ...checkout,
                              cart: setLineQty(cart, line.product.id, line.quantity + 1),
                            })
                          }
                          className="flex h-8 w-8 items-center justify-center text-[#091413]/60 active:bg-[#285A48]/10 active:text-[#285A48] disabled:opacity-30"
                        >
                          <Plus size={13} />
                        </button>
                      </div>

                      <button
                        type="button"
                        aria-label="Delete line"
                        onClick={() =>
                          setCheckout({
                            ...checkout,
                            cart: removeLine(cart, line.product.id),
                          })
                        }
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-[#091413]/40 active:bg-rose-50 active:text-rose-600"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Discount Input */}
              {cart.length > 0 && (
                <div className="flex items-center justify-between rounded-xl border border-[#091413]/10 bg-[#091413]/[0.02] p-3 text-xs">
                  <span className="font-medium text-[#091413]/70">Discount</span>
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[#091413]/40">{settings.currencySymbol}</span>
                    <input
                      type="number"
                      min={0}
                      value={discount || ''}
                      placeholder="0"
                      onChange={(e) =>
                        setCheckout({
                          ...checkout,
                          discount: Number(e.target.value) || 0,
                        })
                      }
                      className="h-7 w-20 rounded border border-[#091413]/15 bg-white px-2 text-right font-mono text-xs font-semibold text-[#091413] outline-none focus:border-[#285A48]"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Totals & Checkout Button */}
            {cart.length > 0 && (
              <div className="border-t border-[#091413]/10 bg-white p-4">
                <div className="mb-3 space-y-1 text-xs text-[#091413]/60">
                  <div className="flex justify-between">
                    <span>Subtotal</span>
                    <span className="font-mono">{formatMoney(totals.subtotal, settings.currencySymbol)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Tax ({settings.taxRate}%)</span>
                    <span className="font-mono">{formatMoney(totals.tax, settings.currencySymbol)}</span>
                  </div>
                  <div className="flex items-baseline justify-between pt-1 border-t border-[#091413]/5 text-sm font-bold text-[#091413]">
                    <span>Total Due</span>
                    <span className="font-mono text-xl text-[#285A48]">
                      {formatMoney(totals.total, settings.currencySymbol)}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={proceedToPayment}
                  className="w-full rounded-xl bg-[#285A48] py-3 text-center text-sm font-bold text-white shadow-md active:scale-[0.99] active:bg-[#1f483a]"
                >
                  Charge {formatMoney(totals.total, settings.currencySymbol)}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Payment Modal */}
      {isPaymentOpen && (
        <PaymentModal onClose={() => setIsPaymentOpen(false)} />
      )}

      {/* History Drawer */}
      {showHistory && (
        <div className="fixed inset-0 z-50 flex flex-col bg-white animate-in slide-in-from-right duration-200">
          <div className="flex items-center justify-between border-b border-[#091413]/10 px-4 py-3">
            <div>
              <h2 className="text-base font-bold text-[#091413]">Order History</h2>
              <p className="text-[11px] font-mono text-[#091413]/50">
                {history.data?.totalCount ?? 0} orders recorded
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setShowHistory(false)
                setSelectedOrder(null)
              }}
              className="rounded-lg border border-[#091413]/10 px-3 py-1.5 text-xs font-semibold text-[#091413]/70 active:bg-[#091413]/5"
            >
              Close
            </button>
          </div>

          <div className="p-3 border-b border-[#091413]/5 bg-[#091413]/[0.02]">
            <div className="relative">
              <Search
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#091413]/40"
              />
              <input
                className="h-9 w-full rounded-lg border border-[#091413]/15 bg-white pl-8.5 pr-8 text-xs text-[#091413] placeholder-[#091413]/40 outline-none focus:border-[#285A48]"
                value={historySearch}
                onChange={(e) => {
                  setHistorySearch(e.target.value)
                  setHistoryPage(1)
                }}
                placeholder="Search invoice or customer..."
              />
              {historySearch && (
                <button
                  type="button"
                  onClick={() => {
                    setHistorySearch('')
                    setHistoryPage(1)
                  }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-[#091413]/40"
                >
                  <ClearIcon size={12} />
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            {history.loading && (
              <div className="py-16 text-center">
                <Spinner />
              </div>
            )}

            {history.error && (
              <div className="p-4">
                <ErrorState message={history.error} onRetry={() => void history.reload()} />
              </div>
            )}

            {!history.loading && !history.error && history.data?.items.length === 0 && (
              <div className="py-16 text-center">
                <EmptyState title="No orders found" hint="Try another search term." />
              </div>
            )}

            <div className="space-y-2.5">
              {history.data?.items.map((order: Sale) => (
                <div
                  key={order.id}
                  onClick={() => {
                    void salesApi
                      .get(order.id)
                      .then(setSelectedOrder)
                      .catch((err: unknown) => notify(getErrorMessage(err), 'error'))
                  }}
                  className="rounded-xl border border-[#091413]/10 bg-white p-3.5 shadow-2xs transition-all active:scale-[0.99] active:border-[#285A48]/50"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-mono text-xs font-bold text-[#091413]">
                        {order.invoiceNumber}
                      </p>
                      <p className="text-[11px] text-[#091413]/50">
                        {formatDateTime(order.createdAt)}
                      </p>
                    </div>

                    <span className="font-mono text-sm font-bold text-[#285A48]">
                      {formatMoney(order.total, settings.currencySymbol)}
                    </span>
                  </div>

                  <div className="mt-2.5 flex items-center justify-between border-t border-[#091413]/5 pt-2 text-[11px]">
                    <span className="text-[#091413]/70 truncate max-w-[150px]">
                      {order.customerName || 'Walk-in customer'}
                    </span>
                    <span className="rounded border border-[#091413]/10 bg-[#091413]/[0.03] px-2 py-0.5 font-medium text-[#091413]/80">
                      {order.paymentMethod}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {selectedOrder && (
              <div className="fixed inset-0 z-60 flex items-end justify-center bg-black/40 backdrop-blur-2xs p-3">
                <div className="w-full max-h-[85vh] overflow-y-auto rounded-2xl bg-white p-4 shadow-xl">
                  <div className="flex items-center justify-between pb-2 border-b border-[#091413]/10">
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[#091413]/40">
                        Invoice
                      </span>
                      <p className="font-mono text-sm font-bold text-[#091413]">
                        {selectedOrder.invoiceNumber}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedOrder(null)}
                      className="rounded-lg bg-[#091413]/5 px-3 py-1 text-xs font-medium text-[#091413]"
                    >
                      Close
                    </button>
                  </div>

                  <div className="divide-y divide-[#091413]/5 py-2">
                    {selectedOrder.items.map((item: SaleItem) => (
                      <div key={item.productId} className="flex justify-between py-2 text-xs">
                        <span className="text-[#091413]/80">
                          {item.productName}{' '}
                          <span className="text-[#091413]/40">× {item.quantity}</span>
                        </span>
                        <span className="font-mono font-semibold text-[#091413]">
                          {formatMoney(item.lineTotal, settings.currencySymbol)}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="flex justify-between pt-2.5 border-t border-[#091413]/10 text-sm font-bold">
                    <span>Total</span>
                    <span className="font-mono text-[#285A48]">
                      {formatMoney(selectedOrder.total, settings.currencySymbol)}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleReprint(selectedOrder)}
                    disabled={isPrinting}
                    className="mt-3 flex h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-[#285A48] text-xs font-bold text-white shadow-xs active:scale-95 touch-manipulation disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <PrinterIcon size={14} />
                    {isPrinting ? 'Printing…' : lastPrintError ? 'Retry Print' : 'Reprint Receipt'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {history.data && history.data.totalPages > 1 && (
            <div className="border-t border-[#091413]/10 p-3 bg-white">
              <Pagination
                page={history.data.page}
                totalPages={history.data.totalPages}
                onPage={setHistoryPage}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function MobileProductCard({
  product,
  qtyInCart,
  currencySymbol,
  onAdd,
}: {
  product: Product
  qtyInCart: number
  currencySymbol: string
  onAdd: (product: Product) => void
}) {
  const outOfStock = product.stockQuantity <= 0

  return (
    <button
      type="button"
      disabled={outOfStock}
      onClick={() => onAdd(product)}
      className={`relative flex min-h-[170px] flex-col justify-between rounded-xl border p-2.5 text-left transition-all active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 ${
        qtyInCart > 0
          ? 'border-[#285A48] bg-white ring-1 ring-[#285A48] shadow-xs'
          : 'border-[#091413]/10 bg-white shadow-2xs'
      }`}
    >
      {qtyInCart > 0 && (
        <span className="absolute -top-1.5 -right-1.5 z-10 flex h-5.5 min-w-[22px] items-center justify-center rounded-full bg-[#285A48] px-1.5 font-mono text-[10px] font-bold text-white shadow-sm">
          {qtyInCart}
        </span>
      )}

      {product.imageUrl ? (
        <div className="mb-2 aspect-4/3 w-full shrink-0 overflow-hidden rounded-lg border border-[#091413]/5 bg-[#091413]/[0.02]">
          <img
            src={product.imageUrl}
            alt={product.name}
            className="h-full w-full object-cover"
          />
        </div>
      ) : (
        <div className="mb-2 flex aspect-4/3 w-full shrink-0 items-center justify-center rounded-lg border border-[#285A48]/15 bg-[#285A48]/5 font-bold text-sm text-[#285A48]">
          {product.name.slice(0, 1).toUpperCase()}
        </div>
      )}

      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-xs font-semibold leading-4 text-[#091413]">
          {product.name}
        </p>
        <p className="mt-0.5 truncate font-mono text-[10px] text-[#091413]/40">
          {product.sku}
        </p>
      </div>

      <div className="mt-2 flex items-center justify-between gap-1 border-t border-[#091413]/5 pt-1.5">
        <span className="font-mono text-xs font-bold text-[#091413]">
          {formatMoney(product.sellingPrice, currencySymbol)}
        </span>

        <Badge tone={stockTone(product.stockStatus)}>
          {outOfStock ? '0' : `${product.stockQuantity}`}
        </Badge>
      </div>
    </button>
  )
}

function CartIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="8" cy="21" r="1" />
      <circle cx="19" cy="21" r="1" />
      <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
    </svg>
  )
}

function ClearIcon({ size = 13 }: { size?: number }) {
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

function PrinterIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 6 2 18 2 18 9" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" />
    </svg>
  )
}

export default MobileSales
