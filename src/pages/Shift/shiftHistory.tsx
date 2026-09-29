import { useEffect, useState, type ReactNode } from 'react'

import { shiftApi } from '../../api/shiftApi'
import { Check } from '../../components/ui/Icons'
import { useSettings } from '../../context/SettingsContext'
import { useAsync } from '../../hooks/useAsync'
import { useDebounced } from '../../hooks/useDebounced'
import type { Shift } from '../../types'
import { formatDateTime, formatDuration, formatMoney, formatTime } from '../../utils/format'

/**
 * Shared pieces of the Shift History screen. The phone list and the tablet/desktop
 * table render the same data, the same variance language and the same detail view.
 */

export type StatusFilter = '' | 'open' | 'closed'

const PAGE_SIZE = 20

export const STATUS_OPTIONS: { key: StatusFilter; label: string }[] = [
  { key: '', label: 'All' },
  { key: 'open', label: 'Open' },
  { key: 'closed', label: 'Closed' },
]

/** Search + status filter + paging over `shiftApi.history` (query unchanged). */
export function useShiftHistory() {
  const { settings } = useSettings()
  const money = (value: number) => formatMoney(value, settings.currencySymbol)

  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('')
  const [page, setPage] = useState(1)
  const q = useDebounced(search).trim()

  const { data, loading, error, reload } = useAsync(
    () =>
      shiftApi.history({
        employeeName: q || undefined,
        status: status || undefined,
        page,
        pageSize: PAGE_SIZE,
      }),
    [q, status, page],
  )

  useEffect(() => {
    setPage(1)
  }, [q, status])

  return {
    money,
    search,
    setSearch,
    status,
    setStatus,
    setPage,
    q,
    data,
    items: data?.items ?? [],
    loading,
    error,
    reload,
    isFirstLoad: loading && !data,
    hasFilters: q !== '' || status !== '',
    clearFilters: () => {
      setSearch('')
      setStatus('')
    },
  }
}

/* ------------------------------------------------------------------
   VARIANCE — the one thing a manager scans this screen for
------------------------------------------------------------------ */

type Variance =
  | { kind: 'open' }
  | { kind: 'uncounted' }
  | { kind: 'balanced' }
  | { kind: 'over' | 'short'; amount: number }

export function varianceOf(shift: Shift): Variance {
  if (shift.status === 'Open') return { kind: 'open' }
  if (shift.difference === null) return { kind: 'uncounted' }
  if (Math.abs(shift.difference) < 0.005) return { kind: 'balanced' }
  return shift.difference > 0
    ? { kind: 'over', amount: shift.difference }
    : { kind: 'short', amount: Math.abs(shift.difference) }
}

export function varianceText(variance: Variance, money: (value: number) => string): string {
  switch (variance.kind) {
    case 'open':
      return 'On shift'
    case 'uncounted':
      return 'Not counted'
    case 'balanced':
      return 'Balanced'
    case 'over':
      return `Over ${money(variance.amount)}`
    case 'short':
      return `Short ${money(variance.amount)}`
  }
}

/**
 * Exceptions get colour, the normal case stays quiet: short = red, over = amber,
 * balanced = neutral with a check, open = brand green with a live dot. The words
 * always carry the meaning on their own.
 */
export function VarianceTag({ shift, money }: { shift: Shift; money: (value: number) => string }) {
  const variance = varianceOf(shift)
  const tone = {
    open: 'bg-[#E6F1EA] text-[#1F5E3B]',
    uncounted: 'bg-slate-100 text-slate-500',
    balanced: 'text-slate-500',
    over: 'bg-amber-50 text-amber-800',
    short: 'bg-rose-50 text-rose-700',
  }[variance.kind]

  return (
    <span
      className={`inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-semibold tabular-nums ${tone}`}
    >
      {variance.kind === 'open' && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[#1F5E3B]" />}
      {variance.kind === 'balanced' && <Check size={10} />}
      {varianceText(variance, money)}
    </span>
  )
}

/** "8:02 AM – 4:15 PM · 8h 13m", or "Since 8:02 AM · 2h 10m" for a shift still open. */
export function shiftTimeLine(shift: Shift): string {
  const duration = formatDuration(shift.startedAt, shift.endedAt)
  return shift.endedAt
    ? `${formatTime(shift.startedAt)} – ${formatTime(shift.endedAt)} · ${duration}`
    : `Since ${formatTime(shift.startedAt)} · ${duration}`
}

/* ------------------------------------------------------------------
   DETAIL — shared by the phone sheet and the desktop modal
------------------------------------------------------------------ */

export function ShiftDetails({ shift, money }: { shift: Shift; money: (value: number) => string }) {
  const variance = varianceOf(shift)
  // Totals only exist once a shift is closed.
  const amount = (value: number | null) => (value === null ? (variance.kind === 'open' ? null : '—') : money(value))

  const hero = {
    open: { tone: 'bg-[#F2F8F4] text-[#1F5E3B]', label: 'Shift in progress', value: formatDuration(shift.startedAt) },
    uncounted: { tone: 'bg-slate-50 text-slate-500', label: 'Cash difference', value: 'Not counted' },
    balanced: { tone: 'bg-[#F2F8F4] text-[#1F5E3B]', label: 'Cash difference', value: 'Balanced' },
    over: { tone: 'bg-amber-50 text-amber-800', label: 'Drawer is over by', value: variance.kind === 'over' ? money(variance.amount) : '' },
    short: { tone: 'bg-rose-50 text-rose-700', label: 'Drawer is short by', value: variance.kind === 'short' ? money(variance.amount) : '' },
  }[variance.kind]

  return (
    <div className="space-y-5">
      <div className={`rounded-3xl px-5 py-4 ${hero.tone}`}>
        <p className="text-sm font-medium">{hero.label}</p>
        <p className="mt-1 truncate text-[32px] font-bold leading-none tracking-[-0.02em] tabular-nums text-[#091413]">
          {hero.value}
        </p>
        <p className="mt-2 text-sm text-slate-600">
          {variance.kind === 'open'
            ? 'Sales and cash totals are calculated when the shift is closed.'
            : shift.actualCash !== null && shift.expectedCash !== null
            ? `Counted ${money(shift.actualCash)} · expected ${money(shift.expectedCash)}`
            : 'No closing count was recorded.'}
        </p>
      </div>

      <DetailSection title="Cash drawer">
        <Row label="Starting cash" value={money(shift.startingCash)} />
        <Row label="Cash sales" value={amount(shift.cashSales)} />
        {!!shift.cashRefunds && <Row label="Cash refunds" value={`−${money(shift.cashRefunds)}`} />}
        {!!shift.cashIn && <Row label="Cash in" value={`+${money(shift.cashIn)}`} />}
        {!!shift.cashOut && <Row label="Cash out" value={`−${money(shift.cashOut)}`} />}
        <Row label="Expected cash" value={amount(shift.expectedCash)} />
        <Row label="Counted cash" value={amount(shift.actualCash)} strong />
        {shift.closedBy && <Row label="Closed by" value={shift.closedBy} />}
      </DetailSection>

      <DetailSection title="Sales">
        <Row label="Cash" value={amount(shift.cashSales)} />
        <Row label="Card, GCash & other" value={amount(shift.nonCashSales)} />
        <Row label="Total sales" value={amount(shift.totalSales)} strong />
      </DetailSection>

      <DetailSection title="Time">
        <Row label="Started" value={formatDateTime(shift.startedAt)} />
        <Row label="Ended" value={shift.endedAt ? formatDateTime(shift.endedAt) : 'Still open'} />
        <Row label="Duration" value={formatDuration(shift.startedAt, shift.endedAt)} />
      </DetailSection>
    </div>
  )
}

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      <dl className="mt-1 divide-y divide-slate-100">{children}</dl>
    </section>
  )
}

function Row({ label, value, strong = false }: { label: string; value: string | null; strong?: boolean }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-4 py-2">
      <dt className="text-sm text-slate-500">{label}</dt>
      <dd
        className={`text-right text-[15px] tabular-nums ${
          value === null ? 'text-slate-400' : strong ? 'font-semibold text-[#091413]' : 'text-[#091413]'
        }`}
      >
        {value ?? 'After close'}
      </dd>
    </div>
  )
}
