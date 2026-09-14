import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { salesApi } from '../api/salesApi'

import { Button } from '../components/ui/Button'
import { ConfirmDialog, Modal } from '../components/ui/Modal'

import { useAuth } from '../context/AuthContext'
import { useCheckout } from '../context/CheckoutContext'
import { useSettings } from '../context/SettingsContext'
import { useToast } from '../context/ToastContext'
import { useReceiptPrinter } from '../hooks/useReceiptPrinter'

import { printerErrorMessage } from '../services/printer'
import type { PaymentMethod, Sale } from '../types'
import { getErrorMessage } from '../utils/errors'
import { formatMoney } from '../utils/format'
import { getPrinterConfig } from '../utils/printerConfig'
import {
  buildPaymentBreakdown,
  calculateChange,
  calculateTotals,
  getPaymentReceived,
  PAYMENT_OPTIONS,
} from '../utils/pos'

const CASH_PAYMENT_METHOD: PaymentMethod = 0

export function PaymentPage() {
  const navigate = useNavigate()
  const { notify } = useToast()
  const { settings } = useSettings()
  const { can } = useAuth()
  const { state: checkout, clearCheckout } = useCheckout()
  const {
    printReceipt: sendReceiptToPrinter,
    isPrinting,
    lastPrintError,
    openDrawer,
    isOpeningDrawer,
  } = useReceiptPrinter()

  const [isMounted, setIsMounted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [receipt, setReceipt] = useState<Sale | null>(null)
  const [summaryExpanded, setSummaryExpanded] = useState(false)
  const [showVoidConfirm, setShowVoidConfirm] = useState(false)

  // Payment inputs
  const [method, setMethod] = useState<PaymentMethod>(checkout.method)
  const [cash, setCash] = useState(checkout.cash)
  const [paymentReference, setPaymentReference] = useState(
    checkout.paymentReference,
  )

  useEffect(() => {
    const id = window.setTimeout(() => setIsMounted(true), 40)
    return () => window.clearTimeout(id)
  }, [])

  // Guard: Redirect if no items in checkout
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

  // Real-time remaining balance for partial cash
  const remainingDue = Math.max(totals.total - cashValue, 0)
  const isCashSufficient = cashValue >= totals.total

  // Smart Cash Denomination Shortcuts
  const quickCashOptions = useMemo(() => {
    const t = totals.total
    if (t <= 0) return []
    const opts = new Set<number>()
    opts.add(Math.ceil(t * 100) / 100) // Exact
    const next10 = Math.ceil(t / 10) * 10
    if (next10 > t) opts.add(next10)
    const next20 = Math.ceil(t / 20) * 20
    if (next20 > t) opts.add(next20)
    const next50 = Math.ceil(t / 50) * 50
    if (next50 > t) opts.add(next50)
    const next100 = Math.ceil(t / 100) * 100
    if (next100 > t) opts.add(next100)
    const next500 = Math.ceil(t / 500) * 500
    if (next500 > t) opts.add(next500)
    const next1000 = Math.ceil(t / 1000) * 1000
    if (next1000 > t) opts.add(next1000)
    return Array.from(opts).slice(0, 4)
  }, [totals.total])

  function handleNumpadPress(digit: string) {
    if (digit === '.') {
      if (!cash.includes('.')) {
        setCash((prev) => (prev === '' ? '0.' : `${prev}.`))
      }
      return
    }

    if (digit === '00') {
      if (cash !== '' && !cash.includes('.')) {
        setCash((prev) => `${prev}00`)
      }
      return
    }

    // Safely check decimal length without TypeScript undefined error
    const decimalPart = cash.split('.')[1]
    if (decimalPart && decimalPart.length >= 2) {
      return
    }

    setCash((prev) => (prev === '0' ? digit : `${prev}${digit}`))
  }

  async function completeSale() {
    if (method === 0 && !isCashSufficient) {
      notify('Tendered cash is less than the balance due.', 'error')
      return
    }

    if (method !== 0 && !paymentReference.trim()) {
      notify('Please enter a payment reference or auth code.', 'error')
      return
    }

    setBusy(true)

    try {
      const sale = await salesApi.create({
        customerId: checkout.customerId,
        discount: totals.discount,
        paymentMethod: method,
        amountReceived: method === 0 ? cashValue : amountReceived,
        reference: paymentReference.trim() || undefined,
        items: checkout.cart.map((line) => ({
          productId: line.product.id,
          quantity: line.quantity,
        })),
      })

      setReceipt(sale)
      clearCheckout()
      notify('Sale completed successfully.')
      void sendReceiptToPrinter(sale, settings).then(
        () => {
          notify('Receipt printed successfully.')
          maybeAutoOpenDrawer(method)
        },
        () => notify('Sale completed, but receipt printing failed.', 'error'),
      )
    } catch (err) {
      notify(getErrorMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  /** Cash sales only, and only when the printer settings have auto-open enabled - non-cash payments never trigger the drawer automatically. */
  function maybeAutoOpenDrawer(paymentMethod: PaymentMethod) {
    if (paymentMethod !== CASH_PAYMENT_METHOD) return
    if (!getPrinterConfig().autoOpenDrawerOnCash) return
    void openDrawer().catch((err) => notify(printerErrorMessage(err), 'error'))
  }

  function handleOpenDrawer() {
    void openDrawer().then(
      () => notify('Cash drawer opened.'),
      (err) => notify(printerErrorMessage(err), 'error'),
    )
  }

  function printReceipt() {
    if (!receipt) return
    void sendReceiptToPrinter(receipt, settings).then(
      () => notify('Receipt printed successfully.'),
      () => notify('Receipt print failed. Please retry.', 'error'),
    )
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

  function confirmVoidTransaction() {
    clearCheckout()
    setShowVoidConfirm(false)
    navigate('/sales', { replace: true })
  }

  const selectedMethodOption = PAYMENT_OPTIONS.find(
    (opt) => opt.value === method,
  )

  const isFormValid =
    (method === 0 && isCashSufficient) ||
    (method !== 0 && paymentReference.trim().length > 0)

  return (
    <div className="min-h-screen bg-[#F6F8F7] text-[#091413] pb-28 md:pb-12 antialiased selection:bg-[#285A48] selection:text-white">
      <div className="mx-auto max-w-6xl px-3.5 pt-4 sm:px-6 md:px-8">

        {/* =======================================================
            HEADER ROW
            ======================================================= */}
        <div className="flex items-center justify-between pb-3.5">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={goBack}
              aria-label="Return to cart"
              className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[#E5EBE7] bg-white text-[#285A48] shadow-xs transition-all hover:bg-[#EAF1EE] active:scale-95 touch-manipulation"
            >
              <ArrowLeftIcon size={18} />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-black tracking-tight text-[#091413]">
                  Settlement
                </h1>
                <span className="rounded-full bg-[#EAF1EE] px-2 py-0.5 text-[10px] font-bold text-[#285A48]">
                  Register
                </span>
              </div>
              <p className="text-xs text-slate-500 font-medium">
                {checkout.cart.length} line item{checkout.cart.length !== 1 ? 's' : ''} in cart
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {can('drawer.open') && (
              <button
                type="button"
                onClick={handleOpenDrawer}
                disabled={isOpeningDrawer}
                className="flex items-center gap-1.5 rounded-2xl border border-[#E5EBE7] bg-white px-3.5 py-2.5 text-xs font-bold text-[#285A48] shadow-xs transition-all hover:bg-[#EAF1EE] active:scale-95 touch-manipulation disabled:opacity-50"
              >
                <DrawerIcon size={13} />
                <span className="hidden sm:inline">{isOpeningDrawer ? 'Opening…' : 'Open Drawer'}</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowVoidConfirm(true)}
              className="flex items-center gap-1.5 rounded-2xl border border-rose-200/80 bg-white px-3.5 py-2.5 text-xs font-bold text-rose-600 shadow-xs transition-all hover:bg-rose-50 active:scale-95 touch-manipulation"
            >
              <TrashIcon size={13} />
              <span className="hidden sm:inline">Void Order</span>
            </button>
          </div>
        </div>

        {/* =======================================================
            MAIN INTERFACE: SUMMARY (LEFT) + PAYMENT PAD (RIGHT)
            ======================================================= */}
        <div
          className={`grid min-h-0 gap-4 transition-all duration-300 ease-out lg:grid-cols-12 lg:items-start ${
            isMounted ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
          }`}
        >

          {/* =======================================================
              LEFT / TOP: ORDER SUMMARY
              ======================================================= */}
          <section className="rounded-3xl border border-[#E5EBE7] bg-white shadow-sm lg:col-span-5 flex flex-col overflow-hidden">
            {/* Header / Mobile Toggle Bar */}
            <button
              type="button"
              onClick={() => setSummaryExpanded((prev) => !prev)}
              className="flex w-full items-center justify-between p-4 text-left border-b border-[#E5EBE7] hover:bg-[#F9FAF9] transition-colors lg:cursor-default"
            >
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-[#EAF1EE] text-[#285A48]">
                  <ShoppingBagIcon size={16} />
                </div>
                <div>
                  <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Order Items
                  </h2>
                  <p className="text-[11px] text-slate-400 lg:hidden">
                    {summaryExpanded ? 'Tap to hide items' : 'Tap to inspect items'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="rounded-full bg-[#EAF1EE] px-2.5 py-0.5 text-[11px] font-bold text-[#285A48]">
                  {checkout.cart.length} items
                </span>
                <span className="text-slate-400 lg:hidden">
                  <ChevronDownIcon
                    size={16}
                    className={`transition-transform duration-200 ${
                      summaryExpanded ? 'rotate-180' : ''
                    }`}
                  />
                </span>
              </div>
            </button>

            {/* Line Items List */}
            <div
              className={`divide-y divide-slate-100 overflow-y-auto overscroll-contain px-4 py-1 transition-all duration-300 lg:block lg:max-h-[360px] ${
                summaryExpanded ? 'block max-h-72' : 'hidden lg:block'
              }`}
            >
              {checkout.cart.map((line) => (
                <div
                  key={line.product.id}
                  className="flex items-center justify-between gap-3 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-bold text-[#091413]">
                      {line.product.name}
                    </p>
                    <p className="mt-0.5 text-[11px] font-medium text-slate-400">
                      {line.quantity} ×{' '}
                      {formatMoney(
                        line.product.sellingPrice,
                        settings.currencySymbol,
                      )}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs font-extrabold text-[#091413]">
                    {formatMoney(
                      line.product.sellingPrice * line.quantity,
                      settings.currencySymbol,
                    )}
                  </span>
                </div>
              ))}
            </div>

            {/* Breakdown Totals */}
            <div className="border-t border-[#E5EBE7] bg-[#FBFDFB] p-4 space-y-2">
              <div className="flex justify-between text-xs font-medium text-slate-500">
                <span>Subtotal</span>
                <span className="font-semibold text-[#091413]">
                  {formatMoney(totals.subtotal, settings.currencySymbol)}
                </span>
              </div>

              <div className="flex justify-between text-xs font-medium text-slate-500">
                <span>Tax ({settings.taxRate}%)</span>
                <span className="font-semibold text-[#091413]">
                  {formatMoney(totals.tax, settings.currencySymbol)}
                </span>
              </div>

              {totals.discount > 0 && (
                <div className="flex justify-between text-xs font-medium text-emerald-700">
                  <span>Discount</span>
                  <span className="font-bold">
                    -{formatMoney(totals.discount, settings.currencySymbol)}
                  </span>
                </div>
              )}

              {/* Total Banner */}
              <div className="mt-3 flex items-baseline justify-between border-t border-[#E5EBE7] pt-3">
                <div>
                  <span className="text-xs font-extrabold uppercase tracking-wider text-[#285A48]">
                    Total Due
                  </span>
                  <p className="text-[10px] text-slate-400">Amount to collect</p>
                </div>
                <span className="text-3xl font-black tracking-tight text-[#091413]">
                  {formatMoney(totals.total, settings.currencySymbol)}
                </span>
              </div>
            </div>
          </section>

          {/* =======================================================
              RIGHT: PAYMENT METHOD PAD & TENDER
              ======================================================= */}
          <section className="rounded-3xl border border-[#E5EBE7] bg-white p-4 sm:p-5 shadow-sm lg:col-span-7 flex flex-col justify-between">
            <div>
              {/* Payment Method Selector Tabs */}
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Payment Method
                </label>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {PAYMENT_OPTIONS.map((option) => {
                    const isSelected = method === option.value
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => {
                          setMethod(Number(option.value) as PaymentMethod)
                          setCash('')
                        }}
                        className={`flex min-h-[48px] items-center justify-center rounded-2xl px-3 py-2 text-xs font-bold transition-all active:scale-95 touch-manipulation ${
                          isSelected
                            ? 'bg-[#285A48] text-white shadow-md shadow-[#285A48]/20'
                            : 'border border-[#E5EBE7] bg-white text-slate-600 hover:bg-[#F0F5F2]'
                        }`}
                      >
                        {option.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* CASH TENDER SECTION */}
              {method === 0 ? (
                <div className="mt-4 space-y-3">
                  {/* Tender Display */}
                  <div className="rounded-2xl border border-[#E5EBE7] bg-[#F6F8F7] p-3.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-500">
                        Cash Tendered
                      </span>
                      {cash && (
                        <button
                          type="button"
                          onClick={() => setCash('')}
                          className="flex items-center gap-1 rounded-xl bg-white px-2 py-1 text-[11px] font-bold text-slate-600 border border-slate-200/80 shadow-2xs hover:text-rose-600 transition-colors"
                        >
                          <RotateCcwIcon size={12} />
                          <span>Clear</span>
                        </button>
                      )}
                    </div>

                    <div className="mt-1 flex items-baseline justify-between">
                      <span className="text-2xl font-black text-[#091413] tracking-tight sm:text-3xl">
                        {cash
                          ? formatMoney(cashValue, settings.currencySymbol)
                          : formatMoney(0, settings.currencySymbol)}
                      </span>
                      <span className="text-xs font-semibold text-[#285A48]">
                        Exact: {formatMoney(totals.total, settings.currencySymbol)}
                      </span>
                    </div>
                  </div>

                  {/* Quick Bill Shortcuts */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                        Quick Bills
                      </span>
                      <span className="text-[10px] text-slate-400">One-tap tender</span>
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      {quickCashOptions.map((amount) => {
                        const isExact = amount === totals.total
                        const isSelected = cashValue === amount

                        return (
                          <button
                            key={amount}
                            type="button"
                            onClick={() => setCash(String(amount))}
                            className={`flex min-h-[44px] flex-col items-center justify-center rounded-2xl text-xs font-bold transition-all active:scale-95 touch-manipulation ${
                              isSelected
                                ? 'bg-[#285A48] text-white shadow-sm'
                                : isExact
                                ? 'border-2 border-[#285A48] bg-[#EAF1EE] text-[#285A48]'
                                : 'border border-[#E5EBE7] bg-white text-[#285A48] hover:bg-[#EAF1EE]'
                            }`}
                          >
                            <span>{formatMoney(amount, settings.currencySymbol)}</span>
                            {isExact && (
                              <span className="text-[9px] font-medium opacity-80">
                                Exact
                              </span>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {/* Standard 4x3 POS Numpad */}
                  <div className="space-y-2 pt-1">
                    <div className="grid grid-cols-3 gap-2">
                      {['7', '8', '9', '4', '5', '6', '1', '2', '3'].map((num) => (
                        <button
                          key={num}
                          type="button"
                          onClick={() => handleNumpadPress(num)}
                          className="flex min-h-[50px] items-center justify-center rounded-2xl border border-[#E5EBE7] bg-white text-base font-extrabold text-[#091413] shadow-2xs transition hover:bg-[#F2F6F4] active:bg-[#EAF1EE] active:scale-95 touch-manipulation"
                        >
                          {num}
                        </button>
                      ))}

                      {/* Row 4: Clear, 0, Backspace */}
                      <button
                        type="button"
                        onClick={() => setCash('')}
                        className="flex min-h-[50px] items-center justify-center rounded-2xl border border-[#E5EBE7] bg-[#F6F8F7] text-xs font-black text-rose-600 hover:bg-rose-50 active:scale-95 touch-manipulation"
                      >
                        C
                      </button>
                      <button
                        type="button"
                        onClick={() => handleNumpadPress('0')}
                        className="flex min-h-[50px] items-center justify-center rounded-2xl border border-[#E5EBE7] bg-white text-base font-extrabold text-[#091413] shadow-2xs hover:bg-[#F2F6F4] active:bg-[#EAF1EE] active:scale-95 touch-manipulation"
                      >
                        0
                      </button>
                      <button
                        type="button"
                        onClick={() => setCash((prev) => prev.slice(0, -1))}
                        className="flex min-h-[50px] items-center justify-center rounded-2xl border border-[#E5EBE7] bg-[#F6F8F7] text-[#091413] hover:bg-slate-200/70 active:scale-95 touch-manipulation"
                        aria-label="Backspace"
                      >
                        <DeleteIcon size={18} />
                      </button>
                    </div>

                    {/* Secondary row for decimals / double zero */}
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => handleNumpadPress('.')}
                        className="flex min-h-[44px] items-center justify-center rounded-2xl border border-[#E5EBE7] bg-[#FBFDFB] text-sm font-black text-slate-700 hover:bg-slate-100 active:scale-95 touch-manipulation"
                      >
                        . (decimal)
                      </button>
                      <button
                        type="button"
                        onClick={() => handleNumpadPress('00')}
                        className="flex min-h-[44px] items-center justify-center rounded-2xl border border-[#E5EBE7] bg-[#FBFDFB] text-sm font-black text-slate-700 hover:bg-slate-100 active:scale-95 touch-manipulation"
                      >
                        00
                      </button>
                    </div>
                  </div>

                  {/* DYNAMIC SYSTEM FEEDBACK: CHANGE DUE vs STILL NEEDED */}
                  {cashValue > 0 && (
                    <div
                      className={`flex items-center justify-between rounded-2xl p-3.5 border transition-all ${
                        isCashSufficient
                          ? 'border-[#285A48]/20 bg-[#EAF1EE]'
                          : 'border-amber-200 bg-amber-50'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className={`flex h-7 w-7 items-center justify-center rounded-full text-white ${
                            isCashSufficient ? 'bg-[#285A48]' : 'bg-amber-500'
                          }`}
                        >
                          {isCashSufficient ? (
                            <CheckIcon size={13} />
                          ) : (
                            <span className="text-xs font-bold">!</span>
                          )}
                        </div>
                        <span
                          className={`text-xs font-bold ${
                            isCashSufficient ? 'text-[#285A48]' : 'text-amber-800'
                          }`}
                        >
                          {isCashSufficient ? 'Change Due' : 'Still Needed'}
                        </span>
                      </div>
                      <span
                        className={`text-xl font-black ${
                          isCashSufficient ? 'text-[#285A48]' : 'text-amber-800'
                        }`}
                      >
                        {formatMoney(
                          isCashSufficient ? change : remainingDue,
                          settings.currencySymbol,
                        )}
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                /* NON-CASH (CARD / DIGITAL WALLET) SECTION */
                <div className="mt-4 space-y-4">
                  <div className="rounded-2xl border border-[#E5EBE7] bg-[#F6F8F7] p-4 text-center">
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
                      Amount to Charge
                    </p>
                    <p className="mt-1 text-3xl font-black text-[#091413]">
                      {formatMoney(totals.total, settings.currencySymbol)}
                    </p>
                    <p className="mt-1 text-[11px] font-medium text-slate-500">
                      Charge via external {selectedMethodOption?.label} terminal
                    </p>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-bold text-slate-700">
                      {selectedMethodOption?.label} Reference or Approval Code <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      autoFocus
                      value={paymentReference}
                      onChange={(e) => setPaymentReference(e.target.value)}
                      placeholder="e.g., Auth Code, Approval #, GCash Ref"
                      className="h-12 w-full rounded-2xl border border-[#E5EBE7] bg-white px-4 text-xs font-semibold text-[#091413] placeholder-slate-400 outline-none transition focus:border-[#285A48] focus:ring-2 focus:ring-[#285A48]/15"
                    />
                    <p className="mt-1.5 text-[11px] text-slate-400">
                      Enter the authorization code from the payment terminal receipt
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Desktop Action Buttons */}
            <div className="mt-6 hidden sm:grid sm:grid-cols-2 gap-2.5 pt-4 border-t border-[#E5EBE7]">
              <button
                type="button"
                onClick={goBack}
                className="flex min-h-[48px] items-center justify-center rounded-2xl border border-[#E5EBE7] bg-white text-xs font-bold text-slate-700 hover:bg-slate-50 active:scale-95 touch-manipulation"
              >
                Back to Register
              </button>

              <button
                type="button"
                disabled={busy || !isFormValid}
                onClick={() => void completeSale()}
                className="flex min-h-[48px] items-center justify-center gap-2 rounded-2xl bg-[#285A48] text-xs font-bold text-white shadow-md shadow-[#285A48]/25 transition hover:bg-[#1e4437] active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 touch-manipulation"
              >
                <CheckIcon size={16} />
                <span>{busy ? 'Finalizing Ticket…' : 'Complete Checkout'}</span>
              </button>
            </div>
          </section>
        </div>
      </div>

      {/* =======================================================
          MOBILE STICKY BOTTOM ACTION BAR (Ergonomic Thumb Reach)
          ======================================================= */}
      <div
        className="fixed inset-x-0 bottom-0 z-30 border-t border-[#E5EBE7] bg-white/95 p-3 backdrop-blur-md sm:hidden"
        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0.75rem))' }}
      >
        <button
          type="button"
          disabled={busy || !isFormValid}
          onClick={() => void completeSale()}
          className="flex min-h-[50px] w-full items-center justify-center gap-2 rounded-2xl bg-[#285A48] text-sm font-extrabold text-white shadow-lg shadow-[#285A48]/25 transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 touch-manipulation"
        >
          <CheckIcon size={18} />
          <span>
            {busy
              ? 'Processing…'
              : method === 0 && isCashSufficient && change > 0
              ? `Done • Give ${formatMoney(change, settings.currencySymbol)} Change`
              : `Settle ${formatMoney(totals.total, settings.currencySymbol)}`}
          </span>
        </button>
      </div>

      {/* =======================================================
          VOID CONFIRMATION MODAL (Nielsen #5 Error Prevention)
          ======================================================= */}
      {showVoidConfirm && (
        <ConfirmDialog
          title="Void order?"
          message={`This will cancel and clear all ${checkout.cart.length} item${checkout.cart.length !== 1 ? 's' : ''} from this order. This action cannot be undone.`}
          confirmLabel="Void Order"
          danger
          onCancel={() => setShowVoidConfirm(false)}
          onConfirm={confirmVoidTransaction}
        />
      )}

      {/* =======================================================
          RECEIPT / SUCCESS MODAL
          ======================================================= */}
      {receipt && (
        <Modal
          title="Order Settled"
          onClose={() => {
            setReceipt(null)
            navigate('/sales', { replace: true })
          }}
          footer={
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="secondary"
                onClick={() => {
                  setReceipt(null)
                  navigate('/sales', { replace: true })
                }}
              >
                New Order
              </Button>
              <Button onClick={printReceipt} disabled={isPrinting}>
                {isPrinting ? (
                  'Printing…'
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    <PrinterIcon size={14} />
                    <span>{lastPrintError ? 'Retry Print' : 'Print Receipt'}</span>
                  </span>
                )}
              </Button>
            </div>
          }
        >
          <div className="space-y-3.5 text-xs text-[#091413]">
            {/* Header branding */}
            <div className="space-y-1 text-center border-b border-[#E5EBE7] pb-3">
              {settings.showLogoOnReceipt && (
                <div className="mx-auto mb-2 flex h-11 w-11 items-center justify-center rounded-2xl bg-[#EAF1EE] text-sm font-black text-[#285A48]">
                  {settings.storeName.slice(0, 1).toUpperCase() || 'S'}
                </div>
              )}
              <h3 className="text-base font-extrabold text-[#091413]">
                {settings.storeName}
              </h3>
              {(settings.phone || settings.email || settings.address) && (
                <div className="space-y-0.5 text-[11px] text-slate-400">
                  {settings.address && <p>{settings.address}</p>}
                  {settings.phone && <p>{settings.phone}</p>}
                  {settings.email && <p>{settings.email}</p>}
                </div>
              )}
              <p className="pt-1 text-[11px] font-bold text-[#285A48]">
                Invoice #{receipt.invoiceNumber}
              </p>
            </div>

            {/* Line items */}
            <div className="divide-y divide-slate-100 py-1 max-h-48 overflow-y-auto overscroll-contain">
              {receipt.items.map((item) => (
                <div key={item.productId} className="flex justify-between py-2">
                  <span className="text-slate-700 font-medium">
                    {item.productName}{' '}
                    <span className="text-slate-400 font-bold">× {item.quantity}</span>
                  </span>
                  <span className="font-extrabold text-[#091413]">
                    {formatMoney(item.lineTotal, settings.currencySymbol)}
                  </span>
                </div>
              ))}
            </div>

            {/* Financial Summary */}
            <div className="space-y-1.5 border-t border-[#E5EBE7] pt-2.5 text-slate-500">
              <div className="flex justify-between text-xs">
                <span>Subtotal</span>
                <span className="font-bold text-[#091413]">
                  {formatMoney(receipt.subtotal, settings.currencySymbol)}
                </span>
              </div>
              {receipt.discount > 0 && (
                <div className="flex justify-between text-xs">
                  <span>Discount</span>
                  <span className="font-bold text-emerald-700">
                    -{formatMoney(receipt.discount, settings.currencySymbol)}
                  </span>
                </div>
              )}
              <div className="flex justify-between text-xs">
                <span>Tax</span>
                <span className="font-bold text-[#091413]">
                  {formatMoney(receipt.tax, settings.currencySymbol)}
                </span>
              </div>
              <div className="flex justify-between border-t border-[#E5EBE7] pt-2 text-sm font-black text-[#091413]">
                <span>Total Paid</span>
                <span className="text-[#285A48]">
                  {formatMoney(receipt.total, settings.currencySymbol)}
                </span>
              </div>
            </div>

            {/* Tender Detail Badge */}
            <div className="rounded-2xl bg-[#EAF1EE] p-3 text-[11px] text-[#285A48] space-y-1">
              <div className="flex justify-between">
                <span>Payment Method</span>
                <span className="font-bold uppercase">{receipt.paymentMethod}</span>
              </div>
              {receipt.amountReceived != null && (
                <div className="flex justify-between">
                  <span>Tendered</span>
                  <span className="font-bold">
                    {formatMoney(receipt.amountReceived, settings.currencySymbol)}
                  </span>
                </div>
              )}
              {receipt.change != null && (
                <div className="flex justify-between font-bold">
                  <span>Change Given</span>
                  <span>{formatMoney(receipt.change, settings.currencySymbol)}</span>
                </div>
              )}
            </div>

            {settings.receiptFooter && (
              <p className="pt-2 text-center text-[11px] text-slate-400 italic">
                {settings.receiptFooter}
              </p>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}

/* ===============================================================
   MINIMAL SVG ICON COMPONENTS
   =============================================================== */

function ArrowLeftIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  )
}

function RotateCcwIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  )
}

function DeleteIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z" />
      <line x1="18" y1="9" x2="12" y2="15" />
      <line x1="12" y1="9" x2="18" y2="15" />
    </svg>
  )
}

function CheckIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function TrashIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </svg>
  )
}

function DrawerIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="1" />
      <line x1="2" y1="11" x2="22" y2="11" />
      <line x1="10" y1="15.5" x2="14" y2="15.5" />
    </svg>
  )
}

function ShoppingBagIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
      <line x1="3" y1="6" x2="21" y2="6" />
      <path d="M16 10a4 4 0 0 1-8 0" />
    </svg>
  )
}

function ChevronDownIcon({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="6 9 12 15 18 9" />
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

export default PaymentPage