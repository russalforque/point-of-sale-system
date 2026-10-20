import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'

import { customerApi } from '../../api/customerApi'
import { salesApi } from '../../api/salesApi'
import { useApproval } from '../auth/ApprovalDialog'
import { useAuth } from '../../context/AuthContext'
import { useCheckout } from '../../context/CheckoutContext'
import { useSettings } from '../../context/SettingsContext'
import { useToast } from '../../context/ToastContext'
import { useAsync } from '../../hooks/useAsync'
import { useDismissOnBack } from '../../hooks/useDismissOnBack'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import { useReceiptPrinter } from '../../hooks/useReceiptPrinter'
import { OrderTypeSelector } from './OrderTypeSelector'
import { ReceiptPreview } from './ReceiptPreview'
import { printerErrorMessage } from '../../services/printer'
import type { PaymentMethod, Sale } from '../../types'
import { getErrorMessage } from '../../utils/errors'
import { formatMoney } from '../../utils/format'
import { getPrinterConfig } from '../../utils/printerConfig'
import {
  buildPaymentBreakdown,
  calculateChange,
  CHARGE_OPTION,
  cartStockKey,
  lineTotal,
  modifierSummary,
  PAYMENT_OPTIONS,
  saleItems,
  type CartLine,
} from '../../utils/pos'
import { StockShortageNotice } from './StockShortageNotice'
import { checkoutTotals, type CheckoutTotals } from '../../services/checkout'
import { CHARGE_METHOD, dueDateFrom } from '../../services/credit'
import { loyaltyActive, maxRedeemablePoints, pointsValue } from '../../services/loyalty'
import {
  maxTenderAmount,
  methodLabel as tenderMethodLabel,
  remainingDue as tenderRemainingDue,
  tenderedTotal,
  type Tender,
} from '../../services/payments'
import { roundMoney, sumMoney } from '../../utils/amount'
import { formatDate } from '../../utils/format'
import { Modal } from '../ui/Modal'

const CASH_PAYMENT_METHOD: PaymentMethod = 0

/** Philippine peso bills used to suggest "round up" cash amounts. */
const BILL_DENOMINATIONS = [20, 50, 100, 200, 500, 1000]

/**
 * Landscape tablets and desktops: payment info on the left, amount entry + keypad on the right.
 * Portrait tablets and phones stack. Width alone can't tell a 1024×768 landscape tablet from
 * a portrait 800×1280 one, so orientation (width vs. height) decides.
 */
const WIDE_LAYOUT_QUERY = '(orientation: landscape) and (min-width: 720px)'

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
    case 4:
      return 'The customer pays later. The amount is added to their account balance.'
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
    case 4:
      return <LedgerIcon size={size} />
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
  const { state: checkout, setState: setCheckout, clearCheckout } = useCheckout()
  const {
    printReceipt: sendReceiptToPrinter,
    isPrinting,
    lastPrintError,
    openDrawer,
  } = useReceiptPrinter()

  const { can } = useAuth()
  const approval = useApproval()
  const [approving, setApproving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [receipt, setReceipt] = useState<Sale | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [showItems, setShowItems] = useState(false)

  const [method, setMethod] = useState<PaymentMethod>(CASH_PAYMENT_METHOD)
  // Raw digits typed on the keypad, read right-to-left as centavos
  // (e.g. "6720" -> 67.20), so cents are always reachable without a decimal key.
  const [cashDigits, setCashDigits] = useState('')
  const [paymentReference, setPaymentReference] = useState('')
  // Split payment: tenders already taken. The keypad/reference then describe the next one.
  const [splitMode, setSplitMode] = useState(false)
  const [tenders, setTenders] = useState<Tender[]>([])

  // Back closes the modal instead of leaving the register — and is ignored mid-payment.
  const locked = busy || approving
  const { close } = useDismissOnBack('paymentModalOpen', onClose, locked)
  const wide = useMediaQuery(WIDE_LAYOUT_QUERY)

  const money = (value: number) => formatMoney(value, settings.currencySymbol)

  const totals = useMemo(() => checkoutTotals(checkout, settings), [checkout, settings])

  // The selected customer's points and credit, fresh from the database.
  const customerQuery = useAsync(
    () => (checkout.customerId ? customerApi.get(checkout.customerId) : Promise.resolve(null)),
    [checkout.customerId],
  )
  const customer = receipt ? null : customerQuery.data

  // Everything the order uses (ingredients and options included), checked before payment.
  const stockKey = cartStockKey(checkout.cart)
  const stockCheck = useAsync(
    () => (checkout.cart.length ? salesApi.checkStock(saleItems(checkout.cart)) : Promise.resolve({ shortages: [], blocked: false })),
    [stockKey],
  )
  const stockBlocked = !receipt && Boolean(stockCheck.data?.blocked)

  // Charge to account: only with customer credit on and a customer who has a limit.
  const availableCredit = customer ? Math.max(roundMoney(customer.creditLimit - customer.creditBalance), 0) : 0
  const canCharge = settings.creditEnabled && Boolean(customer) && (customer?.creditLimit ?? 0) > 0
  const methodOptions = canCharge ? [...PAYMENT_OPTIONS, CHARGE_OPTION] : PAYMENT_OPTIONS
  const isCharge = method === CHARGE_METHOD
  const chargedSoFar = sumMoney(tenders.filter((tender) => tender.method === CHARGE_METHOD).map((tender) => tender.amount))

  // Loyalty: spend points as a discount on this order.
  const pointsBalance = customer?.loyaltyPoints ?? 0
  const redeemablePoints = maxRedeemablePoints(pointsBalance, roundMoney(totals.subtotal - totals.manualDiscount), settings)
  const showPoints = loyaltyActive(settings) && Boolean(customer) && pointsBalance > 0

  const isCash = method === CASH_PAYMENT_METHOD
  const needsReference = !isCash && !isCharge
  const cashValue = cashDigits ? Number(cashDigits) / 100 : 0
  // Non-cash tenders never carry a typed cash amount, matching the previous payload.
  const paymentBreakdown = useMemo(
    () => buildPaymentBreakdown(method, isCash ? cashValue : 0),
    [method, isCash, cashValue],
  )
  const change = isCash ? Math.max(cashValue - totals.total, 0) : calculateChange(totals.total, paymentBreakdown)
  const remainingDue = Math.max(totals.total - cashValue, 0)
  const isCashSufficient = cashValue >= totals.total
  const trimmedReference = paymentReference.trim()

  const methodLabel = methodOptions.find((opt) => opt.value === method)?.label ?? 'Payment'
  const itemCount = checkout.cart.reduce((sum, line) => sum + line.quantity, 0)
  const quickAmounts = useMemo(() => quickCashAmounts(totals.total), [totals.total])

  // --- split payment ---
  const splitPaid = tenderedTotal(tenders)
  const splitRemaining = tenderRemainingDue(totals.total, tenders)
  const splitChange = Math.max(roundMoney(splitPaid - totals.total), 0)
  // An empty keypad means "whatever is left".
  const creditLeft = Math.max(roundMoney(availableCredit - chargedSoFar), 0)
  const tenderMax = maxTenderAmount(totals.total, tenders, method)
  const entryMax = isCharge ? Math.min(tenderMax ?? creditLeft, creditLeft) : tenderMax
  const entryAmount = cashDigits ? cashValue : isCharge ? Math.min(splitRemaining, creditLeft) : splitRemaining
  const entryProblem =
    splitRemaining <= 0
      ? null
      : isCharge && creditLeft <= 0
      ? 'No credit available'
      : entryAmount <= 0
      ? 'Enter an amount'
      : entryMax !== null && entryAmount > entryMax + 0.001
      ? `${methodLabel} can’t be more than ${money(entryMax)}`
      : needsReference && !trimmedReference
      ? `Enter the ${methodLabel} reference`
      : null

  const chargeCovers = isCharge && availableCredit + 0.001 >= totals.total
  const needsSeniorId = checkout.discountType === 'senior_pwd' && !checkout.discountReference.trim()

  const isFormValid =
    !needsSeniorId &&
    !stockBlocked &&
    (splitMode
      ? tenders.length > 0 && splitRemaining === 0
      : isCash
      ? isCashSufficient
      : isCharge
      ? chargeCovers
      : trimmedReference.length > 0)

  const blockedReason = isFormValid
    ? null
    : stockBlocked
    ? 'Not enough stock'
    : needsSeniorId
    ? 'Enter the Senior/PWD ID on the order'
    : splitMode
    ? `${money(splitRemaining)} left to pay`
    : isCash
    ? cashValue === 0
      ? 'Enter the cash received'
      : `${money(remainingDue)} short`
    : isCharge
    ? `Only ${money(availableCredit)} credit available`
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

  /** Points change the amount due, so any payment already entered starts over. */
  function toggleRedeem() {
    const using = checkout.redeemPoints > 0
    setCheckout({ ...checkout, redeemPoints: using ? 0 : redeemablePoints })
    setTenders([])
    setCashDigits('')
    setErrorMessage(null)
  }

  // Charge is no longer offered (customer removed, limit changed): fall back to cash.
  useEffect(() => {
    if (method === CHARGE_METHOD && !canCharge && !customerQuery.loading) setMethod(CASH_PAYMENT_METHOD)
  }, [method, canCharge, customerQuery.loading])

  function toggleSplit() {
    setSplitMode((on) => !on)
    setTenders([])
    setCashDigits('')
    setPaymentReference('')
    setErrorMessage(null)
  }

  function addTender() {
    if (splitRemaining <= 0) return
    if (entryProblem) {
      setErrorMessage(entryProblem)
      return
    }
    setTenders((prev) => [...prev, { method, amount: entryAmount, reference: needsReference ? trimmedReference : null }])
    setCashDigits('')
    setPaymentReference('')
    setErrorMessage(null)
  }

  function removeTender(index: number) {
    setTenders((prev) => prev.filter((_, i) => i !== index))
    setErrorMessage(null)
  }

  /* ------------------------------------------------------------------
     SETTLEMENT (unchanged business logic)
  ------------------------------------------------------------------ */

  async function completeSale() {
    if (busy || approving) return

    if (needsSeniorId) {
      setErrorMessage('Enter the Senior Citizen / PWD ID number on the order before charging.')
      return
    }
    if (splitMode) {
      if (!isFormValid) {
        setErrorMessage(`${money(splitRemaining)} is still left to pay.`)
        return
      }
    } else if (isCash && !isCashSufficient) {
      setErrorMessage(`Amount received is short by ${money(remainingDue)}.`)
      return
    } else if (isCharge && !chargeCovers) {
      setErrorMessage(`Only ${money(availableCredit)} of credit is available. Split the payment or choose another method.`)
      return
    } else if (needsReference && !trimmedReference) {
      setErrorMessage('Enter a payment reference or approval code.')
      return
    }

    // A discount above the store limit needs a manager or admin; ask for their PIN right here.
    let discountApprovedBy: { id: number; fullName: string } | null = null
    if (totals.overLimit && !can('sales.discount')) {
      setApproving(true)
      const approver = await approval.request({
        permission: 'sales.discount',
        title: `${Math.round(totals.discountPercent)}% discount`,
        message: `${money(totals.manualDiscount)} off is above the ${settings.maxDiscountPercent}% limit for cashiers. A manager or admin must approve it.`,
        confirmLabel: 'Approve discount',
      })
      setApproving(false)
      if (!approver) return
      discountApprovedBy = { id: approver.id, fullName: approver.fullName }
    }

    // A single non-cash tender is always for the full amount due; cash may be over-tendered (change).
    const payments: Tender[] = splitMode
      ? tenders
      : [{ method, amount: isCash ? cashValue : totals.total, reference: needsReference ? trimmedReference : null }]
    const paidWithCash = payments.some((tender) => tender.method === CASH_PAYMENT_METHOD)

    setErrorMessage(null)
    setBusy(true)

    try {
      const sale = await salesApi.create({
        customerId: checkout.customerId,
        discount: totals.manualDiscount,
        discountType: checkout.discountType,
        discountReference: checkout.discountReference,
        discountApprovedBy,
        redeemPoints: totals.loyaltyDiscount > 0 ? checkout.redeemPoints : 0,
        orderType: checkout.orderType,
        payments,
        items: saleItems(checkout.cart),
      })

      setReceipt(sale)
      clearCheckout()
      void sendReceiptToPrinter(sale, settings).then(
        () => maybeAutoOpenDrawer(paidWithCash),
        // The sale is already committed to SQLite - a print failure never undoes it.
        (err) => notify(`Payment completed, but receipt printing failed. ${printerErrorMessage(err)}`, 'error'),
      )
    } catch (err) {
      setErrorMessage(getErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  /** Sales with any cash tender, and only when printer settings have auto-open enabled. */
  function maybeAutoOpenDrawer(paidWithCash: boolean) {
    if (!paidWithCash) return
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
      if (splitMode && splitRemaining > 0) addTender()
      else if (isFormValid) void completeSale()
    }
  }

  // Hardware keyboard support for cash entry (tablets / desktop registers).
  const completeSaleRef = useRef(completeSale)
  const addTenderRef = useRef(addTender)
  useEffect(() => {
    completeSaleRef.current = completeSale
    addTenderRef.current = addTender
  })
  const keypadActive = isCash || splitMode
  const splitPending = splitMode && splitRemaining > 0

  useEffect(() => {
    if (receipt || !keypadActive) return

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
        if (splitPending) addTenderRef.current()
        else void completeSaleRef.current()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [receipt, keypadActive, splitPending])

  /* ------------------------------------------------------------------
     RENDER
  ------------------------------------------------------------------ */

  // The primary button carries its own "why it's disabled" label, so no extra hint row
  // takes height away from the keypad. Cancel sits apart from it and is styled quietly,
  // so a hurried tap near the edge never completes a sale by accident.
  const paymentFooter = (
    <div className="flex w-full items-center justify-between gap-3">
      {/* Phones already have the header close button and Android back; wider screens keep an explicit Cancel. */}
      <button
        type="button"
        onClick={close}
        disabled={busy}
        className="hidden h-14 shrink-0 rounded-2xl px-6 text-[15px] font-medium text-slate-600 ring-1 ring-slate-200 transition active:bg-slate-100 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B] sm:block"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={() => void completeSale()}
        disabled={busy || !isFormValid}
        // Fixed width on tablets so it doesn't resize as the label changes; full width on phones.
        className="flex h-14 w-full min-w-0 items-center justify-between gap-3 rounded-2xl bg-[#1F5E3B] px-5 sm:w-88 sm:flex-none text-base font-semibold text-white shadow-sm transition active:scale-[0.99] disabled:bg-slate-100 disabled:text-slate-500 disabled:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B] focus-visible:ring-offset-2"
      >
        {busy ? (
          <span className="flex w-full items-center justify-center gap-2">
            <SpinnerIcon size={16} />
            Completing sale…
          </span>
        ) : blockedReason ? (
          <span aria-live="polite" className="flex w-full items-center justify-center gap-2 truncate font-medium">
            <LockIcon size={15} />
            {blockedReason}
          </span>
        ) : (
          <>
            <span>Complete sale</span>
            <span className="truncate tabular-nums">{money(totals.total)}</span>
          </>
        )}
      </button>
    </div>
  )

  const successFooter = (
    <div className="flex w-full items-center justify-between gap-2">
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
        // Same fixed width as Complete sale on tablets; fills the row next to Print on phones.
        className="h-14 flex-1 rounded-2xl bg-[#1F5E3B] px-5 text-[15px] font-semibold sm:w-88 sm:flex-none text-white transition active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B] focus-visible:ring-offset-2"
      >
        New sale
      </button>
    </div>
  )

  // Received + change (or paid + remaining in a split): under the amount due when stacked,
  // directly above the keypad in the two-column layout.
  const tenderSummary = splitMode ? (
    <SplitSummary money={money} paid={splitPaid} remaining={splitRemaining} change={splitChange} emphasis={wide} />
  ) : isCash ? (
    <TenderRow
      money={money}
      cashValue={cashValue}
      isCashSufficient={isCashSufficient}
      change={change}
      remainingDue={remainingDue}
      onClear={handleCashClear}
      emphasis={wide}
    />
  ) : null

  const taxRatePercent = Math.round(settings.taxRate * 10000) / 100

  let entry: ReactNode
  if (splitMode) {
    entry =
      splitRemaining > 0 ? (
        <SplitEntry
          money={money}
          method={method}
          methodLabel={methodLabel}
          amount={entryAmount}
          typed={Boolean(cashDigits)}
          remaining={isCharge ? Math.min(splitRemaining, creditLeft) : splitRemaining}
          needsReference={needsReference}
          reference={paymentReference}
          problem={entryProblem}
          onReference={(value) => {
            setPaymentReference(value)
            setErrorMessage(null)
          }}
          onReferenceKeyDown={handleReferenceKeyDown}
          onDigit={handleCashDigit}
          onDoubleZero={handleCashDoubleZero}
          onBackspace={handleCashBackspace}
          onQuickSelect={handleCashQuickSelect}
          onAdd={addTender}
        />
      ) : (
        <p className="flex flex-1 items-center justify-center rounded-2xl bg-[#F2F8F4] px-4 py-6 text-center text-sm font-medium text-[#1F5E3B]">
          Fully paid — complete the sale below.
        </p>
      )
  } else if (isCash) {
    entry = (
      <CashEntry
        money={money}
        cashValue={cashValue}
        quickAmounts={quickAmounts}
        onDigit={handleCashDigit}
        onDoubleZero={handleCashDoubleZero}
        onBackspace={handleCashBackspace}
        onQuickSelect={handleCashQuickSelect}
      />
    )
  } else if (isCharge && customer) {
    const balanceAfter = roundMoney(customer.creditBalance + totals.total)
    entry = (
      <div className="rounded-2xl bg-[#F6F8F7] p-4">
        <p className="text-sm text-slate-500">{methodInstruction(method)}</p>
        <p className="mt-3 text-[15px] font-semibold text-[#091413]">
          Charge {money(totals.total)} to {customer.fullName}
        </p>
        <dl className="mt-3 space-y-1.5 text-sm">
          <SummaryRow label="Current balance" value={money(customer.creditBalance)} />
          <SummaryRow label="Balance after this sale" value={money(balanceAfter)} strong />
          <SummaryRow label="Credit limit" value={money(customer.creditLimit)} />
          <SummaryRow label="Due" value={formatDate(dueDateFrom(settings.creditDefaultDays))} />
        </dl>
        {!chargeCovers && (
          <p className="mt-3 text-sm font-medium text-amber-700">
            Only {money(availableCredit)} of credit is left. Use Split payment to charge part of it.
          </p>
        )}
      </div>
    )
  } else {
    entry = (
      <div>
        <p className="text-sm text-slate-500">{methodInstruction(method)}</p>
        <label htmlFor="payment-modal-reference-input" className="mt-3 block text-sm font-medium text-[#091413]">
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
    )
  }

  return (
    <>
    <Modal
      title={receipt ? 'Sale complete' : 'Payment'}
      description={
        receipt
          ? `Invoice #${receipt.invoiceNumber}`
          : `${itemCount} ${itemCount === 1 ? 'item' : 'items'}`
      }
      onClose={close}
      preventClose={locked}
      size="2xl"
      mobileFullScreen
      dense={!receipt}
      // Fixed, viewport-derived height: the keypad stretches into whatever is left, so the
      // dialog fills the screen without scrolling in either orientation.
      panelClassName={
        receipt
          ? undefined
          : wide
          ? 'h-[min(calc(100dvh-2rem),44rem)] max-w-5xl'
          : 'sm:h-[min(calc(100dvh-2rem),58rem)] sm:max-w-3xl'
      }
      bodyClassName={receipt ? undefined : 'px-4 py-3 sm:px-5'}
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
        <div
          className={
            wide
              ? 'grid h-full grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] grid-rows-[minmax(0,1fr)] gap-5'
              : 'flex h-full flex-col gap-3 [@media(max-height:700px)]:gap-2'
          }
        >
          {/* PAYMENT INFO — amount due, order type, method (+ the order itself when there is room) */}
          <div className={`flex min-w-0 flex-col gap-3 [@media(max-height:700px)]:gap-2 ${wide ? 'min-h-0' : 'shrink-0'}`}>
            <section aria-label="Amount due" className="relative min-w-0 rounded-3xl bg-[#F2F8F4] px-4 py-3 sm:px-5">
              <div className="flex h-6 items-center justify-between gap-3">
                <p className="text-sm font-medium text-[#1F5E3B]">Amount due</p>
                {!wide && (
                  <button
                    type="button"
                    onClick={() => setShowItems((open) => !open)}
                    aria-expanded={showItems}
                    aria-controls="payment-order-items"
                    className="relative z-30 -mr-3 inline-flex h-11 shrink-0 items-center gap-1 rounded-full px-3 text-sm text-[#1F5E3B] active:bg-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B]"
                  >
                    {showItems ? 'Hide items' : `${itemCount} ${itemCount === 1 ? 'item' : 'items'}`}
                    {totals.discount > 0 && ` · ${money(totals.discount)} off`}
                    <ChevronIcon open={showItems} />
                  </button>
                )}
              </div>
              <p className="mt-1 truncate text-[36px] font-bold leading-none tracking-[-0.03em] tabular-nums text-[#091413] sm:text-[44px] [@media(max-height:700px)]:text-[32px]">
                {money(totals.total)}
              </p>

              {!wide && tenderSummary && (
                <div className="mt-3 border-t border-[#1F5E3B]/10 pt-2.5 [@media(max-height:700px)]:mt-2 [@media(max-height:700px)]:pt-2">
                  {tenderSummary}
                </div>
              )}

              {/* Stacked layouts: the order opens over the controls instead of pushing the keypad off-screen. */}
              {!wide && showItems && (
                <>
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-hidden="true"
                    onClick={() => setShowItems(false)}
                    className="fixed inset-0 z-10 cursor-default"
                  />
                  <OrderItems
                    id="payment-order-items"
                    className="absolute inset-x-0 top-full z-20 mt-2 bg-white shadow-[0_16px_40px_rgba(15,23,42,0.18)]"
                    listClassName="max-h-[min(16rem,40dvh)]"
                    cart={checkout.cart}
                    totals={totals}
                    taxRatePercent={taxRatePercent}
                    money={money}
                  />
                </>
              )}
            </section>

            <div className={wide ? 'flex flex-col gap-3' : 'grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] [@media(max-height:700px)]:gap-2'}>
              <div className="flex min-w-0 flex-col">
                <p className={`h-8 items-center text-xs font-medium uppercase tracking-wide text-slate-500 ${wide ? 'flex' : 'hidden sm:flex'}`}>
                  Order type
                </p>
                <OrderTypeSelector
                  className="flex-1"
                  value={checkout.orderType}
                  disabled={busy}
                  onChange={(orderType) => setCheckout({ ...checkout, orderType })}
                />
              </div>

              <div className="flex min-w-0 flex-col">
                <div className="flex h-8 items-center justify-between gap-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    {splitMode ? 'Next payment' : 'Payment method'}
                  </p>
                  {totals.total > 0 && (
                    <button
                      type="button"
                      onClick={toggleSplit}
                      disabled={busy}
                      aria-pressed={splitMode}
                      className="-my-1.5 -mr-2 h-11 rounded-full px-3 text-sm font-medium text-[#1F5E3B] active:bg-[#F2F8F4] disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B]"
                    >
                      {splitMode ? 'Use a single payment' : 'Split payment'}
                    </button>
                  )}
                </div>
                {(!splitMode || splitRemaining > 0) ? (
                  <MethodSelector value={method} options={methodOptions} onChange={selectMethod} />
                ) : (
                  <p className="flex min-h-15 items-center rounded-2xl bg-[#F1F4F3] px-4 text-sm text-slate-500">
                    Amount due is covered.
                  </p>
                )}
              </div>
            </div>

            {showPoints && customer && (
              <div className="flex min-h-12 items-center justify-between gap-3 rounded-2xl bg-[#F6F8F7] py-1 pl-4 pr-1">
                <p className="min-w-0 text-sm">
                  <span className="font-medium">{pointsBalance.toLocaleString()} points</span>
                  <span className="text-slate-500">
                    {checkout.redeemPoints > 0
                      ? ` · using ${checkout.redeemPoints} (−${money(totals.loyaltyDiscount)})`
                      : ` · worth ${money(pointsValue(pointsBalance, settings))}`}
                  </span>
                </p>
                <button
                  type="button"
                  onClick={toggleRedeem}
                  disabled={busy || (checkout.redeemPoints === 0 && redeemablePoints === 0)}
                  aria-pressed={checkout.redeemPoints > 0}
                  className={`h-11 shrink-0 rounded-xl px-4 text-sm font-semibold transition active:scale-95 disabled:opacity-40 ${
                    checkout.redeemPoints > 0 ? 'text-slate-600 ring-1 ring-slate-200' : 'bg-[#1F5E3B] text-white'
                  }`}
                >
                  {checkout.redeemPoints > 0 ? 'Don’t use' : `Use ${redeemablePoints}`}
                </button>
              </div>
            )}

            {splitMode && <TenderList tenders={tenders} money={money} disabled={busy} onRemove={removeTender} />}

            {stockCheck.data && <StockShortageNotice shortages={stockCheck.data.shortages} blocked={stockCheck.data.blocked} />}

            {errorMessage && (
              <div role="alert" className="flex items-start gap-2.5 rounded-2xl bg-rose-50 px-4 py-2.5 text-sm text-rose-700">
                <span className="mt-0.5 shrink-0">
                  <WarningIcon size={14} />
                </span>
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Two-column layout: the order fills the rest of the left side, scrolling only inside itself. */}
            {wide && (
              <OrderItems
                id="payment-order-items"
                className="flex min-h-24 flex-1 flex-col overflow-hidden"
                listClassName="min-h-0 flex-1"
                cart={checkout.cart}
                totals={totals}
                taxRatePercent={taxRatePercent}
                money={money}
              />
            )}
          </div>

          {/* AMOUNT ENTRY — received/change display, quick cash and the keypad */}
          <section aria-label="Amount received" className="flex min-w-0 flex-1 flex-col gap-2">
            {wide && tenderSummary && <div className="rounded-3xl bg-[#F6F8F7] px-5 py-3">{tenderSummary}</div>}
            {entry}
          </section>
        </div>
      )}
    </Modal>
    {approval.dialog}
    </>
  )
}

/* =====================================================================
   PIECES
===================================================================== */

function MethodSelector({
  value,
  options,
  onChange,
}: {
  value: PaymentMethod
  options: { value: PaymentMethod; label: string }[]
  onChange: (value: PaymentMethod) => void
}) {
  const buttonsRef = useRef<(HTMLButtonElement | null)[]>([])

  // Radio-group arrow key navigation.
  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(event.key)) return
    event.preventDefault()
    const index = options.findIndex((option) => option.value === value)
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1
    const nextIndex = (index + step + options.length) % options.length
    const next = options[nextIndex]
    if (!next) return
    onChange(Number(next.value) as PaymentMethod)
    buttonsRef.current[nextIndex]?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-label="Payment method"
      onKeyDown={handleKeyDown}
      className={`grid gap-1 rounded-2xl bg-[#F1F4F3] p-1 ${options.length > 4 ? 'grid-cols-5' : 'grid-cols-4'}`}
    >
      {options.map((option, index) => {
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
            className={`flex min-h-13 flex-col items-center justify-center gap-0.5 rounded-xl text-xs transition touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B] ${
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

/**
 * Cash received + change — the numbers the cashier compares against the amount due. Sits
 * under the amount due when stacked, and above the keypad (`emphasis`) in the two-column
 * layout. Always rendered (with placeholders) so the layout never jumps while typing.
 */
function TenderRow({
  money,
  cashValue,
  isCashSufficient,
  change,
  remainingDue,
  onClear,
  emphasis = false,
}: {
  money: (value: number) => string
  cashValue: number
  isCashSufficient: boolean
  change: number
  remainingDue: number
  onClear: () => void
  emphasis?: boolean
}) {
  const hasEntry = cashValue > 0
  const isShort = hasEntry && !isCashSufficient
  const figure = emphasis ? 'text-[30px] leading-none' : 'text-2xl leading-tight'

  return (
    <div className="flex items-end justify-between gap-3">
      <div className="min-w-0">
        <div className="flex h-5 items-center gap-1">
          <p className="text-sm text-slate-500">Cash received</p>
          {hasEntry && (
            <button
              type="button"
              onClick={onClear}
              aria-label="Clear cash received"
              className="-my-3 h-11 rounded-full px-2.5 text-xs font-medium text-slate-500 active:bg-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B]"
            >
              Clear
            </button>
          )}
        </div>
        <p
          aria-live="polite"
          className={`mt-1 truncate font-semibold tabular-nums ${figure} ${hasEntry ? 'text-[#091413]' : 'text-slate-400'}`}
        >
          {money(cashValue)}
        </p>
      </div>

      <div className="shrink-0 text-right" aria-live="polite">
        <p className={`h-5 text-sm ${isShort ? 'font-medium text-amber-700' : 'text-[#1F5E3B]'}`}>
          {isShort ? 'Short by' : 'Change'}
        </p>
        <p
          className={`mt-1 font-bold tabular-nums ${figure} ${
            !hasEntry ? 'text-slate-400' : isShort ? 'text-amber-700' : 'text-[#1F5E3B]'
          }`}
        >
          {hasEntry ? money(isShort ? remainingDue : change) : '—'}
        </p>
      </div>
    </div>
  )
}

/** Paid so far vs. still due (or change once cash covered the rest), for split payments. */
function SplitSummary({
  money,
  paid,
  remaining,
  change,
  emphasis = false,
}: {
  money: (value: number) => string
  paid: number
  remaining: number
  change: number
  emphasis?: boolean
}) {
  const done = remaining <= 0
  const figure = emphasis ? 'text-[30px] leading-none' : 'text-2xl leading-tight'
  return (
    <div className="flex items-end justify-between gap-3" aria-live="polite">
      <div className="min-w-0">
        <p className="h-5 text-sm text-slate-500">Paid</p>
        <p className={`mt-1 truncate font-semibold tabular-nums ${figure} ${paid > 0 ? 'text-[#091413]' : 'text-slate-400'}`}>
          {money(paid)}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className={`h-5 text-sm ${done ? 'text-[#1F5E3B]' : 'font-medium text-amber-700'}`}>{done ? 'Change' : 'Remaining'}</p>
        <p className={`mt-1 font-bold tabular-nums ${figure} ${done ? 'text-[#1F5E3B]' : 'text-amber-700'}`}>
          {money(done ? change : remaining)}
        </p>
      </div>
    </div>
  )
}

function TenderList({
  tenders,
  money,
  disabled,
  onRemove,
}: {
  tenders: Tender[]
  money: (value: number) => string
  disabled: boolean
  onRemove: (index: number) => void
}) {
  if (tenders.length === 0) {
    return (
      <p className="rounded-2xl bg-[#F6F8F7] px-4 py-2.5 text-sm text-slate-500">
        Add each payment until the amount due is covered.
      </p>
    )
  }
  return (
    <ul className="max-h-36 shrink-0 overflow-y-auto overscroll-contain rounded-2xl ring-1 ring-slate-100" aria-label="Payments added">
      {tenders.map((tender, index) => (
        <li key={index} className="flex items-center gap-3 border-b border-slate-100 py-0.5 pl-4 pr-1 last:border-b-0">
          <span className="text-[#1F5E3B]">
            <MethodIcon value={tender.method} size={16} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">{tenderMethodLabel(tender.method)}</span>
            {tender.reference && <span className="block truncate text-xs text-slate-500">Ref {tender.reference}</span>}
          </span>
          <span className="text-sm font-semibold tabular-nums">{money(tender.amount)}</span>
          <button
            type="button"
            onClick={() => onRemove(index)}
            disabled={disabled}
            aria-label={`Remove ${tenderMethodLabel(tender.method)} payment of ${money(tender.amount)}`}
            className="flex h-11 w-11 items-center justify-center rounded-full text-slate-400 active:bg-slate-100 disabled:opacity-40"
          >
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </li>
      ))}
    </ul>
  )
}

/** Next tender in a split: amount on the keypad (blank = everything left), plus a reference for non-cash. */
function SplitEntry({
  money,
  method,
  methodLabel,
  amount,
  typed,
  remaining,
  needsReference,
  reference,
  problem,
  onReference,
  onReferenceKeyDown,
  onDigit,
  onDoubleZero,
  onBackspace,
  onQuickSelect,
  onAdd,
}: {
  money: (value: number) => string
  method: PaymentMethod
  methodLabel: string
  amount: number
  typed: boolean
  remaining: number
  needsReference: boolean
  reference: string
  problem: string | null
  onReference: (value: string) => void
  onReferenceKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void
  onDigit: (digit: string) => void
  onDoubleZero: () => void
  onBackspace: () => void
  onQuickSelect: (amount: number) => void
  onAdd: () => void
}) {
  const isCash = method === CASH_PAYMENT_METHOD
  // Cash can round up to a bill; other tenders can only take what's left.
  const quick = isCash ? quickCashAmounts(remaining) : [remaining]

  return (
    <div className="flex flex-1 flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3 rounded-2xl bg-[#F6F8F7] px-4 py-2.5">
        <span className="text-sm text-slate-500">{methodLabel} amount</span>
        <span className={`truncate text-2xl font-semibold tabular-nums ${typed ? 'text-[#091413]' : 'text-slate-400'}`}>
          {money(amount)}
        </span>
      </div>

      {needsReference && (
        <input
          key={method}
          type="text"
          autoComplete="off"
          autoCapitalize="characters"
          enterKeyHint="done"
          aria-label={`${methodLabel} reference number`}
          value={reference}
          onChange={(event) => onReference(event.target.value)}
          onKeyDown={onReferenceKeyDown}
          placeholder={method === 1 ? 'Approval code' : 'Reference no.'}
          className="h-12 w-full shrink-0 rounded-2xl border-0 bg-[#F3F5F4] px-4 text-base tracking-wide text-[#091413] placeholder:tracking-normal placeholder:text-slate-400 outline-none transition focus:bg-white focus:ring-2 focus:ring-[#1F5E3B]"
        />
      )}

      <div className="grid shrink-0 grid-cols-4 gap-2">
        {quick.map((value, index) => (
          <button
            key={value}
            type="button"
            onClick={() => onQuickSelect(value)}
            className="h-11 truncate rounded-xl bg-[#E6F1EA] px-1 text-sm font-medium tabular-nums text-[#1F5E3B] transition active:scale-95 touch-manipulation"
          >
            {index === 0 ? 'Rest' : money(value)}
          </button>
        ))}
      </div>

      <Keypad onDigit={onDigit} onDoubleZero={onDoubleZero} onBackspace={onBackspace} />

      <button
        type="button"
        onClick={onAdd}
        disabled={Boolean(problem)}
        className="h-12 w-full shrink-0 rounded-2xl bg-[#E6F1EA] text-[15px] font-semibold text-[#1F5E3B] transition active:scale-[0.99] disabled:bg-slate-100 disabled:font-medium disabled:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B]"
      >
        {problem ?? `Add ${methodLabel} ${money(amount)}`}
      </button>
    </div>
  )
}

function CashEntry({
  money,
  cashValue,
  quickAmounts,
  onDigit,
  onDoubleZero,
  onBackspace,
  onQuickSelect,
}: {
  money: (value: number) => string
  cashValue: number
  quickAmounts: number[]
  onDigit: (digit: string) => void
  onDoubleZero: () => void
  onBackspace: () => void
  onQuickSelect: (amount: number) => void
}) {
  const hasEntry = cashValue > 0

  return (
    <div className="flex flex-1 flex-col gap-2">
      {/* Quick amounts — all of them cover the total */}
      <div className="grid shrink-0 grid-cols-4 gap-2">
        {quickAmounts.map((amount, index) => {
          const selected = hasEntry && Math.abs(cashValue - amount) < 0.005
          return (
            <button
              key={amount}
              type="button"
              onClick={() => onQuickSelect(amount)}
              aria-pressed={selected}
              className={`h-12 truncate rounded-xl px-1 text-sm font-medium tabular-nums transition active:scale-95 touch-manipulation [@media(max-height:700px)]:h-11 ${
                selected ? 'bg-[#1F5E3B] text-white' : 'bg-[#E6F1EA] text-[#1F5E3B]'
              }`}
            >
              {index === 0 ? 'Exact' : money(amount)}
            </button>
          )
        })}
      </div>

      <Keypad onDigit={onDigit} onDoubleZero={onDoubleZero} onBackspace={onBackspace} />

      {/* Only for a mouse + keyboard register; touch tablets have no hardware keys to hint at. */}
      <p className="hidden shrink-0 text-center text-xs text-slate-400 [@media(pointer:fine)_and_(min-height:760px)]:block">
        You can also type on your keyboard. Enter completes the sale.
      </p>
    </div>
  )
}

/**
 * The numeric keypad. Its four rows share whatever height the dialog has left (never below
 * a 44px touch target, never taller than a comfortable ~96px), which is what lets the whole
 * payment step fit the screen without scrolling.
 */
function Keypad({
  onDigit,
  onDoubleZero,
  onBackspace,
}: {
  onDigit: (digit: string) => void
  onDoubleZero: () => void
  onBackspace: () => void
}) {
  return (
    <div className="grid max-h-[25.5rem] min-h-[12.5rem] flex-1 grid-cols-3 grid-rows-4 gap-2">
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
        <BackspaceIcon size={22} />
      </KeypadKey>
    </div>
  )
}

function KeypadKey({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex min-h-11 items-center justify-center rounded-2xl bg-[#F6F8F7] text-2xl font-medium text-[#091413] transition-colors active:bg-[#E6F1EA] touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B]"
    >
      {children}
    </button>
  )
}

/** Itemized order recap — read-only, sourced from the existing cart + totals calculation. */
function OrderItems({
  id,
  className,
  listClassName,
  cart,
  totals,
  taxRatePercent,
  money,
}: {
  id: string
  className: string
  listClassName: string
  cart: CartLine[]
  totals: CheckoutTotals
  taxRatePercent: number
  money: (value: number) => string
}) {
  return (
    <div id={id} className={`rounded-2xl ring-1 ring-slate-100 ${className}`}>
      <ul className={`overflow-y-auto overscroll-contain px-4 ${listClassName}`}>
        {cart.map((line) => (
          <li
            key={line.key}
            className="flex items-baseline justify-between gap-3 border-b border-slate-100 py-2 text-sm last:border-b-0"
          >
            <span className="min-w-0 text-[#091413]">
              <span className="block truncate">
                {line.product.name}
                <span className="text-slate-400"> × {line.quantity}</span>
              </span>
              {line.modifiers.length > 0 && <span className="block truncate text-xs text-slate-500">{modifierSummary(line.modifiers)}</span>}
            </span>
            <span className="shrink-0 tabular-nums text-[#091413]">
              {money(lineTotal(line))}
            </span>
          </li>
        ))}
      </ul>

      <dl className="shrink-0 space-y-1 border-t border-slate-100 px-4 py-2.5 text-sm">
        <SummaryRow label="Subtotal" value={money(totals.subtotal)} />
        {totals.manualDiscount > 0 && <SummaryRow label="Discount" value={`−${money(totals.manualDiscount)}`} />}
        {totals.loyaltyDiscount > 0 && <SummaryRow label="Points" value={`−${money(totals.loyaltyDiscount)}`} />}
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
      <p className="mt-4 text-sm text-slate-500">
        {receipt.orderType && `${receipt.orderType} · `}Paid with {receipt.paymentMethod}
      </p>

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

function LockIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden="true">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
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

function LedgerIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 4h12a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4V4z" />
      <line x1="8" y1="9" x2="16" y2="9" />
      <line x1="8" y1="13" x2="13" y2="13" />
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
