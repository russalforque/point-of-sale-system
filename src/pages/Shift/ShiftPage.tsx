import { useState } from 'react'

import { shiftApi } from '../../api/shiftApi'
import { Badge } from '../../components/ui/Badge'
import { Modal } from '../../components/ui/Modal'
import { PrimaryButton, TextButton, TextField } from '../../components/ui/MobileKit'
import { ErrorState, Spinner } from '../../components/ui/States'
import { ReasonField } from '../../components/ui/WorkPage'
import { useAuth } from '../../context/AuthContext'
import { useSettings } from '../../context/SettingsContext'
import { useToast } from '../../context/ToastContext'
import { useAsync } from '../../hooks/useAsync'
import type { Shift, ShiftSummary } from '../../types'
import { getErrorMessage } from '../../utils/errors'
import { formatDateTime, formatMoney, formatTime } from '../../utils/format'

function elapsed(startedAt: string): string {
  const start = new Date(startedAt).getTime()
  if (Number.isNaN(start)) return ''
  const minutes = Math.max(0, Math.floor((Date.now() - start) / 60000))
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (hours === 0) return `${mins}m`
  return `${hours}h ${mins}m`
}

const CASH_IN_REASONS = ['Float top-up', 'Change fund']
const CASH_OUT_REASONS = ['Bank deposit', 'Supplier payment', 'Petty cash']

export function ShiftPage() {
  const { notify } = useToast()
  const { settings } = useSettings()
  const money = (value: number) => formatMoney(value, settings.currencySymbol)

  const { data: activeShift, loading, error, reload } = useAsync(() => shiftApi.getActive(), [])

  const [startingCash, setStartingCash] = useState('')
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)

  const [showEndModal, setShowEndModal] = useState(false)
  const [lastClosed, setLastClosed] = useState<Shift | null>(null)

  async function startShift() {
    if (starting) return
    const amount = Number(startingCash)
    if (!startingCash.trim() || !Number.isFinite(amount) || amount < 0) {
      setStartError('Enter the starting cash amount.')
      return
    }
    setStartError(null)
    setStarting(true)
    try {
      await shiftApi.start({ startingCash: amount })
      setStartingCash('')
      setLastClosed(null)
      notify('Shift started.')
      await reload()
    } catch (err) {
      setStartError(getErrorMessage(err))
    } finally {
      setStarting(false)
    }
  }

  return (
    <div className="min-h-full bg-[#F6F8F7] text-[#091413] antialiased">
      <div className="mx-auto max-w-xl px-6 pb-12 pt-6">
        <header>
          <h1 className="text-2xl font-bold tracking-tight">Shift</h1>
          <p className="mt-0.5 text-sm text-slate-500">Track your cash drawer for this register session.</p>
        </header>

        <div className="mt-6">
          {loading && (
            <div className="py-16">
              <Spinner />
            </div>
          )}

          {!loading && error && <ErrorState message={error} onRetry={() => void reload()} />}

          {!loading && !error && activeShift && (
            <CurrentShiftCard shift={activeShift} money={money} onEndShift={() => setShowEndModal(true)} />
          )}

          {!loading && !error && !activeShift && (
            <div className="rounded-2xl bg-white p-6 ring-1 ring-slate-100">
              {lastClosed && <ClosedSummary shift={lastClosed} money={money} />}

              <h2 className="text-base font-semibold">Start shift</h2>
              <p className="mt-0.5 text-sm text-slate-500">Count your starting cash before you begin selling.</p>

              <form
                className="mt-4 space-y-4"
                onSubmit={(e) => {
                  e.preventDefault()
                  void startShift()
                }}
              >
                <TextField
                  label="Starting cash"
                  prefix={settings.currencySymbol}
                  amount
                  value={startingCash}
                  onChange={(value) => {
                    setStartingCash(value)
                    setStartError(null)
                  }}
                  error={startError ?? undefined}
                  autoFocus
                  placeholder="0.00"
                />
                <PrimaryButton type="submit" disabled={starting} className="w-full">
                  {starting ? 'Starting…' : 'Start Shift'}
                </PrimaryButton>
              </form>
            </div>
          )}
        </div>
      </div>

      {showEndModal && activeShift && (
        <EndShiftModal
          shift={activeShift}
          money={money}
          onClose={() => setShowEndModal(false)}
          onEnded={(closed) => {
            setShowEndModal(false)
            setLastClosed(closed)
            void reload()
          }}
        />
      )}
    </div>
  )
}

function differenceText(difference: number | null, money: (value: number) => string): string {
  if (difference === null) return ''
  if (Math.abs(difference) < 0.005) return 'Cash drawer balanced.'
  return difference > 0 ? `Over by ${money(difference)}.` : `Short by ${money(Math.abs(difference))}.`
}

function ClosedSummary({ shift, money }: { shift: Shift; money: (value: number) => string }) {
  return (
    <div className="mb-5 rounded-2xl bg-[#F2F8F4] p-4 text-sm">
      <p className="font-medium text-[#1F5E3B]">Shift closed</p>
      <p className="mt-1 text-slate-600">
        Expected {money(shift.expectedCash ?? 0)}, counted {money(shift.actualCash ?? 0)}. {differenceText(shift.difference, money)}
      </p>
    </div>
  )
}

function CurrentShiftCard({
  shift,
  money,
  onEndShift,
}: {
  shift: Shift
  money: (value: number) => string
  onEndShift: () => void
}) {
  const { can } = useAuth()
  const drawer = useAsync(() => shiftApi.summary(), [shift.id])
  const movements = useAsync(() => shiftApi.movements(shift.id), [shift.id])
  const [movementType, setMovementType] = useState<'in' | 'out' | null>(null)

  const summary = drawer.data?.summary

  return (
    <>
      <div className="rounded-2xl bg-white p-6 ring-1 ring-slate-100">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Current shift</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              {shift.employeeName} · started {formatDateTime(shift.startedAt)}
            </p>
          </div>
          <Badge tone="green">Open · {elapsed(shift.startedAt)}</Badge>
        </div>

        <div className="mt-5 rounded-2xl bg-[#F2F8F4] px-4 py-4">
          <p className="text-sm font-medium text-[#1F5E3B]">Expected in drawer</p>
          <p className="mt-1 text-[32px] font-bold leading-none tracking-tight tabular-nums">
            {summary ? money(summary.expectedCash) : '—'}
          </p>
        </div>

        {drawer.error && (
          <div className="mt-4">
            <ErrorState message={drawer.error} onRetry={() => void drawer.reload()} />
          </div>
        )}
        {summary && <DrawerBreakdown summary={summary} money={money} className="mt-3" />}

        {can('cash.movement') && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setMovementType('in')}
              className="h-12 rounded-2xl bg-[#F3F5F4] text-[15px] font-medium transition active:scale-[0.99]"
            >
              Cash in
            </button>
            <button
              type="button"
              onClick={() => setMovementType('out')}
              className="h-12 rounded-2xl bg-[#F3F5F4] text-[15px] font-medium transition active:scale-[0.99]"
            >
              Cash out
            </button>
          </div>
        )}

        <PrimaryButton onClick={onEndShift} className="mt-3 w-full">
          End Shift
        </PrimaryButton>
      </div>

      {(movements.data?.length ?? 0) > 0 && (
        <div className="mt-4 rounded-2xl bg-white p-6 ring-1 ring-slate-100">
          <h2 className="text-base font-semibold">Cash in & out</h2>
          <ul className="mt-2 divide-y divide-slate-100">
            {movements.data!.map((movement) => (
              <li key={movement.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-[15px]">{movement.reason}</p>
                  <p className="text-xs text-slate-500">
                    {formatTime(movement.createdAt)} · {movement.createdBy}
                  </p>
                </div>
                <p className={`shrink-0 text-[15px] font-medium tabular-nums ${movement.type === 'Cash in' ? 'text-[#1F5E3B]' : 'text-rose-700'}`}>
                  {movement.type === 'Cash in' ? '+' : '−'}
                  {money(movement.amount)}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {movementType && (
        <CashMovementModal
          type={movementType}
          onClose={() => setMovementType(null)}
          onSaved={() => {
            setMovementType(null)
            void drawer.reload()
            void movements.reload()
          }}
        />
      )}
    </>
  )
}

function DrawerBreakdown({
  summary,
  money,
  className = '',
}: {
  summary: ShiftSummary
  money: (value: number) => string
  className?: string
}) {
  return (
    <dl className={`divide-y divide-slate-100 rounded-2xl bg-[#F6F8F7] px-4 ${className}`}>
      <SummaryRow label="Starting cash" value={money(summary.startingCash)} />
      <SummaryRow label="Cash sales" value={`+${money(summary.cashSales)}`} />
      {summary.cashRefunds > 0 && <SummaryRow label="Cash refunds" value={`−${money(summary.cashRefunds)}`} />}
      {summary.cashIn > 0 && <SummaryRow label="Cash in" value={`+${money(summary.cashIn)}`} />}
      {summary.cashOut > 0 && <SummaryRow label="Cash out" value={`−${money(summary.cashOut)}`} />}
      <SummaryRow label="Non-cash sales (not in drawer)" value={money(summary.nonCashSales)} muted />
    </dl>
  )
}

function CashMovementModal({ type, onClose, onSaved }: { type: 'in' | 'out'; onClose: () => void; onSaved: () => void }) {
  const { notify } = useToast()
  const { settings } = useSettings()
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [amountError, setAmountError] = useState<string | null>(null)
  const [reasonError, setReasonError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function save() {
    if (busy) return
    const value = Number(amount)
    let invalid = false
    if (!amount || !Number.isFinite(value) || value <= 0) {
      setAmountError('Enter an amount above zero.')
      invalid = true
    }
    if (reason.trim().length < 3) {
      setReasonError('Enter a reason.')
      invalid = true
    }
    if (invalid) return

    setBusy(true)
    try {
      await shiftApi.addCashMovement({ type, amount: value, reason })
      notify(`${type === 'in' ? 'Cash in' : 'Cash out'} of ${formatMoney(value, settings.currencySymbol)} recorded.`)
      onSaved()
    } catch (err) {
      setAmountError(getErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={type === 'in' ? 'Cash in' : 'Cash out'}
      description={type === 'in' ? 'Cash added to the drawer.' : 'Cash taken out of the drawer.'}
      onClose={onClose}
      preventClose={busy}
      size="sm"
      footer={
        <div className="flex w-full items-center justify-end gap-2">
          <TextButton onClick={onClose} disabled={busy} className="h-12">
            Cancel
          </TextButton>
          <PrimaryButton onClick={() => void save()} disabled={busy} className="h-12 flex-none px-8">
            {busy ? 'Saving…' : 'Save'}
          </PrimaryButton>
        </div>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <TextField
          label="Amount"
          prefix={settings.currencySymbol}
          amount
          autoFocus
          placeholder="0.00"
          value={amount}
          onChange={(value) => {
            setAmount(value)
            setAmountError(null)
          }}
          error={amountError ?? undefined}
        />
        <ReasonField
          value={reason}
          onChange={(value) => {
            setReason(value)
            setReasonError(null)
          }}
          suggestions={type === 'in' ? CASH_IN_REASONS : CASH_OUT_REASONS}
          error={reasonError}
          disabled={busy}
        />
      </form>
    </Modal>
  )
}

function EndShiftModal({
  shift,
  money,
  onClose,
  onEnded,
}: {
  shift: Shift
  money: (value: number) => string
  onClose: () => void
  onEnded: (closed: Shift) => void
}) {
  const { notify } = useToast()
  const { settings } = useSettings()
  const { data: preview, loading, error } = useAsync(() => shiftApi.summary(), [shift.id])

  const [actualCash, setActualCash] = useState('')
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const actualValue = actualCash.trim() ? Number(actualCash) : null
  const difference = preview && actualValue !== null ? actualValue - preview.summary.expectedCash : null

  async function confirmEnd() {
    if (busy) return
    if (actualValue === null || !Number.isFinite(actualValue) || actualValue < 0) {
      setFormError('Enter the actual cash counted.')
      return
    }
    setFormError(null)
    setBusy(true)
    try {
      const closed = await shiftApi.end({ actualCash: actualValue })
      notify('Shift closed.')
      onEnded(closed)
    } catch (err) {
      setFormError(getErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="End shift"
      description={`Started ${formatDateTime(shift.startedAt)}`}
      onClose={onClose}
      preventClose={busy}
      size="sm"
      footer={
        <div className="flex w-full items-center justify-end gap-2">
          <TextButton onClick={onClose} disabled={busy} className="h-12">
            Cancel
          </TextButton>
          <PrimaryButton onClick={() => void confirmEnd()} disabled={busy || loading || !preview} className="h-12 flex-none px-8">
            {busy ? 'Closing…' : 'Close shift'}
          </PrimaryButton>
        </div>
      }
    >
      {loading && (
        <div className="py-10">
          <Spinner />
        </div>
      )}

      {!loading && error && <ErrorState message={error} />}

      {!loading && preview && (
        <div className="space-y-4">
          <DrawerBreakdown summary={preview.summary} money={money} />
          <div className="flex items-center justify-between rounded-2xl bg-[#F2F8F4] px-4 py-3 text-[15px] font-semibold">
            <span>Expected cash</span>
            <span className="tabular-nums">{money(preview.summary.expectedCash)}</span>
          </div>

          <TextField
            label="Actual cash counted"
            prefix={settings.currencySymbol}
            amount
            value={actualCash}
            onChange={(value) => {
              setActualCash(value)
              setFormError(null)
            }}
            error={formError ?? undefined}
            autoFocus
            placeholder="0.00"
          />

          {difference !== null && (
            <div
              className={`rounded-2xl px-4 py-3 text-sm font-medium ${
                Math.abs(difference) < 0.005
                  ? 'bg-[#F2F8F4] text-[#1F5E3B]'
                  : difference > 0
                  ? 'bg-blue-50 text-blue-700'
                  : 'bg-rose-50 text-rose-700'
              }`}
            >
              {Math.abs(difference) < 0.005
                ? 'Cash drawer balanced.'
                : difference > 0
                ? `Overage: ${money(difference)}`
                : `Shortage: ${money(Math.abs(difference))}`}
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}

function SummaryRow({ label, value, strong = false, muted = false }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-3 py-2.5 text-sm ${strong ? 'font-semibold' : ''}`}>
      <dt className={strong ? '' : 'text-slate-500'}>{label}</dt>
      <dd className={`tabular-nums ${muted ? 'text-slate-400' : ''}`}>{value}</dd>
    </div>
  )
}

export default ShiftPage
