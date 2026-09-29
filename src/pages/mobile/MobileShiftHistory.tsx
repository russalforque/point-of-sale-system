import { useState } from 'react'

import {
  Avatar,
  EmptyBlock,
  ErrorBlock,
  LoadingBlock,
  PageHeader,
  RowButton,
  SearchField,
  Segmented,
  Sheet,
  SheetBody,
  SheetHeader,
} from '../../components/ui/MobileKit'
import { Pagination } from '../../components/ui/Pagination'
import { useDismissOnBack } from '../../hooks/useDismissOnBack'
import type { Shift } from '../../types'
import { formatDayLabel } from '../../utils/format'
import { STATUS_OPTIONS, ShiftDetails, VarianceTag, shiftTimeLine, useShiftHistory } from '../Shift/shiftHistory'

/** Consecutive shifts that started on the same day (the list is already newest first). */
function groupByDay(shifts: Shift[]): { day: string; shifts: Shift[] }[] {
  const groups: { day: string; shifts: Shift[] }[] = []
  for (const shift of shifts) {
    const day = formatDayLabel(shift.startedAt)
    const last = groups[groups.length - 1]
    if (last && last.day === day) last.shifts.push(shift)
    else groups.push({ day, shifts: [shift] })
  }
  return groups
}

/**
 * Phone layout: a day-grouped list where each row answers "who, when, and did the
 * drawer balance?" at a glance; tapping a row opens the full cash summary in a sheet.
 */
export function MobileShiftHistory() {
  const { money, search, setSearch, status, setStatus, setPage, q, data, items, loading, error, reload, isFirstLoad, hasFilters, clearFilters } =
    useShiftHistory()
  const [selected, setSelected] = useState<Shift | null>(null)

  const total = data?.totalCount

  return (
    <div className="flex min-h-full flex-col bg-white text-[#091413] antialiased">
      <PageHeader
        title="Shift History"
        subtitle={total !== undefined ? `${total} ${total === 1 ? 'shift' : 'shifts'}${hasFilters ? ' found' : ''}` : 'Employee shifts and cash counts'}
      >
        <SearchField value={search} onChange={setSearch} placeholder="Search by employee" label="Search shifts" />
        <Segmented label="Shift status" value={status} onChange={setStatus} options={STATUS_OPTIONS} />
      </PageHeader>

      <main className="flex-1 px-5 pb-6">
        {isFirstLoad && <LoadingBlock />}

        {!loading && error && !data && <ErrorBlock message={error} onRetry={() => void reload()} />}

        {/* A failed refresh keeps the last list on screen */}
        {error && data && (
          <div role="alert" className="mt-2 flex items-center gap-3 rounded-2xl bg-rose-50 py-1 pl-4 pr-1 text-sm text-rose-700">
            <span className="min-w-0 flex-1">Couldn’t refresh. Showing the last loaded shifts.</span>
            <button
              type="button"
              onClick={() => void reload()}
              disabled={loading}
              className="h-11 shrink-0 rounded-full px-4 font-medium active:bg-rose-100 disabled:opacity-50"
            >
              {loading ? 'Retrying…' : 'Retry'}
            </button>
          </div>
        )}

        {!loading && !error && items.length === 0 && (
          <EmptyBlock
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
            <div className={`transition-opacity ${loading ? 'opacity-60' : ''}`}>
              {groupByDay(items).map((group) => (
                <section key={group.day} aria-label={group.day}>
                  <h2 className="pb-1 pt-5 text-xs font-semibold uppercase tracking-wide text-slate-500">{group.day}</h2>
                  <ul>
                    {group.shifts.map((shift) => (
                      <li key={shift.id} className="border-b border-slate-100 last:border-b-0">
                        <RowButton onClick={() => setSelected(shift)}>
                          <Avatar name={shift.employeeName} />

                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[15px] font-medium">{shift.employeeName}</p>
                            <p className="mt-0.5 truncate text-xs text-slate-500">{shiftTimeLine(shift)}</p>
                          </div>

                          <div className="flex shrink-0 flex-col items-end gap-1">
                            <VarianceTag shift={shift} money={money} />
                            {shift.totalSales !== null && (
                              <p className="text-xs tabular-nums text-slate-500">{money(shift.totalSales)} sales</p>
                            )}
                          </div>
                        </RowButton>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>

            {(data?.totalPages ?? 1) > 1 && (
              <div className="pt-4">
                <Pagination page={data?.page ?? 1} totalPages={data?.totalPages ?? 1} onPage={setPage} />
              </div>
            )}
          </>
        )}
      </main>

      {selected && <ShiftSheet shift={selected} money={money} onClose={() => setSelected(null)} />}
    </div>
  )
}

function ShiftSheet({ shift, money, onClose }: { shift: Shift; money: (value: number) => string; onClose: () => void }) {
  // Android back closes the sheet instead of leaving the page.
  const { close } = useDismissOnBack('shiftDetailOpen', onClose)

  return (
    <Sheet label={`${shift.employeeName} shift`} onClose={close}>
      <SheetHeader
        title={shift.employeeName}
        subtitle={`${formatDayLabel(shift.startedAt)} · ${shiftTimeLine(shift)}`}
        leading={<Avatar name={shift.employeeName} />}
        onClose={close}
      />
      <SheetBody>
        <div className="pb-[env(safe-area-inset-bottom,0px)]">
          <ShiftDetails shift={shift} money={money} />
        </div>
      </SheetBody>
    </Sheet>
  )
}

export default MobileShiftHistory
