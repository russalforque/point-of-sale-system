import { useEffect, useId, useRef, useState } from 'react'
import { ArrowDownLeft, ArrowRight, ArrowUpRight, Banknote, Check, CheckCheck, ChevronRight, CircleCheck, Clock3, CreditCard, History, LogOut, RefreshCw, Wallet } from 'lucide-react'
import { shiftApi } from '../../api/shiftApi'
import { Button, ButtonLink } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { TextField } from '../../components/ui/MobileKit'
import { ErrorState, Spinner } from '../../components/ui/States'
import { ReasonField } from '../../components/ui/WorkPage'
import { useAuth } from '../../context/AuthContext'
import { useSettings } from '../../context/SettingsContext'
import { useToast } from '../../context/ToastContext'
import { useAsync } from '../../hooks/useAsync'
import { useDismissOnBack } from '../../hooks/useDismissOnBack'
import type { CashMovement, Shift, ShiftSummary } from '../../types'
import { ApiError, getErrorMessage } from '../../utils/errors'
import { roundMoney } from '../../utils/amount'
import { formatDateTime, formatDuration, formatMoney, formatTime } from '../../utils/format'
import { ShiftDetails, VarianceTag } from './shiftHistory'
import { useMyShift } from './useMyShift'
import './my-shift.css'

type Money = (value: number) => string
const QUICK_FLOATS = [0, 500, 1000, 2000, 5000]
const CASH_IN_REASONS = ['Float top-up', 'Change fund']
const CASH_OUT_REASONS = ['Bank deposit', 'Supplier payment', 'Petty cash']

function StaffAvatar({ name }: { name: string }) {
  return <span className="ms-avatar" aria-hidden="true">{name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase() || '?'}</span>
}

export function ShiftPage() {
  const { can, user } = useAuth()
  const { settings } = useSettings()
  const money: Money = value => formatMoney(value, settings.currencySymbol)
  const { snapshot, loading, error, reload, commit } = useMyShift()
  const [lastClosed, setLastClosed] = useState<Shift | null>(null)
  const [, tick] = useState(0)
  useEffect(() => {
    const timer = window.setInterval(() => tick(value => value + 1), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  const shift = snapshot?.shift
  return <div className="my-shift-page">
    <header className="ms-header"><div><p className="ms-eyebrow"><span />YOUR REGISTER SESSION</p><h1>My shift</h1><p>{shift ? 'Keep track of your drawer, recorded payments and cash movements.' : 'Count your starting cash and get your register ready.'}</p></div>
      <div className="ms-header-actions"><Button variant="secondary" aria-label="Refresh my shift" disabled={loading} onClick={() => void reload()}><RefreshCw size={16} aria-hidden="true" className={loading ? 'ms-spin' : ''} />Refresh</Button>{can('shifts.manage') && <ButtonLink to="/shift-history" variant="secondary"><History size={16} aria-hidden="true" />Shift history<ArrowRight size={15} aria-hidden="true" /></ButtonLink>}</div>
    </header>
    {loading && !snapshot && <div className="ms-loading"><Spinner label="Loading your shift…" /></div>}
    {error && !snapshot && <ErrorState message={error} onRetry={() => void reload()} />}
    {error && snapshot && <RetryBanner message="Couldn’t refresh your shift. Showing the last loaded information; refresh before making changes." onRetry={() => void reload()} disabled={loading} />}
    {snapshot && (shift ? <ActiveShift shift={shift} summary={snapshot.summary} summaryError={snapshot.summaryError} movements={snapshot.movements} movementsError={snapshot.movementsError} updatedAt={snapshot.updatedAt} loading={loading} blocked={loading || !!error} money={money} onRefresh={() => void reload()} onCashMoved={() => void reload()} onClosed={closed => { setLastClosed(closed); commit(null) }} />
      : <div className="ms-start-layout">{lastClosed ? <ClosedShiftCard shift={lastClosed} money={money} /> : <section className="ms-welcome" aria-labelledby="ms-welcome-title"><span className="ms-welcome-icon"><Wallet size={30} aria-hidden="true" /></span><span className="ms-status is-idle">No active shift</span><h2 id="ms-welcome-title">Start with a counted drawer.</h2><p>Your shift keeps starting cash, payments and cash movements together, so closing is easier to check.</p><ol className="ms-start-steps">{[{ title: 'Count your starting cash', body: 'Include every bill and coin already in the drawer.' }, { title: settings.businessType === 'laundry' ? 'Take payments as usual' : 'Make sales as usual', body: 'Cash payments and cash movements update your expected drawer cash.' }, { title: 'Count again before closing', body: 'Review any shortage or overage, then confirm the closing count.' }].map((step, index) => <li key={step.title}><span aria-hidden="true">{index + 1}</span><div><strong>{step.title}</strong><p>{step.body}</p></div></li>)}</ol></section>}
        <StartShiftCard name={user?.fullName ?? 'Signed-in employee'} money={money} compact={!!lastClosed} disabled={loading || !!error} onStarted={started => { setLastClosed(null); commit(started) }} />
      </div>)}
  </div>
}

function ClosedShiftCard({ shift, money }: { shift: Shift; money: Money }) {
  return <section className="ms-card ms-closed" aria-labelledby="ms-closed-title"><header className="ms-card-heading"><span className="ms-card-icon"><CircleCheck size={19} aria-hidden="true" /></span><div><h2 id="ms-closed-title">Shift closed</h2><p>Shift #{shift.id} · {formatDateTime(shift.endedAt)}</p></div><VarianceTag shift={shift} money={money} /></header><p className="ms-close-success">Your closing count has been saved.</p><dl className="ms-closed-summary"><div><dt>Expected cash</dt><dd>{shift.expectedCash === null ? '—' : money(shift.expectedCash)}</dd></div><div><dt>Counted cash</dt><dd>{shift.actualCash === null ? '—' : money(shift.actualCash)}</dd></div></dl><details className="ms-closed-details"><summary>View closing breakdown<ChevronRight size={16} aria-hidden="true" /></summary><ShiftDetails shift={shift} money={money} /></details></section>
}

function ActiveShift({ shift, summary, summaryError, movements, movementsError, updatedAt, loading, blocked, money, onRefresh, onCashMoved, onClosed }: {
  shift: Shift; summary: ShiftSummary | null; summaryError: string | null; movements: CashMovement[] | null; movementsError: string | null; updatedAt: string | null; loading: boolean; blocked: boolean; money: Money; onRefresh: () => void; onCashMoved: () => void; onClosed: (shift: Shift) => void
}) {
  const { can } = useAuth()
  const [movementType, setMovementType] = useState<'in' | 'out' | null>(null)
  const [ending, setEnding] = useState(false)
  const actionsDisabled = blocked || !summary || !!summaryError
  const total = summary ? roundMoney(summary.cashSales + summary.nonCashSales) : null
  const cashShare = total && total > 0 && summary ? Math.min(100, Math.max(0, summary.cashSales / total * 100)) : 0
  return <>
    <section className="ms-session" aria-label="Active shift"><div className="ms-session-person"><StaffAvatar name={shift.employeeName} /><div><strong>{shift.employeeName}</strong><p>Shift #{shift.id} · Started <time dateTime={shift.startedAt}>{formatDateTime(shift.startedAt)}</time></p></div></div><div className="ms-session-status"><span className="ms-status"><span />Shift open</span><span><Clock3 size={14} aria-hidden="true" />{formatDuration(shift.startedAt)}</span></div></section>
    <div className="ms-active-layout">
      <section className="ms-card ms-drawer" aria-labelledby="ms-drawer-title" aria-busy={loading}>
        <header className="ms-card-heading"><span className="ms-card-icon"><Wallet size={19} aria-hidden="true" /></span><div><h2 id="ms-drawer-title">Cash drawer</h2><p>{updatedAt ? `Totals updated ${formatTime(updatedAt)}` : 'Preparing your drawer totals'}</p></div></header>
        <div className="ms-drawer-focus"><span>Expected in drawer</span><strong>{summary ? money(summary.expectedCash) : '—'}</strong><p>The cash that should be in your drawer right now.</p></div>
        {summaryError && <RetryBanner message={summary ? 'Couldn’t refresh. Showing the last drawer totals.' : 'Couldn’t load your drawer totals.'} disabled={loading} onRetry={onRefresh} />}
        <div className="ms-drawer-actions" role="group" aria-label="Drawer actions">{can('cash.movement') && <><Button variant="secondary" disabled={actionsDisabled} onClick={() => setMovementType('in')}><ArrowDownLeft size={17} aria-hidden="true" />Cash in</Button><Button variant="secondary" disabled={actionsDisabled} onClick={() => setMovementType('out')}><ArrowUpRight size={17} aria-hidden="true" />Cash out</Button></>}<Button disabled={actionsDisabled} onClick={() => setEnding(true)} className="ms-end-button"><LogOut size={17} aria-hidden="true" />End shift</Button></div>
        <div className="ms-section-caption"><h3>How your drawer adds up</h3><span>Cash only</span></div>
        {summary ? <DrawerLedger summary={summary} money={money} /> : !summaryError && <Spinner label="Loading drawer totals…" />}
        <p className="ms-footnote">Non-cash payments are recorded separately and do not increase the cash in your drawer.</p>
      </section>
      <section className="ms-card ms-payments" aria-labelledby="ms-payments-title" aria-busy={loading}><header className="ms-card-heading"><span className="ms-card-icon"><CreditCard size={19} aria-hidden="true" /></span><div><h2 id="ms-payments-title">Payments this shift</h2><p>Cash and non-cash payments recorded</p></div></header><strong className="ms-payment-total">{total === null ? '—' : money(total)}</strong>
        {summary && <><div className="ms-payment-track" role="img" aria-label={total ? `${cashShare.toFixed(1)}% cash, ${(100 - cashShare).toFixed(1)}% non-cash` : 'No payments recorded'}><span style={{ width: `${cashShare}%` }} /></div><dl className="ms-payment-split"><div><dt><span />Cash</dt><dd>{money(summary.cashSales)}</dd><small>{total ? `${cashShare.toFixed(1)}% of payments` : 'No cash payments yet'}</small></div><div><dt><span />Non-cash</dt><dd>{money(summary.nonCashSales)}</dd><small>{total ? `${(100 - cashShare).toFixed(1)}% of payments` : 'No non-cash payments yet'}</small></div></dl></>}
        <p className="ms-footnote">{summaryError ? 'Payment totals could not be refreshed. Retry from Cash drawer.' : summary && total === 0 ? 'Payments appear here as you collect them during your shift.' : 'Cash refunds and drawer movements are shown in the cash breakdown.'}</p>
      </section>
      <MovementsCard movements={movements} loading={loading} error={movementsError} onRetry={onRefresh} money={money} />
    </div>
    {movementType && <CashMovementDialog shiftId={shift.id} type={movementType} available={summary?.expectedCash ?? null} money={money} onClose={() => setMovementType(null)} onSaved={onCashMoved} />}
    {ending && <EndShiftDialog shift={shift} money={money} onClose={() => setEnding(false)} onEnded={onClosed} />}
  </>
}

function DrawerLedger({ summary, money }: { summary: ShiftSummary; money: Money }) {
  const rows: { label: string; value: number; sign?: string; total?: boolean }[] = [
    { label: 'Starting cash', value: summary.startingCash }, { label: 'Cash payments', value: summary.cashSales, sign: '+' }, { label: 'Cash refunds', value: summary.cashRefunds, sign: '−' }, { label: 'Cash in', value: summary.cashIn, sign: '+' }, { label: 'Cash out', value: summary.cashOut, sign: '−' }, { label: 'Expected cash', value: summary.expectedCash, total: true },
  ]
  return <dl className="ms-ledger">{rows.map(row => <div key={row.label} className={row.total ? 'is-total' : row.sign && row.value === 0 ? 'is-empty' : ''}><dt>{row.sign && <span aria-hidden="true">{row.sign}</span>}{row.label}</dt><dd>{row.sign && row.value > 0 && <span className="sr-only">{row.sign === '+' ? 'plus' : 'minus'} </span>}{money(row.value)}</dd></div>)}</dl>
}

function MovementsCard({ movements, loading, error, onRetry, money }: { movements: CashMovement[] | null; loading: boolean; error: string | null; onRetry: () => void; money: Money }) {
  const [filter, setFilter] = useState<'all' | 'in' | 'out'>('all')
  const [expanded, setExpanded] = useState(false)
  const list = movements ?? []
  const filtered = list.filter(row => filter === 'all' || row.type === (filter === 'in' ? 'Cash in' : 'Cash out'))
  const visible = expanded ? filtered : filtered.slice(0, 8)
  return <section className="ms-card ms-movements" aria-labelledby="ms-movements-title" aria-busy={loading}>
    <header className="ms-card-heading"><span className="ms-card-icon"><History size={19} aria-hidden="true" /></span><div><h2 id="ms-movements-title">Cash activity</h2><p>Drawer top-ups and payouts, newest first</p></div>{movements && <span className="ms-count">{list.length} {list.length === 1 ? 'entry' : 'entries'}</span>}</header>
    {list.length > 0 && <div className="ms-log-filters" role="group" aria-label="Cash activity filters">{([{ key: 'all', label: 'All activity' }, { key: 'in', label: 'Cash in' }, { key: 'out', label: 'Cash out' }] as const).map(option => <button key={option.key} type="button" aria-pressed={filter === option.key} onClick={() => { setFilter(option.key); setExpanded(false) }}>{option.label}</button>)}</div>}
    {error && <RetryBanner message={movements ? 'Couldn’t refresh the cash log. Showing the last loaded entries.' : 'Couldn’t load the cash log.'} disabled={loading} onRetry={onRetry} />}
    {loading && !movements && <Spinner label="Loading cash activity…" />}
    {movements && !filtered.length && <div className="ms-log-empty"><Banknote size={27} aria-hidden="true" /><h3>{list.length ? `No ${filter === 'in' ? 'cash in' : 'cash out'} entries yet` : 'No cash movements yet'}</h3><p>Use Cash in for drawer top-ups and Cash out for deposits or payouts. Payments are tracked separately.</p></div>}
    {visible.length > 0 && <ul className="ms-log-list">{visible.map(movement => <li key={movement.id}><span className={`ms-movement-icon ${movement.type === 'Cash out' ? 'is-out' : ''}`} aria-hidden="true">{movement.type === 'Cash in' ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}</span><div><strong>{movement.reason}</strong><p>{movement.type} · <time dateTime={movement.createdAt}>{formatTime(movement.createdAt)}</time> · {movement.createdBy}</p></div><span className={movement.type === 'Cash out' ? 'is-out' : ''}>{movement.type === 'Cash in' ? '+' : '−'}{money(movement.amount)}</span></li>)}</ul>}
    {filtered.length > 8 && <Button variant="ghost" className="ms-show-log" onClick={() => setExpanded(!expanded)}>{expanded ? 'Show fewer entries' : `Show all ${filtered.length} entries`}</Button>}
  </section>
}

function RetryBanner({ message, onRetry, disabled }: { message: string; onRetry: () => void; disabled?: boolean }) {
  return <div className="ms-retry" role="alert"><span>{message}</span><Button variant="ghost" onClick={onRetry} disabled={disabled}>Retry</Button></div>
}

function StartShiftCard({ name, money, compact, disabled, onStarted }: { name: string; money: Money; compact: boolean; disabled: boolean; onStarted: (shift: Shift) => void }) {
  const { notify } = useToast()
  const { settings } = useSettings()
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lock = useRef(false)
  async function start() {
    if (lock.current || disabled) return
    const value = roundMoney(Number(amount))
    if (!amount.trim() || !Number.isFinite(value) || value < 0) { setError('Enter a valid starting cash amount. Use 0 for an empty drawer.'); return }
    lock.current = true; setBusy(true); setError(null)
    try { const shift = await shiftApi.start({ startingCash: value }); notify(`Shift started with ${money(value)} in the drawer.`); onStarted(shift) }
    catch (error) { setError(getErrorMessage(error)) }
    finally { lock.current = false; setBusy(false) }
  }
  return <section className="ms-card ms-start-card" aria-labelledby="ms-start-title"><header className="ms-card-heading"><StaffAvatar name={name} /><div><h2 id="ms-start-title">{compact ? 'Start the next shift' : 'Open your drawer'}</h2><p>{name}</p></div></header><form noValidate onSubmit={event => { event.preventDefault(); void start() }}><fieldset disabled={busy || disabled} className="ms-form-fields"><legend className="sr-only">Starting cash details</legend><div className="ms-money-field"><TextField label="Starting cash" prefix={settings.currencySymbol} amount value={amount} onChange={value => { setAmount(value); setError(null) }} error={error ?? undefined} hint="The cash already in the drawer before taking payments." placeholder="0.00" /></div><div className="ms-quick-heading">Quick amounts</div><div className="ms-quick-amounts" role="group" aria-label="Quick starting cash amounts">{QUICK_FLOATS.map(value => <button type="button" key={value} aria-pressed={!!amount.trim() && Number(amount) === value} onClick={() => { setAmount(String(value)); setError(null) }}>{value === 0 ? 'Empty drawer' : money(value)}</button>)}</div><p className="ms-start-note"><CheckCheck size={16} aria-hidden="true" />Count the drawer first. Your starting amount is saved with this shift.</p><Button type="submit" className="ms-start-button"><Wallet size={18} aria-hidden="true" />{busy ? 'Starting…' : 'Start shift'}<ArrowRight size={17} aria-hidden="true" /></Button></fieldset></form></section>
}

async function checkActiveShift(id: number) {
  if ((await shiftApi.getActive())?.id !== id) throw new ApiError('Your active shift changed. Close this dialog and refresh My shift.', 409)
}

function CashMovementDialog({ shiftId, type, available, money, onClose, onSaved }: { shiftId: number; type: 'in' | 'out'; available: number | null; money: Money; onClose: () => void; onSaved: () => void }) {
  const { notify } = useToast()
  const { settings } = useSettings()
  const formId = useId()
  const [amount, setAmount] = useState(''), [reason, setReason] = useState('')
  const [amountError, setAmountError] = useState<string | null>(null), [reasonError, setReasonError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const { close } = useDismissOnBack('cashMovementOpen', onClose, busy)
  const value = amount.trim() ? roundMoney(Number(amount)) : null
  const projected = available !== null && value !== null && Number.isFinite(value) && value > 0 ? roundMoney(available + (type === 'in' ? value : -value)) : null
  async function save() {
    if (lock.current) return
    const amountInvalid = value === null || !Number.isFinite(value) || value <= 0 || (type === 'out' && available !== null && value > available)
    setAmountError(amountInvalid ? value !== null && available !== null && type === 'out' && value > available ? `Cash out cannot exceed ${money(available)}.` : 'Enter an amount above zero.' : null)
    setReasonError(reason.trim().length < 3 ? 'Enter a reason with at least 3 characters.' : null)
    if (amountInvalid || reason.trim().length < 3) return
    lock.current = true; setBusy(true)
    try { await checkActiveShift(shiftId); await shiftApi.addCashMovement({ type, amount: value!, reason: reason.trim() }); notify(`${type === 'in' ? 'Cash in' : 'Cash out'} of ${money(value!)} recorded.`); close(); onSaved() }
    catch (error) { setAmountError(getErrorMessage(error)); lock.current = false; setBusy(false) }
  }
  return <Modal title={type === 'in' ? 'Cash in' : 'Cash out'} description={type === 'in' ? 'Record cash added to your drawer.' : 'Record a deposit or payout from your drawer.'} mobileFullScreen panelClassName="ms-dialog" preventClose={busy} onClose={close} footer={<><Button variant="secondary" onClick={close} disabled={busy}>Cancel</Button><Button form={formId} type="submit" disabled={busy}>{busy ? 'Saving…' : type === 'in' ? 'Save cash in' : 'Save cash out'}</Button></>}>
    <form id={formId} noValidate onSubmit={event => { event.preventDefault(); void save() }}><fieldset disabled={busy} className="ms-form-fields"><legend className="sr-only">Cash movement details</legend><div className="ms-dialog-balance"><span>Expected in drawer</span><strong>{available === null ? '—' : money(available)}</strong></div><TextField label="Amount" amount prefix={settings.currencySymbol} placeholder="0.00" value={amount} onChange={value => { setAmount(value); setAmountError(null) }} error={amountError ?? undefined} hint={type === 'out' ? 'Enter the amount you are taking out.' : 'Enter the amount you are adding.'} /><ReasonField value={reason} onChange={value => { setReason(value); setReasonError(null) }} suggestions={type === 'in' ? CASH_IN_REASONS : CASH_OUT_REASONS} error={reasonError} disabled={busy} />{projected !== null && projected >= 0 && <div className="ms-projection" role="status"><span>Expected after this entry</span><strong>{money(projected)}</strong></div>}</fieldset></form>
  </Modal>
}

function EndShiftDialog({ shift, money, onClose, onEnded }: { shift: Shift; money: Money; onClose: () => void; onEnded: (shift: Shift) => void }) {
  const { notify } = useToast()
  const { settings } = useSettings()
  const formId = useId()
  const { data: preview, loading, error, reload } = useAsync(async () => { const result = await shiftApi.summary(); if (result.shift.id !== shift.id) throw new ApiError('Your active shift changed. Close this dialog and refresh My shift.', 409); return result }, [shift.id])
  const [amount, setAmount] = useState(''), [busy, setBusy] = useState(false), [formError, setFormError] = useState<string | null>(null)
  const lock = useRef(false)
  const { close } = useDismissOnBack('endShiftOpen', onClose, busy)
  const actual = amount.trim() ? roundMoney(Number(amount)) : null
  const difference = preview && actual !== null && Number.isFinite(actual) ? roundMoney(actual - preview.summary.expectedCash) : null
  async function confirmEnd() {
    if (lock.current || loading || error || !preview) return
    if (actual === null || !Number.isFinite(actual) || actual < 0) { setFormError('Enter the cash you counted. Use 0 for an empty drawer.'); return }
    lock.current = true; setBusy(true); setFormError(null)
    try { await checkActiveShift(shift.id); const closed = await shiftApi.end({ actualCash: actual }); notify('Shift closed.'); close(); onEnded(closed) }
    catch (error) { setFormError(getErrorMessage(error)); lock.current = false; setBusy(false) }
  }
  return <Modal title="End shift" description={`Shift #${shift.id} · ${shift.employeeName} · ${formatDuration(shift.startedAt)}`} mobileFullScreen panelClassName="ms-dialog ms-close-dialog" onClose={close} preventClose={busy} footer={<><Button variant="secondary" onClick={close} disabled={busy}>Keep shift open</Button><Button form={formId} type="submit" disabled={busy || loading || !!error || !preview}><Check size={17} aria-hidden="true" />{busy ? 'Closing…' : 'Close shift'}</Button></>}>
    {loading && !preview && <Spinner label="Preparing your closing count…" />}{error && <ErrorState message={error} onRetry={() => void reload()} />}
    {preview && !error && <form id={formId} noValidate onSubmit={event => { event.preventDefault(); void confirmEnd() }}><fieldset disabled={busy || loading} className="ms-form-fields"><legend className="sr-only">Closing cash count</legend><p className="ms-close-notice"><Banknote size={18} aria-hidden="true" />Count every bill and coin in the drawer before confirming.</p><div className="ms-dialog-balance"><span>Expected in drawer</span><strong>{money(preview.summary.expectedCash)}</strong></div><TextField label="Cash you counted" prefix={settings.currencySymbol} amount value={amount} onChange={value => { setAmount(value); setFormError(null) }} error={formError ?? undefined} hint="Enter your actual count, including the starting cash." placeholder="0.00" />{difference !== null && <VarianceCallout difference={difference} money={money} />}<details className="ms-close-ledger"><summary>How expected cash is calculated<ChevronRight size={15} aria-hidden="true" /></summary><DrawerLedger summary={preview.summary} money={money} /></details><p className="ms-footnote">Closing saves the cash count and any difference to shift history.</p></fieldset></form>}
  </Modal>
}

function VarianceCallout({ difference, money }: { difference: number; money: Money }) {
  const balanced = Math.abs(difference) < 0.005
  return <div role="status" className={`ms-variance ${balanced ? 'is-balanced' : difference > 0 ? 'is-over' : 'is-short'}`}><CircleCheck size={19} aria-hidden="true" /><div><strong>{balanced ? 'Drawer balanced' : `${difference > 0 ? 'Over' : 'Short'} by ${money(Math.abs(difference))}`}</strong><p>{balanced ? 'Your count matches the expected cash.' : 'Recount if needed. You can still close; this difference will be saved.'}</p></div></div>
}

export default ShiftPage
