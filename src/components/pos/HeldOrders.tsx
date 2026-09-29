import { useCallback, useEffect, useState } from 'react'

import { customerApi } from '../../api/customerApi'
import { heldOrdersApi } from '../../api/heldOrdersApi'
import { productApi } from '../../api/productApi'
import { useCheckout } from '../../context/CheckoutContext'
import { useSettings } from '../../context/SettingsContext'
import { useToast } from '../../context/ToastContext'
import { useAsync } from '../../hooks/useAsync'
import type { Customer, HeldOrder } from '../../types'
import { getErrorMessage } from '../../utils/errors'
import { formatMoney, formatTime, formatDayLabel } from '../../utils/format'
import { calculateTotals, DEFAULT_ORDER_TYPE, isOrderType, orderTypeLabel, type CartLine } from '../../utils/pos'
import { ConfirmDialog, Modal } from '../ui/Modal'
import { EmptyState, ErrorState, Spinner } from '../ui/States'

/**
 * Hold / park sale. Holding saves the cart (customer, order type, discount, quantities, totals)
 * and clears the register; stock is not touched until the resumed order is paid for.
 * Shared by the phone and tablet/desktop registers.
 */
export function useHeldOrders() {
  const { notify } = useToast()
  const { settings } = useSettings()
  const { state: checkout, setState: setCheckout, clearCheckout } = useCheckout()
  const [heldCount, setHeldCount] = useState(0)

  const refreshCount = useCallback(async () => {
    try {
      setHeldCount(await heldOrdersApi.count())
    } catch {
      setHeldCount(0)
    }
  }, [])

  useEffect(() => {
    void refreshCount()
  }, [refreshCount])

  /** Parks the current cart. Returns false when there was nothing to hold or saving failed. */
  async function holdCurrent(label: string, customerName: string | null): Promise<boolean> {
    if (checkout.cart.length === 0) return false
    const totals = calculateTotals(checkout.cart, checkout.discount, settings.taxRate)
    try {
      await heldOrdersApi.hold({
        label,
        customerId: checkout.customerId,
        customerName,
        orderType: checkout.orderType,
        discount: totals.discount,
        subtotal: totals.subtotal,
        total: totals.total,
        lines: checkout.cart.map((line) => ({
          productId: line.product.id,
          name: line.product.name,
          quantity: line.quantity,
          unitPrice: line.product.sellingPrice,
        })),
      })
      clearCheckout()
      await refreshCount()
      return true
    } catch (err) {
      notify(getErrorMessage(err), 'error')
      return false
    }
  }

  /**
   * Loads a held order back into the cart with today's prices and stock, then removes it from
   * the held list. Returns the order's customer (so the register can show their name) or null.
   */
  async function resume(order: HeldOrder): Promise<{ customer: Customer | null } | null> {
    const products = await Promise.all(order.lines.map((line) => productApi.get(line.productId).catch(() => null)))

    const cart: CartLine[] = []
    const notes: string[] = []
    order.lines.forEach((line, index) => {
      const product = products[index]
      if (!product || !product.isActive) {
        notes.push(`${line.name} is no longer sold`)
        return
      }
      const quantity = Math.min(line.quantity, product.stockQuantity)
      if (quantity <= 0) {
        notes.push(`${product.name} is out of stock`)
        return
      }
      if (quantity < line.quantity) notes.push(`only ${quantity} ${product.name} left`)
      if (product.sellingPrice !== line.unitPrice) notes.push(`${product.name} price is now ${formatMoney(product.sellingPrice, settings.currencySymbol)}`)
      cart.push({ product, quantity })
    })

    if (cart.length === 0) {
      notify('None of the items on this order can be sold right now. It stays on hold.', 'error')
      return null
    }

    const customer = order.customerId ? await customerApi.get(order.customerId).catch(() => null) : null

    setCheckout({
      ...checkout,
      cart,
      customerId: customer?.id ?? null,
      discount: order.discount,
      orderType: isOrderType(order.orderType) ? order.orderType : DEFAULT_ORDER_TYPE,
    })

    try {
      await heldOrdersApi.remove(order.id)
    } catch (err) {
      notify(getErrorMessage(err), 'error')
    }
    await refreshCount()
    notify(notes.length ? `Order resumed — ${notes.join('; ')}.` : 'Order resumed.', notes.length ? 'error' : 'success')
    return { customer }
  }

  return { heldCount, refreshCount, holdCurrent, resume, hasCart: checkout.cart.length > 0 }
}

type HeldOrdersController = ReturnType<typeof useHeldOrders>

/** "Hold order" with an optional name so it's easy to find again (table number, customer…). */
export function HoldOrderDialog({
  controller,
  customerName,
  onClose,
}: {
  controller: HeldOrdersController
  customerName: string | null
  onClose: () => void
}) {
  const { notify } = useToast()
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (busy) return
    setBusy(true)
    const held = await controller.holdCurrent(label, customerName)
    setBusy(false)
    if (held) {
      notify('Order on hold. Resume it from Held orders.')
      onClose()
    }
  }

  return (
    <Modal
      title="Hold order"
      description="Stock isn’t deducted until the order is paid."
      onClose={onClose}
      preventClose={busy}
      size="sm"
      footer={
        <div className="flex w-full gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="h-12 flex-1 rounded-2xl text-[15px] font-medium text-slate-600 active:bg-slate-100 disabled:opacity-40 sm:flex-none sm:px-5"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy}
            className="h-12 flex-1 rounded-2xl bg-[#1F5E3B] px-6 text-[15px] font-semibold text-white transition active:scale-[0.99] disabled:bg-slate-200 disabled:text-slate-400"
          >
            {busy ? 'Holding…' : 'Hold order'}
          </button>
        </div>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <label htmlFor="hold-order-label" className="block text-sm font-medium">
          Name <span className="font-normal text-slate-400">(optional)</span>
        </label>
        <input
          id="hold-order-label"
          autoFocus
          maxLength={40}
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder={customerName ?? 'e.g. Table 4'}
          className="mt-1.5 h-12 w-full rounded-2xl border-0 bg-[#F3F5F4] px-4 text-[15px] placeholder:text-slate-400 outline-none focus:bg-white focus:ring-2 focus:ring-[#1F5E3B]"
        />
      </form>
    </Modal>
  )
}

/** The list of parked orders, with Resume and Delete. */
export function HeldOrdersDialog({
  controller,
  currentCustomerName,
  onClose,
  onResumed,
}: {
  controller: HeldOrdersController
  /** Name of the customer on the order being rung up now, used if it has to be parked. */
  currentCustomerName: string | null
  onClose: () => void
  onResumed: (customer: Customer | null) => void
}) {
  const { notify } = useToast()
  const { settings } = useSettings()
  const held = useAsync(() => heldOrdersApi.list(), [])
  const [busyId, setBusyId] = useState<number | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<HeldOrder | null>(null)
  const [confirmSwap, setConfirmSwap] = useState<HeldOrder | null>(null)
  const money = (value: number) => formatMoney(value, settings.currencySymbol)

  async function doResume(order: HeldOrder, holdCurrentFirst: boolean) {
    setBusyId(order.id)
    try {
      if (holdCurrentFirst && !(await controller.holdCurrent('', currentCustomerName))) return
      const result = await controller.resume(order)
      if (result) {
        onResumed(result.customer)
        onClose()
      } else {
        await held.reload()
      }
    } catch (err) {
      notify(getErrorMessage(err), 'error')
    } finally {
      setBusyId(null)
      setConfirmSwap(null)
    }
  }

  function requestResume(order: HeldOrder) {
    if (busyId !== null) return
    // Never silently throw away what's in the cart: park it first.
    if (controller.hasCart) setConfirmSwap(order)
    else void doResume(order, false)
  }

  async function doDelete(order: HeldOrder) {
    setBusyId(order.id)
    try {
      await heldOrdersApi.discard(order)
      notify('Held order deleted.')
      await Promise.all([held.reload(), controller.refreshCount()])
    } catch (err) {
      notify(getErrorMessage(err), 'error')
    } finally {
      setBusyId(null)
      setConfirmDelete(null)
    }
  }

  const orders = held.data ?? []

  return (
    <>
      <Modal title="Held orders" description={held.data ? `${orders.length} on hold` : undefined} onClose={onClose} size="lg" mobileFullScreen>
        {held.loading && !held.data && (
          <div className="py-12">
            <Spinner />
          </div>
        )}
        {held.error && <ErrorState message={held.error} onRetry={() => void held.reload()} />}
        {!held.loading && !held.error && orders.length === 0 && (
          <div className="py-12 text-center">
            <EmptyState title="No orders on hold" hint="Use Hold on the current order to park it for later." />
          </div>
        )}

        <ul className="space-y-2">
          {orders.map((order) => {
            const busy = busyId === order.id
            const names = order.lines.map((line) => `${line.quantity}× ${line.name}`).join(', ')
            return (
              <li key={order.id} className="rounded-2xl bg-[#F6F8F7] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-semibold">
                      {order.label || order.customerName || 'Walk-in customer'}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {formatDayLabel(order.createdAt)} {formatTime(order.createdAt)} · {order.cashierName}
                      {orderTypeLabel(order.orderType) && ` · ${orderTypeLabel(order.orderType)}`}
                    </p>
                  </div>
                  <p className="shrink-0 text-[15px] font-semibold tabular-nums">{money(order.total)}</p>
                </div>
                <p className="mt-2 line-clamp-2 text-sm text-slate-600">{names}</p>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(order)}
                    disabled={busyId !== null}
                    className="h-11 rounded-xl px-4 text-sm font-medium text-rose-600 active:bg-rose-50 disabled:opacity-40"
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    onClick={() => requestResume(order)}
                    disabled={busyId !== null}
                    className="h-11 flex-1 rounded-xl bg-[#1F5E3B] text-sm font-semibold text-white transition active:scale-[0.99] disabled:bg-slate-200 disabled:text-slate-400"
                  >
                    {busy ? 'Opening…' : 'Resume'}
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      </Modal>

      {confirmDelete && (
        <ConfirmDialog
          title="Delete held order?"
          message={`${confirmDelete.label || confirmDelete.customerName || 'This order'} (${money(confirmDelete.total)}) will be removed. Nothing was charged and stock is unchanged.`}
          confirmLabel="Delete"
          danger
          busy={busyId === confirmDelete.id}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => void doDelete(confirmDelete)}
        />
      )}

      {confirmSwap && (
        <ConfirmDialog
          title="Hold the current order?"
          message="The order you’re ringing up now will be put on hold so you can resume this one."
          confirmLabel="Hold & resume"
          busy={busyId === confirmSwap.id}
          onCancel={() => setConfirmSwap(null)}
          onConfirm={() => void doResume(confirmSwap, true)}
        />
      )}
    </>
  )
}
