import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { salesApi } from '../../api/salesApi'

import { Button } from '../../components/ui/Button'
import { ConfirmDialog, Modal } from '../../components/ui/Modal'

import { useAuth } from '../../context/AuthContext'
import { useCheckout } from '../../context/CheckoutContext'
import { useSettings } from '../../context/SettingsContext'
import { useToast } from '../../context/ToastContext'
import { useReceiptPrinter } from '../../hooks/useReceiptPrinter'

import { printerErrorMessage } from '../../services/printer'
import type { PaymentMethod, Sale } from '../../types'
import { getErrorMessage } from '../../utils/errors'
import { formatMoney } from '../../utils/format'
import { getPrinterConfig } from '../../utils/printerConfig'
import {
  buildPaymentBreakdown,
  calculateChange,
  calculateTotals,
  getPaymentReceived,
  PAYMENT_OPTIONS,
} from '../../utils/pos'

const CASH_PAYMENT_METHOD: PaymentMethod = 0

export function MobilePayment() {
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
  const [cartDrawerOpen, setCartDrawerOpen] = useState(false)
  const [showVoidConfirm, setShowVoidConfirm] = useState(false)

  // Payment State
  const [method, setMethod] = useState<PaymentMethod>(checkout.method)
  const [cash, setCash] = useState(checkout.cash)
  const [paymentReference, setPaymentReference] = useState(
    checkout.paymentReference,
  )

  useEffect(() => {
    const id = window.setTimeout(() => setIsMounted(true), 40)
    return () => window.clearTimeout(id)
  }, [])

  // Guard: Redirect to sales screen if cart is empty
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

  const isCashSufficient = cashValue >= totals.total
  const remainingDue = Math.max(totals.total - cashValue, 0)

  // Quick denomination suggestions for cash
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

    const decimalPart = cash.split('.')[1]
    if (decimalPart && decimalPart.length >= 2) {
      return
    }

    setCash((prev) => (prev === '0' ? digit : `${prev}${digit}`))
  }

  async function completeSale() {
    if (method === 0 && !isCashSufficient) {
      notify('Tendered cash is less than the total balance.', 'error')
      return
    }

    if (method !== 0 && !paymentReference.trim()) {
      notify('Please enter an authorization or reference code.', 'error')
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

  function confirmVoid() {
    clearCheckout()
    setShowVoidConfirm(false)
    navigate('/sales', { replace: true })
  }

  const selectedMethodOption = PAYMENT_OPTIONS.find(
    (opt) => opt.value === method,
  )

  const isReadyToSettle =
    (method === 0 && isCashSufficient) ||
    (method !== 0 && paymentReference.trim().length > 0)

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[#F6F8F7] text-[#091413] pb-48 pt-[env(safe-area-inset-top,0px)] font-sans antialiased selection:bg-[#285A48] selection:text-white">
      <div className="mx-auto max-w-md px-4 pt-3">

        {/* =========================================================
            HEADER BAR
        ========================================================= */}
        <header className="flex items-center justify-between pb-2">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={goBack}
              aria-label="Back to Cart"
              className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[#E5EBE7] bg-white text-[#285A48] shadow-xs active:scale-95 touch-manipulation transition-all hover:bg-[#EAF1EE]"
            >
              <ArrowLeftIcon size={18} />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-black tracking-tight text-[#091413]">
                  Settlement
                </h1>
                <span className="rounded-full bg-[#EAF1EE] px-2 py-0.5 text-[10px] font-bold text-[#285A48]">
                  POS
                </span>
              </div>
              <p className="text-[11px] font-medium text-slate-400">
                Register Terminal 01
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {can('drawer.open') && (
              <button
                type="button"
                onClick={handleOpenDrawer}
                disabled={isOpeningDrawer}
                aria-label="Open cash drawer"
                className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[#E5EBE7] bg-white text-[#285A48] shadow-xs active:scale-95 touch-manipulation hover:bg-[#EAF1EE] disabled:opacity-50"
              >
                <DrawerIcon size={16} />
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowVoidConfirm(true)}
              className="flex h-11 items-center gap-1 rounded-2xl border border-rose-200/80 bg-white px-3 text-xs font-bold text-rose-600 shadow-xs active:scale-95 touch-manipulation hover:bg-rose-50"
            >
              <TrashIcon size={14} />
              <span>Void</span>
            </button>
          </div>
        </header>

        {/* =========================================================
            TOTAL DUE HERO CARD
        ========================================================= */}
        <section className="mt-2.5 overflow-hidden rounded-3xl bg-gradient-to-br from-[#091413] via-[#163329] to-[#285A48] p-5 text-white shadow-xl shadow-[#091413]/10">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-100/70">
              Total Amount Due
            </span>
            <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[10px] font-bold text-emerald-200 backdrop-blur-sm border border-white/10">
              {checkout.cart.length} item{checkout.cart.length !== 1 ? 's' : ''}
            </span>
          </div>

          <div className="my-2.5">
            <h2 className="text-3xl font-black tracking-tight text-white sm:text-4xl">
              {formatMoney(totals.total, settings.currencySymbol)}
            </h2>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-white/15 text-[11px] font-medium text-emerald-100/80">
            <span>Subtotal: {formatMoney(totals.subtotal, settings.currencySymbol)}</span>
            {totals.discount > 0 && (
              <span className="text-emerald-300 font-bold">
                Disc: -{formatMoney(totals.discount, settings.currencySymbol)}
              </span>
            )}
            <span>Tax ({settings.taxRate}%): {formatMoney(totals.tax, settings.currencySymbol)}</span>
          </div>
        </section>

        {/* =========================================================
            COLLAPSIBLE CART DRAWER (Inspect Line Items)
        ========================================================= */}
        <div className="mt-3 rounded-2xl border border-[#E5EBE7] bg-white overflow-hidden shadow-2xs">
          <button
            type="button"
            onClick={() => setCartDrawerOpen((prev) => !prev)}
            className="flex w-full items-center justify-between px-3.5 py-2.5 text-left transition hover:bg-[#F9FAF9] active:bg-[#F0F5F2]"
          >
            <div className="flex items-center gap-2 text-xs font-bold text-[#091413]">
              <ShoppingBagIcon size={14} />
              <span>Inspect Order Breakdown</span>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#285A48]">
              <span>{cartDrawerOpen ? 'Hide' : 'Show Details'}</span>
              <ChevronDownIcon
                size={14}
                className={`transition-transform duration-200 ${
                  cartDrawerOpen ? 'rotate-180' : ''
                }`}
              />
            </div>
          </button>

          {cartDrawerOpen && (
            <div className="divide-y divide-slate-100 border-t border-[#E5EBE7] px-3.5 py-1 max-h-48 overflow-y-auto overscroll-contain">
              {checkout.cart.map((line) => (
                <div key={line.product.id} className="flex justify-between py-2 text-xs">
                  <div className="min-w-0 pr-2">
                    <p className="truncate font-bold text-[#091413]">{line.product.name}</p>
                    <p className="text-[10px] text-slate-400">
                      {line.quantity} × {formatMoney(line.product.sellingPrice, settings.currencySymbol)}
                    </p>
                  </div>
                  <span className="font-extrabold text-[#091413] shrink-0">
                    {formatMoney(line.product.sellingPrice * line.quantity, settings.currencySymbol)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* =========================================================
            PAYMENT METHOD SELECTOR
        ========================================================= */}
        <div className="mt-3.5">
          <div className="grid grid-cols-3 gap-2">
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
                  className={`flex min-h-[46px] items-center justify-center rounded-2xl px-2 py-2 text-xs font-bold transition-all active:scale-95 touch-manipulation ${
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

        {/* =========================================================
            CASH TENDER MODE
        ========================================================= */}
        {method === 0 ? (
          <div className="mt-3 space-y-2.5">
            {/* Cash Input Status Display */}
            <div className="rounded-2xl border border-[#E5EBE7] bg-white p-3.5 shadow-2xs">
              <div className="flex items-center justify-between text-xs text-slate-500 font-semibold">
                <span>Amount Tendered</span>
                {cash && (
                  <button
                    type="button"
                    onClick={() => setCash('')}
                    className="flex items-center gap-1 rounded-lg bg-[#F6F8F7] px-2 py-0.5 text-[10px] font-bold text-slate-600 hover:text-rose-600"
                  >
                    <RotateCcwIcon size={10} />
                    <span>Clear</span>
                  </button>
                )}
              </div>

              <div className="mt-1 flex items-baseline justify-between">
                <span className="text-2xl font-black text-[#091413] tracking-tight sm:text-3xl">
                  {cash ? formatMoney(cashValue, settings.currencySymbol) : formatMoney(0, settings.currencySymbol)}
                </span>
                <span className="text-[11px] font-bold text-[#285A48]">
                  Target: {formatMoney(totals.total, settings.currencySymbol)}
                </span>
              </div>
            </div>

            {/* Smart Cash Bill Pills */}
            <div className="grid grid-cols-4 gap-1.5">
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
                    {isExact && <span className="text-[8px] font-medium opacity-80">Exact</span>}
                  </button>
                )
              })}
            </div>

            {/* Standard 4x3 POS Numpad */}
            <div className="space-y-1.5 pt-1">
              <div className="grid grid-cols-3 gap-1.5">
                {['7', '8', '9', '4', '5', '6', '1', '2', '3'].map((num) => (
                  <button
                    key={num}
                    type="button"
                    onClick={() => handleNumpadPress(num)}
                    className="flex min-h-[48px] items-center justify-center rounded-2xl border border-[#E5EBE7] bg-white text-base font-extrabold text-[#091413] shadow-2xs active:bg-[#EAF1EE] active:scale-95 touch-manipulation transition-colors"
                  >
                    {num}
                  </button>
                ))}

                {/* Bottom Row */}
                <button
                  type="button"
                  onClick={() => setCash('')}
                  className="flex min-h-[48px] items-center justify-center rounded-2xl border border-[#E5EBE7] bg-[#F6F8F7] text-xs font-black text-rose-600 active:scale-95 touch-manipulation"
                >
                  C
                </button>
                <button
                  type="button"
                  onClick={() => handleNumpadPress('0')}
                  className="flex min-h-[48px] items-center justify-center rounded-2xl border border-[#E5EBE7] bg-white text-base font-extrabold text-[#091413] shadow-2xs active:bg-[#EAF1EE] active:scale-95 touch-manipulation"
                >
                  0
                </button>
                <button
                  type="button"
                  onClick={() => setCash((prev) => prev.slice(0, -1))}
                  className="flex min-h-[48px] items-center justify-center rounded-2xl border border-[#E5EBE7] bg-[#F6F8F7] text-[#091413] active:scale-95 touch-manipulation"
                  aria-label="Backspace"
                >
                  <DeleteIcon size={16} />
                </button>
              </div>

              {/* Decimal & Double-Zero Row */}
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => handleNumpadPress('.')}
                  className="flex min-h-[42px] items-center justify-center rounded-xl border border-[#E5EBE7] bg-white text-xs font-black text-slate-700 active:scale-95 touch-manipulation"
                >
                  . (decimal)
                </button>
                <button
                  type="button"
                  onClick={() => handleNumpadPress('00')}
                  className="flex min-h-[42px] items-center justify-center rounded-xl border border-[#E5EBE7] bg-white text-xs font-black text-slate-700 active:scale-95 touch-manipulation"
                >
                  00
                </button>
              </div>
            </div>

            {/* Dynamic change feedback */}
            {cashValue > 0 && (
              <div
                className={`flex items-center justify-between rounded-2xl p-3 border transition-all ${
                  isCashSufficient
                    ? 'border-[#285A48]/20 bg-[#EAF1EE]'
                    : 'border-amber-200 bg-amber-50'
                }`}
              >
                <div className="flex items-center gap-2">
                  <div
                    className={`flex h-6 w-6 items-center justify-center rounded-full text-white ${
                      isCashSufficient ? 'bg-[#285A48]' : 'bg-amber-500'
                    }`}
                  >
                    {isCashSufficient ? <CheckIcon size={11} /> : <span className="text-xs font-bold">!</span>}
                  </div>
                  <span className={`text-xs font-bold ${isCashSufficient ? 'text-[#285A48]' : 'text-amber-800'}`}>
                    {isCashSufficient ? 'Change Due' : 'Still Needed'}
                  </span>
                </div>
                <span className={`text-lg font-black ${isCashSufficient ? 'text-[#285A48]' : 'text-amber-800'}`}>
                  {formatMoney(isCashSufficient ? change : remainingDue, settings.currencySymbol)}
                </span>
              </div>
            )}

            {/* 🟢 INLINE SETTLE BUTTON (Always visible directly below keypad) */}
            <div className="pt-2">
              <button
                type="button"
                disabled={busy || !isReadyToSettle}
                onClick={() => void completeSale()}
                className="flex h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-[#285A48] text-sm font-extrabold text-white shadow-lg shadow-[#285A48]/25 transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 touch-manipulation"
              >
                <CheckIcon size={18} />
                <span className="truncate">
                  {busy
                    ? 'Finalizing Transaction…'
                    : isCashSufficient && change > 0
                    ? `Done • Give ${formatMoney(change, settings.currencySymbol)}`
                    : `Settle ${formatMoney(totals.total, settings.currencySymbol)}`}
                </span>
              </button>
            </div>
          </div>
        ) : (
          /* =========================================================
             CARD / DIGITAL WALLET AUTH MODE
          ========================================================= */
          <div className="mt-3.5 space-y-3 rounded-2xl border border-[#E5EBE7] bg-white p-4 shadow-2xs">
            <div className="rounded-xl bg-[#F6F8F7] p-3 text-center">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Amount to Charge
              </span>
              <p className="text-2xl font-black text-[#091413]">
                {formatMoney(totals.total, settings.currencySymbol)}
              </p>
              <p className="text-[10px] text-slate-400 mt-0.5">
                Collect via {selectedMethodOption?.label} terminal
              </p>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-bold text-slate-700">
                {selectedMethodOption?.label} Approval / Reference # <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                autoFocus
                value={paymentReference}
                onChange={(e) => setPaymentReference(e.target.value)}
                placeholder="e.g. GCash Ref, Terminal Auth Code"
                className="h-12 w-full rounded-2xl border border-[#E5EBE7] bg-[#F6F8F7] px-4 text-xs font-semibold text-[#091413] placeholder-slate-400 outline-none transition focus:border-[#285A48] focus:bg-white focus:ring-2 focus:ring-[#285A48]/15"
              />
            </div>

            {/* 🟢 INLINE SETTLE BUTTON */}
            <div className="pt-2">
              <button
                type="button"
                disabled={busy || !isReadyToSettle}
                onClick={() => void completeSale()}
                className="flex h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-[#285A48] text-sm font-extrabold text-white shadow-lg shadow-[#285A48]/25 transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 touch-manipulation"
              >
                <CheckIcon size={18} />
                <span className="truncate">
                  {busy
                    ? 'Finalizing Transaction…'
                    : `Settle ${formatMoney(totals.total, settings.currencySymbol)}`}
                </span>
              </button>
            </div>
          </div>
        )}

      </div>

      {/* =========================================================
          🟢 FLOATING BOTTOM ACTION BAR (Raised above Bottom Nav with bottom-20)
      ========================================================= */}
      <div
        className="fixed inset-x-0 bottom-20 sm:bottom-0 z-[9999] border-t border-[#E5EBE7] bg-white/95 px-4 py-2.5 shadow-xl backdrop-blur-md"
      >
        <div className="mx-auto flex max-w-md items-center gap-2.5">
          {/* Direct "Back to Register" action button */}
          <button
            type="button"
            onClick={goBack}
            className="flex h-[50px] items-center justify-center gap-1.5 rounded-2xl border border-[#E5EBE7] bg-[#F6F8F7] px-4 text-xs font-bold text-[#091413] shadow-xs active:scale-95 touch-manipulation transition hover:bg-[#EAF1EE]"
          >
            <ArrowLeftIcon size={16} />
            <span>Register</span>
          </button>

          {/* Settle / Checkout Action Button */}
          <button
            type="button"
            disabled={busy || !isReadyToSettle}
            onClick={() => void completeSale()}
            className="flex h-[50px] flex-1 items-center justify-center gap-2 rounded-2xl bg-[#285A48] text-sm font-extrabold text-white shadow-lg shadow-[#285A48]/25 transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 touch-manipulation"
          >
            <CheckIcon size={18} />
            <span className="truncate">
              {busy
                ? 'Finalizing Transaction…'
                : method === 0 && isCashSufficient && change > 0
                ? `Done • Give ${formatMoney(change, settings.currencySymbol)}`
                : `Settle ${formatMoney(totals.total, settings.currencySymbol)}`}
            </span>
          </button>
        </div>
      </div>

      {/* =========================================================
          VOID ORDER CONFIRMATION MODAL
      ========================================================= */}
      {showVoidConfirm && (
        <ConfirmDialog
          title="Void current ticket?"
          message={`This will discard this sale with ${checkout.cart.length} item${checkout.cart.length !== 1 ? 's' : ''} and reset the register to an empty ticket.`}
          confirmLabel="Void Cart"
          danger
          onCancel={() => setShowVoidConfirm(false)}
          onConfirm={confirmVoid}
        />
      )}

      {/* =========================================================
          DIGITAL RECEIPT & SUCCESS MODAL
      ========================================================= */}
      {receipt && (
        <Modal
          title="Ticket Settled"
          onClose={() => {
            setReceipt(null)
            navigate('/sales', { replace: true })
          }}
          footer={
            <div className="flex flex-col-reverse gap-2 w-full sm:flex-row sm:justify-end">
              <Button
                variant="secondary"
                onClick={() => {
                  setReceipt(null)
                  navigate('/sales', { replace: true })
                }}
              >
                Back to Register
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
          <div className="space-y-3 text-xs text-[#091413]">
            <div className="space-y-1 text-center border-b border-[#E5EBE7] pb-3">
              {settings.showLogoOnReceipt && (
                <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-2xl bg-[#EAF1EE] text-sm font-black text-[#285A48]">
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

            <div className="divide-y divide-slate-100 py-1 max-h-40 overflow-y-auto overscroll-contain">
              {receipt.items.map((item) => (
                <div key={item.productId} className="flex justify-between py-1.5">
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

            <div className="space-y-1 border-t border-[#E5EBE7] pt-2 text-slate-500">
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
              <div className="flex justify-between border-t border-[#E5EBE7] pt-1.5 text-sm font-black text-[#091413]">
                <span>Total Paid</span>
                <span className="text-[#285A48]">
                  {formatMoney(receipt.total, settings.currencySymbol)}
                </span>
              </div>
            </div>

            <div className="rounded-2xl bg-[#EAF1EE] p-2.5 text-[11px] text-[#285A48] space-y-1">
              <div className="flex justify-between">
                <span>Method</span>
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
                  <span>Change</span>
                  <span>{formatMoney(receipt.change, settings.currencySymbol)}</span>
                </div>
              )}
            </div>

            {settings.receiptFooter && (
              <p className="pt-2 text-center text-[10px] text-slate-400 italic">
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

export default MobilePayment