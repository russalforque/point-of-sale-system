import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { salesApi } from '../api/salesApi'

import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Field'
import { Modal } from '../components/ui/Modal'
import { PageHeader } from '../components/ui/Page'

import { useSettings } from '../context/SettingsContext'
import { useToast } from '../context/ToastContext'
import { useCheckout } from '../context/CheckoutContext'

import type { PaymentMethod, Sale } from '../types'

import { formatMoney } from '../utils/format'
import {
  buildPaymentBreakdown,
  calculateChange,
  calculateTotals,
  getPaymentReceived,
  PAYMENT_OPTIONS,
} from '../utils/pos'
import { getErrorMessage } from '../utils/errors'

export function PaymentPage() {
  const navigate = useNavigate()
  const { notify } = useToast()
  const { settings } = useSettings()
  const { state: checkout, clearCheckout } =
    useCheckout()

  const [isMounted, setIsMounted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [receipt, setReceipt] =
    useState<Sale | null>(null)

  // Local payment state
  const [method, setMethod] =
    useState<PaymentMethod>(checkout.method)
  const [cash, setCash] = useState(checkout.cash)
  const [paymentReference, setPaymentReference] =
    useState(checkout.paymentReference)

  useEffect(() => {
    const id = window.setTimeout(
      () => setIsMounted(true),
      40,
    )
    return () => window.clearTimeout(id)
  }, [])

  // Redirect if no cart
  useEffect(() => {
    if (!isMounted) return
    if (checkout.cart.length === 0) {
      navigate('/sales', { replace: true })
    }
  }, [isMounted, checkout.cart.length, navigate])

  const totals = useMemo(
    () =>
      calculateTotals(
        checkout.cart,
        checkout.discount,
        settings.taxRate,
      ),
    [checkout.cart, checkout.discount, settings.taxRate],
  )

  const cashValue = Number(cash) || 0
  const paymentBreakdown = useMemo(
    () => buildPaymentBreakdown(method, cashValue),
    [method, cashValue],
  )
  const amountReceived =
    method === 0 ? cashValue : getPaymentReceived(paymentBreakdown)
  const change =
    method === 0
      ? Math.max(cashValue - totals.total, 0)
      : calculateChange(totals.total, paymentBreakdown)
  async function completeSale() {
    if (
      method === 0 &&
      cashValue < totals.total
    ) {
      notify(
        'Cash received is less than the total.',
        'error',
      )
      return
    }

    if (method !== 0 && !paymentReference.trim()) {
      notify(
        'Add a payment reference or note before completing a non-cash sale.',
        'error',
      )
      return
    }

    setBusy(true)

    try {
      const sale = await salesApi.create({
        customerId: checkout.customerId,
        discount: totals.discount,
        paymentMethod: method,
        amountReceived:
          method === 0 ? cashValue : amountReceived,
        reference:
          paymentReference.trim() || undefined,
        items: checkout.cart.map((line) => ({
          productId: line.product.id,
          quantity: line.quantity,
        })),
      })

      setReceipt(sale)
      clearCheckout()
      notify('Sale completed.')
    } catch (err) {
      notify(getErrorMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  function printReceipt() {
    window.print()
  }

  function goBack() {
    navigate('/sales', {
      state: {
        cart: checkout.cart,
        customerId: checkout.customerId,
        discount: checkout.discount,
      },
    })
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-7xl px-4 pb-6 pt-4 sm:px-5 lg:px-6">
        <PageHeader
          title="Payment"
          subtitle={`${checkout.cart.length} item${checkout.cart.length !== 1 ? 's' : ''} ready to complete`}
          actions={
            <button
              type="button"
              onClick={goBack}
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm shadow-slate-200/50 transition hover:border-slate-300 hover:bg-slate-50"
            >
              Back to sale
            </button>
          }
        />

        <div className="grid min-h-0 gap-3 md:h-[calc(100vh-8.5rem)] md:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.8fr)_132px]">
          <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/50">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/80 px-4 py-3">
              <div className="grid grid-cols-[72px_minmax(0,1fr)_100px_90px] gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                <span>Item #</span><span>Title</span><span>Original price</span><span>Price</span>
              </div>
              <span className="ml-3 shrink-0 rounded-full bg-slate-100 px-2 py-1 text-[10px] font-medium text-slate-600">{checkout.cart.length} items</span>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {checkout.cart.map((line, index) => (
                <div key={line.product.id} className="grid grid-cols-[72px_minmax(0,1fr)_100px_90px] gap-2 border-b border-slate-100 px-3 py-3 text-[11px] text-slate-700">
                  <span className="text-slate-400">{String(index + 1).padStart(2, '0')}</span>
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-800" title={line.product.name}>{line.product.name}</p>
                    <p className="mt-0.5 truncate text-[10px] text-slate-400">Qty {line.quantity}</p>
                  </div>
                  <span>{formatMoney(line.product.sellingPrice, settings.currencySymbol)}</span>
                  <span className="font-semibold text-slate-900">{formatMoney(line.product.sellingPrice * line.quantity, settings.currencySymbol)}</span>
                </div>
              ))}
            </div>

            <div className="border-t border-slate-200 px-4 py-3">
              <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-[11px] text-slate-600 sm:grid-cols-4">
                <span>Total items <b className="ml-2 text-slate-900">{checkout.cart.length}</b></span>
                <span>Discount <b className="ml-2 text-slate-900">{formatMoney(totals.discount, settings.currencySymbol)}</b></span>
                <span>Tax <b className="ml-2 text-slate-900">{formatMoney(totals.tax, settings.currencySymbol)}</b></span>
                <span>Subtotal <b className="ml-2 text-slate-900">{formatMoney(totals.subtotal, settings.currencySymbol)}</b></span>
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Total due</span>
                <span className="text-xl font-black text-sky-600">{formatMoney(totals.total, settings.currencySymbol)}</span>
              </div>
            </div>
          </section>

          <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/50">
            <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50/80 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Payment method</p>
              <div className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-right text-sm font-semibold text-slate-900 shadow-inner">{cash ? formatMoney(Number(cash), settings.currencySymbol) : formatMoney(totals.total, settings.currencySymbol)}</div>
              <button type="button" onClick={() => setCash('')} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[10px] font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50">Clear</button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {method !== 0 && (
                <div className="mb-3">
                  <label className="mb-1 block text-[11px] font-semibold text-slate-600">{PAYMENT_OPTIONS.find((option) => option.value === method)?.label ?? 'Payment'} reference</label>
                  <Input className="h-9 w-full rounded-md text-sm" value={paymentReference} onChange={(e) => setPaymentReference(e.target.value)} placeholder="Enter payment reference" />
                </div>
              )}

              <div className="grid grid-cols-3 gap-1.5">
                {['7', '8', '9', '4', '5', '6', '1', '2', '3', '.', '0', '00'].map((num) => (
                  <button key={num} type="button" onClick={() => method === 0 && setCash((current) => (current === '' ? num : `${current}${num}`))} className="flex h-12 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-base font-semibold text-slate-800 transition hover:border-slate-300 hover:bg-white touch-manipulation">{num}</button>
                ))}
                <button type="button" onClick={() => method === 0 && setCash((current) => current.slice(0, -1))} className="col-span-3 flex h-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-500 hover:bg-slate-50">Backspace</button>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-1.5 border-t border-slate-100 pt-3">
                {PAYMENT_OPTIONS.map((option) => (
                  <button key={option.value} type="button" onClick={() => setMethod(Number(option.value) as PaymentMethod)} className={`rounded-xl border px-2 py-2 text-[10px] font-semibold transition-colors ${method === option.value ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'}`}>{option.label}</button>
                ))}
              </div>

              <div className="mt-3 flex items-center justify-between rounded border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs">
                <span className="font-semibold text-emerald-700">Change</span>
                <span className="font-bold text-emerald-700">{formatMoney(change, settings.currencySymbol)}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 border-t border-slate-200 p-3">
              <button type="button" onClick={goBack} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-white">Suspend</button>
              <button type="button" disabled={busy || (method === 0 && cashValue < totals.total) || (method !== 0 && !paymentReference.trim())} onClick={() => void completeSale()} className="rounded-xl bg-slate-900 px-3 py-2.5 text-xs font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300">{busy ? 'Processing...' : 'Checkout'}</button>
            </div>
          </section>

          <aside className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm shadow-slate-200/50">
            <p className="px-1 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Quick options</p>
            <button type="button" onClick={goBack} className="rounded-xl border border-slate-200 bg-slate-50 px-2 py-2.5 text-[10px] font-medium text-slate-700 transition hover:border-slate-300 hover:bg-white">Add item</button>
            <button type="button" onClick={goBack} className="rounded-xl border border-slate-200 bg-slate-50 px-2 py-2.5 text-[10px] font-medium text-slate-700 transition hover:border-slate-300 hover:bg-white">New order</button>
            <button type="button" onClick={() => setCash('')} className="rounded-xl border border-slate-200 bg-slate-50 px-2 py-2.5 text-[10px] font-medium text-slate-700 transition hover:border-slate-300 hover:bg-white">Clear payment</button>
            <button type="button" onClick={() => notify('Use the payment buttons to select a method.')} className="rounded-xl border border-slate-200 bg-slate-50 px-2 py-2.5 text-[10px] font-medium text-slate-700 transition hover:border-slate-300 hover:bg-white">More</button>
          </aside>
        </div>
      </div>

      {receipt && (
        <Modal
          title="Sale complete"
          onClose={() => {
            setReceipt(null)
            navigate('/sales', { replace: true })
          }}
          footer={
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  setReceipt(null)
                  navigate('/sales', { replace: true })
                }}
              >
                Close
              </Button>

              <Button onClick={printReceipt}>
                Print receipt
              </Button>
            </>
          }
        >
          <div
            id="receipt"
            className="
              space-y-2
              text-sm
            "
          >
            <div className="space-y-1 text-center">
              {settings.showLogoOnReceipt && (
                <div className="mb-2 flex items-center justify-center">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-900 text-sm font-bold text-white">
                    {settings.storeName
                      .slice(0, 1)
                      .toUpperCase() || 'S'}
                  </div>
                </div>
              )}

              <p className="text-center text-lg font-bold tracking-tight text-gray-900">
                {settings.storeName}
              </p>

              {(settings.phone ||
                settings.email ||
                settings.address) && (
                <div className="space-y-0.5 text-center text-[11px] text-gray-500">
                  {settings.address && (
                    <p>{settings.address}</p>
                  )}
                  {settings.phone && (
                    <p>{settings.phone}</p>
                  )}
                  {settings.email && (
                    <p>{settings.email}</p>
                  )}
                </div>
              )}

              <p
                className="
                  text-center
                  text-[11px]
                  text-gray-500
                "
              >
                {receipt.invoiceNumber}
              </p>
            </div>

            <ul
              className="
                divide-y
                divide-gray-100
              "
            >
              {receipt.items.map((item) => (
                <li
                  key={item.productId}
                  className="
                    flex
                    justify-between
                    gap-3
                    py-1
                  "
                >
                  <span
                    className="
                      min-w-0
                      truncate
                    "
                  >
                    {item.productName} ×
                    {item.quantity}
                  </span>

                  <span className="shrink-0">
                    {formatMoney(
                      item.lineTotal,
                      settings.currencySymbol,
                    )}
                  </span>
                </li>
              ))}
            </ul>

            <CheckoutRow
              label="Subtotal"
              value={formatMoney(
                receipt.subtotal,
                settings.currencySymbol,
              )}
            />

            <CheckoutRow
              label="Discount"
              value={formatMoney(
                receipt.discount,
                settings.currencySymbol,
              )}
            />

            <CheckoutRow
              label="Tax"
              value={formatMoney(
                receipt.tax,
                settings.currencySymbol,
              )}
            />

            <CheckoutRow
              label="Total"
              value={formatMoney(
                receipt.total,
                settings.currencySymbol,
              )}
              strong
            />

            <p
              className="
                text-xs
                text-gray-500
              "
            >
              {receipt.paymentMethod}

              {receipt.amountReceived !=
                null &&
                ` · Received ${formatMoney(
                  receipt.amountReceived,
                  settings.currencySymbol,
                )}`}

              {receipt.change != null &&
                ` · Change ${formatMoney(
                  receipt.change,
                  settings.currencySymbol,
                )}`}
            </p>

            {settings.receiptFooter && (
              <p
                className="
                  pt-2
                  text-center
                  text-xs
                  text-gray-500
                "
              >
                {settings.receiptFooter}
              </p>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}

function CheckoutRow({
  label,
  value,
  strong = false,
}: {
  label: string
  value: string
  strong?: boolean
}) {
  return (
    <div
      className={`
        flex
        min-w-0
        items-center
        justify-between
        gap-3

        ${strong ? 'text-base font-bold' : 'text-sm'}
      `}
    >
      <span
        className="
          min-w-0
          truncate
          text-gray-600
        "
      >
        {label}
      </span>

      <span
        className="
          shrink-0
          text-right
        "
      >
        {value}
      </span>
    </div>
  )
}
