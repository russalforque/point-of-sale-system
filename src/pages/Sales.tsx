import { useEffect, useMemo, useState } from 'react'
import {
  Barcode,
  ChevronDown,
  Eye,
  History,
  Minus,
  Plus,
  Search,
  Trash2,
  UserRound,
} from '../components/ui/Icons'

import { categoryApi } from '../api/categoryApi'
import { customerApi } from '../api/customerApi'
import { productApi } from '../api/productApi'
import { salesApi } from '../api/salesApi'

import { Badge, stockTone } from '../components/ui/Badge'
import { Modal } from '../components/ui/Modal'
import { PageHeader } from '../components/ui/Page'
import { Pagination } from '../components/ui/Pagination'
import { PaymentModal } from '../components/pos/PaymentModal'

import {
  EmptyState,
  ErrorState,
  Spinner,
} from '../components/ui/States'

import { useAuth } from '../context/AuthContext'
import { useCheckout } from '../context/CheckoutContext'
import { useSettings } from '../context/SettingsContext'
import { useToast } from '../context/ToastContext'
import { useAsync } from '../hooks/useAsync'
import { useDebounced } from '../hooks/useDebounced'
import { useReceiptPrinter } from '../hooks/useReceiptPrinter'

import { printerErrorMessage } from '../services/printer'
import type { Product, Sale } from '../types'
import { getErrorMessage } from '../utils/errors'
import { formatDateTime, formatMoney } from '../utils/format'
import {
  addToCart,
  calculateTotals,
  canSell,
  removeLine,
  setLineQty,
} from '../utils/pos'

// 📱 1. Mobile Sales Import
import MobileSales from "./mobile/MobileSales";

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

  // 💻 Otherwise render Desktop layout
  return <DesktopSales />
}

/* =============================================================
   DESKTOP SALES IMPLEMENTATION
============================================================= */

function DesktopSales() {
  const { notify } = useToast()
  const { settings } = useSettings()
  const { user } = useAuth()
  const { state: checkout, setState: setCheckout } = useCheckout()
  const { printReceipt: reprintReceipt, isPrinting, lastPrintError } = useReceiptPrinter()

  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [isMounted, setIsMounted] = useState(false)
  const [isPaymentOpen, setIsPaymentOpen] = useState(false)

  useEffect(() => {
    const id = window.setTimeout(() => setIsMounted(true), 40)
    return () => window.clearTimeout(id)
  }, [])

  const [customerSearch, setCustomerSearch] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [historySearch, setHistorySearch] = useState('')
  const [historyPage, setHistoryPage] = useState(1)
  const [selectedOrder, setSelectedOrder] = useState<Sale | null>(null)

  const cart = checkout.cart
  const customerId = checkout.customerId
  const discount = checkout.discount

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

  const customers = useAsync(
    () => customerApi.lookup(cq || undefined),
    [cq],
  )

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
    (customer) => customer.id === customerId,
  )

  function add(product: Product) {
    if (product.stockQuantity <= 0) {
      notify('This item is out of stock.', 'error')
      return
    }

    if (!canSell(product, cart)) {
      notify('Not enough stock available for this item.', 'error')
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
    notify('Cart cleared.')
  }

  function proceedToPayment() {
    if (cart.length === 0) {
      notify('Add items to the cart first.', 'error')
      return
    }
    setIsPaymentOpen(true)
  }

  function handleReprint(order: Sale) {
    void reprintReceipt(order, settings).then(
      () => notify('Receipt printed successfully.'),
      (err) => notify(printerErrorMessage(err), 'error'),
    )
  }

  return (
    <div className="min-h-screen bg-[#091413]/[0.02] text-[#091413] antialiased">
      <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 md:px-8">
        {/* Page Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <PageHeader
            title="Sales"
            subtitle="Create and process point-of-sale register orders"
          />
          <button
            type="button"
            onClick={() => {
              setHistoryPage(1)
              setShowHistory(true)
            }}
            className="inline-flex items-center justify-center gap-2 self-start rounded-lg border border-[#091413]/10 bg-white px-3.5 py-2 text-xs font-medium text-[#091413]/80 shadow-xs transition-all hover:border-[#285A48]/40 hover:bg-[#285A48]/5 hover:text-[#285A48] active:scale-[0.98] sm:self-auto"
          >
            <History size={15} className="text-[#285A48]" />
            <span>Order history</span>
          </button>
        </div>

        {/* 2-Column POS Layout */}
        <div
          className={`mt-2 grid min-h-0 gap-4 transition-all duration-300 ease-out xl:grid-cols-[minmax(0,1.8fr)_380px] xl:items-start ${
            isMounted ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
          }`}
        >
          {/* =======================================================
              LEFT: PRODUCT CATALOG
              ======================================================= */}
          <main className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-[#091413]/10 bg-white shadow-xs xl:max-h-[calc(100dvh-9.5rem)]">
            {/* Filter Toolbar */}
            <div className="shrink-0 border-b border-[#091413]/10 bg-white p-4">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 mb-3">
                {/* Search Bar */}
                <div className="relative flex-1">
                  <Search
                    size={14}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#091413]/40"
                  />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search product, SKU, or scan barcode..."
                    className="h-9 w-full rounded-lg border border-[#091413]/15 bg-white pl-8.5 pr-8 text-xs text-[#091413] placeholder-[#091413]/35 outline-none transition-colors focus:border-[#285A48] focus:ring-1 focus:ring-[#285A48]"
                  />
                  {search ? (
                    <button
                      type="button"
                      onClick={() => setSearch('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-[#091413]/40 hover:text-[#091413]"
                      title="Clear search"
                    >
                      <ClearIcon size={13} />
                    </button>
                  ) : (
                    <Barcode
                      size={16}
                      className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[#285A48]/70"
                    />
                  )}
                </div>

                {search && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearch('')
                      setCategoryId('')
                    }}
                    className="shrink-0 rounded-lg border border-[#091413]/15 bg-white px-3 py-2 text-xs font-medium text-[#091413]/70 transition-colors hover:bg-[#285A48]/5 hover:text-[#285A48]"
                  >
                    Reset
                  </button>
                )}
              </div>

              {/* Segmented Category Filter Pills */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
                <button
                  type="button"
                  onClick={() => setCategoryId('')}
                  className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                    !categoryId
                      ? 'bg-[#285A48] text-white shadow-xs'
                      : 'border border-[#091413]/10 bg-[#091413]/[0.03] text-[#091413]/70 hover:border-[#285A48]/30 hover:text-[#091413]'
                  }`}
                >
                  All items
                </button>

                {(categories.data ?? []).map((category) => (
                  <button
                    key={category.id}
                    type="button"
                    onClick={() => setCategoryId(String(category.id))}
                    className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                      categoryId === String(category.id)
                        ? 'bg-[#285A48] text-white shadow-xs'
                        : 'border border-[#091413]/10 bg-[#091413]/[0.03] text-[#091413]/70 hover:border-[#285A48]/30 hover:text-[#091413]'
                    }`}
                  >
                    {category.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Product Grid Area */}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 scroll-smooth">
              {catalog.loading && (
                <div className="py-16">
                  <Spinner />
                </div>
              )}

              {catalog.error && (
                <div className="p-4">
                  <ErrorState
                    message={catalog.error}
                    onRetry={() => void catalog.reload()}
                  />
                </div>
              )}

              {!catalog.loading && !catalog.error && catalog.data && catalog.data.length === 0 && (
                <div className="p-8 text-center">
                  <EmptyState
                    title="No products found"
                    hint="Try adjusting your search term or select another category."
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                {(catalog.data ?? []).map((product) => (
                  <CatalogProductCard
                    key={product.id}
                    product={product}
                    onAdd={add}
                    currencySymbol={settings.currencySymbol}
                    isInCart={cart.some((line) => line.product.id === product.id)}
                  />
                ))}
              </div>
            </div>
          </main>

          {/* =======================================================
              RIGHT: CART & CHECKOUT DRAWER
              ======================================================= */}
          <aside className="flex min-h-0 w-full flex-col overflow-hidden rounded-xl border border-[#091413]/10 bg-white shadow-xs xl:max-h-[calc(100dvh-9.5rem)]">
            {/* Customer & Register Header */}
            <div className="shrink-0 border-b border-[#091413]/10 p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-[#091413]/60">
                  Current Sale
                </span>
                <span className="rounded-md border border-[#285A48]/20 bg-[#285A48]/10 px-2 py-0.5 font-mono text-xs font-semibold text-[#285A48]">
                  {cart.length} item{cart.length !== 1 ? 's' : ''}
                </span>
              </div>

              {/* Customer Lookup Input */}
              <div className="relative mb-2">
                <UserRound
                  size={14}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#091413]/40"
                />
                <input
                  placeholder="Filter registered customer..."
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  className="h-9 w-full rounded-lg border border-[#091413]/15 bg-white pl-8.5 pr-8 text-xs text-[#091413] placeholder-[#091413]/35 outline-none transition-colors focus:border-[#285A48] focus:ring-1 focus:ring-[#285A48]"
                />
                {customerSearch && (
                  <button
                    type="button"
                    onClick={() => setCustomerSearch('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-[#091413]/40 hover:text-[#091413]"
                  >
                    <ClearIcon size={12} />
                  </button>
                )}
              </div>

              {/* Customer Selector Dropdown */}
              <div className="relative">
                <select
                  value={customerId ?? ''}
                  onChange={(e) =>
                    setCheckout({
                      ...checkout,
                      customerId: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                  className="h-9 w-full appearance-none rounded-lg border border-[#091413]/15 bg-white px-3 pr-8 text-xs text-[#091413]/80 outline-none transition-colors focus:border-[#285A48] focus:ring-1 focus:ring-[#285A48]"
                >
                  <option value="">Walk-in customer</option>
                  {(customers.data ?? []).map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.fullName}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={13}
                  className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[#091413]/40"
                />
              </div>

              {selectedCustomer && (
                <div className="mt-2.5 flex items-center justify-between text-xs text-[#091413]/60">
                  <span>Customer Loyalty</span>
                  <span className="font-semibold text-[#285A48]">
                    {selectedCustomer.loyaltyPoints} points
                  </span>
                </div>
              )}
            </div>

            {/* Cart Items List */}
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-3 space-y-2">
              {cart.length === 0 ? (
                <div className="flex min-h-56 items-center justify-center p-4">
                  <EmptyState
                    title="Cart is empty"
                    hint="Scan a barcode or tap a product to add."
                  />
                </div>
              ) : (
                cart.map((line) => (
                  <div
                    key={line.product.id}
                    className="rounded-lg border border-[#091413]/10 bg-[#091413]/[0.02] p-3 transition-colors hover:border-[#285A48]/30 hover:bg-[#285A48]/[0.02]"
                  >
                    <div className="flex min-w-0 items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p
                          title={line.product.name}
                          className="truncate text-xs font-medium text-[#091413]"
                        >
                          {line.product.name}
                        </p>
                        <p className="mt-0.5 font-mono text-[11px] text-[#091413]/50">
                          {formatMoney(line.product.sellingPrice, settings.currencySymbol)} each
                        </p>
                      </div>

                      <button
                        type="button"
                        title="Remove item"
                        aria-label={`Remove ${line.product.name}`}
                        onClick={() =>
                          setCheckout({
                            ...checkout,
                            cart: removeLine(cart, line.product.id),
                          })
                        }
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[#091413]/40 transition-colors hover:bg-rose-50 hover:text-rose-600 active:scale-95"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>

                    <div className="mt-2.5 flex items-center justify-between gap-2">
                      {/* Stepper */}
                      <div className="flex h-7 shrink-0 items-center rounded-md border border-[#091413]/15 bg-white">
                        <button
                          type="button"
                          aria-label="Decrease quantity"
                          onClick={() =>
                            setCheckout({
                              ...checkout,
                              cart: setLineQty(cart, line.product.id, line.quantity - 1),
                            })
                          }
                          className="flex h-7 w-7 items-center justify-center text-[#091413]/60 transition-colors hover:bg-[#285A48]/10 hover:text-[#285A48] active:bg-[#285A48]/20"
                        >
                          <Minus size={12} />
                        </button>

                        <span className="flex h-7 w-7 items-center justify-center font-mono text-xs font-semibold text-[#091413]">
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
                          className="flex h-7 w-7 items-center justify-center text-[#091413]/60 transition-colors hover:bg-[#285A48]/10 hover:text-[#285A48] active:bg-[#285A48]/20 disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          <Plus size={12} />
                        </button>
                      </div>

                      {/* Line Total */}
                      <span className="font-mono text-xs font-semibold text-[#091413]">
                        {formatMoney(
                          line.product.sellingPrice * line.quantity,
                          settings.currencySymbol,
                        )}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Summary & Checkout Footer */}
            <div className="shrink-0 border-t border-[#091413]/10 bg-white p-4">
              <div className="space-y-1.5 pb-3 text-xs text-[#091413]/60">
                <div className="flex justify-between">
                  <span>Subtotal</span>
                  <span className="font-mono font-medium text-[#091413]">
                    {formatMoney(totals.subtotal, settings.currencySymbol)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Tax ({settings.taxRate}%)</span>
                  <span className="font-mono font-medium text-[#091413]">
                    {formatMoney(totals.tax, settings.currencySymbol)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Discount</span>
                  <div className="flex items-center gap-1">
                    <span className="text-[#091413]/40">{settings.currencySymbol}</span>
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
                      className="h-7 w-20 rounded border border-[#091413]/15 bg-white px-2 text-right font-mono text-xs font-medium text-[#091413] outline-none focus:border-[#285A48] focus:ring-1 focus:ring-[#285A48]"
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-baseline justify-between border-t border-[#091413]/10 pt-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-[#091413]/60">
                  Total
                </span>
                <span className="font-mono text-2xl font-bold tracking-tight text-[#091413]">
                  {formatMoney(totals.total, settings.currencySymbol)}
                </span>
              </div>

              {/* Action Buttons */}
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={cart.length === 0}
                  onClick={clearCart}
                  className="rounded-lg border border-[#091413]/15 bg-white py-2.5 text-xs font-medium text-[#091413]/70 transition-colors hover:border-[#091413]/30 hover:bg-[#091413]/[0.03] hover:text-[#091413] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Clear
                </button>
                <button
                  type="button"
                  disabled={cart.length === 0}
                  onClick={proceedToPayment}
                  className="rounded-lg bg-[#285A48] py-2.5 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-[#1f483a] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Pay now
                </button>
              </div>
            </div>
          </aside>
        </div>
      </div>

      {/* =======================================================
          PAYMENT MODAL
          ======================================================= */}
      {isPaymentOpen && (
        <PaymentModal onClose={() => setIsPaymentOpen(false)} />
      )}

      {/* =======================================================
          ORDER HISTORY MODAL
          ======================================================= */}
      {showHistory && (
        <Modal
          title="Order history"
          wide
          onClose={() => {
            setShowHistory(false)
            setSelectedOrder(null)
          }}
        >
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-xs text-[#091413]/60 font-mono">
              {history.data?.totalCount ?? 0} recorded orders
            </span>
            <div className="relative w-full sm:max-w-xs">
              <Search
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#091413]/40"
              />
              <input
                className="h-8 w-full rounded-lg border border-[#091413]/15 bg-white pl-8.5 pr-8 text-xs text-[#091413] placeholder-[#091413]/35 outline-none transition-colors focus:border-[#285A48] focus:ring-1 focus:ring-[#285A48]"
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
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-[#091413]/40 hover:text-[#091413]"
                >
                  <ClearIcon size={12} />
                </button>
              )}
            </div>
          </div>

          {history.loading && (
            <div className="py-12">
              <Spinner />
            </div>
          )}

          {history.error && (
            <div className="p-4">
              <ErrorState message={history.error} onRetry={() => void history.reload()} />
            </div>
          )}

          {!history.loading && !history.error && history.data && history.data.items.length === 0 && (
            <div className="py-10 text-center">
              <EmptyState title="No orders found" hint="Try searching a different keyword." />
            </div>
          )}

          {history.data && history.data.items.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-[#091413]/10">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-[#091413]/70">
                  <thead className="border-b border-[#091413]/10 bg-[#091413]/[0.02] text-[11px] font-medium uppercase tracking-wider text-[#091413]/50">
                    <tr>
                      <th className="py-2.5 pl-4 pr-3 font-medium">Invoice</th>
                      <th className="py-2.5 px-3 font-medium">Date & Time</th>
                      <th className="py-2.5 px-3 font-medium">Customer</th>
                      <th className="py-2.5 px-3 font-medium">Payment</th>
                      <th className="py-2.5 px-3 text-right font-medium">Total</th>
                      <th className="py-2.5 pl-3 pr-4 text-right font-medium">View</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#091413]/5 font-normal">
                    {history.data.items.map((order) => (
                      <tr key={order.id} className="transition-colors hover:bg-[#285A48]/[0.03]">
                        <td className="py-3 pl-4 pr-3 font-mono font-medium text-[#091413]">
                          {order.invoiceNumber}
                        </td>
                        <td className="py-3 px-3 text-[#091413]/50 whitespace-nowrap">
                          {formatDateTime(order.createdAt)}
                        </td>
                        <td className="py-3 px-3 text-[#091413]/80">
                          {order.customerName || 'Walk-in'}
                        </td>
                        <td className="py-3 px-3">
                          <span className="rounded border border-[#091413]/10 bg-[#091413]/[0.03] px-1.5 py-0.5 text-[11px] font-medium text-[#091413]/80">
                            {order.paymentMethod}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-right font-mono font-medium text-[#091413]">
                          {formatMoney(order.total, settings.currencySymbol)}
                        </td>
                        <td className="py-3 pl-3 pr-4 text-right">
                          <button
                            type="button"
                            aria-label={`View ${order.invoiceNumber}`}
                            onClick={() => {
                              void salesApi
                                .get(order.id)
                                .then(setSelectedOrder)
                                .catch((err) => notify(getErrorMessage(err), 'error'))
                            }}
                            className="flex h-7 w-7 items-center justify-center rounded-md text-[#091413]/40 hover:bg-[#285A48]/10 hover:text-[#285A48] transition-colors ml-auto"
                          >
                            <Eye size={15} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="border-t border-[#091413]/10 px-3 py-2">
                <Pagination
                  page={history.data.page}
                  totalPages={history.data.totalPages}
                  onPage={setHistoryPage}
                />
              </div>
            </div>
          )}

          {/* Selected Order Summary Drilldown */}
          {selectedOrder && (
            <div className="mt-4 rounded-lg border border-[#091413]/10 bg-[#091413]/[0.02] p-4 text-xs">
              <div className="flex items-center justify-between pb-2 border-b border-[#091413]/10">
                <div>
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-[#091413]/50">
                    Order Details
                  </span>
                  <p className="font-mono text-sm font-semibold text-[#091413] mt-0.5">
                    {selectedOrder.invoiceNumber}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedOrder(null)}
                  className="text-xs font-medium text-[#091413]/50 hover:text-[#285A48] transition-colors"
                >
                  Close
                </button>
              </div>

              <div className="divide-y divide-[#091413]/5 py-2">
                {selectedOrder.items.map((item) => (
                  <div key={item.productId} className="flex justify-between py-1.5">
                    <span className="text-[#091413]/80">
                      {item.productName} <span className="text-[#091413]/40">× {item.quantity}</span>
                    </span>
                    <span className="font-mono font-medium text-[#091413]">
                      {formatMoney(item.lineTotal, settings.currencySymbol)}
                    </span>
                  </div>
                ))}
              </div>

              <div className="flex justify-between pt-2 border-t border-[#091413]/10 font-semibold text-[#091413]">
                <span>Grand Total</span>
                <span className="font-mono text-[#285A48]">
                  {formatMoney(selectedOrder.total, settings.currencySymbol)}
                </span>
              </div>

              <button
                type="button"
                onClick={() => handleReprint(selectedOrder)}
                disabled={isPrinting}
                className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#285A48] py-2 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-[#1e4537] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <PrinterIcon size={13} />
                {isPrinting ? 'Printing…' : lastPrintError ? 'Retry Print' : 'Reprint Receipt'}
              </button>
            </div>
          )}
        </Modal>
      )}
    </div>
  )
}

/* ===============================================================
   CATALOG PRODUCT CARD COMPONENT
   =============================================================== */

function CatalogProductCard({
  product,
  onAdd,
  currencySymbol,
  isInCart,
}: {
  product: Product
  onAdd: (product: Product) => void
  currencySymbol: string
  isInCart?: boolean
}) {
  const outOfStock = product.stockQuantity <= 0

  return (
    <button
      type="button"
      disabled={outOfStock}
      onClick={() => onAdd(product)}
      className={`group flex min-h-56 min-w-0 flex-col justify-between rounded-xl border p-2.5 text-left transition-all active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 ${
        isInCart
          ? 'border-[#285A48] bg-white ring-1.5 ring-[#285A48] shadow-xs'
          : 'border-[#091413]/10 bg-white hover:border-[#285A48]/40 hover:shadow-xs'
      }`}
    >
      {product.imageUrl ? (
        <div className="mb-2 aspect-4/3 w-full shrink-0 overflow-hidden rounded-lg border border-[#091413]/5 bg-[#091413]/[0.02]">
          <img
            src={product.imageUrl}
            alt={product.name}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        </div>
      ) : (
        <div className="mb-2 flex aspect-4/3 w-full shrink-0 items-center justify-center rounded-lg border border-[#285A48]/15 bg-[#285A48]/5 font-semibold text-xs text-[#285A48]">
          {product.name.slice(0, 1).toUpperCase()}
        </div>
      )}

      <div className="min-w-0 flex-1">
        <p
          title={product.name}
          className="line-clamp-2 text-xs font-medium leading-4 text-[#091413]"
        >
          {product.name}
        </p>
        <p className="mt-0.5 truncate font-mono text-[11px] text-[#091413]/40">
          {product.sku}
        </p>
      </div>

      <div className="mt-3 flex items-center justify-between gap-1 border-t border-[#091413]/5 pt-2">
        <span className="font-mono text-xs font-semibold text-[#091413]">
          {formatMoney(product.sellingPrice, currencySymbol)}
        </span>

        <Badge tone={stockTone(product.stockStatus)}>
          {outOfStock ? 'Out' : `${product.stockQuantity}`}
        </Badge>
      </div>
    </button>
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