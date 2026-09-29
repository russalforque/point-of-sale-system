import { useState, type KeyboardEvent } from 'react'

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
import { useIsMobile } from '../../hooks/useIsMobile'
import type { Shift } from '../../types'
import { formatDayLabel } from '../../utils/format'
import { MobileShiftHistory } from '../mobile/MobileShiftHistory'
import { STATUS_OPTIONS, ShiftDetails, VarianceTag, shiftTimeLine, useShiftHistory } from './shiftHistory'

export function ShiftHistoryPage() {
  const isMobile = useIsMobile()
  return isMobile ? <MobileShiftHistory /> : <DesktopShiftHistory />
}

/**
 * Tablet / desktop layout. The old nine-column table is folded into six: date, start,
 * end and duration read as one "Shift" cell, and status + difference as one "Cash
 * difference" tag. Expected/counted cash only appear on wide screens; every figure is
 * one click away in the detail dialog.
 */
function DesktopShiftHistory() {
  const { money, search, setSearch, status, setStatus, setPage, q, data, items, loading, error, reload, isFirstLoad, hasFilters, clearFilters } =
    useShiftHistory()
  const [selected, setSelected] = useState<Shift | null>(null)

  const total = data?.totalCount

  function handleRowKeyDown(event: KeyboardEvent<HTMLTableRowElement>, shift: Shift) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      setSelected(shift)
    }
  }

  return (
    <DesktopPage
      title="Shift History"
      subtitle={
        total !== undefined
          ? `${total} ${total === 1 ? 'shift' : 'shifts'}${hasFilters ? ' match these filters' : ''} · select a shift for its cash summary`
          : 'Every employee shift, with its closing cash summary.'
      }
    >
      <Toolbar>
        <DesktopSearch value={search} onChange={setSearch} placeholder="Search by employee" label="Search shifts" />
        <FilterPills label="Shift status" value={status} onChange={setStatus} options={STATUS_OPTIONS} />
      </Toolbar>

      {/* A failed refresh keeps the last page on screen */}
      {error && data && (
        <div role="alert" className="mt-4 flex items-center gap-3 rounded-2xl bg-rose-50 py-1 pl-4 pr-1 text-sm text-rose-700">
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

      <DataCard className="mt-4">
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
            <table className={`w-full table-fixed text-left text-sm transition-opacity ${loading ? 'opacity-60' : ''}`}>
              <thead className="border-b border-slate-100 text-xs text-slate-500">
                <tr>
                  <Th className="pl-6 lg:w-[28%]">Employee</Th>
                  <Th className="hidden lg:table-cell">Shift</Th>
                  <Th align="right" className="hidden w-32 lg:table-cell">Total sales</Th>
                  <Th align="right" className="hidden w-32 xl:table-cell">Expected</Th>
                  <Th align="right" className="hidden w-32 xl:table-cell">Counted</Th>
                  <Th align="right" className="w-40">Cash difference</Th>
                  <Th className="w-10 pr-4">
                    <span className="sr-only">Open</span>
                  </Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((shift) => (
                  <tr
                    key={shift.id}
                    tabIndex={0}
                    onClick={() => setSelected(shift)}
                    onKeyDown={(event) => handleRowKeyDown(event, shift)}
                    aria-label={`${shift.employeeName}, ${formatDayLabel(shift.startedAt)}. View cash summary`}
                    className="group cursor-pointer transition-colors hover:bg-slate-50 focus-visible:bg-[#F2F8F4] focus-visible:outline-none"
                  >
                    <td className="py-3 pl-6 pr-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="hidden lg:contents">
                          <Avatar name={shift.employeeName} />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-medium">{shift.employeeName}</p>
                          {/* Portrait tablets: the Shift column folds under the name */}
                          <p className="mt-0.5 truncate text-xs text-slate-500 lg:hidden">
                            {formatDayLabel(shift.startedAt)} · {shiftTimeLine(shift)}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="hidden px-3 py-3 lg:table-cell">
                      <p className="truncate">{formatDayLabel(shift.startedAt)}</p>
                      <p className="mt-0.5 truncate text-xs text-slate-500">{shiftTimeLine(shift)}</p>
                    </td>
                    <MoneyCell value={shift.totalSales} money={money} className="hidden lg:table-cell" />
                    <MoneyCell value={shift.expectedCash} money={money} className="hidden xl:table-cell" />
                    <MoneyCell value={shift.actualCash} money={money} className="hidden xl:table-cell" />
                    <td className="px-3 py-3 text-right">
                      <VarianceTag shift={shift} money={money} />
                      {shift.totalSales !== null && (
                        <p className="mt-1 text-xs tabular-nums text-slate-500 lg:hidden">{money(shift.totalSales)} sales</p>
                      )}
                    </td>
                    <td className="py-3 pl-1 pr-4 text-slate-300 transition-colors group-hover:text-slate-500">
                      <ChevronRight size={12} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {(data?.totalPages ?? 1) > 1 && (
              <div className="border-t border-slate-100 px-6 py-3">
                <Pagination page={data?.page ?? 1} totalPages={data?.totalPages ?? 1} onPage={setPage} />
              </div>
            )}
          </>
        )}
      </DataCard>

      {selected && (
        <Modal
          title={selected.employeeName}
          description={`${formatDayLabel(selected.startedAt)} · ${shiftTimeLine(selected)}`}
          onClose={() => setSelected(null)}
          size="md"
        >
          <ShiftDetails shift={selected} money={money} />
        </Modal>
      )}
    </DesktopPage>
  )
}

function MoneyCell({
  value,
  money,
  className = '',
}: {
  value: number | null
  money: (value: number) => string
  className?: string
}) {
  return (
    <td className={`px-3 py-3 text-right tabular-nums ${value === null ? 'text-slate-400' : ''} ${className}`}>
      {value === null ? '—' : money(value)}
    </td>
  )
}

export default ShiftHistoryPage
