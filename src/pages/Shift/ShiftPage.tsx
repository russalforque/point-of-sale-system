import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { shiftApi } from '../../api/shiftApi'
import { DesktopPage, SecondaryButton } from '../../components/ui/DesktopKit'
import { ArrowDown, ArrowUp, ChevronRight, Refresh } from '../../components/ui/Icons'
import { Modal } from '../../components/ui/Modal'
import { Avatar, PrimaryButton, TextButton, TextField } from '../../components/ui/MobileKit'
import { ErrorState, Spinner } from '../../components/ui/States'
import { ReasonField } from '../../components/ui/WorkPage'
import { useAuth } from '../../context/AuthContext'
import { useSettings } from '../../context/SettingsContext'
import { useToast } from '../../context/ToastContext'
import { useAsync } from '../../hooks/useAsync'
import { useDismissOnBack } from '../../hooks/useDismissOnBack'
import type { CashMovement, Shift, ShiftSummary } from '../../types'
import { getErrorMessage } from '../../utils/errors'
import { formatDayLabel, formatDuration, formatMoney, formatTime } from '../../utils/format'
import { ShiftDetails, VarianceTag, shiftTimeLine } from './shiftHistory'

type Money = (value: number) => string

const CASH_IN_REASONS = ['Float top-up', 'Change fund']
const CASH_OUT_REASONS = ['Bank deposit', 'Supplier payment', 'Petty cash']
/** One-tap starting floats; the field still takes any amount. */
const QUICK_FLOATS = [500, 1000, 2000, 3000, 5000]

const CARD = 'rounded-3xl bg-white p-5 ring-1 ring-slate-100 @xl:p-6'

/** Re-renders every 30s so "On shift · 2h 40m" keeps ticking while the page is open. */
function useTicker(intervalMs = 30_000) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setTick((tick) => tick + 1), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
}

function startedLabel(shift: Shift): string {
  const day = formatDayLabel(shift.startedAt)
  return `${day === 'Today' ? '' : `${day}, `}${formatTime(shift.startedAt)}`
}

/**
 * The cashier's register session. Tablet landscape gets a two-column drawer dashboard
 * (drawer + actions on the left, sales and the cash log on the right); portrait tablets
 * and phones stack the same cards. Layout follows the page's own width (container
 * queries), so it also adapts when the sidebar is expanded.
 */
export function ShiftPage() {
  const { can } = useAuth()
  const { settings } = useSettings()
  const money: Money = (value) => formatMoney(value, settings.currencySymbol)
  useTicker()

  const active = useAsync(() => shiftApi.getActive(), [])
  const shift = active.data
  const drawer = useAsync(() => (shift ? shiftApi.summary() : Promise.resolve(null)), [shift?.id])
  const movements = useAsync(() => (shift ? shiftApi.movements(shift.id) : Promise.resolve([] as CashMovement[])), [shift?.id])

  const [lastClosed, setLastClosed] = useState<Shift | null>(null)
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)

  useEffect(() => {
    if (drawer.data) setUpdatedAt(new Date().toISOString())
  }, [drawer.data])

  const refreshing = drawer.loading || movements.loading
  const refresh = () => {
    void active.reload()
    void drawer.reload()
    void movements.reload()
  }

  const firstLoad = active.loading && !shift && !active.error

  return (
    <DesktopPage
      title="My Shift"
      subtitle={
        shift
          ? `Started ${startedLabel(shift)}${updatedAt ? ` · updated ${formatTime(updatedAt)}` : ''}`
          : 'Count your drawer to open a register session.'
      }
      actions={
        <>
          {shift && (
            <SecondaryButton onClick={refresh} disabled={refreshing} aria-label="Refresh drawer totals">
              <Refresh size={14} className={`text-slate-500 ${refreshing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Refresh</span>
            </SecondaryButton>
          )}
          {can('shifts.manage') && (
            <Link
              to="/shift-history"
              className="inline-flex h-11 items-center gap-2 rounded-full px-4 text-sm font-medium text-[#1F5E3B] transition hover:bg-[#E6F1EA] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B]"
            >
              Shift history
              <ChevronRight size={11} />
            </Link>
          )}
        </>
      }
    >
      <div className="@container mt-6">
        {firstLoad && (
          <div className="py-20">
            <Spinner />
          </div>
        )}

        {!active.loading && active.error && !shift && <ErrorState message={active.error} onRetry={() => void active.reload()} />}

        {shift && (
          <ActiveShift
            shift={shift}
            money={money}
            summary={drawer.data?.summary ?? null}
            summaryError={drawer.error}
            onRetrySummary={() => void drawer.reload()}
            movements={movements.data}
            movementsLoading={movements.loading}
            movementsError={movements.error}
            onRetryMovements={() => void movements.reload()}
            onCashMoved={() => {
              void drawer.reload()
              void movements.reload()
            }}
            onClosed={(closed) => {
              setLastClosed(closed)
              active.setData(null)
            }}
          />
        )}

        {!active.loading && !active.error && !shift && (
          <NoShift
            money={money}
            lastClosed={lastClosed}
            onStarted={(started) => {
              setLastClosed(null)
              active.setData(started)
            }}
          />
        )}
      </div>
    </DesktopPage>
  )
}

/* ------------------------------------------------------------------
   OPEN SHIFT
------------------------------------------------------------------ */

function ActiveShift({
  shift,
  money,
  summary,
  summaryError,
  onRetrySummary,
  movements,
  movementsLoading,
  movementsError,
  onRetryMovements,
  onCashMoved,
  onClosed,
}: {
  shift: Shift
  money: Money
  summary: ShiftSummary | null
  summaryError: string | null
  onRetrySummary: () => void
  movements: CashMovement[] | null
  movementsLoading: boolean
  movementsError: string | null
  onRetryMovements: () => void
  onCashMoved: () => void
  onClosed: (closed: Shift) => void
}) {
  const { can } = useAuth()
  const canMoveCash = can('cash.movement')
  const [movementType, setMovementType] = useState<'in' | 'out' | null>(null)
  const [ending, setEnding] = useState(false)

  return (
    <div className="grid grid-cols-1 gap-5 @4xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] @4xl:items-start">
      {/* Drawer: the number the cashier is accountable for, how it's made up, and what to do next */}
      <section aria-labelledby="drawer-title" className={CARD}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="drawer-title" className="text-base font-semibold">
            Cash drawer
          </h2>
          <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-[#E6F1EA] px-2.5 text-xs font-semibold text-[#1F5E3B]">
            <span aria-hidden="true" className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#1F5E3B] opacity-40 motion-reduce:hidden" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[#1F5E3B]" />
            </span>
            On shift · {formatDuration(shift.startedAt)}
          </span>
        </div>

        <div className="mt-4 rounded-2xl bg-[#F2F8F4] px-5 py-5">
          <p className="text-sm font-medium text-[#1F5E3B]">Expected in drawer</p>
          <p className="mt-1.5 truncate text-[40px] font-bold leading-none tracking-[-0.02em] tabular-nums">
            {summary ? money(summary.expectedCash) : summaryError ? '—' : <span className="text-slate-300">…</span>}
          </p>
          <p className="mt-2 text-sm text-slate-600">Your count should match this when you end the shift.</p>
        </div>

        {summaryError && (
          <RetryBanner
            message={summary ? 'Couldn’t refresh. Showing the last totals.' : 'Couldn’t load the drawer totals.'}
            onRetry={onRetrySummary}
          />
        )}

        {summary && <DrawerLedger summary={summary} money={money} className="mt-4" />}

        <div className={`mt-5 grid gap-2 ${canMoveCash ? 'grid-cols-2 @xl:grid-cols-[1fr_1fr_minmax(0,1.4fr)]' : ''}`}>
          {canMoveCash && (
            <>
              <CashButton direction="in" onClick={() => setMovementType('in')} />
              <CashButton direction="out" onClick={() => setMovementType('out')} />
            </>
          )}
          <PrimaryButton onClick={() => setEnding(true)} className={canMoveCash ? 'col-span-2 @xl:col-span-1' : 'w-full'}>
            End shift
          </PrimaryButton>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-5">
        <SalesCard summary={summary} money={money} />
        <MovementsCard
          movements={movements}
          loading={movementsLoading}
          error={movementsError}
          onRetry={onRetryMovements}
          money={money}
        />
      </div>

      {movementType && (
        <CashMovementDialog
          type={movementType}
          available={summary?.expectedCash ?? null}
          money={money}
          onClose={() => setMovementType(null)}
          onSaved={() => {
            setMovementType(null)
            onCashMoved()
          }}
        />
      )}

      {ending && <EndShiftDialog shift={shift} money={money} onClose={() => setEnding(false)} onEnded={onClosed} />}
    </div>
  )
}

function CashButton({ direction, onClick }: { direction: 'in' | 'out'; onClick: () => void }) {
  const isIn = direction === 'in'
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-14 items-center justify-center gap-2 whitespace-nowrap rounded-2xl bg-[#F3F5F4] px-3 text-[15px] font-medium transition hover:bg-[#E9EEEB] active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B]"
    >
      <span
        aria-hidden="true"
        className={`flex h-7 w-7 items-center justify-center rounded-full ${isIn ? 'bg-[#E6F1EA] text-[#1F5E3B]' : 'bg-rose-50 text-rose-600'}`}
      >
        {isIn ? <ArrowDown size={12} /> : <ArrowUp size={12} />}
      </span>
      {isIn ? 'Cash in' : 'Cash out'}
    </button>
  )
}

/** Starting cash, then each change to it. Rows with nothing in them stay (muted) so the list never jumps around. */
function DrawerLedger({ summary, money, className = '' }: { summary: ShiftSummary; money: Money; className?: string }) {
  return (
    <dl className={`divide-y divide-slate-100 ${className}`}>
      <LedgerRow label="Starting cash" value={summary.startingCash} money={money} />
      <LedgerRow label="Cash sales" sign="+" value={summary.cashSales} money={money} />
      <LedgerRow label="Cash refunds" sign="−" value={summary.cashRefunds} money={money} />
      <LedgerRow label="Cash in" sign="+" value={summary.cashIn} money={money} />
      <LedgerRow label="Cash out" sign="−" value={summary.cashOut} money={money} />
    </dl>
  )
}

function LedgerRow({ label, value, sign, money }: { label: string; value: number; sign?: '+' | '−'; money: Money }) {
  const empty = sign !== undefined && value === 0
  return (
    <div className="flex min-h-11 items-center justify-between gap-4 py-2 text-[15px]">
      <dt className="flex items-center gap-2 text-slate-500">
        <span aria-hidden="true" className="w-3 text-center font-medium text-slate-400">
          {sign}
        </span>
        {label}
      </dt>
      <dd className={`tabular-nums ${empty ? 'text-slate-300' : 'text-[#091413]'}`}>
        {sign && !empty && <span className="sr-only">{sign === '+' ? 'plus' : 'minus'} </span>}
        {money(value)}
      </dd>
    </div>
  )
}

function SalesCard({ summary, money }: { summary: ShiftSummary | null; money: Money }) {
  const total = summary ? summary.cashSales + summary.nonCashSales : 0
  const cashShare = total > 0 && summary ? Math.round((summary.cashSales / total) * 100) : 0

  return (
    <section aria-labelledby="sales-title" className={CARD}>
      <h2 id="sales-title" className="text-base font-semibold">
        Sales this shift
      </h2>
      <p className="mt-2 truncate text-[28px] font-bold leading-none tracking-[-0.02em] tabular-nums">
        {summary ? money(total) : '—'}
      </p>

      {summary && total > 0 ? (
        <>
          <div
            className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-slate-100"
            role="img"
            aria-label={`${cashShare}% cash, ${100 - cashShare}% card, GCash and other`}
          >
            <span className="h-full rounded-full bg-[#1F5E3B]" style={{ width: `${cashShare}%` }} />
            {cashShare > 0 && cashShare < 100 && <span className="w-0.5 shrink-0" />}
            <span className="h-full flex-1 rounded-full bg-[#9DC3AC]" />
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-3">
            <SalesSplit dot="bg-[#1F5E3B]" label="Cash" value={money(summary.cashSales)} share={cashShare} />
            <SalesSplit dot="bg-[#9DC3AC]" label="Card, GCash & other" value={money(summary.nonCashSales)} share={100 - cashShare} />
          </dl>
          <p className="mt-3 text-xs text-slate-500">Only cash sales go into the drawer.</p>
        </>
      ) : (
        <p className="mt-2 text-sm text-slate-500">{summary ? 'No sales yet this shift.' : 'Totals appear once the drawer loads.'}</p>
      )}
    </section>
  )
}

function SalesSplit({ dot, label, value, share }: { dot: string; label: string; value: string; share: number }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 truncate text-xs text-slate-500">
        <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
        {label}
      </dt>
      <dd className="mt-0.5 truncate text-[15px] font-medium tabular-nums">
        {value} <span className="text-xs font-normal text-slate-400">{share}%</span>
      </dd>
    </div>
  )
}

function MovementsCard({
  movements,
  loading,
  error,
  onRetry,
  money,
}: {
  movements: CashMovement[] | null
  loading: boolean
  error: string | null
  onRetry: () => void
  money: Money
}) {
  const list = movements ?? []
  const net = list.reduce((sum, movement) => sum + (movement.type === 'Cash in' ? movement.amount : -movement.amount), 0)

  return (
    <section aria-labelledby="movements-title" className={CARD}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="movements-title" className="text-base font-semibold">
          Cash in & out
          {list.length > 0 && <span className="ml-1.5 text-sm font-normal text-slate-400">{list.length}</span>}
        </h2>
        {list.length > 0 && (
          <p className="shrink-0 text-sm tabular-nums text-slate-500">
            Net{' '}
            <span className={`font-medium ${net < 0 ? 'text-rose-700' : net > 0 ? 'text-[#1F5E3B]' : 'text-[#091413]'}`}>
              {net > 0 ? '+' : net < 0 ? '−' : ''}
              {money(Math.abs(net))}
            </span>
          </p>
        )}
      </div>

      {loading && !movements && (
        <div className="py-8">
          <Spinner />
        </div>
      )}

      {error && (movements ? <RetryBanner message="Couldn’t refresh the cash log." onRetry={onRetry} /> : <div className="mt-3"><ErrorState message={error} onRetry={onRetry} /></div>)}

      {movements && list.length === 0 && (
        <div className="mt-3 rounded-2xl bg-[#F6F8F7] px-4 py-5 text-center">
          <p className="text-sm font-medium">Nothing added or taken out yet</p>
          <p className="mx-auto mt-1 max-w-xs text-xs text-slate-500">
            Use Cash in for float top-ups, and Cash out for bank deposits or payouts.
          </p>
        </div>
      )}

      {list.length > 0 && (
        <ul className="mt-2 divide-y divide-slate-100">
          {list.map((movement) => {
            const isIn = movement.type === 'Cash in'
            return (
              <li key={movement.id} className="flex min-h-14 items-center gap-3 py-2.5">
                <span
                  aria-hidden="true"
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                    isIn ? 'bg-[#E6F1EA] text-[#1F5E3B]' : 'bg-rose-50 text-rose-600'
                  }`}
                >
                  {isIn ? <ArrowDown size={12} /> : <ArrowUp size={12} />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px]">{movement.reason}</p>
                  <p className="truncate text-xs text-slate-500">
                    {formatTime(movement.createdAt)} · {movement.createdBy}
                  </p>
                </div>
                <p className={`shrink-0 text-[15px] font-medium tabular-nums ${isIn ? 'text-[#1F5E3B]' : 'text-rose-700'}`}>
                  <span className="sr-only">{movement.type} </span>
                  {isIn ? '+' : '−'}
                  {money(movement.amount)}
                </p>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function RetryBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="mt-3 flex items-center gap-3 rounded-2xl bg-rose-50 py-1 pl-4 pr-1 text-sm text-rose-700">
      <span className="min-w-0 flex-1">{message}</span>
      <button type="button" onClick={onRetry} className="h-11 shrink-0 rounded-full px-4 font-medium hover:bg-rose-100">
        Retry
      </button>
    </div>
  )
}

/* ------------------------------------------------------------------
   NO OPEN SHIFT
------------------------------------------------------------------ */

function NoShift({ money, lastClosed, onStarted }: { money: Money; lastClosed: Shift | null; onStarted: (shift: Shift) => void }) {
  return (
    <div className="grid grid-cols-1 gap-5 @4xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] @4xl:items-start">
      {/* Right after closing, the result is what the cashier wants to see first */}
      {lastClosed && <ClosedShiftCard shift={lastClosed} money={money} />}
      <StartShiftCard money={money} compact={!!lastClosed} onStarted={onStarted} />
      {!lastClosed && <HowShiftsWork />}
    </div>
  )
}

function StartShiftCard({ money, compact, onStarted }: { money: Money; compact: boolean; onStarted: (shift: Shift) => void }) {
  const { user } = useAuth()
  const { notify } = useToast()
  const { settings } = useSettings()
  const [startingCash, setStartingCash] = useState('')
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Focusing the field on a touch screen throws the keyboard over the quick amounts.
  const [autoFocus] = useState(() => !compact && window.matchMedia?.('(pointer: fine)').matches)

  async function start() {
    if (starting) return
    const amount = Number(startingCash)
    if (!startingCash.trim() || !Number.isFinite(amount) || amount < 0) {
      setError('Enter the starting cash amount.')
      return
    }
    setError(null)
    setStarting(true)
    try {
      const started = await shiftApi.start({ startingCash: amount })
      notify(`Shift started with ${money(amount)} in the drawer.`)
      onStarted(started)
    } catch (err) {
      setError(getErrorMessage(err))
      setStarting(false)
    }
  }

  return (
    <section aria-labelledby="start-title" className={CARD}>
      <div className="flex items-center gap-3">
        {user && <Avatar name={user.fullName} />}
        <div className="min-w-0">
          <h2 id="start-title" className="text-base font-semibold">
            {compact ? 'Start the next shift' : 'Start your shift'}
          </h2>
          <p className="truncate text-sm text-slate-500">{user?.fullName ?? 'Count the cash in your drawer first.'}</p>
        </div>
      </div>

      <form
        className="mt-5 space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          void start()
        }}
      >
        <TextField
          label="Starting cash"
          prefix={settings.currencySymbol}
          amount
          value={startingCash}
          onChange={(value) => {
            setStartingCash(value)
            setError(null)
          }}
          error={error ?? undefined}
          hint="The cash in the drawer before your first sale."
          autoFocus={autoFocus}
          placeholder="0.00"
          disabled={starting}
        />

        <div role="group" aria-label="Quick amounts" className="flex flex-wrap gap-2">
          {QUICK_FLOATS.map((value) => {
            const selected = startingCash !== '' && Number(startingCash) === value
            return (
              <button
                key={value}
                type="button"
                aria-pressed={selected}
                disabled={starting}
                onClick={() => {
                  setStartingCash(String(value))
                  setError(null)
                }}
                className={`h-11 rounded-full px-4 text-sm font-medium tabular-nums transition active:scale-95 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B] ${
                  selected ? 'bg-[#1F5E3B] text-white' : 'bg-[#F3F5F4] text-[#091413] hover:bg-[#E9EEEB]'
                }`}
              >
                {settings.currencySymbol}
                {value.toLocaleString()}
              </button>
            )
          })}
        </div>

        <PrimaryButton type="submit" disabled={starting} className="w-full">
          {starting ? 'Starting…' : 'Start shift'}
        </PrimaryButton>
      </form>
    </section>
  )
}

function ClosedShiftCard({ shift, money }: { shift: Shift; money: Money }) {
  return (
    <section aria-labelledby="closed-title" className={CARD}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="closed-title" className="text-base font-semibold">
            Shift closed
          </h2>
          <p className="mt-0.5 text-sm text-slate-500">
            {formatDayLabel(shift.startedAt)} · {shiftTimeLine(shift)}
          </p>
        </div>
        <VarianceTag shift={shift} money={money} />
      </div>
      <div className="mt-5">
        <ShiftDetails shift={shift} money={money} />
      </div>
    </section>
  )
}

const STEPS: { title: string; body: string }[] = [
  { title: 'Count your starting cash', body: 'Enter what’s in the drawer before your first sale.' },
  { title: 'Sell as usual', body: 'Cash sales, refunds and cash in or out keep the expected cash up to date.' },
  { title: 'Count and close', body: 'At the end, count the drawer. Any shortage or overage is recorded.' },
]

function HowShiftsWork() {
  return (
    <section aria-labelledby="how-title" className={CARD}>
      <h2 id="how-title" className="text-base font-semibold">
        How a shift works
      </h2>
      <ol className="mt-4 space-y-4">
        {STEPS.map((step, index) => (
          <li key={step.title} className="flex gap-3">
            <span
              aria-hidden="true"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#E6F1EA] text-xs font-semibold text-[#1F5E3B]"
            >
              {index + 1}
            </span>
            <div className="min-w-0 pt-0.5">
              <p className="text-sm font-medium">{step.title}</p>
              <p className="mt-0.5 text-sm text-slate-500">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}

/* ------------------------------------------------------------------
   DIALOGS
------------------------------------------------------------------ */

function CashMovementDialog({
  type,
  available,
  money,
  onClose,
  onSaved,
}: {
  type: 'in' | 'out'
  /** Cash expected in the drawer, shown as the most that can be taken out. */
  available: number | null
  money: Money
  onClose: () => void
  onSaved: () => void
}) {
  const { notify } = useToast()
  const { settings } = useSettings()
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [amountError, setAmountError] = useState<string | null>(null)
  const [reasonError, setReasonError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Android back closes the dialog instead of leaving the page.
  const { close } = useDismissOnBack('cashMovementOpen', onClose, busy)

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
      close()
      onSaved()
    } catch (err) {
      setAmountError(getErrorMessage(err))
      setBusy(false)
    }
  }

  return (
    <Modal
      title={type === 'in' ? 'Cash in' : 'Cash out'}
      description={type === 'in' ? 'Cash added to the drawer.' : 'Cash taken out of the drawer.'}
      onClose={close}
      preventClose={busy}
      size="sm"
      footer={
        <div className="flex w-full items-center justify-end gap-2">
          <TextButton onClick={close} disabled={busy} className="h-12">
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
          hint={type === 'out' && available !== null ? `The drawer should have ${money(available)}.` : undefined}
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

function EndShiftDialog({
  shift,
  money,
  onClose,
  onEnded,
}: {
  shift: Shift
  money: Money
  onClose: () => void
  onEnded: (closed: Shift) => void
}) {
  const { notify } = useToast()
  const { settings } = useSettings()
  const { data: preview, loading, error, reload } = useAsync(() => shiftApi.summary(), [shift.id])

  const [actualCash, setActualCash] = useState('')
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const { close } = useDismissOnBack('endShiftOpen', onClose, busy)

  const actualValue = actualCash.trim() ? Number(actualCash) : null
  const expected = preview?.summary.expectedCash ?? null
  const difference = expected !== null && actualValue !== null && Number.isFinite(actualValue) ? actualValue - expected : null

  async function confirmEnd() {
    if (busy) return
    if (actualValue === null || !Number.isFinite(actualValue) || actualValue < 0) {
      setFormError('Enter the cash you counted.')
      return
    }
    setFormError(null)
    setBusy(true)
    try {
      const closed = await shiftApi.end({ actualCash: actualValue })
      notify('Shift closed.')
      close()
      onEnded(closed)
    } catch (err) {
      setFormError(getErrorMessage(err))
      setBusy(false)
    }
  }

  return (
    <Modal
      title="End shift"
      description={`Started ${startedLabel(shift)} · ${formatDuration(shift.startedAt)}`}
      onClose={close}
      preventClose={busy}
      size="md"
      footer={
        <div className="flex w-full items-center justify-end gap-2">
          <TextButton onClick={close} disabled={busy} className="h-12">
            Keep shift open
          </TextButton>
          <PrimaryButton onClick={() => void confirmEnd()} disabled={busy || !preview} className="h-12 flex-none px-8">
            {busy ? 'Closing…' : 'Close shift'}
          </PrimaryButton>
        </div>
      }
    >
      {loading && !preview && (
        <div className="py-10">
          <Spinner />
        </div>
      )}

      {!loading && error && <ErrorState message={error} onRetry={() => void reload()} />}

      {preview && (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            void confirmEnd()
          }}
        >
          <div className="rounded-2xl bg-[#F2F8F4] px-4 py-4">
            <p className="text-sm font-medium text-[#1F5E3B]">Expected in drawer</p>
            <p className="mt-1 text-[28px] font-bold leading-none tracking-[-0.02em] tabular-nums">{money(preview.summary.expectedCash)}</p>
          </div>

          <TextField
            label="Cash you counted"
            prefix={settings.currencySymbol}
            amount
            value={actualCash}
            onChange={(value) => {
              setActualCash(value)
              setFormError(null)
            }}
            error={formError ?? undefined}
            hint="Count every bill and coin in the drawer."
            autoFocus
            placeholder="0.00"
            disabled={busy}
          />

          {difference !== null && <VarianceCallout difference={difference} money={money} />}

          <details className="group rounded-2xl bg-[#F6F8F7] px-4">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-slate-600 [&::-webkit-details-marker]:hidden">
              How expected cash is worked out
              <ChevronRight size={11} className="text-slate-400 transition-transform group-open:rotate-90" />
            </summary>
            <DrawerLedger summary={preview.summary} money={money} className="border-t border-slate-200/70 pb-1" />
          </details>
        </form>
      )}
    </Modal>
  )
}

function VarianceCallout({ difference, money }: { difference: number; money: Money }) {
  const balanced = Math.abs(difference) < 0.005
  const tone = balanced ? 'bg-[#F2F8F4] text-[#1F5E3B]' : difference > 0 ? 'bg-amber-50 text-amber-800' : 'bg-rose-50 text-rose-700'
  let title: ReactNode = 'Drawer balanced'
  if (!balanced) title = difference > 0 ? `Over by ${money(difference)}` : `Short by ${money(Math.abs(difference))}`

  return (
    <div role="status" aria-live="polite" className={`rounded-2xl px-4 py-3 ${tone}`}>
      <p className="text-[15px] font-semibold tabular-nums">{title}</p>
      <p className="mt-0.5 text-sm opacity-90">
        {balanced ? 'Your count matches the expected cash.' : 'Recount if you can. You can still close — the difference is saved to Shift History.'}
      </p>
    </div>
  )
}

export default ShiftPage
