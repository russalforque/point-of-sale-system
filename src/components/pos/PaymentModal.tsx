import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'

import { salesApi } from '../../api/salesApi'
import { useCheckout } from '../../context/CheckoutContext'
import { useSettings } from '../../context/SettingsContext'
import { useToast } from '../../context/ToastContext'
import { useDismissOnBack } from '../../hooks/useDismissOnBack'
import { useReceiptPrinter } from '../../hooks/useReceiptPrinter'
import { ReceiptPreview } from './ReceiptPreview'
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
  type CartLine,
  type CartTotals,
} from '../../utils/pos'
import { Modal } from '../ui/Modal'

const CASH_PAYMENT_METHOD: PaymentMethod = 0

/** Philippine peso bills used to suggest "round up" cash amounts. */
const BILL_DENOMINATIONS = [20, 50, 100, 200, 500, 1000]

/** Keypad entry cap (~₱9,999,999.99). */
const MAX_CASH_DIGITS = 9

/** Exact amount first, then the next bills that fully cover the total — never a short amount. */
function quickCashAmounts(total: number): number[] {
  if (total <= 0) return []
  const exact = Math.round(total * 100) / 100
  const rounded = BILL_DENOMINATIONS.map((bill) => Math.ceil(exact / bill) * bill).filter((amount) => amount > exact)
  return [exact, ...Array.from(new Set(rounded))].slice(0, 4)
}

function methodInstruction(value: PaymentMethod): string {
  switch (value) {
    case 1:
      return 'Charge the card on your terminal, then enter the approval code.'
    case 2:
      return 'Have the customer pay via GCash, then enter the reference number.'
    default:
      return 'Collect the payment (bank transfer, QR Ph, etc.), then enter its reference.'
  }
}

function MethodIcon({ value, size = 18 }: { value: PaymentMethod; size?: number }) {
  switch (value) {
    case 0:
      return <CashIcon size={size} />
    case 1:
      return <CardIcon size={size} />
    case 2:
      return <WalletIcon size={size} />
    default:
      return <MoreIcon size={size} />
  }
}

/**
 * Payment step for both the phone and tablet/desktop registers. Settlement logic
 * (salesApi.create, receipt printing, drawer kick) is unchanged; the UI puts the
 * amount due first, keeps one primary action, and explains why it is disabled.
 */
export function PaymentModal({ onClose }: { onClose: () => void }) {
  const { notify } = useToast()
  const { settings } = useSettings()
  const { state: checkout, clearCheckout } = useCheckout()
  const {
    printReceipt: sendReceiptToPrinter,
    isPrinting,
    lastPrintError,
    openDrawer,
  } = useReceiptPrinter()

  const [busy, setBusy] = useState(false)
  const [receipt, setReceipt] = useState<Sale | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [showItems, setShowItems] = useState(false)

  const [method, setMethod] = useState<PaymentMethod>(CASH_PAYMENT_METHOD)
  // Raw digits typed on the keypad, read right-to-left as centavos
  // (e.g. "6720" -> 67.20), so cents are always reachable without a decimal key.
  const [cashDigits, setCashDigits] = useState('')
  const [paymentReference, setPaymentReference] = useState('')

  // Back closes the modal instead of leaving the register — and is ignored mid-payment.
  const { close } = useDismissOnBack('paymentModalOpen', onClose, busy)

  const money = (value: number) => formatMoney(value, settings.currencySymbol)

  const totals = useMemo(
    () => calculateTotals(checkout.cart, checkout.discount, settings.taxRate),
    [checkout.cart, checkout.discount, settings.taxRate],
  )

  const isCash = method === CASH_PAYMENT_METHOD
  const cashValue = cashDigits ? Number(cashDigits) / 100 : 0
  // Non-cash tenders never carry a typed cash amount, matching the previous payload.
  const paymentBreakdown = useMemo(
    () => buildPaymentBreakdown(method, isCash ? cashValue : 0),
    [method, isCash, cashValue],
  )
  const amountReceived = isCash ? cashValue : getPaymentReceived(paymentBreakdown)
  const change = isCash ? Math.max(cashValue - totals.total, 0) : calculateChange(totals.total, paymentBreakdown)
  const remainingDue = Math.max(totals.total - cashValue, 0)
  const isCashSufficient = cashValue >= totals.total
  const trimmedReference = paymentReference.trim()

  const methodLabel = PAYMENT_OPTIONS.find((opt) => opt.value === method)?.label ?? 'Payment'
  const itemCount = checkout.cart.reduce((sum, line) => sum + line.quantity, 0)
  const quickAmounts = useMemo(() => quickCashAmounts(totals.total), [totals.total])

  const isFormValid = isCash ? isCashSufficient : trimmedReference.length > 0

  const blockedReason = isFormValid
    ? null
    : isCash
    ? cashValue === 0
      ? 'Enter the cash received'
      : `${money(remainingDue)} short`
    : `Enter the ${methodLabel} reference number`

  /* ------------------------------------------------------------------
     CASH ENTRY
  ------------------------------------------------------------------ */

  function handleCashDigit(digit: string) {
    setCashDigits((prev) => (prev.length >= MAX_CASH_DIGITS ? prev : `${prev}${digit}`))
    setErrorMessage(null)
  }

  function handleCashDoubleZero() {
    setCashDigits((prev) => (prev === '' || prev.length + 2 > MAX_CASH_DIGITS ? prev : `${prev}00`))
    setErrorMessage(null)
  }

  function handleCashBackspace() {
    setCashDigits((prev) => prev.slice(0, -1))
    setErrorMessage(null)
  }

  function handleCashClear() {
    setCashDigits('')
    setErrorMessage(null)
  }

  function handleCashQuickSelect(amount: number) {
    setCashDigits(String(Math.round(amount * 100)))
    setErrorMessage(null)
  }

  function selectMethod(value: PaymentMethod) {
    setMethod(value)
    setErrorMessage(null)
  }

  /* ------------------------------------------------------------------
     SETTLEMENT (unchanged business logic)
  ------------------------------------------------------------------ */

  async function completeSale() {
    if (busy) return

    if (isCash && !isCashSufficient) {
      setErrorMessage(`Amount received is short by ${money(remainingDue)}.`)
      return
    }

    if (!isCash && !trimmedReference) {
      setErrorMessage('Enter a payment reference or approval code.')
      return
    }

    setErrorMessage(null)
    setBusy(true)

    try {
      const sale = await salesApi.create({
        customerId: checkout.customerId,
        discount: totals.discount,
        paymentMethod: method,
        amountReceived: isCash ? cashValue : amountReceived,
        reference: isCash ? undefined : trimmedReference || undefined,
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
      setErrorMessage(getErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  /** Cash sales only, and only when printer settings have auto-open enabled. */
  function maybeAutoOpenDrawer(paymentMethod: PaymentMethod) {
    if (paymentMethod !== CASH_PAYMENT_METHOD) return
    if (!getPrinterConfig().autoOpenDrawerOnCash) return
    void openDrawer().catch((err) => notify(printerErrorMessage(err), 'error'))
  }

  function printReceipt() {
    if (!receipt) return
    void sendReceiptToPrinter(receipt, settings).then(
      () => notify('Receipt printed.'),
      (err) => notify(printerErrorMessage(err), 'error'),
    )
  }

  function handleReferenceKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (isFormValid) void completeSale()
    }
  }

  // Hardware keyboard support for cash entry (tablets / desktop registers).
  const completeSaleRef = useRef(completeSale)
  useEffect(() => {
    completeSaleRef.current = completeSale
  })

  useEffect(() => {
    if (receipt || !isCash) return

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return

      if (/^[0-9]$/.test(event.key)) {
        event.preventDefault()
        handleCashDigit(event.key)
      } else if (event.key === 'Backspace') {
        event.preventDefault()
        handleCashBackspace()
      } else if (event.key === 'Delete') {
        event.preventDefault()
        handleCashClear()
      } else if (event.key === 'Enter') {
        event.preventDefault()
        void completeSaleRef.current()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [receipt, isCash])

  /* ------------------------------------------------------------------
     RENDER
  ------------------------------------------------------------------ */

  const paymentFooter = (
    <div className="w-full">
      <p
        aria-live="polite"
        className={`mb-2 min-h-5 text-center text-sm sm:text-right ${
          blockedReason && !busy ? 'text-slate-500' : 'text-transparent'
        }`}
      >
        {blockedReason ?? ' '}
      </p>
      <div className="flex w-full items-center gap-2">
        <button
          type="button"
          onClick={close}
          disabled={busy}
          className="h-14 shrink-0 rounded-2xl px-5 text-[15px] font-medium text-slate-600 transition active:bg-slate-100 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B]"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void completeSale()}
          disabled={busy || !isFormValid}
          className="flex h-14 min-w-0 flex-1 items-center justify-between gap-3 rounded-2xl bg-[#1F5E3B] px-5 text-[15px] font-semibold text-white transition active:scale-[0.99] disabled:bg-slate-200 disabled:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B] focus-visible:ring-offset-2"
        >
          {busy ? (
            <span className="flex w-full items-center justify-center gap-2">
              <SpinnerIcon size={16} />
              Completing sale…
            </span>
          ) : (
            <>
              <span>Complete sale</span>
              <span className="truncate tabular-nums">
                {isCash && isCashSufficient && change > 0 ? `Change ${money(change)}` : money(totals.total)}
              </span>
            </>
          )}
        </button>
      </div>
    </div>
  )

  const successFooter = (
    <div className="flex w-full items-center gap-2">
      <button
        type="button"
        onClick={printReceipt}
        disabled={isPrinting}
        className="flex h-14 shrink-0 items-center gap-2 rounded-2xl px-4 text-[15px] font-medium text-[#1F5E3B] transition active:bg-[#F2F8F4] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B]"
      >
        <PrinterIcon size={16} />
        {isPrinting ? 'Printing…' : lastPrintError ? 'Retry print' : 'Print again'}
      </button>
      <button
        type="button"
        autoFocus
        onClick={close}
        className="h-14 flex-1 rounded-2xl bg-[#1F5E3B] px-5 text-[15px] font-semibold text-white transition active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B] focus-visible:ring-offset-2"
      >
        New sale
      </button>
    </div>
  )

  return (
    <Modal
      title={receipt ? 'Sale complete' : 'Payment'}
      description={
        receipt
          ? `Invoice #${receipt.invoiceNumber}`
          : `${itemCount} ${itemCount === 1 ? 'item' : 'items'}`
      }
      onClose={close}
      preventClose={busy}
      size="2xl"
      mobileFullScreen
      footer={receipt ? successFooter : paymentFooter}
    >
      {receipt ? (
        <SuccessView
          receipt={receipt}
          settings={settings}
          money={money}
          isPrinting={isPrinting}
          printFailed={Boolean(lastPrintError)}
        />
      ) : (
        <div className="grid gap-5 lg:grid-cols-2 lg:gap-6">
          {/* ORDER — amount due first */}
          <section aria-label="Order summary" className="min-w-0">
            <div className="rounded-3xl bg-[#F2F8F4] px-5 py-5 text-center lg:text-left">
              <p className="text-sm font-medium text-[#1F5E3B]">Amount due</p>
              <p className="mt-1 truncate text-[40px] font-bold leading-none tracking-[-0.03em] tabular-nums text-[#091413]">
                {money(totals.total)}
              </p>
              <button
                type="button"
                onClick={() => setShowItems((open) => !open)}
                aria-expanded={showItems}
                aria-controls="payment-order-items"
                className="mt-3 inline-flex h-9 items-center gap-1 rounded-full px-3 text-sm text-[#1F5E3B] active:bg-white/70 lg:hidden"
              >
                {showItems ? 'Hide items' : `View ${itemCount} ${itemCount === 1 ? 'item' : 'items'}`}
                {totals.discount > 0 && ` · ${money(totals.discount)} off`}
                <ChevronIcon open={showItems} />
              </button>
            </div>

            <OrderItems
              id="payment-order-items"
              className={`${showItems ? 'block' : 'hidden'} lg:block`}
              cart={checkout.cart}
              totals={totals}
              taxRatePercent={Math.round(settings.taxRate * 10000) / 100}
              money={money}
            />
          </section>

          {/* PAYMENT */}
          <section aria-label="Payment" className="min-w-0">
            <MethodSelector value={method} onChange={selectMethod} />

            {errorMessage && (
              <div role="alert" className="mt-3 flex items-start gap-2.5 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
                <span className="mt-0.5 shrink-0">
                  <WarningIcon size={14} />
                </span>
                <span>{errorMessage}</span>
              </div>
            )}

            {isCash ? (
              <CashEntry
                money={money}
                cashValue={cashValue}
                isCashSufficient={isCashSufficient}
                change={change}
                remainingDue={remainingDue}
                quickAmounts={quickAmounts}
                onDigit={handleCashDigit}
                onDoubleZero={handleCashDoubleZero}
                onBackspace={handleCashBackspace}
                onClear={handleCashClear}
                onQuickSelect={handleCashQuickSelect}
              />
            ) : (
              <div className="mt-5">
                <p className="text-sm text-slate-500">{methodInstruction(method)}</p>
                <label htmlFor="payment-modal-reference-input" className="mt-4 block text-sm font-medium text-[#091413]">
                  Reference number
                </label>
                <input
                  key={method}
                  id="payment-modal-reference-input"
                  type="text"
                  autoFocus
                  autoComplete="off"
                  autoCapitalize="characters"
                  enterKeyHint="done"
                  value={paymentReference}
                  onChange={(e) => {
                    setPaymentReference(e.target.value)
                    setErrorMessage(null)
                  }}
                  onKeyDown={handleReferenceKeyDown}
                  placeholder={method === 1 ? 'Approval code' : 'Reference no.'}
                  className="mt-1.5 h-14 w-full rounded-2xl border-0 bg-[#F3F5F4] px-4 text-lg tracking-wide text-[#091413] placeholder:text-base placeholder:tracking-normal placeholder:text-slate-400 outline-none transition focus:bg-white focus:ring-2 focus:ring-[#1F5E3B]"
                />
              </div>
            )}
          </section>
        </div>
      )}
    </Modal>
  )
}

/* =====================================================================
   PIECES
===================================================================== */

function MethodSelector({ value, onChange }: { value: PaymentMethod; onChange: (value: PaymentMethod) => void }) {
  const buttonsRef = useRef<(HTMLButtonElement | null)[]>([])

  // Radio-group arrow key navigation.
  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(event.key)) return
    event.preventDefault()
    const index = PAYMENT_OPTIONS.findIndex((option) => option.value === value)
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1
    const nextIndex = (index + step + PAYMENT_OPTIONS.length) % PAYMENT_OPTIONS.length
    const next = PAYMENT_OPTIONS[nextIndex]
    if (!next) return
    onChange(Number(next.value) as PaymentMethod)
    buttonsRef.current[nextIndex]?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-label="Payment method"
      onKeyDown={handleKeyDown}
      className="grid grid-cols-4 gap-1 rounded-2xl bg-[#F1F4F3] p-1"
    >
      {PAYMENT_OPTIONS.map((option, index) => {
        const selected = value === option.value
        return (
          <button
            key={option.value}
            ref={(element) => {
              buttonsRef.current[index] = element
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(Number(option.value) as PaymentMethod)}
            className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl text-xs transition touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B] ${
              selected ? 'bg-white font-semibold text-[#1F5E3B] shadow-sm' : 'font-medium text-slate-600 active:bg-white/60'
            }`}
          >
            <MethodIcon value={option.value} size={18} />
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

function CashEntry({
  money,
  cashValue,
  isCashSufficient,
  change,
  remainingDue,
  quickAmounts,
  onDigit,
  onDoubleZero,
  onBackspace,
  onClear,
  onQuickSelect,
}: {
  money: (value: number) => string
  cashValue: number
  isCashSufficient: boolean
  change: number
  remainingDue: number
  quickAmounts: number[]
  onDigit: (digit: string) => void
  onDoubleZero: () => void
  onBackspace: () => void
  onClear: () => void
  onQuickSelect: (amount: number) => void
}) {
  const hasEntry = cashValue > 0

  return (
    <div className="mt-4">
      {/* Received + live change / short */}
      <div className="flex items-end justify-between gap-3 rounded-2xl bg-[#F6F8F7] px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm text-slate-500">Cash received</p>
            {hasEntry && (
              <button
                type="button"
                onClick={onClear}
                className="h-7 rounded-full px-2 text-xs font-medium text-slate-500 active:bg-slate-200"
              >
                Clear
              </button>
            )}
          </div>
          <p
            aria-live="polite"
            className={`mt-0.5 truncate text-3xl font-semibold tabular-nums ${hasEntry ? 'text-[#091413]' : 'text-slate-300'}`}
          >
            {money(cashValue)}
          </p>
        </div>

        {hasEntry && (
          <div className="shrink-0 text-right" aria-live="polite">
            <p className={`text-sm ${isCashSufficient ? 'text-[#1F5E3B]' : 'text-amber-700'}`}>
              {isCashSufficient ? 'Change' : 'Short'}
            </p>
            <p className={`text-xl font-semibold tabular-nums ${isCashSufficient ? 'text-[#1F5E3B]' : 'text-amber-700'}`}>
              {money(isCashSufficient ? change : remainingDue)}
            </p>
          </div>
        )}
      </div>

      {/* Quick amounts — all of them cover the total */}
      <div className="mt-3 grid grid-cols-4 gap-2">
        {quickAmounts.map((amount, index) => {
          const selected = hasEntry && Math.abs(cashValue - amount) < 0.005
          return (
            <button
              key={amount}
              type="button"
              onClick={() => onQuickSelect(amount)}
              aria-pressed={selected}
              className={`h-12 truncate rounded-xl px-1 text-sm font-medium tabular-nums transition active:scale-95 touch-manipulation ${
                selected ? 'bg-[#1F5E3B] text-white' : 'bg-[#E6F1EA] text-[#1F5E3B]'
              }`}
            >
              {index === 0 ? 'Exact' : money(amount)}
            </button>
          )
        })}
      </div>

      {/* Keypad */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
          <KeypadKey key={digit} label={digit} onClick={() => onDigit(digit)}>
            {digit}
          </KeypadKey>
        ))}
        <KeypadKey label="Double zero" onClick={onDoubleZero}>
          00
        </KeypadKey>
        <KeypadKey label="0" onClick={() => onDigit('0')}>
          0
        </KeypadKey>
        <KeypadKey label="Delete last digit" onClick={onBackspace}>
          <BackspaceIcon size={20} />
        </KeypadKey>
      </div>

      <p className="mt-2 hidden text-center text-xs text-slate-400 lg:block">
        You can also type on your keyboard. Enter completes the sale.
      </p>
    </div>
  )
}

function KeypadKey({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex h-14 items-center justify-center rounded-2xl bg-[#F6F8F7] text-2xl font-medium text-[#091413] transition-colors active:bg-[#E6F1EA] touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B] sm:h-16"
    >
      {children}
    </button>
  )
}

/** Itemized order recap — read-only, sourced from the existing cart + totals calculation. */
function OrderItems({
  id,
  className,
  cart,
  totals,
  taxRatePercent,
  money,
}: {
  id: string
  className: string
  cart: CartLine[]
  totals: CartTotals
  taxRatePercent: number
  money: (value: number) => string
}) {
  return (
    <div id={id} className={`mt-3 rounded-2xl ring-1 ring-slate-100 ${className}`}>
      <ul className="max-h-48 overflow-y-auto overscroll-contain px-4 lg:max-h-72">
        {cart.map((line) => (
          <li
            key={line.product.id}
            className="flex items-baseline justify-between gap-3 border-b border-slate-100 py-2.5 text-sm last:border-b-0"
          >
            <span className="min-w-0 truncate text-[#091413]">
              {line.product.name}
              <span className="text-slate-400"> × {line.quantity}</span>
            </span>
            <span className="shrink-0 tabular-nums text-[#091413]">
              {money(line.product.sellingPrice * line.quantity)}
            </span>
          </li>
        ))}
      </ul>

      <dl className="space-y-1.5 border-t border-slate-100 px-4 py-3 text-sm">
        <SummaryRow label="Subtotal" value={money(totals.subtotal)} />
        {totals.discount > 0 && <SummaryRow label="Discount" value={`−${money(totals.discount)}`} />}
        <SummaryRow label={`Tax (${taxRatePercent}%)`} value={money(totals.tax)} />
        <SummaryRow label="Total" value={money(totals.total)} strong />
      </dl>
    </div>
  )
}

function SummaryRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? 'font-semibold text-[#091413]' : 'text-slate-500'}`}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  )
}

function SuccessView({
  receipt,
  settings,
  money,
  isPrinting,
  printFailed,
}: {
  receipt: Sale
  settings: Parameters<typeof ReceiptPreview>[0]['settings']
  money: (value: number) => string
  isPrinting: boolean
  printFailed: boolean
}) {
  const change = receipt.change ?? 0

  return (
    <div className="mx-auto max-w-md py-2 text-center">
      <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#E6F1EA] text-[#1F5E3B]">
        <CheckIcon size={30} />
      </span>
      <p className="mt-4 text-sm text-slate-500">Paid with {receipt.paymentMethod}</p>

      {/* The one number the cashier needs right now */}
      <div className="mt-5 rounded-3xl bg-[#F2F8F4] px-5 py-6">
        <p className="text-sm font-medium text-[#1F5E3B]">{change > 0 ? 'Give change' : 'Total paid'}</p>
        <p className="mt-1 truncate text-[44px] font-bold leading-none tracking-[-0.03em] tabular-nums text-[#091413]">
          {money(change > 0 ? change : receipt.total)}
        </p>
        {change > 0 && receipt.amountReceived != null && (
          <p className="mt-3 text-sm text-slate-500">
            Received {money(receipt.amountReceived)} · Total {money(receipt.total)}
          </p>
        )}
      </div>

      <p aria-live="polite" className={`mt-4 min-h-5 text-sm ${printFailed && !isPrinting ? 'text-rose-600' : 'text-slate-500'}`}>
        {isPrinting
          ? 'Printing receipt…'
          : printFailed
          ? 'Payment completed, but receipt printing failed. Check the printer, then tap Retry print.'
          : ' '}
      </p>

      {/* Exactly what the printer receives */}
      <details className="group mt-4 rounded-2xl text-left ring-1 ring-slate-100">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-4 text-sm font-medium [&::-webkit-details-marker]:hidden">
          Receipt preview
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-400 transition-transform group-open:rotate-180" aria-hidden="true">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </summary>
        <div className="border-t border-slate-100 p-3">
          <ReceiptPreview sale={receipt} settings={settings} />
        </div>
      </details>
    </div>
  )
}

/* =====================================================================
   ICONS
===================================================================== */

function SpinnerIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="animate-spin" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}

function CheckIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

function BackspaceIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z" />
      <line x1="18" y1="9" x2="12" y2="15" />
      <line x1="12" y1="9" x2="18" y2="15" />
    </svg>
  )
}

function PrinterIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="6 9 6 2 18 2 18 9" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" />
    </svg>
  )
}

function CashIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 12h.01M18 12h.01" />
    </svg>
  )
}

function CardIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <line x1="2" y1="10" x2="22" y2="10" />
    </svg>
  )
}

function WalletIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="6" y="2" width="12" height="20" rx="2" />
      <line x1="10" y1="18" x2="14" y2="18" />
    </svg>
  )
}

function MoreIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">
      <circle cx="5" cy="12" r="1.75" />
      <circle cx="12" cy="12" r="1.75" />
      <circle cx="19" cy="12" r="1.75" />
    </svg>
  )
}

function WarningIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
    </svg>
  )
}

export default PaymentModal
