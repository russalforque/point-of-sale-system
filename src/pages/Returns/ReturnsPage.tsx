import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { adjustmentsApi, calculateRefund, MIN_REASON_LENGTH, returnableQuantity } from '../../api/adjustmentsApi'
import { salesApi } from '../../api/salesApi'
import { shiftApi } from '../../api/shiftApi'
import { useApproval } from '../../components/auth/ApprovalDialog'
import { Badge } from '../../components/ui/Badge'
import { Search } from '../../components/ui/Icons'
import { Modal } from '../../components/ui/Modal'
import { SwitchRow } from '../../components/ui/MobileKit'
import { EmptyState, ErrorState, Spinner } from '../../components/ui/States'
import { Panel, QuantityStepper, ReasonField, WorkPage } from '../../components/ui/WorkPage'
import { useAuth } from '../../context/AuthContext'
import { useSettings } from '../../context/SettingsContext'
import { useToast } from '../../context/ToastContext'
import { useAsync } from '../../hooks/useAsync'
import { CASH_METHOD } from '../../services/payments'
import type { PaymentMethod, Refund, Sale } from '../../types'
import { getErrorMessage } from '../../utils/errors'
import { formatDateTime, formatMoney } from '../../utils/format'
import { PAYMENT_OPTIONS } from '../../utils/pos'

const REFUND_REASONS = ['Damaged item', 'Wrong item', 'Changed mind', 'Expired']
const VOID_REASONS = ['Wrong items rung up', 'Customer cancelled', 'Duplicate sale', 'Payment failed']

/**
 * Returns, refunds and voids, found by receipt number. Kept off the register so the checkout
 * flow stays uncluttered; the order history links here for a selected receipt.
 */
export function ReturnsPage() {
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState(params.get('invoice') ?? '')
  const [sale, setSale] = useState<Sale | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)

  async function find(input = query) {
    const term = input.trim()
    if (!term || searching) return
    setSearching(true)
    setSearchError(null)
    try {
      const found = await salesApi.findByInvoice(term)
      setSale(found)
      if (found) setParams({ invoice: found.invoiceNumber }, { replace: true })
      else setSearchError(`No sale found with receipt number “${term}”.`)
    } catch (err) {
      setSearchError(getErrorMessage(err))
    } finally {
      setSearching(false)
    }
  }

  async function reloadSale() {
    if (!sale) return
    try {
      setSale(await salesApi.get(sale.id))
    } catch (err) {
      setSearchError(getErrorMessage(err))
    }
  }

  // Opened from the order history with ?invoice=…
  useEffect(() => {
    const invoice = params.get('invoice')
    if (invoice) void find(invoice)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function clear() {
    setSale(null)
    setQuery('')
    setSearchError(null)
    setParams({}, { replace: true })
  }

  return (
    <WorkPage title="Returns & voids" subtitle="Look up a receipt to return items, refund or void the sale.">
      <form
        className="mt-5 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          void find()
        }}
      >
        <div className="relative min-w-0 flex-1">
          <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            inputMode="text"
            autoCapitalize="characters"
            enterKeyHint="search"
            aria-label="Receipt number"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setSearchError(null)
            }}
            placeholder="Receipt no., e.g. INV-000123 or 123"
            className="h-12 w-full rounded-2xl border-0 bg-white pl-11 pr-4 text-[15px] ring-1 ring-slate-200 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-[#1F5E3B] [&::-webkit-search-cancel-button]:hidden"
          />
        </div>
        <button
          type="submit"
          disabled={searching || !query.trim()}
          className="h-12 shrink-0 rounded-2xl bg-[#1F5E3B] px-5 text-[15px] font-semibold text-white transition active:scale-[0.99] disabled:bg-slate-200 disabled:text-slate-400"
        >
          {searching ? 'Finding…' : 'Find'}
        </button>
      </form>
      {searchError && (
        <p role="alert" className="mt-2 text-sm text-rose-600">
          {searchError}
        </p>
      )}

      {sale ? (
        <SaleAdjustments key={sale.id} sale={sale} onChanged={reloadSale} onClose={clear} />
      ) : (
        <RecentRefunds />
      )}
    </WorkPage>
  )
}

/* ------------------------------------------------------------------
   SALE DETAIL + ACTIONS
------------------------------------------------------------------ */

function SaleAdjustments({ sale, onChanged, onClose }: { sale: Sale; onChanged: () => Promise<void>; onClose: () => void }) {
  const { notify } = useToast()
  const { settings } = useSettings()
  const { can } = useAuth()
  const approval = useApproval()
  const money = (value: number) => formatMoney(value, settings.currencySymbol)

  const refunds = useAsync(() => adjustmentsApi.refundsForSale(sale.id), [sale.id, sale.refundedAmount, sale.status])
  const activeShift = useAsync(() => shiftApi.getActive().catch(() => null), [])

  const defaultMethod: PaymentMethod =
    sale.payments.length === 1 && PAYMENT_OPTIONS.some((option) => option.value === sale.payments[0]!.method)
      ? (sale.payments[0]!.method as PaymentMethod)
      : CASH_METHOD

  const [selection, setSelection] = useState<Record<number, number>>({})
  const [reason, setReason] = useState('')
  const [method, setMethod] = useState<PaymentMethod>(defaultMethod)
  const [restock, setRestock] = useState(true)
  const [busy, setBusy] = useState(false)
  const [reasonError, setReasonError] = useState<string | null>(null)
  const [showVoid, setShowVoid] = useState(false)

  const voided = sale.status === 'Voided'
  const fullyRefunded = sale.refundStatus === 'Full'
  const canReturn = sale.status === 'Completed' && !fullyRefunded
  const canVoid = sale.status === 'Completed' && sale.refundStatus === 'None'

  const picked = Object.entries(selection)
    .map(([productId, quantity]) => ({ productId: Number(productId), quantity }))
    .filter((entry) => entry.quantity > 0)

  const refund = useMemo(() => {
    try {
      return calculateRefund(sale, picked)
    } catch {
      return null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sale, selection])

  const pickedCount = picked.reduce((sum, entry) => sum + entry.quantity, 0)

  function selectAll() {
    setSelection(Object.fromEntries(sale.items.map((item) => [item.productId, returnableQuantity(item)])))
  }

  async function submitRefund() {
    if (busy || !refund || pickedCount === 0) return
    if (reason.trim().length < MIN_REASON_LENGTH) {
      setReasonError('Enter a reason for the return.')
      return
    }
    const methodName = PAYMENT_OPTIONS.find((option) => option.value === method)?.label ?? 'Other'
    const approver = await approval.request({
      permission: 'sales.refund',
      title: `Refund ${money(refund.amount)}?`,
      message:
        `${pickedCount} ${pickedCount === 1 ? 'item' : 'items'} from ${sale.invoiceNumber}, paid back by ${methodName}. ` +
        (restock ? 'The items go back into stock.' : 'The items will not be put back into stock.'),
      confirmLabel: `Refund ${money(refund.amount)}`,
    })
    if (!approver) return

    setBusy(true)
    try {
      const saved = await adjustmentsApi.refund({ saleId: sale.id, items: picked, reason, method, restock, approvedBy: approver })
      notify(`${saved.refundNumber}: refunded ${money(saved.amount)}.`)
      setSelection({})
      setReason('')
      await onChanged()
    } catch (err) {
      notify(getErrorMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  const cashWithoutShift = method === CASH_METHOD && activeShift.data === null && !activeShift.loading

  return (
    <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0 space-y-4">
        <Panel
          title={sale.invoiceNumber}
          description={`${formatDateTime(sale.createdAt)} · ${sale.customerName || 'Walk-in customer'} · ${sale.cashierName}`}
          action={
            <button type="button" onClick={onClose} className="h-10 shrink-0 rounded-full px-3 text-sm font-medium text-slate-500 active:bg-slate-100">
              Close
            </button>
          }
        >
          <div className="flex flex-wrap gap-2">
            {voided ? (
              <Badge tone="red">Voided</Badge>
            ) : sale.refundStatus === 'Full' ? (
              <Badge tone="amber">Fully refunded</Badge>
            ) : sale.refundStatus === 'Partial' ? (
              <Badge tone="amber">Partly refunded</Badge>
            ) : (
              <Badge tone="green">Completed</Badge>
            )}
            {sale.orderType && <Badge tone="gray">{sale.orderType}</Badge>}
            <Badge tone="gray">
              {sale.payments.length > 1
                ? sale.payments.map((payment) => `${payment.label} ${money(payment.amount)}`).join(' + ')
                : sale.paymentMethod}
            </Badge>
          </div>

          {voided && (
            <div className="mt-3 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-800">
              Voided {formatDateTime(sale.voidedAt)} by {sale.voidedBy ?? 'unknown'}
              {sale.voidApprovedBy && sale.voidApprovedBy !== sale.voidedBy && `, approved by ${sale.voidApprovedBy}`}. Reason: {sale.voidReason}
            </div>
          )}

          <div className="mt-4 flex items-center justify-between">
            <h3 className="text-sm font-medium text-slate-500">Items</h3>
            {canReturn && (
              <button type="button" onClick={selectAll} disabled={busy} className="h-10 rounded-full px-3 text-sm font-medium text-[#1F5E3B] active:bg-[#F2F8F4]">
                Return everything
              </button>
            )}
          </div>
          <ul className="mt-1">
            {sale.items.map((item) => {
              const returnable = returnableQuantity(item)
              return (
                <li key={item.productId} className="flex items-center gap-3 border-b border-slate-100 py-3 last:border-b-0">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px]">{item.productName}</p>
                    <p className="text-xs tabular-nums text-slate-500">
                      {item.quantity} × {money(item.unitPrice)}
                      {item.refundedQuantity > 0 && <span className="text-amber-700"> · {item.refundedQuantity} returned</span>}
                    </p>
                  </div>
                  {canReturn && returnable > 0 ? (
                    <QuantityStepper
                      label={`${item.productName} to return`}
                      value={selection[item.productId] ?? 0}
                      max={returnable}
                      disabled={busy}
                      onChange={(value) => setSelection((prev) => ({ ...prev, [item.productId]: value }))}
                    />
                  ) : (
                    <span className="text-sm tabular-nums text-slate-500">{money(item.lineTotal)}</span>
                  )}
                </li>
              )
            })}
          </ul>

          <dl className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-sm">
            <Row label="Subtotal" value={money(sale.subtotal)} />
            {sale.discount > 0 && <Row label="Discount" value={`−${money(sale.discount)}`} />}
            <Row label="Tax" value={money(sale.tax)} />
            <Row label="Total paid" value={money(sale.total)} strong />
            {sale.refundedAmount > 0 && <Row label="Already refunded" value={`−${money(sale.refundedAmount)}`} />}
          </dl>
        </Panel>

        <RefundHistory refunds={refunds.data ?? []} loading={refunds.loading} money={money} />
      </div>

      <div className="space-y-4">
        {canReturn && (
          <Panel title="Return & refund" description="Pick the items above, then the reason.">
            <div className="space-y-4">
              <ReasonField
                value={reason}
                onChange={(value) => {
                  setReason(value)
                  setReasonError(null)
                }}
                suggestions={REFUND_REASONS}
                error={reasonError}
                disabled={busy}
              />

              <div>
                <p className="text-sm font-medium">Refund by</p>
                <div role="radiogroup" aria-label="Refund method" className="mt-1.5 grid grid-cols-4 gap-1 rounded-2xl bg-[#F1F4F3] p-1">
                  {PAYMENT_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={method === option.value}
                      disabled={busy}
                      onClick={() => setMethod(option.value)}
                      className={`h-11 rounded-xl text-sm transition ${
                        method === option.value ? 'bg-white font-semibold text-[#1F5E3B] shadow-sm' : 'font-medium text-slate-600'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                {cashWithoutShift && (
                  <p className="mt-1.5 text-xs text-amber-700">You have no open shift, so this cash won’t be taken from a drawer count.</p>
                )}
              </div>

              <SwitchRow
                label="Return items to stock"
                description={restock ? 'Stock goes back up.' : 'For damaged or expired goods.'}
                checked={restock}
                disabled={busy}
                onChange={setRestock}
              />

              <div className="flex items-baseline justify-between border-t border-slate-100 pt-3">
                <span className="text-sm text-slate-500">
                  Refund{pickedCount > 0 && ` · ${pickedCount} ${pickedCount === 1 ? 'item' : 'items'}`}
                </span>
                <span className="text-2xl font-bold tabular-nums">{money(refund?.amount ?? 0)}</span>
              </div>

              <button
                type="button"
                onClick={() => void submitRefund()}
                disabled={busy || pickedCount === 0}
                className="h-14 w-full rounded-2xl bg-[#1F5E3B] text-[15px] font-semibold text-white transition active:scale-[0.99] disabled:bg-slate-200 disabled:text-slate-500"
              >
                {busy ? 'Saving…' : pickedCount === 0 ? 'Select items to return' : `Refund ${money(refund?.amount ?? 0)}`}
              </button>
              {!can('sales.refund') && <p className="text-center text-xs text-slate-500">A manager or admin PIN is needed.</p>}
            </div>
          </Panel>
        )}

        {canVoid && (
          <Panel title="Void sale" description="Cancels the whole sale and puts every item back in stock. The record is kept.">
            <button
              type="button"
              onClick={() => setShowVoid(true)}
              disabled={busy}
              className="h-12 w-full rounded-2xl bg-rose-50 text-[15px] font-semibold text-rose-700 transition active:bg-rose-100 disabled:opacity-40"
            >
              Void {sale.invoiceNumber}
            </button>
          </Panel>
        )}

        {!canReturn && !voided && (
          <Panel>
            <p className="text-sm text-slate-500">Every item on this receipt has already been returned.</p>
          </Panel>
        )}
      </div>

      {showVoid && (
        <VoidDialog
          sale={sale}
          money={money}
          onClose={() => setShowVoid(false)}
          onVoided={async () => {
            setShowVoid(false)
            await onChanged()
          }}
          requestApproval={approval.request}
        />
      )}

      {approval.dialog}
    </div>
  )
}

function VoidDialog({
  sale,
  money,
  onClose,
  onVoided,
  requestApproval,
}: {
  sale: Sale
  money: (value: number) => string
  onClose: () => void
  onVoided: () => Promise<void>
  requestApproval: ReturnType<typeof useApproval>['request']
}) {
  const { notify } = useToast()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (busy) return
    if (reason.trim().length < MIN_REASON_LENGTH) {
      setError('Enter a reason for the void.')
      return
    }
    const approver = await requestApproval({
      permission: 'sales.void',
      title: `Void ${sale.invoiceNumber}?`,
      message: `The ${money(sale.total)} sale will be cancelled and its items returned to stock. This can’t be undone.`,
      confirmLabel: 'Void sale',
      danger: true,
    })
    if (!approver) return

    setBusy(true)
    try {
      await adjustmentsApi.void({ saleId: sale.id, reason, approvedBy: approver })
      notify(`${sale.invoiceNumber} voided.`)
      await onVoided()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={`Void ${sale.invoiceNumber}`}
      description={`${money(sale.total)} · ${formatDateTime(sale.createdAt)}`}
      onClose={onClose}
      preventClose={busy}
      size="sm"
      footer={
        <div className="flex w-full gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="h-12 flex-1 rounded-2xl text-[15px] font-medium text-slate-600 active:bg-slate-100 sm:flex-none sm:px-5">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy}
            className="h-12 flex-1 rounded-2xl bg-rose-600 px-6 text-[15px] font-semibold text-white transition active:scale-[0.99] disabled:bg-slate-200 disabled:text-slate-400"
          >
            {busy ? 'Voiding…' : 'Continue'}
          </button>
        </div>
      }
    >
      <ReasonField
        value={reason}
        onChange={(value) => {
          setReason(value)
          setError(null)
        }}
        suggestions={VOID_REASONS}
        error={error}
        disabled={busy}
      />
    </Modal>
  )
}

/* ------------------------------------------------------------------
   HISTORY
------------------------------------------------------------------ */

function RefundHistory({ refunds, loading, money }: { refunds: Refund[]; loading: boolean; money: (value: number) => string }) {
  if (loading && refunds.length === 0) return null
  if (refunds.length === 0) return null
  return (
    <Panel title="Refunds on this receipt">
      <ul className="space-y-2">
        {refunds.map((refund) => (
          <RefundCard key={refund.id} refund={refund} money={money} />
        ))}
      </ul>
    </Panel>
  )
}

function RefundCard({ refund, money, showInvoice = false }: { refund: Refund; money: (value: number) => string; showInvoice?: boolean }) {
  return (
    <li className="rounded-2xl bg-[#F6F8F7] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold">
            {refund.refundNumber}
            {showInvoice && <span className="font-normal text-slate-500"> · {refund.invoiceNumber}</span>}
          </p>
          <p className="text-xs text-slate-500">
            {formatDateTime(refund.createdAt)} · {refund.processedBy}
            {refund.approvedBy && refund.approvedBy !== refund.processedBy && ` · approved by ${refund.approvedBy}`}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[15px] font-semibold tabular-nums">−{money(refund.amount)}</p>
          <p className="text-xs text-slate-500">{refund.methodLabel}</p>
        </div>
      </div>
      <p className="mt-2 text-sm text-slate-600">
        {refund.items.map((item) => `${item.quantity}× ${item.productName}`).join(', ')}
        {!refund.restocked && <span className="text-amber-700"> · not restocked</span>}
      </p>
      <p className="mt-1 text-sm text-slate-500">Reason: {refund.reason}</p>
    </li>
  )
}

function RecentRefunds() {
  const { settings } = useSettings()
  const money = (value: number) => formatMoney(value, settings.currencySymbol)
  const recent = useAsync(() => adjustmentsApi.recentRefunds({ pageSize: 10 }), [])

  return (
    <Panel title="Recent refunds" className="mt-5">
      {recent.loading && !recent.data && (
        <div className="py-8">
          <Spinner />
        </div>
      )}
      {recent.error && <ErrorState message={recent.error} onRetry={() => void recent.reload()} />}
      {recent.data && recent.data.items.length === 0 && (
        <div className="py-8 text-center">
          <EmptyState title="No refunds yet" hint="Refunds and returns you process will be listed here." />
        </div>
      )}
      <ul className="space-y-2">
        {(recent.data?.items ?? []).map((refund) => (
          <RefundCard key={refund.id} refund={refund} money={money} showInvoice />
        ))}
      </ul>
    </Panel>
  )
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? 'font-semibold text-[#091413]' : 'text-slate-500'}`}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  )
}

export default ReturnsPage
