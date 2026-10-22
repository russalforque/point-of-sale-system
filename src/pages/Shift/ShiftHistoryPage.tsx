import { useEffect, useRef, useState } from 'react'
import { Activity, ArrowDownLeft, ArrowRight, ArrowUpRight, CheckCheck, ChevronRight, Clock3, History, RefreshCw, Wallet } from 'lucide-react'
import { Button, ButtonLink } from '../../components/ui/Button'
import { BackLayer, SearchBox } from '../../components/ui/WorkPage'
import { Modal } from '../../components/ui/Modal'
import { Pagination } from '../../components/ui/Pagination'
import { EmptyState, ErrorState, Spinner } from '../../components/ui/States'
import { useAuth } from '../../context/AuthContext'
import { useElementWidth } from '../../hooks/useElementWidth'
import type { Shift } from '../../types'
import { formatDayLabel, formatDuration, formatTime } from '../../utils/format'
import { LONG_SHIFT_HOURS, STATUS_OPTIONS, ShiftDetails, VarianceTag, groupByDay, hoursOpen, shiftTimeLine, useOnShiftNow, useShiftHistory, varianceOf, type CashResultFilter } from './shiftHistory'

type Money = (value: number) => string

function EmployeeAvatar({ name }: { name: string }) {
  return <span className="sh-avatar" aria-hidden="true">{name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase() || '?'}</span>
}

/** One mounted view preserves search, paging and selection when the viewport changes. */
export function ShiftHistoryPage() {
  const { money, search, setSearch, status, setStatus, cashResult, setCashResult, setPage, queryKey, data, items, loading, error, reload, isFirstLoad, hasFilters, clearFilters } = useShiftHistory()
  const onShift = useOnShiftNow(true)
  const { can } = useAuth()
  const [pageRef, width] = useElementWidth<HTMLDivElement>()
  const split = width >= 1000
  const listRef = useRef<HTMLElement>(null)
  const [picked, setPicked] = useState<{ shift: Shift; query: string } | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  const selection = picked?.query === queryKey ? picked.shift : null
  const selected = selection ? items.find(shift => shift.id === selection.id) ?? onShift.items.find(shift => shift.id === selection.id) ?? selection : items[0] ?? null
  const closed = items.filter(shift => shift.status === 'Closed')
  const short = closed.filter(shift => varianceOf(shift).kind === 'short')
  const over = closed.filter(shift => varianceOf(shift).kind === 'over')
  const balanced = closed.filter(shift => varianceOf(shift).kind === 'balanced').length
  const recorded = closed.filter(shift => shift.totalSales !== null)
  const refreshing = loading || onShift.loading
  const showDialog = dialogOpen && picked?.query === queryKey && !!selected

  function selectShift(shift: Shift) {
    setPicked({ shift, query: queryKey })
    if (!split) setDialogOpen(true)
  }
  function changePage(page: number) {
    setPage(page)
    listRef.current?.focus({ preventScroll: true })
    listRef.current?.scrollIntoView({ block: 'start' })
  }
  async function refresh() {
    await Promise.all([reload(), onShift.reload()])
  }

  return <div className="shift-history-page" ref={pageRef}>
    <header className="sh-header">
      <div><p className="sh-eyebrow"><span />STAFF & CASH MANAGEMENT</p><h1>Shift history</h1><p>Review employee shifts, recorded payments and closing cash counts.</p></div>
      <div className="sh-header-actions">{can('sales.process') && <ButtonLink to="/shift" variant="secondary"><Clock3 size={16} aria-hidden="true" />My shift<ArrowRight size={15} aria-hidden="true" /></ButtonLink>}<Button variant="secondary" disabled={refreshing} onClick={() => void refresh()} aria-label="Refresh shift history"><RefreshCw size={16} aria-hidden="true" className={refreshing ? 'sh-spin' : ''} />Refresh</Button></div>
    </header>

    {!hasFilters && onShift.items.length > 0 && <section className="sh-live" aria-labelledby="sh-live-title">
      <header><div><span className="sh-live-dot" aria-hidden="true" /><h2 id="sh-live-title">On shift now</h2><span className="sh-count">{onShift.total}</span></div><Button variant="ghost" onClick={() => setStatus('open')}>View open shifts<ArrowRight size={14} aria-hidden="true" /></Button></header>
      <ul>{onShift.items.slice(0, 3).map(shift => {
        const long = hoursOpen(shift, now) >= LONG_SHIFT_HOURS
        return <li key={shift.id}><button type="button" className={long ? 'is-long' : ''} onClick={() => selectShift(shift)} aria-label={`View open shift for ${shift.employeeName}`} aria-haspopup={split ? undefined : 'dialog'}><EmployeeAvatar name={shift.employeeName} /><span><strong>{shift.employeeName}</strong><small>{long ? `Open ${formatDuration(shift.startedAt)} · Review closing status` : `Since ${formatTime(shift.startedAt)} · ${formatDuration(shift.startedAt)}`}</small></span><ChevronRight size={16} aria-hidden="true" /></button></li>
      })}</ul>
    </section>}
    {onShift.error && <p className="sh-source-note" role="status">Open shifts could not be refreshed. Use Refresh to try again.</p>}

    <div className="sh-overview-heading"><h2>This page at a glance</h2><span>{data ? `${items.length} ${items.length === 1 ? 'shift' : 'shifts'} on this page` : 'Up to 20 shifts per page'}</span></div>
    <div className="sh-metrics" aria-label="Current page summary">
      <section className="sh-metric"><div><h3>Closed shifts</h3><span><CheckCheck size={18} aria-hidden="true" /></span></div><strong>{data ? closed.length : '—'}</strong><p>{balanced} balanced cash {balanced === 1 ? 'count' : 'counts'}</p></section>
      <section className="sh-metric is-featured"><div><h3>Recorded total</h3><span><Wallet size={18} aria-hidden="true" /></span></div><strong>{data ? money(recorded.reduce((sum, shift) => sum + shift.totalSales!, 0)) : '—'}</strong><p>Cash + non-cash · {recorded.length} closed {recorded.length === 1 ? 'shift' : 'shifts'}</p></section>
      <section className="sh-metric is-short"><div><h3>Cash shortages</h3><span><ArrowDownLeft size={18} aria-hidden="true" /></span></div><strong>{data ? money(short.reduce((sum, shift) => sum + Math.abs(shift.difference!), 0)) : '—'}</strong><p>{short.length} {short.length === 1 ? 'shift' : 'shifts'} short of the expected cash</p></section>
      <section className="sh-metric is-over"><div><h3>Cash overages</h3><span><ArrowUpRight size={18} aria-hidden="true" /></span></div><strong>{data ? money(over.reduce((sum, shift) => sum + shift.difference!, 0)) : '—'}</strong><p>{over.length} {over.length === 1 ? 'shift' : 'shifts'} above the expected cash</p></section>
    </div>

    <div className={`sh-workspace ${split ? 'is-split' : ''}`}>
      <section className="sh-list" ref={listRef} tabIndex={-1} aria-labelledby="sh-list-title">
        <header className="sh-list-heading"><div><h2 id="sh-list-title">Employee shifts</h2><p>Grouped by start date, newest first.</p></div><span className="sh-count" role="status">{data ? `${data.totalCount.toLocaleString()} matching ${data.totalCount === 1 ? 'shift' : 'shifts'}` : error ? 'Unable to load shifts' : 'Loading shifts…'}</span></header>
        <div className="sh-filters"><div className="sh-search"><span aria-hidden="true">Employee</span><SearchBox label="Search shifts by employee" placeholder="Search employee name…" value={search} onChange={setSearch} /></div><label className="sh-result-filter"><span>Cash result</span><select value={cashResult} onChange={event => setCashResult(event.target.value as CashResultFilter)}><option value="">All cash results</option><option value="balanced">Balanced</option><option value="short">Short</option><option value="over">Over</option><option value="uncounted">Not counted</option></select></label></div>
        <div className="sh-status-toolbar"><div className="sh-status-filters" role="group" aria-label="Shift status">{STATUS_OPTIONS.map(option => <button key={option.key} type="button" aria-pressed={status === option.key} onClick={() => setStatus(option.key)}>{option.label === 'All' ? 'All shifts' : option.label}</button>)}</div>{hasFilters && <Button variant="ghost" onClick={clearFilters}>Clear filters</Button>}</div>
        {cashResult && <p className="sh-filter-note">Cash results apply to closed shifts.</p>}
        {error && data && <div className="sh-refresh-error" role="alert"><span>Couldn’t refresh. Showing the last loaded shifts for these filters.</span><Button variant="ghost" disabled={loading} onClick={() => void reload()}>Retry</Button></div>}
        <div className="sh-list-content" aria-busy={loading}>
          {isFirstLoad && <div className="sh-loading"><Spinner label="Loading shift history…" /></div>}
          {!loading && error && !data && <ErrorState message={error} onRetry={() => void reload()} />}
          {!loading && !error && !items.length && <div className="sh-empty"><EmptyState title={hasFilters ? 'No shifts match these filters' : 'No shift history yet'} hint={hasFilters ? 'Try another employee, status or cash result.' : 'Shifts appear here when an employee starts a shift.'} />{hasFilters && <Button variant="secondary" onClick={clearFilters}>Clear filters</Button>}</div>}
          {!!items.length && <ShiftTable items={items} money={money} activeId={split ? selected?.id : undefined} disabled={loading} split={split} onSelect={selectShift} />}
        </div>
        {data && <footer className="sh-pagination"><p>{data.totalCount ? `Showing ${(data.page - 1) * data.pageSize + 1}–${Math.min(data.page * data.pageSize, data.totalCount)} of ${data.totalCount.toLocaleString()} shifts` : '0 shifts'}{loading && <span role="status"> · Updating…</span>}</p><Pagination page={data.page} totalPages={data.totalPages} onPage={changePage} /></footer>}
      </section>
      {split && <aside className="sh-detail-panel" aria-label="Selected shift details">{selected ? <><header className="sh-detail-header"><p><Activity size={15} aria-hidden="true" />SHIFT DETAILS <span>#{selected.id}</span></p><div><EmployeeAvatar name={selected.employeeName} /><div><h2>{selected.employeeName}</h2><p>{formatDayLabel(selected.startedAt)} · {shiftTimeLine(selected)}</p></div></div></header><div className="sh-detail-body" key={selected.id}><ShiftDetails shift={selected} money={money} /></div></> : <div className="sh-detail-empty"><History size={30} aria-hidden="true" /><h2>Shift details</h2><p>Select an employee shift to review its cash count and recorded payments.</p></div>}</aside>}
    </div>
    <p className="sh-footer-note"><Wallet size={14} aria-hidden="true" />Cash difference = counted cash − expected cash. Open shifts show totals after closing.</p>
    {showDialog && selected && <BackLayer name="shift-history-detail" onBack={() => setDialogOpen(false)}>{close => <Modal title={selected.employeeName} description={`Shift #${selected.id} · ${formatDayLabel(selected.startedAt)} · ${shiftTimeLine(selected)}`} mobileFullScreen panelClassName="sh-detail-dialog" onClose={close} footer={<Button variant="secondary" onClick={close}>Done</Button>}><ShiftDetails shift={selected} money={money} /></Modal>}</BackLayer>}
  </div>
}

function ShiftTable({ items, money, activeId, disabled, split, onSelect }: { items: Shift[]; money: Money; activeId?: number; disabled: boolean; split: boolean; onSelect: (shift: Shift) => void }) {
  return <table className="sh-table" role="table"><caption className="sr-only">Employee shifts with recorded totals and closing cash differences</caption><thead role="rowgroup"><tr role="row"><th scope="col" role="columnheader">Employee / shift</th><th scope="col" role="columnheader">Recorded total</th><th scope="col" role="columnheader">Cash result</th><th scope="col" role="columnheader"><span className="sr-only">View details</span></th></tr></thead>{groupByDay(items).map(group => <tbody key={group.day} role="rowgroup"><tr className="sh-day-row" role="row"><th colSpan={4} scope="rowgroup" role="rowheader"><span>{group.day}</span><small>{group.shifts.length} {group.shifts.length === 1 ? 'shift' : 'shifts'}</small></th></tr>{group.shifts.map(shift => <tr key={shift.id} role="row" className={`sh-row ${activeId === shift.id ? 'is-selected' : ''}`} onClick={() => { if (!disabled) onSelect(shift) }}>
    <td role="cell" className="sh-employee-cell"><div className="sh-employee"><EmployeeAvatar name={shift.employeeName} /><div><strong>{shift.employeeName}</strong><span>Shift #{shift.id} · {shift.status}</span><small>{shiftTimeLine(shift)}</small>{shift.status === 'Open' && hoursOpen(shift) >= LONG_SHIFT_HOURS && <small className="sh-long-note">Open 12+ hours · Review closing status</small>}</div></div></td>
    <td role="cell" className="sh-sales-cell"><span className="sh-mobile-label">Recorded total</span><strong>{shift.totalSales === null ? '—' : money(shift.totalSales)}</strong>{shift.status === 'Open' && <small>After close</small>}</td>
    <td role="cell" className="sh-variance-cell"><span className="sh-mobile-label">Cash result</span><VarianceTag shift={shift} money={money} /></td>
    <td role="cell" className="sh-open-cell"><button type="button" className="sh-open-button" disabled={disabled} onClick={event => { event.stopPropagation(); onSelect(shift) }} aria-current={activeId === shift.id ? 'true' : undefined} aria-haspopup={split ? undefined : 'dialog'} aria-label={`View shift #${shift.id} for ${shift.employeeName}, ${group.day}`}><ChevronRight size={18} aria-hidden="true" /></button></td>
  </tr>)}</tbody>)}</table>
}

export default ShiftHistoryPage
