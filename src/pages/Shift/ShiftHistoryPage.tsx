import { useEffect, useState } from 'react'

import { shiftApi } from '../../api/shiftApi'
import { Badge } from '../../components/ui/Badge'
import { DataCard, DesktopPage, DesktopSearch, FilterPills, Th } from '../../components/ui/DesktopKit'
import { EmptyState, ErrorState, Spinner } from '../../components/ui/States'
import { Pagination } from '../../components/ui/Pagination'
import { useSettings } from '../../context/SettingsContext'
import { useAsync } from '../../hooks/useAsync'
import { useDebounced } from '../../hooks/useDebounced'
import type { Shift } from '../../types'
import { formatDate, formatMoney, formatTime } from '../../utils/format'

type StatusFilter = '' | 'open' | 'closed'

const PAGE_SIZE = 20

function diffLabel(shift: Shift, money: (value: number) => string): string {
  if (shift.difference === null) return '—'
  if (Math.abs(shift.difference) < 0.005) return 'Balanced'
  return shift.difference > 0 ? `+${money(shift.difference)}` : `-${money(Math.abs(shift.difference))}`
}

function diffTone(shift: Shift): 'green' | 'blue' | 'red' | 'gray' {
  if (shift.status === 'Open' || shift.difference === null) return 'gray'
  if (Math.abs(shift.difference) < 0.005) return 'green'
  return shift.difference > 0 ? 'blue' : 'red'
}

export function ShiftHistoryPage() {
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

  const items = data?.items ?? []
  const hasFilters = q !== '' || status !== ''

  return (
    <DesktopPage title="Shift History" subtitle="Every employee shift, with its closing cash summary.">
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <DesktopSearch value={search} onChange={setSearch} placeholder="Search by employee" label="Search shifts" />
        <FilterPills
          label="Shift status"
          value={status}
          onChange={setStatus}
          options={[
            { key: '', label: 'All' },
            { key: 'open', label: 'Open' },
            { key: 'closed', label: 'Closed' },
          ]}
        />
      </div>

      <DataCard className="mt-4">
        {loading && !data && (
          <div className="py-20">
            <Spinner />
          </div>
        )}

        {!loading && error && (
          <div className="p-6">
            <ErrorState message={error} onRetry={() => void reload()} />
          </div>
        )}

        {!loading && !error && items.length === 0 && (
          <div className="px-6 py-16 text-center">
            <EmptyState
              title={hasFilters ? 'No shifts found' : 'No shifts yet'}
              hint={hasFilters ? 'Nothing matches these filters.' : 'Shifts appear here once an employee starts one.'}
            />
          </div>
        )}

        {!error && items.length > 0 && (
          <>
            <div className="overflow-x-auto">
              <table className={`w-full text-left text-sm transition-opacity ${loading ? 'opacity-60' : ''}`}>
                <thead className="border-b border-slate-100 text-xs text-slate-500">
                  <tr>
                    <Th>Employee</Th>
                    <Th>Date</Th>
                    <Th>Start</Th>
                    <Th>End</Th>
                    <Th align="right">Total sales</Th>
                    <Th align="right">Expected cash</Th>
                    <Th align="right">Actual cash</Th>
                    <Th align="right">Difference</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((shift) => (
                    <tr key={shift.id} className="transition-colors hover:bg-slate-50">
                      <td className="py-3 pl-6 pr-3 font-medium">{shift.employeeName}</td>
                      <td className="px-3 py-3 text-slate-500">{formatDate(shift.startedAt)}</td>
                      <td className="px-3 py-3 text-slate-500">{formatTime(shift.startedAt)}</td>
                      <td className="px-3 py-3 text-slate-500">{shift.endedAt ? formatTime(shift.endedAt) : '—'}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{shift.totalSales !== null ? money(shift.totalSales) : '—'}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{shift.expectedCash !== null ? money(shift.expectedCash) : '—'}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{shift.actualCash !== null ? money(shift.actualCash) : '—'}</td>
                      <td className="px-3 py-3 text-right">
                        <Badge tone={diffTone(shift)}>{diffLabel(shift, money)}</Badge>
                      </td>
                      <td className="py-3 pl-3 pr-6">
                        {shift.status === 'Open' ? <Badge tone="amber">Open</Badge> : <Badge tone="gray">Closed</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {(data?.totalPages ?? 1) > 1 && (
              <div className="border-t border-slate-100 px-6 py-3">
                <Pagination page={data?.page ?? 1} totalPages={data?.totalPages ?? 1} onPage={setPage} />
              </div>
            )}
          </>
        )}
      </DataCard>
    </DesktopPage>
  )
}

export default ShiftHistoryPage
