import { useEffect, useState, type KeyboardEvent } from 'react'

import { ChevronRight } from '../../components/ui/Icons'
import {
  DataCard,
  DesktopPage,
  DesktopSearch,
  EmptyRow,
  ErrorRow,
  FilterPills,
  LoadingRow,
  Th,
  Toolbar,
} from '../../components/ui/DesktopKit'
import { Avatar } from '../../components/ui/MobileKit'
import { Modal } from '../../components/ui/Modal'
import { Pagination } from '../../components/ui/Pagination'
import { useDismissOnBack } from '../../hooks/useDismissOnBack'
import { useElementWidth } from '../../hooks/useElementWidth'
import { useIsMobile } from '../../hooks/useIsMobile'
import type { Shift } from '../../types'
import { formatDayLabel, formatDuration, formatTime } from '../../utils/format'
import { MobileShiftHistory } from '../mobile/MobileShiftHistory'
import {
  LONG_SHIFT_HOURS,
  STATUS_OPTIONS,
  ShiftDetails,
  VarianceTag,
  groupByDay,
  hoursOpen,
  shiftTimeLine,
  useOnShiftNow,
  useShiftHistory,
} from './shiftHistory'

type Money = (value: number) => string

/** Page width (px) from which the detail sits beside the list instead of opening in a dialog. */
const SPLIT_MIN_WIDTH = 900

/**
 * Visible table columns at a given list width — mirrors the @lg/list (32rem) and
 * @3xl/list (48rem) breakpoints below. Day header rows need the exact count: hidden
 * cells don't create columns, so a larger colSpan would add phantom columns.
 */
function columnCount(listWidth: number, split: boolean): number {
  return 2 + (listWidth >= 512 ? 1 : 0) + (listWidth >= 768 ? 2 : 0) + (split ? 0 : 1)
}

export function ShiftHistoryPage() {
  const isMobile = useIsMobile()
  return isMobile ? <MobileShiftHistory /> : <DesktopShiftHistory />
}

/**
 * Tablet / desktop layout.
 * - Landscape (page ≥ 900px): master–detail. The list stays put and the selected shift's
 *   cash summary sits in a sticky panel beside it, so a manager can walk the list without
 *   opening and closing dialogs.
 * - Portrait: the list takes the full width and a shift opens in a dialog.
 * Rows are grouped by day (like the phone list); money columns appear as the list gets
 * wider (container queries), and the cash difference — the thing managers scan for — is
 * always visible.
 */
function DesktopShiftHistory() {
  const { money, search, setSearch, status, setStatus, setPage, q, data, items, loading, error, reload, isFirstLoad, hasFilters, clearFilters } =
    useShiftHistory()
  const onShift = useOnShiftNow(true)

  const [bodyRef, width] = useElementWidth<HTMLDivElement>()
  const split = width >= SPLIT_MIN_WIDTH
  const [listRef, listWidth] = useElementWidth<HTMLDivElement>()
  const [picked, setPicked] = useState<Shift | null>(null)

  // A new search, filter or page starts the panel back at the top row.
  const page = data?.page
  useEffect(() => {
    setPicked(null)
  }, [q, status, page])

  // Turning the tablet to portrait drops the side panel; don't pop a dialog nobody asked for.
  useEffect(() => {
    if (!split) setPicked(null)
  }, [split])

  const panelShift = split ? picked ?? items[0] ?? null : null
  const total = data?.totalCount
  const showOnShift = !hasFilters && onShift.items.length > 0

  return (
    <DesktopPage
      title="Shift History"
      maxWidth="max-w-7xl"
      subtitle={
        total !== undefined
          ? `${total} ${total === 1 ? 'shift' : 'shifts'}${hasFilters ? ' match these filters' : ''}`
          : 'Every employee shift, with its closing cash summary.'
      }
    >
      <div ref={bodyRef}>
        {showOnShift && (
          <OnShiftNow
            shifts={onShift.items}
            total={onShift.total}
            activeId={panelShift?.id ?? null}
            onSelect={setPicked}
          />
        )}

        <Toolbar>
          <DesktopSearch
            value={search}
            onChange={setSearch}
            placeholder="Search by employee"
            label="Search shifts"
            className="min-w-0 max-w-md flex-1 basis-60"
          />
          <FilterPills label="Shift status" value={status} onChange={setStatus} options={STATUS_OPTIONS} />
        </Toolbar>

        <div className={`mt-4 ${split ? 'flex items-start gap-5' : ''}`}>
          <div className="min-w-0 flex-1">
            {/* A failed refresh keeps the last page on screen */}
            {error && data && (
              <div role="alert" className="mb-4 flex items-center gap-3 rounded-2xl bg-rose-50 py-1 pl-4 pr-1 text-sm text-rose-700">
                <span className="min-w-0 flex-1">Couldn’t refresh. Showing the last loaded shifts.</span>
                <button
                  type="button"
                  onClick={() => void reload()}
                  disabled={loading}
                  className="h-11 shrink-0 rounded-full px-4 font-medium hover:bg-rose-100 disabled:opacity-50"
                >
                  {loading ? 'Retrying…' : 'Retry'}
                </button>
              </div>
            )}

            <DataCard className="@container/list">
              <div ref={listRef}>
              {isFirstLoad && <LoadingRow />}

              {!loading && error && !data && <ErrorRow message={error} onRetry={() => void reload()} />}

              {!loading && !error && items.length === 0 && (
                <EmptyRow
                  title={hasFilters ? 'No shifts found' : 'No shifts yet'}
                  hint={
                    q
                      ? `No employee matches “${q}”.`
                      : hasFilters
                      ? 'No shifts have this status.'
                      : 'Shifts appear here once an employee starts one.'
                  }
                  actionLabel={hasFilters ? 'Clear filters' : undefined}
                  onAction={hasFilters ? clearFilters : undefined}
                  secondary
                />
              )}

              {items.length > 0 && (
                <>
                  <ShiftTable
                    shifts={items}
                    money={money}
                    split={split}
                    columns={columnCount(listWidth, split)}
                    activeId={panelShift?.id ?? null}
                    dimmed={loading}
                    onSelect={setPicked}
                  />
                  {(data?.totalPages ?? 1) > 1 && (
                    <div className="border-t border-slate-100 px-6 py-3">
                      <Pagination page={data?.page ?? 1} totalPages={data?.totalPages ?? 1} onPage={setPage} />
                    </div>
                  )}
                </>
              )}
              </div>
            </DataCard>
          </div>

          {split && (
            <aside aria-label="Shift details" className="sticky top-4 w-[360px] shrink-0">
              {panelShift ? (
                <ShiftPanel shift={panelShift} money={money} />
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-200 px-6 py-16 text-center text-sm text-slate-500">
                  Select a shift to see its cash summary.
                </div>
              )}
            </aside>
          )}
        </div>
      </div>

      {!split && picked && <ShiftDialog shift={picked} money={money} onClose={() => setPicked(null)} />}
    </DesktopPage>
  )
}

/* ------------------------------------------------------------------
   ON SHIFT NOW — who is working, and which drawers were never closed
------------------------------------------------------------------ */

function OnShiftNow({
  shifts,
  total,
  activeId,
  onSelect,
}: {
  shifts: Shift[]
  total: number
  activeId: number | null
  onSelect: (shift: Shift) => void
}) {
  const now = Date.now()
  return (
    <section aria-labelledby="on-shift-title" className="mt-6">
      <h2 id="on-shift-title" className="flex items-baseline gap-2 text-sm font-semibold">
        On shift now
        <span className="font-normal tabular-nums text-slate-400">{total}</span>
      </h2>
      <ul className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">
        {shifts.map((shift) => {
          const hours = hoursOpen(shift, now)
          const stale = hours >= LONG_SHIFT_HOURS
          const active = shift.id === activeId
          return (
            <li key={shift.id}>
              <button
                type="button"
                onClick={() => onSelect(shift)}
                aria-current={active || undefined}
                className={`flex min-h-[68px] w-full items-center gap-3 rounded-2xl bg-white py-3 pl-3 pr-4 text-left ring-1 transition active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B] ${
                  active ? 'ring-[#1F5E3B]/40' : stale ? 'ring-amber-200 hover:ring-amber-300' : 'ring-slate-100 hover:ring-slate-200'
                }`}
              >
                <span className="relative shrink-0">
                  <Avatar name={shift.employeeName} />
                  <span
                    aria-hidden="true"
                    className={`absolute bottom-0 right-0 h-3 w-3 rounded-full ring-2 ring-white ${stale ? 'bg-amber-500' : 'bg-[#1F5E3B]'}`}
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium">{shift.employeeName}</span>
                  <span className={`block truncate text-xs ${stale ? 'font-medium text-amber-700' : 'text-slate-500'}`}>
                    {stale
                      ? `Open ${Math.floor(hours)}h — not closed?`
                      : `Since ${formatTime(shift.startedAt)} · ${formatDuration(shift.startedAt)}`}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/* ------------------------------------------------------------------
   LIST
------------------------------------------------------------------ */

function ShiftTable({
  shifts,
  money,
  split,
  columns,
  activeId,
  dimmed,
  onSelect,
}: {
  shifts: Shift[]
  money: Money
  split: boolean
  columns: number
  activeId: number | null
  dimmed: boolean
  onSelect: (shift: Shift) => void
}) {
  function handleRowKeyDown(event: KeyboardEvent<HTMLTableRowElement>, shift: Shift) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSelect(shift)
    }
  }

  return (
    <table className={`w-full table-fixed text-left text-sm transition-opacity ${dimmed ? 'opacity-60' : ''}`}>
      <thead className="text-xs text-slate-500">
        <tr>
          <Th className="pl-6">Employee</Th>
          <Th align="right" className="hidden w-32 @lg/list:table-cell">
            Total sales
          </Th>
          <Th align="right" className="hidden w-32 @3xl/list:table-cell">
            Expected
          </Th>
          <Th align="right" className="hidden w-32 @3xl/list:table-cell">
            Counted
          </Th>
          <Th align="right" className={`w-40 ${split ? 'pr-6' : ''}`}>
            Cash difference
          </Th>
          {!split && (
            <Th className="w-10 pr-4">
              <span className="sr-only">Open</span>
            </Th>
          )}
        </tr>
      </thead>

      {groupByDay(shifts).map((group) => {
        const daySales = group.shifts.reduce((sum, shift) => sum + (shift.totalSales ?? 0), 0)
        return (
          <tbody key={group.day} className="divide-y divide-slate-100 border-t border-slate-100">
            <tr className="bg-[#FAFBFA]">
              <th colSpan={columns} scope="colgroup" className="px-6 py-2 font-normal">
                <div className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="font-semibold uppercase tracking-wide text-slate-500">{group.day}</span>
                  <span className="truncate tabular-nums text-slate-400">
                    {group.shifts.length} {group.shifts.length === 1 ? 'shift' : 'shifts'}
                    {daySales > 0 && ` · ${money(daySales)} sales`}
                  </span>
                </div>
              </th>
            </tr>

            {group.shifts.map((shift) => {
              const active = shift.id === activeId
              return (
                <tr
                  key={shift.id}
                  tabIndex={0}
                  onClick={() => onSelect(shift)}
                  onKeyDown={(event) => handleRowKeyDown(event, shift)}
                  aria-current={active || undefined}
                  aria-label={`${shift.employeeName}, ${group.day}, ${shiftTimeLine(shift)}. View cash summary`}
                  className={`group cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#1F5E3B] ${
                    active ? 'bg-[#F2F8F4]' : 'hover:bg-slate-50'
                  }`}
                >
                  <td className="relative py-3 pl-6 pr-3">
                    {active && <span aria-hidden="true" className="absolute inset-y-2 left-0 w-1 rounded-r-full bg-[#1F5E3B]" />}
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="hidden @md/list:contents">
                        <Avatar name={shift.employeeName} />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-medium">{shift.employeeName}</p>
                        <p className="mt-0.5 truncate text-xs text-slate-500">{shiftTimeLine(shift)}</p>
                      </div>
                    </div>
                  </td>
                  <MoneyCell value={shift.totalSales} money={money} className="hidden @lg/list:table-cell" />
                  <MoneyCell value={shift.expectedCash} money={money} className="hidden @3xl/list:table-cell" />
                  <MoneyCell value={shift.actualCash} money={money} className="hidden @3xl/list:table-cell" />
                  <td className={`py-3 pl-3 text-right ${split ? 'pr-6' : 'pr-3'}`}>
                    <VarianceTag shift={shift} money={money} />
                    {/* Narrow lists: total sales folds under the tag */}
                    {shift.totalSales !== null && (
                      <p className="mt-1 text-xs tabular-nums text-slate-500 @lg/list:hidden">{money(shift.totalSales)} sales</p>
                    )}
                  </td>
                  {!split && (
                    <td className="py-3 pl-1 pr-4 text-slate-300 transition-colors group-hover:text-slate-500">
                      <ChevronRight size={12} />
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        )
      })}
    </table>
  )
}

function MoneyCell({ value, money, className = '' }: { value: number | null; money: Money; className?: string }) {
  return (
    <td className={`px-3 py-3 text-right tabular-nums ${value === null ? 'text-slate-400' : ''} ${className}`}>
      {value === null ? '—' : money(value)}
    </td>
  )
}

/* ------------------------------------------------------------------
   DETAIL — side panel (landscape) or dialog (portrait)
------------------------------------------------------------------ */

function ShiftPanel({ shift, money }: { shift: Shift; money: Money }) {
  return (
    <div className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden rounded-2xl bg-white ring-1 ring-slate-100">
      <header className="flex shrink-0 items-center gap-3 border-b border-slate-100 px-5 py-4">
        <Avatar name={shift.employeeName} />
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold">{shift.employeeName}</h2>
          <p className="truncate text-sm text-slate-500">
            {formatDayLabel(shift.startedAt)} · {shiftTimeLine(shift)}
          </p>
        </div>
      </header>
      {/* Keyed so switching shifts starts the panel at the top */}
      <div key={shift.id} className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        <ShiftDetails shift={shift} money={money} />
      </div>
    </div>
  )
}

function ShiftDialog({ shift, money, onClose }: { shift: Shift; money: Money; onClose: () => void }) {
  // Android back closes the dialog instead of leaving the page.
  const { close } = useDismissOnBack('shiftDetailOpen', onClose)
  return (
    <Modal title={shift.employeeName} description={`${formatDayLabel(shift.startedAt)} · ${shiftTimeLine(shift)}`} onClose={close} size="md">
      <ShiftDetails shift={shift} money={money} />
    </Modal>
  )
}

export default ShiftHistoryPage
