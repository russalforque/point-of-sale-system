import { useState } from 'react'

import { shiftApi } from '../../api/shiftApi'
import { Badge } from '../../components/ui/Badge'
import { Modal } from '../../components/ui/Modal'
import { PrimaryButton, TextButton, TextField } from '../../components/ui/MobileKit'
import { ErrorState, Spinner } from '../../components/ui/States'
import { useSettings } from '../../context/SettingsContext'
import { useToast } from '../../context/ToastContext'
import { useAsync } from '../../hooks/useAsync'
import type { Shift } from '../../types'
import { getErrorMessage } from '../../utils/errors'
import { formatDateTime, formatMoney } from '../../utils/format'

function elapsed(startedAt: string): string {
  const start = new Date(startedAt).getTime()
  if (Number.isNaN(start)) return ''
  const minutes = Math.max(0, Math.floor((Date.now() - start) / 60000))
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (hours === 0) return `${mins}m`
  return `${hours}h ${mins}m`
}

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
              {lastClosed && (
                <div className="mb-5 rounded-2xl bg-[#F2F8F4] p-4 text-sm">
                  <p className="font-medium text-[#1F5E3B]">Shift closed</p>
                  <p className="mt-1 text-slate-600">
                    {lastClosed.difference !== null && Math.abs(lastClosed.difference) < 0.005
                      ? 'Cash drawer balanced.'
                      : lastClosed.difference !== null && lastClosed.difference > 0
                      ? `Over by ${money(lastClosed.difference)}.`
                      : lastClosed.difference !== null
                      ? `Short by ${money(Math.abs(lastClosed.difference))}.`
                      : ''}
                  </p>
                </div>
              )}

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
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
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

function CurrentShiftCard({
  shift,
  money,
  onEndShift,
}: {
  shift: Shift
  money: (value: number) => string
  onEndShift: () => void
}) {
  return (
    <div className="rounded-2xl bg-white p-6 ring-1 ring-slate-100">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Current shift</h2>
          <p className="mt-0.5 text-sm text-slate-500">Started {formatDateTime(shift.startedAt)}</p>
        </div>
        <Badge tone="green">Open · {elapsed(shift.startedAt)}</Badge>
      </div>

      <dl className="mt-5 divide-y divide-slate-100">
        <div className="flex items-center justify-between py-3">
          <dt className="text-sm text-slate-500">Employee</dt>
          <dd className="text-[15px] font-medium">{shift.employeeName}</dd>
        </div>
        <div className="flex items-center justify-between py-3">
          <dt className="text-sm text-slate-500">Starting cash</dt>
          <dd className="text-[15px] tabular-nums font-medium">{money(shift.startingCash)}</dd>
        </div>
      </dl>

      <PrimaryButton onClick={onEndShift} className="mt-2 w-full">
        End Shift
      </PrimaryButton>
    </div>
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
  const { data: preview, loading, error } = useAsync(() => shiftApi.previewClose(), [shift.id])

  const [actualCash, setActualCash] = useState('')
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const actualValue = actualCash.trim() ? Number(actualCash) : null
  const difference = preview && actualValue !== null ? actualValue - preview.expectedCash : null

  async function confirmEnd() {
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
          <dl className="divide-y divide-slate-100 rounded-2xl bg-[#F6F8F7] px-4">
            <SummaryRow label="Starting cash" value={money(shift.startingCash)} />
            <SummaryRow label="Cash sales" value={money(preview.cashSales)} />
            <SummaryRow label="Non-cash sales" value={money(preview.nonCashSales)} />
            <SummaryRow label="Expected cash" value={money(preview.expectedCash)} strong />
          </dl>

          <TextField
            label="Actual cash counted"
            prefix={settings.currencySymbol}
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
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
                ? `Over by ${money(difference)}`
                : `Short by ${money(Math.abs(difference))}`}
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}

function SummaryRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between py-2.5 text-sm ${strong ? 'font-semibold' : ''}`}>
      <dt className={strong ? '' : 'text-slate-500'}>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  )
}

export default ShiftPage
