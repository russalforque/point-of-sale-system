import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'

import { salesApi } from '../../api/salesApi'

import { ConfirmDialog } from '../../components/ui/Modal'

import { useAuth } from '../../context/AuthContext'
import { useCheckout } from '../../context/CheckoutContext'
import { useSettings } from '../../context/SettingsContext'
import { useToast } from '../../context/ToastContext'
import { useReceiptPrinter } from '../../hooks/useReceiptPrinter'
import { ReceiptPreview } from '../../components/pos/ReceiptPreview'

import { printerErrorMessage } from '../../services/printer'
import type { PaymentMethod, Sale } from '../../types'
import { getErrorMessage } from '../../utils/errors'
import { formatMoney } from '../../utils/format'
import { getPrinterConfig } from '../../utils/printerConfig'
import {
  buildPaymentBreakdown,
  calculateTotals,
  getPaymentReceived,
  PAYMENT_OPTIONS,
} from '../../utils/pos'

const CASH_PAYMENT_METHOD: PaymentMethod = 0

// Common bill denominations used to suggest "round up" cash amounts.
const BILL_STEPS = [20, 50, 100, 200, 500, 1000]

const MAX_CASH_DIGITS = 9

type KeypadKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '.' | 'back'

/** Pure reducer for the cash keypad so keyboard and touch input share one rule set. */
function nextCash(prev: string, key: KeypadKey): string {
  if (key === 'back') return prev.slice(0, -1)

  if (key === '.') {
    if (prev.includes('.')) return prev
    return prev === '' ? '0.' : `${prev}.`
  }

  const [whole = '', decimals] = prev.split('.')
  if (decimals !== undefined && decimals.length >= 2) return prev
  if (decimals === undefined && whole.length >= MAX_CASH_DIGITS) return prev

  return prev === '0' ? key : `${prev}${key}`
}

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
  const [showItems, setShowItems] = useState(false)
  const [showVoidConfirm, setShowVoidConfirm] = useState(false)

  // Payment state
  const [method, setMethod] = useState<PaymentMethod>(checkout.method)
  const [cash, setCash] = useState(checkout.cash)
  const [paymentReference, setPaymentReference] = useState(checkout.paymentReference)

  const money = (value: number) => formatMoney(value, settings.currencySymbol)

  useEffect(() => {
    const id = window.setTimeout(() => setIsMounted(true), 40)
    return () => window.clearTimeout(id)
  }, [])

  // Guard: nothing to pay for → back to sales. Skipped once a sale completes,
  // because completing a sale clears the cart and the success screen must stay.
  useEffect(() => {
    if (!isMounted || receipt) return
    if (checkout.cart.length === 0) {
      navigate('/sales', { replace: true })
    }
  }, [isMounted, receipt, checkout.cart.length, navigate])

  const totals = useMemo(
    () => calculateTotals(checkout.cart, checkout.discount, settings.taxRate),
    [checkout.cart, checkout.discount, settings.taxRate],
  )

  const isCash = method === CASH_PAYMENT_METHOD
  const cashValue = Number(cash) || 0
  const isCashSufficient = cashValue >= totals.total
  const change = Math.max(cashValue - totals.total, 0)
  const shortBy = Math.max(totals.total - cashValue, 0)
  const itemCount = checkout.cart.reduce((sum, line) => sum + line.quantity, 0)
  const methodLabel = PAYMENT_OPTIONS.find((opt) => opt.value === method)?.label ?? 'Payment'

  const quickCashOptions = useMemo(() => {
    const total = totals.total
    if (total <= 0) return []

    const exact = Math.ceil(total * 100) / 100
    const rounded = BILL_STEPS.map((step) => Math.ceil(total / step) * step).filter(
      (amount) => amount > exact,
    )

    return [exact, ...Array.from(new Set(rounded))].slice(0, 4)
  }, [totals.total])

  const isReadyToComplete = isCash
    ? totals.total > 0 && isCashSufficient
    : paymentReference.trim().length > 0

  // Tells the cashier why the primary button is disabled.
  const blockedReason = isReadyToComplete
    ? null
    : isCash
    ? cashValue === 0
      ? 'Enter the cash received'
      : `${money(shortBy)} short`
    : `Enter the ${methodLabel} reference number`

  function pressKey(key: KeypadKey) {
    setCash((prev) => nextCash(prev, key))
  }

  function selectMethod(value: PaymentMethod) {
    setMethod(value)
  }

  async function completeSale() {
    if (busy || !isReadyToComplete) return

    setBusy(true)

    try {
      const sale = await salesApi.create({
        customerId: checkout.customerId,
        discount: totals.discount,
        paymentMethod: method,
        amountReceived: isCash ? cashValue : getPaymentReceived(buildPaymentBreakdown(method, 0)),
        reference: isCash ? undefined : paymentReference.trim() || undefined,
        items: checkout.cart.map((line) => ({
          productId: line.product.id,
          quantity: line.quantity,
        })),
      })

      setReceipt(sale)
      clearCheckout()
      void sendReceiptToPrinter(sale, settings).then(
        () => maybeAutoOpenDrawer(method),
        // The sale is already committed to SQLite - a print failure never undoes it.
        (err) => notify(`Payment completed, but receipt printing failed. ${printerErrorMessage(err)}`, 'error'),
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
      () => notify('Receipt printed.'),
      (err) => notify(printerErrorMessage(err), 'error'),
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

  function startNewSale() {
    setReceipt(null)
    navigate('/sales', { replace: true })
  }

  // Hardware keyboard support (tablets / USB keyboards). Kept in a ref so the
  // listener always calls the latest completeSale without re-subscribing.
  const completeRef = useRef(completeSale)
  completeRef.current = completeSale

  useEffect(() => {
    if (receipt || showVoidConfirm) return

    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typingInField = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA'

      if (event.key === 'Enter') {
        event.preventDefault()
        void completeRef.current()
        return
      }

      if (!isCash || typingInField) return

      if (/^[0-9]$/.test(event.key)) pressKey(event.key as KeypadKey)
      else if (event.key === '.') pressKey('.')
      else if (event.key === 'Backspace') pressKey('back')
      else if (event.key === 'Escape') setCash('')
    }

    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isCash, receipt, showVoidConfirm])

  /* ==================================================================
     SUCCESS SCREEN
  ================================================================== */

  if (receipt) {
    const receiptChange = receipt.change ?? 0

    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-white pt-[env(safe-area-inset-top,0px)] text-[#091413] antialiased">
        <div className="flex-1 overflow-y-auto overscroll-contain px-5">
          <div className="mx-auto max-w-md pb-6 pt-12 text-center">
            <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#E6F1EA] text-[#1F5E3B] animate-in zoom-in duration-300">
              <CheckIcon size={30} />
            </span>

            <h1 className="mt-5 text-2xl font-bold tracking-tight">Sale complete</h1>
            <p className="mt-1 text-sm text-slate-500">
              {receipt.invoiceNumber} · {receipt.paymentMethod}
            </p>

            {/* The one number the cashier needs right now */}
            {receiptChange > 0 ? (
              <div className="mt-8 rounded-3xl bg-[#F2F8F4] px-5 py-6">
                <p className="text-sm font-medium text-[#1F5E3B]">Give change</p>
                <p className="mt-1 text-[44px] font-bold leading-none tracking-[-0.03em] tabular-nums">
                  {money(receiptChange)}
                </p>
                {receipt.amountReceived != null && (
                  <p className="mt-3 text-sm text-slate-500">
                    Received {money(receipt.amountReceived)} · Total {money(receipt.total)}
                  </p>
                )}
              </div>
            ) : (
              <div className="mt-8 rounded-3xl bg-[#F2F8F4] px-5 py-6">
                <p className="text-sm font-medium text-[#1F5E3B]">Total paid</p>
                <p className="mt-1 text-[44px] font-bold leading-none tracking-[-0.03em] tabular-nums">
                  {money(receipt.total)}
                </p>
              </div>
            )}

            {/* Receipt details — available, but out of the way */}
            <details className="group mt-4 rounded-2xl text-left ring-1 ring-slate-100">
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-4 text-[15px] [&::-webkit-details-marker]:hidden">
                Receipt details
                <ChevronDownIcon size={16} className="text-slate-400 transition-transform group-open:rotate-180" />
              </summary>

              <div className="border-t border-slate-100 px-4 pb-4">
                <ul>
                  {receipt.items.map((item) => (
                    <li
                      key={item.productId}
                      className="flex items-baseline justify-between gap-3 border-b border-slate-100 py-2.5 text-sm last:border-b-0"
                    >
                      <span className="min-w-0 truncate">
                        {item.productName}
                        <span className="text-slate-400"> × {item.quantity}</span>
                      </span>
                      <span className="shrink-0 tabular-nums">{money(item.lineTotal)}</span>
                    </li>
                  ))}
                </ul>

                <dl className="mt-2 space-y-1.5 border-t border-slate-100 pt-3 text-sm">
                  <SummaryRow label="Subtotal" value={money(receipt.subtotal)} />
                  {receipt.discount > 0 && (
                    <SummaryRow label="Discount" value={`−${money(receipt.discount)}`} />
                  )}
                  <SummaryRow label="Tax" value={money(receipt.tax)} />
                  <SummaryRow label="Total" value={money(receipt.total)} strong />
                </dl>
              </div>
            </details>

            {/* Exactly what the printer receives (58mm / 32 columns) */}
            <details className="group mt-3 rounded-2xl text-left ring-1 ring-slate-100">
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-4 text-[15px] [&::-webkit-details-marker]:hidden">
                Receipt preview
                <ChevronDownIcon size={16} className="text-slate-400 transition-transform group-open:rotate-180" />
              </summary>
              <div className="border-t border-slate-100 p-3">
                <ReceiptPreview sale={receipt} settings={settings} />
              </div>
            </details>
          </div>
        </div>

        <footer className="border-t border-slate-100 px-5 pb-[max(1rem,env(safe-area-inset-bottom,0px))] pt-3">
          <div className="mx-auto max-w-md space-y-2">
            {(isPrinting || lastPrintError) && (
              <p aria-live="polite" className={`text-center text-sm ${isPrinting ? 'text-slate-500' : 'text-rose-600'}`}>
                {isPrinting ? 'Printing receipt…' : 'Payment completed, but receipt printing failed.'}
              </p>
            )}
            <PrimaryButton onClick={startNewSale}>New sale</PrimaryButton>

            <button
              type="button"
              onClick={printReceipt}
              disabled={isPrinting}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl text-[15px] font-medium text-[#1F5E3B] transition active:bg-[#F2F8F4] disabled:opacity-50"
            >
              <PrinterIcon size={16} />
              {isPrinting ? 'Printing…' : lastPrintError ? 'Retry printing' : 'Print receipt again'}
            </button>
          </div>
        </footer>
      </div>
    )
  }

  /* ==================================================================
     PAYMENT SCREEN
  ================================================================== */

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white pt-[env(safe-area-inset-top,0px)] text-[#091413] antialiased">
      {/* HEADER */}
      <header className="flex items-center gap-2 px-2 pt-2">
        <button
          type="button"
          onClick={goBack}
          disabled={busy}
          aria-label="Back to order"
          className="flex h-11 w-11 items-center justify-center rounded-full transition active:bg-slate-100 disabled:opacity-40"
        >
          <ArrowLeftIcon size={20} />
        </button>

        <h1 className="flex-1 text-lg font-semibold">Payment</h1>

        {can('drawer.open') && (
          <button
            type="button"
            onClick={handleOpenDrawer}
            disabled={isOpeningDrawer || busy}
            aria-label="Open cash drawer"
            title="Open cash drawer"
            className="flex h-11 w-11 items-center justify-center rounded-full text-slate-600 transition active:bg-slate-100 disabled:opacity-40"
          >
            <DrawerIcon size={18} />
          </button>
        )}

        <button
          type="button"
          onClick={() => setShowVoidConfirm(true)}
          disabled={busy}
          className="h-11 rounded-full px-3 text-sm font-medium text-rose-600 transition active:bg-rose-50 disabled:opacity-40"
        >
          Cancel sale
        </button>
      </header>

      <main className="flex-1 overflow-y-auto overscroll-contain px-5">
        <div className="mx-auto max-w-md pb-4">
          {/* AMOUNT DUE */}
          <section className="pt-4 text-center">
            <p className="text-sm text-slate-500">Amount due</p>
            <p className="mt-1 text-[44px] font-bold leading-none tracking-[-0.03em] tabular-nums">
              {money(totals.total)}
            </p>

            <button
              type="button"
              onClick={() => setShowItems((open) => !open)}
              aria-expanded={showItems}
              className="mt-2 inline-flex h-9 items-center gap-1 rounded-full px-3 text-sm text-[#1F5E3B] active:bg-[#F2F8F4]"
            >
              {itemCount} {itemCount === 1 ? 'item' : 'items'}
              {totals.discount > 0 && ` · ${money(totals.discount)} off`}
              <ChevronDownIcon
                size={14}
                className={`transition-transform ${showItems ? 'rotate-180' : ''}`}
              />
            </button>
          </section>

          {showItems && (
            <div className="mt-2 rounded-2xl bg-[#F6F8F7] px-4 py-2">
              <ul className="max-h-48 overflow-y-auto overscroll-contain">
                {checkout.cart.map((line) => (
                  <li
                    key={line.product.id}
                    className="flex items-baseline justify-between gap-3 border-b border-slate-200/60 py-2.5 text-sm last:border-b-0"
                  >
                    <span className="min-w-0 truncate">
                      {line.product.name}
                      <span className="text-slate-400"> × {line.quantity}</span>
                    </span>
                    <span className="shrink-0 tabular-nums">
                      {money(line.product.sellingPrice * line.quantity)}
                    </span>
                  </li>
                ))}
              </ul>

              <dl className="space-y-1 border-t border-slate-200/60 py-2.5 text-sm">
                <SummaryRow label="Subtotal" value={money(totals.subtotal)} />
                {totals.discount > 0 && (
                  <SummaryRow label="Discount" value={`−${money(totals.discount)}`} />
                )}
                <SummaryRow label={`Tax (${Math.round(settings.taxRate * 10000) / 100}%)`} value={money(totals.tax)} />
              </dl>
            </div>
          )}

          {/* METHOD */}
          <div
            role="radiogroup"
            aria-label="Payment method"
            className="mt-6 grid grid-cols-4 rounded-full bg-[#F1F4F3] p-1"
          >
            {PAYMENT_OPTIONS.map((option) => {
              const isSelected = method === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  onClick={() => selectMethod(option.value as PaymentMethod)}
                  className={`min-h-11 rounded-full text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B] focus-visible:ring-offset-2 ${
                    isSelected ? 'bg-[#1F5E3B] text-white shadow-sm' : 'text-slate-600'
                  }`}
                >
                  {option.label}
                </button>
              )
            })}
          </div>

          {isCash ? (
            <section aria-label="Cash payment" className="mt-5">
              {/* Received + live change / short feedback */}
              <div className="flex items-end justify-between gap-3 rounded-2xl bg-[#F6F8F7] px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm text-slate-500">Cash received</p>
                  <p
                    aria-live="polite"
                    className={`mt-0.5 truncate text-3xl font-semibold tabular-nums ${
                      cash ? '' : 'text-slate-300'
                    }`}
                  >
                    {money(cashValue)}
                  </p>
                </div>

                {cashValue > 0 && (
                  <div className="shrink-0 text-right" aria-live="polite">
                    <p className={`text-sm ${isCashSufficient ? 'text-[#1F5E3B]' : 'text-amber-700'}`}>
                      {isCashSufficient ? 'Change' : 'Short'}
                    </p>
                    <p
                      className={`text-lg font-semibold tabular-nums ${
                        isCashSufficient ? 'text-[#1F5E3B]' : 'text-amber-700'
                      }`}
                    >
                      {money(isCashSufficient ? change : shortBy)}
                    </p>
                  </div>
                )}
              </div>

              {/* Quick amounts */}
              <div className="mt-3 grid grid-cols-4 gap-2">
                {quickCashOptions.map((amount, index) => {
                  const isSelected = cashValue === amount
                  return (
                    <button
                      key={amount}
                      type="button"
                      onClick={() => setCash(String(amount))}
                      aria-pressed={isSelected}
                      className={`flex h-12 flex-col items-center justify-center rounded-xl text-sm font-medium tabular-nums transition active:scale-95 ${
                        isSelected
                          ? 'bg-[#1F5E3B] text-white'
                          : 'bg-[#E6F1EA] text-[#1F5E3B]'
                      }`}
                    >
                      {index === 0 ? 'Exact' : money(amount)}
                    </button>
                  )
                })}
              </div>

              {/* Keypad — phone layout; clear lives away from digits */}
              <div className="mt-3 grid grid-cols-3 gap-2">
                {(['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0'] as KeypadKey[]).map((key) => (
                  <KeypadButton key={key} onClick={() => pressKey(key)} label={key === '.' ? 'Decimal point' : key}>
                    {key}
                  </KeypadButton>
                ))}
                <KeypadButton onClick={() => pressKey('back')} label="Delete last digit">
                  <DeleteIcon size={20} />
                </KeypadButton>
              </div>

              {cash && (
                <button
                  type="button"
                  onClick={() => setCash('')}
                  className="mx-auto mt-2 flex h-10 items-center rounded-full px-4 text-sm text-slate-500 active:bg-slate-100"
                >
                  Clear amount
                </button>
              )}
            </section>
          ) : (
            <section aria-label={`${methodLabel} payment`} className="mt-6">
              <p className="text-sm text-slate-500">
                Collect <span className="font-medium text-[#091413]">{money(totals.total)}</span> via{' '}
                {methodLabel}, then enter the reference number from the terminal or app.
              </p>

              <label htmlFor="payment-reference" className="mt-4 block text-sm font-medium">
                Reference number
              </label>
              <input
                id="payment-reference"
                type="text"
                autoFocus
                autoComplete="off"
                autoCapitalize="characters"
                enterKeyHint="done"
                value={paymentReference}
                onChange={(e) => setPaymentReference(e.target.value)}
                placeholder={method === 2 ? 'e.g. 1234 567 890123' : 'e.g. approval code'}
                className="mt-1.5 h-14 w-full rounded-2xl border-0 bg-[#F3F5F4] px-4 text-lg tracking-wide placeholder:text-base placeholder:tracking-normal placeholder:text-slate-400 outline-none transition focus:bg-white focus:ring-2 focus:ring-[#1F5E3B]"
              />
            </section>
          )}
        </div>
      </main>

      {/* SINGLE PRIMARY ACTION */}
      <footer className="border-t border-slate-100 px-5 pb-[max(1rem,env(safe-area-inset-bottom,0px))] pt-3">
        <div className="mx-auto max-w-md">
          <p
            aria-live="polite"
            className={`mb-2 h-5 text-center text-sm ${
              blockedReason ? 'text-slate-500' : 'text-transparent'
            }`}
          >
            {blockedReason ?? ' '}
          </p>

          <PrimaryButton onClick={() => void completeSale()} disabled={busy || !isReadyToComplete}>
            {busy ? (
              'Completing sale…'
            ) : isCash && isCashSufficient && change > 0 ? (
              <span className="flex w-full items-center justify-between">
                <span>Complete sale</span>
                <span className="tabular-nums">Change {money(change)}</span>
              </span>
            ) : (
              <span className="flex w-full items-center justify-between">
                <span>Complete sale</span>
                <span className="tabular-nums">{money(totals.total)}</span>
              </span>
            )}
          </PrimaryButton>
        </div>
      </footer>

      {showVoidConfirm && (
        <ConfirmDialog
          title="Cancel this sale?"
          message={`The ${itemCount} ${itemCount === 1 ? 'item' : 'items'} in this order will be removed. This can't be undone.`}
          confirmLabel="Cancel sale"
          danger
          onCancel={() => setShowVoidConfirm(false)}
          onConfirm={confirmVoid}
        />
      )}
    </div>
  )
}

/* ===============================================================
   BUILDING BLOCKS
=============================================================== */

function PrimaryButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-14 w-full items-center justify-center rounded-2xl bg-[#1F5E3B] px-5 text-[15px] font-semibold text-white transition active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B] focus-visible:ring-offset-2"
    >
      {children}
    </button>
  )
}

function KeypadButton({
  onClick,
  label,
  children,
}: {
  onClick: () => void
  label: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex h-14 touch-manipulation items-center justify-center rounded-2xl bg-[#F6F8F7] text-2xl font-medium transition-colors active:bg-[#E6F1EA]"
    >
      {children}
    </button>
  )
}

function SummaryRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? 'font-semibold text-[#091413]' : 'text-slate-500'}`}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  )
}

/* ===============================================================
   ICONS
=============================================================== */

function Svg({ size, className = '', children }: { size: number; className?: string; children: ReactNode }) {
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
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

function ArrowLeftIcon({ size = 16 }: { size?: number }) {
  return (
    <Svg size={size}>
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </Svg>
  )
}

function DeleteIcon({ size = 16 }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z" />
      <line x1="18" y1="9" x2="12" y2="15" />
      <line x1="12" y1="9" x2="18" y2="15" />
    </Svg>
  )
}

function CheckIcon({ size = 16 }: { size?: number }) {
  return (
    <Svg size={size}>
      <polyline points="20 6 9 17 4 12" />
    </Svg>
  )
}

function DrawerIcon({ size = 14 }: { size?: number }) {
  return (
    <Svg size={size}>
      <rect x="2" y="4" width="20" height="16" rx="1" />
      <line x1="2" y1="11" x2="22" y2="11" />
      <line x1="10" y1="15.5" x2="14" y2="15.5" />
    </Svg>
  )
}

function ChevronDownIcon({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <Svg size={size} className={className}>
      <polyline points="6 9 12 15 18 9" />
    </Svg>
  )
}

function PrinterIcon({ size = 14 }: { size?: number }) {
  return (
    <Svg size={size}>
      <polyline points="6 9 6 2 18 2 18 9" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" />
    </Svg>
  )
}

export default MobilePayment
