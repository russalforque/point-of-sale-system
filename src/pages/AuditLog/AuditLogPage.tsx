import { useEffect, useState } from 'react'

import { auditApi } from '../../api/auditApi'
import { Search } from '../../components/ui/Icons'
import { Pagination } from '../../components/ui/Pagination'
import { EmptyState, ErrorState, Spinner } from '../../components/ui/States'
import { Panel, WorkPage } from '../../components/ui/WorkPage'
import { useAsync } from '../../hooks/useAsync'
import { useDebounced } from '../../hooks/useDebounced'
import { AUDIT_ACTIONS, type AuditAction } from '../../services/audit'
import { formatDayLabel, formatTime } from '../../utils/format'

/** Grouped so the filter stays short: each group can match several stored actions. */
const FILTERS: { key: string; label: string; action?: AuditAction }[] = [
  { key: '', label: 'All' },
  { key: 'sale', label: 'Sales', action: 'sale' },
  { key: 'refund', label: 'Refunds', action: 'refund' },
  { key: 'return', label: 'Returns', action: 'return' },
  { key: 'void', label: 'Voids', action: 'void' },
  { key: 'discount', label: 'Discounts', action: 'discount' },
  { key: 'price_change', label: 'Prices', action: 'price_change' },
  { key: 'stock_adjustment', label: 'Stock adj.', action: 'stock_adjustment' },
  { key: 'stock_count', label: 'Counts', action: 'stock_count' },
  { key: 'restock', label: 'Restock', action: 'restock' },
  { key: 'shift_open', label: 'Shift open', action: 'shift_open' },
  { key: 'shift_close', label: 'Shift close', action: 'shift_close' },
  { key: 'cash_movement', label: 'Cash in/out', action: 'cash_movement' },
  { key: 'settings', label: 'Settings', action: 'settings' },
  { key: 'user', label: 'Users', action: 'user' },
  { key: 'login', label: 'Logins', action: 'login' },
  { key: 'backup', label: 'Backups', action: 'backup' },
  { key: 'restore', label: 'Restores', action: 'restore' },
]

const TONES: Partial<Record<AuditAction, string>> = {
  void: 'bg-rose-50 text-rose-700',
  refund: 'bg-amber-50 text-amber-800',
  return: 'bg-amber-50 text-amber-800',
  discount: 'bg-amber-50 text-amber-800',
  price_change: 'bg-blue-50 text-blue-700',
  stock_adjustment: 'bg-blue-50 text-blue-700',
  stock_count: 'bg-blue-50 text-blue-700',
  restore: 'bg-rose-50 text-rose-700',
}

export function AuditLogPage() {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('')
  const [page, setPage] = useState(1)
  const q = useDebounced(search)
  const action = FILTERS.find((option) => option.key === filter)?.action ?? ''

  const logs = useAsync(() => auditApi.list({ search: q.trim() || undefined, action, page, pageSize: 30 }), [q, action, page])

  useEffect(() => {
    setPage(1)
  }, [q, action])

  // A day heading above the first entry of each day.
  const rows = (logs.data?.items ?? []).map((log, index, all) => {
    const day = formatDayLabel(log.createdAt)
    return { log, day, showDay: index === 0 || day !== formatDayLabel(all[index - 1]!.createdAt) }
  })

  return (
    <WorkPage
      title="Audit log"
      subtitle={logs.data ? `${logs.data.totalCount.toLocaleString('en-PH')} recorded actions · read-only` : 'Every important action, who did it and when.'}
    >
      <div className="relative mt-5">
        <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          aria-label="Search the audit log"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search user, receipt no., product…"
          className="h-12 w-full rounded-2xl border-0 bg-white pl-11 pr-4 text-[15px] ring-1 ring-slate-200 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-[#1F5E3B] [&::-webkit-search-cancel-button]:hidden"
        />
      </div>

      <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-none sm:mx-0 sm:flex-wrap sm:px-0">
        {FILTERS.map((option) => (
          <button
            key={option.key || 'all'}
            type="button"
            onClick={() => setFilter(option.key)}
            aria-pressed={filter === option.key}
            className={`h-10 shrink-0 rounded-full px-4 text-sm font-medium transition ${
              filter === option.key ? 'bg-[#1F5E3B] text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <Panel className="mt-4">
        {logs.loading && !logs.data && (
          <div className="py-10">
            <Spinner />
          </div>
        )}
        {logs.error && <ErrorState message={logs.error} onRetry={() => void logs.reload()} />}
        {logs.data && rows.length === 0 && (
          <div className="py-10 text-center">
            <EmptyState title="Nothing recorded" hint={q || action ? 'Try a different search or filter.' : 'Actions will appear here as the store is used.'} />
          </div>
        )}

        <div className="hidden grid-cols-[5rem_9rem_8rem_minmax(0,1fr)] gap-3 border-b border-slate-100 pb-2 text-xs font-medium text-slate-500 md:grid">
          <span>Time</span>
          <span>User</span>
          <span>Action</span>
          <span>Description</span>
        </div>

        <ul className={logs.loading ? 'opacity-60' : ''}>
          {rows.map(({ log, day, showDay }) => {
            return (
              <li key={log.id}>
                {showDay && <p className="pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-slate-500 first:pt-2">{day}</p>}
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 border-b border-slate-100 py-3 md:grid-cols-[5rem_9rem_8rem_minmax(0,1fr)] md:items-start">
                  <span className="order-3 col-span-2 text-xs tabular-nums text-slate-500 md:order-none md:col-span-1 md:text-sm">
                    {formatTime(log.createdAt)}
                    <span className="md:hidden"> · {log.userName}</span>
                  </span>
                  <span className="hidden truncate text-sm md:block">{log.userName}</span>
                  <span className="order-2 md:order-none">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                        TONES[log.action as AuditAction] ?? 'bg-[#F3F5F4] text-slate-600'
                      }`}
                    >
                      {log.actionLabel ?? AUDIT_ACTIONS[log.action as AuditAction]}
                    </span>
                  </span>
                  <span className="order-1 min-w-0 break-words text-sm md:order-none">{log.description}</span>
                </div>
              </li>
            )
          })}
        </ul>

        {logs.data && logs.data.totalPages > 1 && (
          <div className="mt-3">
            <Pagination page={logs.data.page} totalPages={logs.data.totalPages} onPage={setPage} />
          </div>
        )}
      </Panel>
    </WorkPage>
  )
}

export default AuditLogPage
