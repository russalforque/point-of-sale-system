import { useMemo, useState, type KeyboardEvent } from 'react'

import { salesApi } from '../../api/salesApi'
import { useCheckout } from '../../context/CheckoutContext'
import { useSettings } from '../../context/SettingsContext'
import { useToast } from '../../context/ToastContext'
import { useReceiptPrinter } from '../../hooks/useReceiptPrinter'
import { printerErrorMessage } from '../../services/printer'
import type { PaymentMethod, Sale, StoreSetting } from '../../types'
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
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'

const CASH_PAYMENT_METHOD: PaymentMethod = 0

/** Common Philippine peso bill denominations offered as one-tap quick-cash buttons. */
const QUICK_CASH_DENOMINATIONS = [50, 100, 200, 500, 1000]

/** Short blurb shown on each payment method card — purely descriptive, doesn't affect the submitted method. */
function methodDescription(value: PaymentMethod): string {
  switch (value) {
    case 0:
      return 'Pay with cash'
    case 1:
      return 'Credit / debit card'
    case 2:
      return 'Mobile wallet'
    default:
      return 'PayMaya, bank transfer, QR Ph, etc.'
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
 * Tablet-first payment modal. Reuses the same settlement logic as the legacy
 * full-page checkout (salesApi.create, receipt printing, drawer kick) so the
 * cashier can complete a sale without ever leaving the POS/order screen.
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

  const [method, setMethod] = useState<PaymentMethod>(0)
  // Raw digits typed on the cash calculator keypad, read right-to-left as
  // centavos (e.g. "6720" -> 67.20) — the classic POS numeric-entry pattern,
  // so cents are always reachable without a decimal key.
  const [cashDigits, setCashDigits] = useState('')
  const [paymentReference, setPaymentReference] = useState('')

  const totals = useMemo(
    () => calculateTotals(checkout.cart, checkout.discount, settings.taxRate),
    [checkout.cart, checkout.discount, settings.taxRate],
  )

  const cashValue = cashDigits ? Number(cashDigits) / 100 : 0
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

  const remainingDue = Math.max(totals.total - cashValue, 0)
  const isCashSufficient = cashValue >= totals.total

  const selectedMethodOption = PAYMENT_OPTIONS.find((opt) => opt.value === method)

  const isFormValid =
    (method === 0 && isCashSufficient) ||
    (method !== 0 && paymentReference.trim().length > 0)

  /** Calculator keypad: digits shift in from the right as centavos, so cents stay reachable with no decimal key. Capped at 9 digits (~₱9,999,999.99) to keep entries sane. */
  function handleCashDigit(digit: string) {
    setCashDigits((prev) => (prev.length >= 9 ? prev : `${prev}${digit}`))
    if (errorMessage) setErrorMessage(null)
  }

  function handleCashBackspace() {
    setCashDigits((prev) => prev.slice(0, -1))
    if (errorMessage) setErrorMessage(null)
  }

  function handleCashClear() {
    setCashDigits('')
    if (errorMessage) setErrorMessage(null)
  }

  function handleCashQuickSelect(amount: number) {
    setCashDigits(String(Math.round(amount * 100)))
    if (errorMessage) setErrorMessage(null)
  }

  async function completeSale() {
    if (busy) return

    if (method === 0 && !isCashSufficient) {
      setErrorMessage(
        `Amount received is short by ${formatMoney(remainingDue, settings.currencySymbol)}.`,
      )
      return
    }

    if (method !== 0 && !paymentReference.trim()) {
      setErrorMessage('Please enter a payment reference or approval code.')
      return
    }

    setErrorMessage(null)
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
      setErrorMessage(getErrorMessage(err))
      notify(getErrorMessage(err), 'error')
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
      () => notify('Receipt printed successfully.'),
      () => notify('Receipt print failed. Please retry.', 'error'),
    )
  }

  function handleKeyDownSubmit(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (isFormValid) void completeSale()
    }
  }

  return (
    <Modal
      title={
        <span className="inline-flex items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#EAF1EE] text-[#285A48]">
            {receipt ? <CheckIcon size={15} /> : <CardIcon size={15} />}
          </span>
          <span>{receipt ? 'Payment Complete' : 'Process Payment'}</span>
        </span>
      }
      description={
        receipt
          ? `Invoice #${receipt.invoiceNumber}`
          : 'Complete the transaction and collect payment.'
      }
      onClose={onClose}
      preventClose={busy}
      size="2xl"
      mobileFullScreen
      footer={
        receipt ? (
          <div className="flex w-full flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
            <Button
              variant="secondary"
              onClick={printReceipt}
              disabled={isPrinting}
              className="min-h-13 flex-1 text-sm sm:flex-none sm:px-6"
            >
              {isPrinting
                ? 'Printing…'
                : lastPrintError
                ? 'Retry Print'
                : 'Print Receipt'}
            </Button>
            <Button
              onClick={onClose}
              className="min-h-13 flex-1 bg-[#285A48] text-sm hover:bg-[#1e4437] sm:flex-none sm:px-8"
            >
              New Sale
            </Button>
          </div>
        ) : (
          <div className="flex w-full flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
            <Button
              variant="secondary"
              onClick={onClose}
              disabled={busy}
              className="min-h-13 flex-1 text-sm sm:min-w-32 sm:flex-none"
            >
              Cancel
            </Button>
            <Button
              onClick={() => void completeSale()}
              disabled={busy || !isFormValid}
              className="min-h-13 flex-2 bg-[#285A48] text-sm hover:bg-[#1e4437] disabled:bg-slate-200 sm:flex-none sm:min-w-56"
            >
              {busy ? (
                <span className="inline-flex items-center gap-2">
                  <SpinnerIcon size={16} />
                  <span>Processing…</span>
                </span>
              ) : method === 0 && isCashSufficient && change > 0 ? (
                `Complete • Change ${formatMoney(change, settings.currencySymbol)}`
              ) : (
                'Complete Payment'
              )}
            </Button>
          </div>
        )
      }
    >
      {receipt ? (
        <SuccessView receipt={receipt} settings={settings} />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
          {/* =====================================================
              LEFT: PAYMENT METHOD
              ===================================================== */}
          <div className="order-2 lg:order-1">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Payment Method
            </label>
            <p className="mt-0.5 text-[11px] text-slate-400">Select a payment method</p>

            <div className="mt-2.5 space-y-2">
              {PAYMENT_OPTIONS.map((option) => {
                const isSelected = method === option.value
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => {
                      setMethod(Number(option.value) as PaymentMethod)
                      setCashDigits('')
                      setPaymentReference('')
                      setErrorMessage(null)
                    }}
                    className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition-all active:scale-[0.98] touch-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-[#285A48]/40 ${
                      isSelected
                        ? 'border-[#285A48] bg-[#EAF1EE] shadow-sm'
                        : 'border-[#E5EBE7] bg-white hover:bg-[#F6F8F7]'
                    }`}
                  >
                    <span
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                        isSelected ? 'bg-[#285A48] text-white' : 'bg-[#F6F8F7] text-[#285A48]'
                      }`}
                    >
                      <MethodIcon value={option.value} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-bold text-[#091413]">
                        {option.label}
                      </span>
                      <span className="block truncate text-[11px] text-slate-400">
                        {methodDescription(option.value)}
                      </span>
                    </span>
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                        isSelected ? 'border-[#285A48]' : 'border-slate-300'
                      }`}
                    >
                      {isSelected && <span className="h-2.5 w-2.5 rounded-full bg-[#285A48]" />}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* =====================================================
              RIGHT: TRANSACTION SUMMARY + PAYMENT DETAILS
              ===================================================== */}
          <div className="order-1 min-w-0 space-y-4 lg:order-2">
            <TransactionSummary
              cart={checkout.cart}
              totals={totals}
              currencySymbol={settings.currencySymbol}
            />

            {errorMessage && (
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded-2xl border border-rose-200 bg-rose-50 p-3.5 text-xs font-semibold text-rose-700"
              >
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-600">
                  <WarningIcon size={12} />
                </span>
                <span className="leading-relaxed">{errorMessage}</span>
              </div>
            )}

            <div>
              <p className="mb-2.5 text-xs font-bold uppercase tracking-wider text-slate-400">
                {selectedMethodOption?.label} Payment
              </p>

              {method === 0 ? (
                <CashCalculator
                  currencySymbol={settings.currencySymbol}
                  totalDue={totals.total}
                  cashValue={cashValue}
                  isCashSufficient={isCashSufficient}
                  change={change}
                  remainingDue={remainingDue}
                  onDigit={handleCashDigit}
                  onBackspace={handleCashBackspace}
                  onClear={handleCashClear}
                  onQuickSelect={handleCashQuickSelect}
                />
              ) : (
                <div className="space-y-3.5">
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
                    <label
                      htmlFor="payment-modal-reference-input"
                      className="mb-1.5 block text-xs font-bold text-slate-700"
                    >
                      {selectedMethodOption?.label} Reference or Approval Code{' '}
                      <span className="text-rose-500">*</span>
                    </label>
                    <input
                      id="payment-modal-reference-input"
                      type="text"
                      autoFocus
                      value={paymentReference}
                      onChange={(e) => {
                        setPaymentReference(e.target.value)
                        if (errorMessage) setErrorMessage(null)
                      }}
                      onKeyDown={handleKeyDownSubmit}
                      placeholder="e.g., Auth Code, Approval #, GCash Ref"
                      className="h-14 w-full rounded-2xl border border-[#E5EBE7] bg-white px-4 text-sm font-semibold text-[#091413] placeholder-slate-400 outline-none transition focus:border-[#285A48] focus:ring-2 focus:ring-[#285A48]/15"
                    />
                  </div>

                  <div
                    className={`flex items-center gap-2.5 rounded-2xl border p-3.5 text-xs font-bold ${
                      paymentReference.trim()
                        ? 'border-[#285A48]/20 bg-[#EAF1EE] text-[#285A48]'
                        : 'border-[#E5EBE7] bg-white text-slate-400'
                    }`}
                  >
                    <div
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white ${
                        paymentReference.trim() ? 'bg-[#285A48]' : 'bg-slate-300'
                      }`}
                    >
                      {paymentReference.trim() ? (
                        <CheckIcon size={12} />
                      ) : (
                        <span className="text-[10px] font-bold">!</span>
                      )}
                    </div>
                    <span>
                      {paymentReference.trim()
                        ? 'Ready to complete payment'
                        : 'Enter a reference to continue'}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}

/**
 * Calculator-style cash tender: a keypad-driven amount display paired with a
 * change/remaining readout, laid out two-up on tablet+ so the panel stays
 * wide and short instead of a tall stack of cards.
 */
function CashCalculator({
  currencySymbol,
  totalDue,
  cashValue,
  isCashSufficient,
  change,
  remainingDue,
  onDigit,
  onBackspace,
  onClear,
  onQuickSelect,
}: {
  currencySymbol: string
  totalDue: number
  cashValue: number
  isCashSufficient: boolean
  change: number
  remainingDue: number
  onDigit: (digit: string) => void
  onBackspace: () => void
  onClear: () => void
  onQuickSelect: (amount: number) => void
}) {
  const hasEntry = cashValue > 0
  const isShort = hasEntry && !isCashSufficient

  return (
    <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
      {/* Left: amount summary + quick cash */}
      <div className="space-y-3">
        <div>
          <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Amount Received
          </label>
          <div className="mt-1.5 flex h-16 items-center justify-end rounded-2xl border border-[#E5EBE7] bg-white px-4 sm:h-18">
            <span className="truncate text-3xl font-black tracking-tight text-[#091413] sm:text-4xl">
              {formatMoney(cashValue, currencySymbol)}
            </span>
          </div>
        </div>

        {/* Change — the major visual element */}
        <div
          className={`rounded-2xl border p-4 transition-all ${
            isShort
              ? 'border-amber-200 bg-amber-50'
              : isCashSufficient && hasEntry
              ? 'border-[#285A48]/25 bg-[#EAF1EE]'
              : 'border-[#E5EBE7] bg-white'
          }`}
        >
          {isShort ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-bold text-amber-800">
                <span>Amount Due</span>
                <span>{formatMoney(totalDue, currencySymbol)}</span>
              </div>
              <div className="flex items-center justify-between text-xs font-bold text-amber-800">
                <span>Amount Received</span>
                <span>{formatMoney(cashValue, currencySymbol)}</span>
              </div>
              <div className="flex items-center justify-between border-t border-amber-200 pt-1.5">
                <span className="text-xs font-bold uppercase tracking-wider text-amber-800">
                  Remaining
                </span>
                <span className="text-2xl font-black text-amber-800">
                  {formatMoney(remainingDue, currencySymbol)}
                </span>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <span
                className={`text-xs font-bold uppercase tracking-wider ${
                  hasEntry ? 'text-[#285A48]' : 'text-slate-400'
                }`}
              >
                Change
              </span>
              <span
                className={`text-3xl font-black ${
                  hasEntry ? 'text-[#285A48]' : 'text-slate-300'
                }`}
              >
                {formatMoney(hasEntry ? change : 0, currencySymbol)}
              </span>
            </div>
          )}
        </div>

        {/* Quick cash */}
        <div className="grid grid-cols-3 gap-2">
          <QuickCashButton
            label="Exact"
            isSelected={hasEntry && cashValue === totalDue}
            onClick={() => onQuickSelect(totalDue)}
          />
          {QUICK_CASH_DENOMINATIONS.map((amount) => (
            <QuickCashButton
              key={amount}
              label={formatMoney(amount, currencySymbol)}
              isSelected={cashValue === amount}
              onClick={() => onQuickSelect(amount)}
            />
          ))}
        </div>
      </div>

      {/* Right: numeric keypad */}
      <div className="grid grid-cols-3 gap-2 content-start">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
          <button
            key={digit}
            type="button"
            onClick={() => onDigit(digit)}
            className="flex min-h-14 items-center justify-center rounded-2xl border border-[#E5EBE7] bg-white text-2xl font-extrabold text-[#091413] shadow-2xs transition-all hover:bg-[#F2F6F4] active:scale-95 active:bg-[#EAF1EE] touch-manipulation sm:min-h-16"
          >
            {digit}
          </button>
        ))}

        <button
          type="button"
          onClick={onClear}
          aria-label="Clear amount"
          className="flex min-h-14 items-center justify-center rounded-2xl border border-[#E5EBE7] bg-[#F6F8F7] text-sm font-black text-rose-600 transition-all hover:bg-rose-50 active:scale-95 touch-manipulation sm:min-h-16"
        >
          C
        </button>
        <button
          type="button"
          onClick={() => onDigit('0')}
          className="flex min-h-14 items-center justify-center rounded-2xl border border-[#E5EBE7] bg-white text-2xl font-extrabold text-[#091413] shadow-2xs transition-all hover:bg-[#F2F6F4] active:scale-95 active:bg-[#EAF1EE] touch-manipulation sm:min-h-16"
        >
          0
        </button>
        <button
          type="button"
          onClick={onBackspace}
          aria-label="Remove last digit"
          className="flex min-h-14 items-center justify-center rounded-2xl border border-[#E5EBE7] bg-[#F6F8F7] text-[#091413] transition-all hover:bg-slate-200/70 active:scale-95 touch-manipulation sm:min-h-16"
        >
          <BackspaceIcon size={20} />
        </button>
      </div>
    </div>
  )
}

/** Itemized order recap + subtotal/discount/tax/total — read-only, sourced entirely from the existing cart + totals calculation. */
function TransactionSummary({
  cart,
  totals,
  currencySymbol,
}: {
  cart: CartLine[]
  totals: CartTotals
  currencySymbol: string
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-[#E5EBE7] bg-white">
      <div className="flex items-center justify-between border-b border-[#E5EBE7] bg-[#F6F8F7] px-4 py-2.5">
        <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
          Transaction Summary
        </span>
        <span className="text-[11px] font-semibold text-[#285A48]">
          {cart.length} item{cart.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="max-h-36 divide-y divide-slate-100 overflow-y-auto overscroll-contain px-4">
        {cart.map((line) => (
          <div key={line.product.id} className="flex items-center justify-between gap-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-[#091413]">
                {line.product.name}
              </p>
              <p className="text-[11px] text-slate-400">
                {line.quantity} × {formatMoney(line.product.sellingPrice, currencySymbol)}
              </p>
            </div>
            <span className="shrink-0 text-xs font-bold text-[#091413]">
              {formatMoney(line.product.sellingPrice * line.quantity, currencySymbol)}
            </span>
          </div>
        ))}
      </div>

      <div className="space-y-1.5 border-t border-[#E5EBE7] bg-[#FBFDFB] px-4 py-3">
        <div className="flex justify-between text-xs text-slate-500">
          <span>Subtotal</span>
          <span className="font-semibold text-[#091413]">
            {formatMoney(totals.subtotal, currencySymbol)}
          </span>
        </div>
        {totals.discount > 0 && (
          <div className="flex justify-between text-xs text-emerald-700">
            <span>Discount</span>
            <span className="font-bold">-{formatMoney(totals.discount, currencySymbol)}</span>
          </div>
        )}
        <div className="flex justify-between text-xs text-slate-500">
          <span>Tax</span>
          <span className="font-semibold text-[#091413]">
            {formatMoney(totals.tax, currencySymbol)}
          </span>
        </div>
        <div className="mt-1 flex items-baseline justify-between border-t border-[#E5EBE7] pt-2">
          <span className="text-xs font-extrabold uppercase tracking-wider text-[#285A48]">
            Total
          </span>
          <span className="text-2xl font-black tracking-tight text-[#091413]">
            {formatMoney(totals.total, currencySymbol)}
          </span>
        </div>
      </div>
    </div>
  )
}

function QuickCashButton({
  label,
  isSelected,
  onClick,
}: {
  label: string
  isSelected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isSelected}
      className={`flex min-h-11 items-center justify-center rounded-xl text-xs font-bold transition-all active:scale-95 touch-manipulation ${
        isSelected
          ? 'bg-[#285A48] text-white shadow-sm'
          : 'border border-[#E5EBE7] bg-white text-[#285A48] hover:bg-[#EAF1EE]'
      }`}
    >
      {label}
    </button>
  )
}

function SuccessView({
  receipt,
  settings,
}: {
  receipt: Sale
  settings: StoreSetting
}) {
  return (
    <div className="space-y-4 text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#EAF1EE] text-[#285A48]">
        <CheckIcon size={28} />
      </div>
      <div>
        <p className="text-lg font-black text-[#091413]">Payment successful</p>
        <p className="mt-0.5 text-xs font-medium text-slate-400">
          Invoice #{receipt.invoiceNumber}
        </p>
      </div>

      <div className="rounded-2xl border border-[#E5EBE7] bg-[#F6F8F7] p-4 text-left text-xs text-[#091413]">
        <div className="flex justify-between border-b border-[#E5EBE7] pb-2.5">
          <span className="font-semibold text-slate-500">Total Paid</span>
          <span className="text-base font-black text-[#285A48]">
            {formatMoney(receipt.total, settings.currencySymbol)}
          </span>
        </div>
        <div className="mt-2.5 space-y-1.5">
          <div className="flex justify-between">
            <span className="text-slate-500">Payment Method</span>
            <span className="font-bold uppercase">{receipt.paymentMethod}</span>
          </div>
          {receipt.amountReceived != null && (
            <div className="flex justify-between">
              <span className="text-slate-500">Tendered</span>
              <span className="font-bold">
                {formatMoney(receipt.amountReceived, settings.currencySymbol)}
              </span>
            </div>
          )}
          {receipt.change != null && receipt.change > 0 && (
            <div className="flex justify-between">
              <span className="text-slate-500">Change Given</span>
              <span className="font-bold text-[#285A48]">
                {formatMoney(receipt.change, settings.currencySymbol)}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function SpinnerIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className="animate-spin"
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth="2.5"
        opacity="0.25"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
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

function BackspaceIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z" />
      <line x1="18" y1="9" x2="12" y2="15" />
      <line x1="12" y1="9" x2="18" y2="15" />
    </svg>
  )
}

function CashIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 12h.01M18 12h.01" />
    </svg>
  )
}

function CardIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <line x1="2" y1="10" x2="22" y2="10" />
    </svg>
  )
}

function WalletIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="6" y="2" width="12" height="20" rx="2" />
      <line x1="10" y1="18" x2="14" y2="18" />
    </svg>
  )
}

function MoreIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <circle cx="5" cy="12" r="1.75" />
      <circle cx="12" cy="12" r="1.75" />
      <circle cx="19" cy="12" r="1.75" />
    </svg>
  )
}

function WarningIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
    </svg>
  )
}

export default PaymentModal
