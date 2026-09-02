import {
  Barcode,
  Eye,
  History,
  Minus,
  Plus,
  Search,
  Trash2,
  UserRound,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { categoryApi } from '../api/categoryApi'
import { customerApi } from '../api/customerApi'
import { productApi } from '../api/productApi'
import { salesApi } from '../api/salesApi'

import { Badge, stockTone } from '../components/ui/Badge'
import { Input, Select } from '../components/ui/Field'
import { Modal } from '../components/ui/Modal'
import { PageHeader } from '../components/ui/Page'
import { Pagination } from '../components/ui/Pagination'

import {
  EmptyState,
  ErrorState,
  Spinner,
} from '../components/ui/States'

import { useSettings } from '../context/SettingsContext'
import { useToast } from '../context/ToastContext'
import { useCheckout } from '../context/CheckoutContext'
import { useAsync } from '../hooks/useAsync'
import { useDebounced } from '../hooks/useDebounced'

import type {
  Product,
  Sale,
} from '../types'

import { formatDateTime, formatMoney } from '../utils/format'
import { getErrorMessage } from '../utils/errors'

import {
  addToCart,
  calculateTotals,
  canSell,
  removeLine,
  setLineQty,
} from '../utils/pos'

export function SalesPage() {
  const navigate = useNavigate()
  const { notify } = useToast()
  const { settings } = useSettings()
  const { state: checkout, setState: setCheckout } =
    useCheckout()

  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [isMounted, setIsMounted] = useState(false)

  useEffect(() => {
    const id = window.setTimeout(() => setIsMounted(true), 40)
    return () => window.clearTimeout(id)
  }, [])

  const [customerSearch, setCustomerSearch] =
    useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [historySearch, setHistorySearch] = useState('')
  const [historyPage, setHistoryPage] = useState(1)
  const [selectedOrder, setSelectedOrder] = useState<Sale | null>(null)

  const cart = checkout.cart
  const customerId = checkout.customerId
  const discount = checkout.discount

  const q = useDebounced(search)
  const cq = useDebounced(customerSearch)

  const categories = useAsync(
    () => categoryApi.list(true),
    [],
  )

  const catalog = useAsync(
    () =>
      productApi.catalog({
        search: q || undefined,
        categoryId: categoryId
          ? Number(categoryId)
          : undefined,
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
          })
        : Promise.resolve(null),
    [historySearch, historyPage, showHistory],
  )

  const totals = useMemo(
    () =>
      calculateTotals(
        cart,
        discount,
        settings.taxRate,
      ),
    [cart, discount, settings.taxRate],
  )

  const selectedCustomer =
    customers.data?.find(
      (customer) => customer.id === customerId,
    )

  function add(product: Product) {
    if (product.stockQuantity <= 0) {
      notify(
        'This item is out of stock.',
        'error',
      )
      return
    }

    if (!canSell(product, cart)) {
      notify(
        'Not enough stock for this item.',
        'error',
      )
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
      notify(
        'Add items to the cart first.',
        'error',
      )
      return
    }

    navigate('/payment')
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-7xl px-4 pb-6 pt-4 sm:px-5 lg:px-6">
        <PageHeader
          title="Sales"
          subtitle="Create and process point-of-sale orders"
          actions={
            <Button
              variant="secondary"
              onClick={() => {
                setHistoryPage(1)
                setShowHistory(true)
              }}
            >
              <History size={16} />
              <span>Order history</span>
            </Button>
          }
        />

        <div
          className={`
            grid
            min-h-0
            gap-4
            transition-all
            duration-500
            ease-out
            ${
              isMounted
                ? 'translate-y-0 opacity-100'
                : 'translate-y-2 opacity-0'
            }
            xl:grid-cols-[minmax(0,1.8fr)_390px]
            xl:items-start
          `}
        >
          <main
            className={`
              flex
              min-h-0
              min-w-0
              flex-col
              overflow-hidden
              rounded-2xl
              border
              border-slate-200
              bg-white
              shadow-sm
              shadow-slate-200/50
              transition-all
              duration-500
              ease-out
              ${
                isMounted
                  ? 'translate-y-0 opacity-100'
                  : 'translate-y-2 opacity-0'
              }
              delay-200
              xl:max-h-[calc(100dvh-10rem)]
            `}
          >
        {/* Search & Category Filters */}

        <div
          className="
            shrink-0
            border-b
            border-gray-200
            bg-white
            p-4
          "
        >
          {/* Items label + Search field */}

          <div
            className="
              flex
              w-full
              flex-col
              gap-3
              mb-3
            "
          >
            <p
              className="
                text-xs
                font-bold
                uppercase
                tracking-wider
                text-gray-500
              "
            >
              Items
            </p>

            <div
              className="
                relative
                min-w-0
                flex-1
              "
            >
              <Search
                size={18}
                className="
                  pointer-events-none
                  absolute
                  left-3
                  top-1/2
                  -translate-y-1/2
                  text-gray-400
                "
              />

              <input
                autoFocus
                value={search}
                onChange={(e) =>
                  setSearch(e.target.value)
                }
                placeholder="Search..."
                className="
                  h-10
                  w-full
                  min-w-0
                  rounded-lg
                  border
                  border-gray-200
                  bg-white
                  pl-10
                  pr-10
                  text-sm
                  outline-none
                  transition-all
                  duration-200
                  ease-out
                  placeholder:text-gray-500
                  hover:border-gray-300
                  focus:border-gray-400
                  focus:ring-1
                  focus:ring-gray-300
                "
              />

              <Barcode
                size={18}
                className="
                  pointer-events-none
                  absolute
                  right-3
                  top-1/2
                  -translate-y-1/2
                  text-gray-400
                "
              />
            </div>
          </div>

          {/* Category pills */}

          <div
            className="
              flex
              items-center
              gap-2
              overflow-x-auto
              pb-1
              -mx-4
              px-4
            "
          >
            <button
              type="button"
              onClick={() => setCategoryId('')}
              className={`
                shrink-0
                px-3
                py-2
                rounded-full
                text-xs
                font-semibold
                transition-all
                duration-200
                ease-out
                whitespace-nowrap
                ${
                  !categoryId
                    ? 'bg-gray-900 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }
              `}
            >
              All
            </button>

            {(categories.data ?? []).map(
              (category) => (
                <button
                  key={category.id}
                  type="button"
                  onClick={() =>
                    setCategoryId(
                      String(category.id),
                    )
                  }
                  className={`
                    shrink-0
                    px-3
                    py-2
                    rounded-full
                    text-xs
                    font-semibold
                    transition-all
                    duration-200
                    ease-out
                    whitespace-nowrap
                    ${
                      categoryId ===
                      String(category.id)
                        ? 'bg-gray-900 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }
                  `}
                >
                  {category.name}
                </button>
              ),
            )}
          </div>
        </div>

        {/* Product area */}

        <div
          className="
            min-h-0
            flex-1
            overflow-y-auto
            overflow-x-hidden
            overscroll-contain
            p-4
            scroll-smooth
            touch-pan-y
          "
        >
          {catalog.loading && <Spinner />}

          {catalog.error && (
            <ErrorState
              message={catalog.error}
              onRetry={() =>
                void catalog.reload()
              }
            />
          )}

          {!catalog.loading &&
            catalog.data &&
            catalog.data.length === 0 && (
              <EmptyState
                title="No products found"
                hint="
                  Try another search or category.
                "
              />
            )}

          {/* PRODUCT GRID — Responsive */}

          <div
            className="
              grid
              grid-cols-2
              gap-3
              sm:grid-cols-3
              lg:grid-cols-4
            "
          >
            {(catalog.data ?? []).map(
              (product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  onAdd={add}
                  currencySymbol={
                    settings.currencySymbol
                  }
                  isInCart={cart.some(
                    (line) =>
                      line.product.id ===
                      product.id,
                  )}
                />
              ),
            )}
          </div>
        </div>
      </main>

          <aside
            className={`
              flex
              min-h-0
              w-full
              flex-col
              overflow-hidden
              rounded-2xl
              border
              border-slate-200
              bg-white
              shadow-sm
              shadow-slate-200/50
              transition-all
              duration-500
              ease-out
              ${
                isMounted
                  ? 'translate-y-0 opacity-100'
                  : 'translate-y-2 opacity-0'
              }
              delay-300
              xl:max-h-[calc(100dvh-10rem)]
            `}
          >
            <div className="shrink-0 border-b border-slate-200 p-4">
          <div
            className="
              mb-3
              flex
              items-center
              justify-between
              gap-2
            "
          >
            <h2
              className="
                truncate
                text-sm
                font-semibold
                text-gray-900
              "
            >
              Current sale
            </h2>

            <span
              className="
                shrink-0
                rounded-full
                bg-gray-100
                px-2
                py-1
                text-xs
                font-medium
                text-gray-600
              "
            >
              {cart.length}
            </span>
          </div>

          {/* Customer search */}

          <div className="relative mb-2">
            <UserRound
              size={16}
              className="
                pointer-events-none
                absolute
                left-3
                top-1/2
                -translate-y-1/2
                text-gray-400
              "
            />

            <Input
              className="
                h-10
                pl-9
                rounded-lg
                text-sm
              "
              placeholder="Walk-in customer"
              value={customerSearch}
              onChange={(e) =>
                setCustomerSearch(
                  e.target.value,
                )
              }
            />
          </div>

          {/* Customer selector */}

          <Select
            className="
              h-10
              rounded-lg
              text-sm
            "
            value={customerId ?? ''}
            onChange={(e) =>
              setCheckout({
                ...checkout,
                customerId: e.target.value
                  ? Number(e.target.value)
                  : null,
              })
            }
          >
            <option value="">
              Walk-in customer
            </option>

            {(customers.data ?? []).map(
              (customer) => (
                <option
                  key={customer.id}
                  value={customer.id}
                >
                  {customer.fullName}
                </option>
              ),
            )}
          </Select>

          {selectedCustomer && (
            <div
              className="
                mt-2
                flex
                items-center
                justify-between
                gap-2
                text-xs
                text-gray-500
              "
            >
              <span>Customer</span>

              <span>
                {selectedCustomer.loyaltyPoints}{' '}
                points
              </span>
            </div>
          )}
        </div>

        {/* CART ITEMS */}

        <div
          className="
            flex-1
            min-h-0
            overflow-hidden
            border-b
            border-gray-200
            bg-white
            flex
            flex-col
          "
        >
          {cart.length === 0 ? (
            <div
              className="
                flex
                min-h-full
                items-center
                justify-center
                p-4
              "
            >
              <EmptyState
                title="Cart is empty"
                hint="Scan a barcode or select a product."
              />
            </div>
          ) : (
            <>
              <div className="px-3 py-2 border-b border-gray-200 bg-gray-50">
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-600">
                  {cart.length} item{cart.length !== 1 ? 's' : ''}
                </p>
              </div>

              <div className="flex-1 overflow-y-auto overscroll-contain p-3 space-y-2 scroll-smooth touch-pan-y">
                {cart.map((line) => (
                  <div
                    key={line.product.id}
                    className="
                      rounded-lg
                      border
                      border-gray-200
                      bg-gray-50
                      p-3
                    "
                  >
                    {/* Product info + Remove */}

                    <div
                      className="
                        flex
                        min-w-0
                        items-start
                        justify-between
                        gap-2
                        mb-2
                      "
                    >
                      <div className="min-w-0 flex-1">
                        <p
                          title={line.product.name}
                          className="
                            overflow-hidden
                            text-ellipsis
                            whitespace-nowrap
                            text-sm
                            font-semibold
                            text-gray-900
                          "
                        >
                          {line.product.name}
                        </p>

                        <p
                          className="
                            mt-0.5
                            text-xs
                            text-gray-600
                          "
                        >
                          {formatMoney(
                            line.product.sellingPrice,
                            settings.currencySymbol,
                          )}{' '}
                          each
                        </p>
                      </div>

                      {/* Remove */}

                      <button
                        type="button"
                        title="Remove item"
                        aria-label={`Remove ${line.product.name}`}
                        onClick={() =>
                          setCheckout({
                            ...checkout,
                            cart: removeLine(
                              cart,
                              line.product.id,
                            ),
                          })
                        }
                        className="
                          flex
                          h-8
                          w-8
                          shrink-0
                          items-center
                          justify-center
                          touch-manipulation
                          rounded-lg
                          text-gray-500
                          transition-all
                          duration-200
                          ease-out
                          hover:bg-red-100
                          hover:text-red-600
                          active:bg-red-200
                          focus:outline-none
                          focus-visible:ring-2
                          focus-visible:ring-red-500
                        "
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>

                    {/* Quantity controls + Line total */}

                    <div
                      className="
                        flex
                        items-center
                        justify-between
                        gap-2
                      "
                    >
                      <div
                        className="
                          flex
                          h-9
                          shrink-0
                          items-center
                          rounded-lg
                          border
                          border-gray-200
                          bg-white
                          overflow-hidden
                        "
                      >
                        {/* Minus */}

                        <button
                          type="button"
                          aria-label="Decrease quantity"
                          className="
                            flex
                            h-9
                            w-9
                            items-center
                            justify-center
                            touch-manipulation
                            text-gray-600
                            transition-all
                            duration-200
                            ease-out
                            hover:bg-gray-50
                            active:bg-gray-100
                            focus:outline-none
                            focus-visible:ring-2
                            focus-visible:ring-gray-400
                          "
                          onClick={() =>
                            setCheckout({
                              ...checkout,
                              cart: setLineQty(
                                cart,
                                line.product.id,
                                line.quantity - 1,
                              ),
                            })
                          }
                        >
                          <Minus size={14} />
                        </button>

                        {/* Quantity */}

                        <span
                          className="
                            flex
                            h-9
                            w-7
                            items-center
                            justify-center
                            text-xs
                            font-bold
                            text-gray-900
                          "
                        >
                          {line.quantity}
                        </span>

                        {/* Plus */}

                        <button
                          type="button"
                          aria-label="Increase quantity"
                          disabled={
                            !canSell(
                              line.product,
                              cart,
                            )
                          }
                          className="
                            flex
                            h-9
                            w-9
                            items-center
                            justify-center
                            touch-manipulation
                            text-gray-600
                            transition-all
                            duration-200
                            ease-out
                            hover:bg-gray-50
                            active:bg-gray-100
                            disabled:cursor-not-allowed
                            disabled:opacity-50
                            focus:outline-none
                            focus-visible:ring-2
                            focus-visible:ring-gray-400
                          "
                          onClick={() =>
                            setCheckout({
                              ...checkout,
                              cart: setLineQty(
                                cart,
                                line.product.id,
                                line.quantity + 1,
                              ),
                            })
                          }
                        >
                          <Plus size={14} />
                        </button>
                      </div>

                      {/* Line total */}

                      <span
                        className="
                          ml-auto
                          min-w-0
                          truncate
                          text-sm
                          font-bold
                          text-gray-900
                        "
                      >
                        {formatMoney(
                          line.product.sellingPrice *
                            line.quantity,
                          settings.currencySymbol,
                        )}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* =======================================================
            ORDER SUMMARY & ACTIONS
            ======================================================= */}

        <div
          className="
            shrink-0
            border-t
            border-gray-200
            bg-linear-to-b
            from-white
            to-gray-50
            flex
            flex-col
          "
        >
          {/* Header with total */}

          <div className="border-b border-gray-200 bg-white px-4 py-3">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
              Order Total
            </p>
            <p className="text-3xl font-black text-gray-900">
              {formatMoney(
                totals.total,
                settings.currencySymbol,
              )}
            </p>

            {/* Summary row */}
            <div className="flex items-center justify-between gap-3 text-xs mt-3">
              <span className="text-gray-600">
                Subtotal: {formatMoney(totals.subtotal, settings.currencySymbol)}
              </span>
              <span className="text-gray-600">
                Tax: {formatMoney(totals.tax, settings.currencySymbol)}
              </span>
              <span className="text-gray-600">
                Discount: {formatMoney(totals.discount, settings.currencySymbol)}
              </span>
            </div>
          </div>

          {/* Discount input */}

          <div className="border-b border-gray-200 bg-white px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <label className="text-sm font-medium text-gray-600">
                Discount
              </label>

              <input
                type="number"
                min={0}
                value={discount}
                onChange={(e) =>
                  setCheckout({
                    ...checkout,
                    discount: Number(e.target.value) || 0,
                  })
                }
                className="
                  h-10
                  w-24
                  shrink-0
                  rounded-lg
                  border
                  border-gray-200
                  bg-white
                  px-3
                  text-right
                  text-sm
                  font-semibold
                  outline-none
                  transition-all
                  duration-200
                  ease-out
                  focus:border-blue-400
                  focus:ring-2
                  focus:ring-blue-300
                "
              />
            </div>
          </div>

          {/* Action Buttons */}

          <div
            className="
              flex
              gap-2
              border-t
              border-gray-200
              bg-white
              p-4
            "
          >
            {/* CLEAR */}

            <button
              type="button"
              disabled={cart.length === 0}
              onClick={clearCart}
              className="
                flex-1
                h-12
                rounded-lg
                border-2
                border-red-500
                bg-red-500
                text-sm
                font-semibold
                text-white
                transition-all
                duration-200
                ease-out
                hover:bg-red-600
                hover:border-red-600
                active:scale-[0.98]
                disabled:cursor-not-allowed
                disabled:border-gray-300
                disabled:bg-gray-300
                disabled:text-gray-500
                focus:outline-none
                focus-visible:ring-2
                focus-visible:ring-red-500
              "
            >
              Clear
            </button>

            {/* CONTINUE TO PAYMENT */}

            <button
              type="button"
              disabled={cart.length === 0}
              onClick={proceedToPayment}
              className="
                flex-1
                h-12
                rounded-lg
                border-2
                border-green-500
                bg-green-500
                text-sm
                font-semibold
                text-white
                transition-all
                duration-200
                ease-out
                hover:bg-green-600
                hover:border-green-600
                active:scale-[0.98]
                disabled:cursor-not-allowed
                disabled:border-gray-300
                disabled:bg-gray-300
                disabled:text-gray-500
                focus:outline-none
                focus-visible:ring-2
                focus-visible:ring-green-500
              "
            >
              Continue
            </button>
          </div>
        </div>
      </aside>

        </div>
      </div>

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
            <div>
              <p className="text-sm font-semibold text-slate-900">Completed orders</p>
              <p className="mt-0.5 text-xs text-slate-500">Search by invoice number, customer, or payment method.</p>
            </div>
            <div className="relative w-full sm:max-w-xs">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input
                className="h-10 w-full rounded-xl pl-9"
                value={historySearch}
                onChange={(e) => {
                  setHistorySearch(e.target.value)
                  setHistoryPage(1)
                }}
                placeholder="Search orders..."
              />
            </div>
          </div>

          {history.loading && <Spinner />}
          {history.error && <ErrorState message={history.error} onRetry={() => void history.reload()} />}

          {!history.loading && history.data && history.data.items.length === 0 && (
            <EmptyState title="No orders found" hint="Try another invoice number or customer name." />
          )}

          {history.data && history.data.items.length > 0 && (
            <div className="overflow-hidden rounded-2xl border border-slate-200">
              <div className="overflow-x-auto">
                <table className="w-full min-w-170 border-collapse text-sm">
                  <thead className="bg-slate-50 text-[10px] uppercase tracking-[0.18em] text-slate-500">
                    <tr className="border-b border-slate-200">
                      <th className="px-3 py-2 text-left">Order</th>
                      <th className="px-3 py-2 text-left">When</th>
                      <th className="px-3 py-2 text-left">Customer</th>
                      <th className="px-3 py-2 text-left">Payment</th>
                      <th className="px-3 py-2 text-right">Total</th>
                      <th className="px-3 py-2 text-right">View</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.data.items.map((order) => (
                      <tr key={order.id} className="border-b border-slate-200 last:border-b-0 transition-colors hover:bg-slate-50/80">
                        <td className="px-3 py-3 font-semibold text-slate-900">{order.invoiceNumber}</td>
                        <td className="px-3 py-3 text-xs text-slate-500">{formatDateTime(order.createdAt)}</td>
                        <td className="px-3 py-3 text-slate-600">{order.customerName || 'Walk-in customer'}</td>
                        <td className="px-3 py-3 text-slate-600">{order.paymentMethod}</td>
                        <td className="px-3 py-3 text-right font-semibold text-slate-900">{formatMoney(order.total, settings.currencySymbol)}</td>
                        <td className="px-3 py-3 text-right">
                          <button
                            type="button"
                            aria-label={`View ${order.invoiceNumber}`}
                            onClick={() => {
                              void salesApi.get(order.id).then(setSelectedOrder).catch((err) => notify(getErrorMessage(err), 'error'))
                            }}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                          >
                            <Eye size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="border-t border-slate-200 bg-slate-50/60 px-3 py-2">
                <Pagination page={history.data.page} totalPages={history.data.totalPages} onPage={setHistoryPage} />
              </div>
            </div>
          )}

          {selectedOrder && (
            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Order details</p>
                  <h3 className="mt-1 text-base font-semibold text-slate-900">{selectedOrder.invoiceNumber}</h3>
                </div>
                <button type="button" onClick={() => setSelectedOrder(null)} className="text-xs font-medium text-slate-500 hover:text-slate-900">Close</button>
              </div>
              <div className="mt-3 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
                {selectedOrder.items.map((item) => (
                  <div key={item.productId} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <span className="min-w-0 truncate text-slate-700">{item.productName} × {item.quantity}</span>
                    <span className="shrink-0 font-semibold text-slate-900">{formatMoney(item.lineTotal, settings.currencySymbol)}</span>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-slate-200 pt-3 text-sm font-bold text-slate-900">
                <span>Total</span>
                <span>{formatMoney(selectedOrder.total, settings.currencySymbol)}</span>
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  )
}

/* ===============================================================
   PRODUCT CARD
   =============================================================== */

function ProductCard({
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
  const outOfStock =
    product.stockQuantity <= 0

  return (
    <button
      type="button"
      disabled={outOfStock}
      onClick={() => onAdd(product)}
      className={`
        group
        flex
        min-h-28
        min-w-0
        flex-col
        justify-between
        overflow-hidden
        border
        p-2
        text-left
        touch-manipulation
        select-none
        transition-all
        duration-300
        ease-[cubic-bezier(0.16,1,0.3,1)]
        hover:-translate-y-1.5
        hover:shadow-md
        hover:border-gray-500
        hover:bg-gray-50
        active:border-gray-700
        active:bg-gray-100
        disabled:cursor-not-allowed
        disabled:bg-gray-50
        disabled:opacity-50
        focus:outline-none
        focus-visible:ring-2
        focus-visible:ring-gray-700
        focus-visible:ring-inset

        ${
          isInCart
            ? 'border-green-600 bg-green-50 ring-2 ring-green-500 hover:-translate-y-1.5 hover:shadow-md'
            : 'border-gray-300 bg-white'
        }
      `}
    >
      {/* Product image */}

      {product.imageUrl ? (
        <div
          className="
            mb-2
            h-12
            w-full
            shrink-0
            overflow-hidden
            bg-gray-100
          "
        >
          <img
            src={product.imageUrl}
            alt=""
            className="
              h-full
              w-full
              object-cover
            "
          />
        </div>
      ) : (
        <div
          className="
            mb-2
            flex
            h-12
            w-full
            shrink-0
            items-center
            justify-center
            bg-gray-100
          "
        >
          <span
            className="
              text-lg
              font-bold
              text-gray-400
            "
          >
            {product.name
              .slice(0, 1)
              .toUpperCase()}
          </span>
        </div>
      )}

      {/* Product name */}

      <div className="min-w-0">
        <p
          title={product.name}
          className="
            overflow-hidden
            text-ellipsis
            whitespace-nowrap
            text-sm
            font-semibold
            leading-5
            text-gray-900
          "
        >
          {product.name}
        </p>
      </div>

      {/* Price / stock */}

      <div
        className="
          mt-1
          flex
          min-w-0
          items-center
          justify-between
          gap-2
        "
      >
        <span
          className="
            min-w-0
            truncate
            text-sm
            font-black
            text-gray-950
          "
        >
          {formatMoney(
            product.sellingPrice,
            currencySymbol,
          )}
        </span>

        <span
          className="
            shrink-0
            text-[11px]
            font-medium
            text-gray-500
          "
        >
          {product.stockQuantity}
        </span>
      </div>

      {/* Stock status */}

      <div
        className="
          mt-1
          min-w-0
        "
      >
        <Badge
          tone={stockTone(
            product.stockStatus,
          )}
        >
          <span
            className="
              block
              max-w-full
              truncate
            "
          >
            {outOfStock
              ? 'Out of stock'
              : `${product.stockQuantity} in stock`}
          </span>
        </Badge>
      </div>
    </button>
  )
}