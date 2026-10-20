import { useEffect, useState } from 'react'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import {
  faBolt,
  faBoxOpen,
  faBullhorn,
  faHouse,
  faLandmark,
  faReceipt,
  faTruck,
  faUsers,
  faWrench,
} from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'

import { EXPENSE_CATEGORIES, expenseApi } from '../../api/expenseApi'
import { Badge } from '../../components/ui/Badge'
import { Plus, X } from '../../components/ui/Icons'
import { DateField, DetailList, DetailRow, SwitchRow, TextField } from '../../components/ui/MobileKit'
import { ConfirmDialog, Modal } from '../../components/ui/Modal'
import { Pagination } from '../../components/ui/Pagination'
import { EmptyState, ErrorState, Spinner } from '../../components/ui/States'
import { BackLayer, Panel, PillGroup, ReasonField, SearchBox, WorkPage } from '../../components/ui/WorkPage'
import { useSettings } from '../../context/SettingsContext'
import { useToast } from '../../context/ToastContext'
import { useAsync } from '../../hooks/useAsync'
import { useDebounced } from '../../hooks/useDebounced'
import type { Expense } from '../../types'
import { getErrorMessage } from '../../utils/errors'
import { formatDate, formatDateTime, formatMoney } from '../../utils/format'

type Period = 'month' | 'last-month' | 'year' | 'all'

const PERIODS: { key: Period; label: string }[] = [
  { key: 'month', label: 'This month' },
  { key: 'last-month', label: 'Last month' },
  { key: 'year', label: 'This year' },
  { key: 'all', label: 'All time' },
]

const CATEGORY_ICONS: Record<string, IconDefinition> = {
  Rent: faHouse,
  Utilities: faBolt,
  Salaries: faUsers,
  Supplies: faBoxOpen,
  Transport: faTruck,
  Repairs: faWrench,
  Marketing: faBullhorn,
  'Taxes & fees': faLandmark,
}

function CategoryIcon({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }) {
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-xl bg-brand-tint text-brand ${
        size === 'sm' ? 'h-8 w-8 text-[13px]' : 'h-10 w-10 text-[15px]'
      }`}
    >
      <FontAwesomeIcon icon={CATEGORY_ICONS[name] ?? faReceipt} />
    </span>
  )
}

function dateKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function periodDates(period: Period): { from?: string; to?: string } {
  const now = new Date()
  if (period === 'month') return { from: dateKey(new Date(now.getFullYear(), now.getMonth(), 1)) }
  if (period === 'last-month') {
    return {
      from: dateKey(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
      to: dateKey(new Date(now.getFullYear(), now.getMonth(), 0)),
    }
  }
  if (period === 'year') return { from: dateKey(new Date(now.getFullYear(), 0, 1)) }
  return {}
}

type Dialog = { kind: 'add' } | { kind: 'view'; expense: Expense }

/** Category rows shown on phones before "Show all", so the list isn't pushed off the first screen. */
const PHONE_ROWS = 4

export function ExpensesPage() {
  const { settings } = useSettings()
  const money = (value: number) => formatMoney(value, settings.currencySymbol)
  const [period, setPeriod] = useState<Period>('month')
  const [category, setCategory] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [formDirty, setFormDirty] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const q = useDebounced(search)

  const range = periodDates(period)
  const list = useAsync(
    () => expenseApi.list({ ...range, category: category || undefined, search: q || undefined, page, pageSize: 20, includeVoided: true }),
    [period, category, q, page],
  )
  // The breakdown ignores the category filter so every category stays visible (and tappable).
  const summary = useAsync(() => expenseApi.summary({ ...range, search: q || undefined }), [period, q])

  async function refresh() {
    await Promise.all([list.reload(), summary.reload()])
  }

  function pickCategory(next: string) {
    setCategory(next)
    setPage(1)
  }

  function closeDialog() {
    setDialog(null)
    setFormDirty(false)
    setConfirmDiscard(false)
  }

  const periodLabel = PERIODS.find((option) => option.key === period)!.label
  const filtered = Boolean(category || q)
  const items = list.data?.items ?? []

  return (
    <WorkPage
      title="Expenses"
      subtitle="Rent, bills and other costs. They’re subtracted in the profit report."
      maxWidth="max-w-6xl"
      actions={
        <button
          type="button"
          onClick={() => setDialog({ kind: 'add' })}
          className="inline-flex h-11 items-center gap-2 rounded-full bg-brand px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-hover active:scale-95"
        >
          <Plus size={12} />
          Record expense
        </button>
      }
    >
      <div className="@container mt-5">
        <div className="grid gap-4 @4xl:grid-cols-[minmax(0,1fr)_20rem] @4xl:items-start">
          {/* Summary first in the DOM so it leads on portrait; it moves to a sticky side column when there's room. */}
          <SummaryCard
            loading={summary.loading && !summary.data}
            error={summary.data ? null : summary.error}
            onRetry={() => void summary.reload()}
            periodLabel={periodLabel}
            rows={summary.data?.byCategory ?? []}
            total={summary.data?.total ?? 0}
            count={summary.data?.count ?? 0}
            category={category}
            onCategory={(name) => pickCategory(category === name ? '' : name)}
            money={money}
          />

          <Panel className="@container/list min-w-0 @4xl:col-start-1 @4xl:row-start-1">
            <div className="flex flex-col gap-3 @2xl/list:flex-row @2xl/list:items-center">
              <PillGroup
                label="Period"
                options={PERIODS}
                value={period}
                onChange={(next) => {
                  setPeriod(next)
                  setPage(1)
                }}
              />
              <SearchBox
                label="Search expenses"
                value={search}
                onChange={(next) => {
                  setSearch(next)
                  setPage(1)
                }}
                placeholder="Search description or receipt no."
                className="@2xl/list:ml-auto @2xl/list:max-w-sm @2xl/list:min-w-64 @2xl/list:flex-1"
              />
            </div>

            {category && (
              <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-slate-500">
                Showing
                <button
                  type="button"
                  onClick={() => pickCategory('')}
                  aria-label={`Remove ${category} filter`}
                  className="inline-flex h-9 items-center gap-1.5 rounded-full bg-brand-soft pl-3.5 pr-2.5 font-medium text-brand pointer-coarse:h-11"
                >
                  {category}
                  <X size={11} />
                </button>
              </div>
            )}

            {/* Column headings once rows lay out as a table */}
            {items.length > 0 && (
              <div
                aria-hidden="true"
                className="mt-4 hidden grid-cols-[2.5rem_minmax(0,1fr)_8.5rem_7rem_8rem] gap-3 border-b border-slate-100 pb-2 text-xs font-medium text-slate-400 @2xl/list:grid"
              >
                <span />
                <span>Expense</span>
                <span>Category</span>
                <span>Date</span>
                <span className="text-right">Amount</span>
              </div>
            )}

            <div className={`mt-2 transition-opacity ${list.loading && list.data ? 'opacity-60' : ''}`} aria-busy={list.loading}>
              {list.loading && !list.data && (
                <div className="py-16">
                  <Spinner label="Loading expenses…" />
                </div>
              )}
              {list.error && !list.data && <ErrorState message={list.error} onRetry={() => void list.reload()} />}
              {list.error && list.data && (
                <p role="alert" className="mb-2 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  Couldn’t refresh — showing the last loaded list.{' '}
                  <button type="button" onClick={() => void list.reload()} className="font-semibold underline">
                    Try again
                  </button>
                </p>
              )}
              {list.data && items.length === 0 && (
                <div className="py-10 text-center">
                  {filtered ? (
                    <>
                      <EmptyState title="No matching expenses" hint={`Nothing in ${periodLabel.toLowerCase()} matches your search or category.`} />
                      <button
                        type="button"
                        onClick={() => {
                          setSearch('')
                          pickCategory('')
                        }}
                        className="h-11 rounded-full bg-field px-5 text-sm font-medium text-ink active:bg-line"
                      >
                        Clear filters
                      </button>
                    </>
                  ) : (
                    <>
                      <EmptyState
                        title={period === 'all' ? 'No expenses yet' : `No expenses ${periodLabel.toLowerCase()}`}
                        hint="Record rent, utilities, supplies and other costs to see your real profit."
                      />
                      <button
                        type="button"
                        onClick={() => setDialog({ kind: 'add' })}
                        className="h-11 rounded-full bg-brand px-5 text-sm font-semibold text-white active:scale-95"
                      >
                        Record expense
                      </button>
                    </>
                  )}
                </div>
              )}

              <ul>
                {items.map((expense) => (
                  <li key={expense.id} className="border-b border-slate-100 last:border-b-0">
                    <ExpenseRow expense={expense} money={money} onOpen={() => setDialog({ kind: 'view', expense })} />
                  </li>
                ))}
              </ul>
              {list.data && list.data.totalPages > 1 && (
                <div className="mt-2 border-t border-slate-100">
                  <Pagination page={list.data.page} totalPages={list.data.totalPages} onPage={setPage} />
                </div>
              )}
            </div>
          </Panel>
        </div>
      </div>

      {dialog && (
        <BackLayer name="expenseDialog" onBack={closeDialog} blocked={formDirty} onBlocked={() => setConfirmDiscard(true)}>
          {(close) => {
            const requestClose = () => (formDirty ? setConfirmDiscard(true) : close())
            return (
              <>
                {dialog.kind === 'add' && (
                  <ExpenseForm
                    onClose={requestClose}
                    onDirtyChange={setFormDirty}
                    onSaved={async () => {
                      setFormDirty(false)
                      close()
                      await refresh()
                    }}
                  />
                )}
                {dialog.kind === 'view' && (
                  <ExpenseDetail
                    expense={dialog.expense}
                    onClose={close}
                    onVoided={async () => {
                      close()
                      await refresh()
                    }}
                  />
                )}
                {confirmDiscard && (
                  <ConfirmDialog
                    title="Discard this expense?"
                    message="It hasn’t been saved. What you entered will be lost."
                    confirmLabel="Discard"
                    danger
                    onCancel={() => setConfirmDiscard(false)}
                    onConfirm={() => {
                      setConfirmDiscard(false)
                      setFormDirty(false)
                      close()
                    }}
                  />
                )}
              </>
            )
          }}
        </BackLayer>
      )}
    </WorkPage>
  )
}

/* ------------------------------------------------------------------
   SUMMARY
------------------------------------------------------------------ */

function SummaryCard({
  loading,
  error,
  onRetry,
  periodLabel,
  rows,
  total,
  count,
  category,
  onCategory,
  money,
}: {
  loading: boolean
  error: string | null
  onRetry: () => void
  periodLabel: string
  rows: { name: string; amount: number; count: number }[]
  total: number
  count: number
  category: string
  onCategory: (name: string) => void
  money: (value: number) => string
}) {
  const [showAll, setShowAll] = useState(false)
  const selected = rows.find((row) => row.name === category)
  const shownTotal = category ? selected?.amount ?? 0 : total
  const shownCount = category ? selected?.count ?? 0 : count

  return (
    <section
      aria-label="Expense summary"
      className="@container/sum rounded-2xl bg-white p-4 ring-1 ring-slate-100 sm:p-5 @4xl:sticky @4xl:top-4 @4xl:col-start-2 @4xl:row-start-1"
    >
      {error ? (
        <ErrorState message={error} onRetry={onRetry} />
      ) : (
        <>
          <p className="text-sm text-slate-500">
            {category ? `${category} · ` : 'Total · '}
            {periodLabel.toLowerCase()}
          </p>
          <p className={`mt-0.5 text-3xl font-bold tracking-tight tabular-nums ${loading ? 'text-slate-300' : ''}`}>{money(shownTotal)}</p>
          <p className="mt-0.5 text-sm text-slate-500">
            {shownCount} {shownCount === 1 ? 'expense' : 'expenses'} · voided ones not counted
          </p>

          {loading && (
            <div className="py-6">
              <Spinner />
            </div>
          )}
          {!loading && rows.length > 0 && (
            <>
              <div className="mt-5 flex items-baseline justify-between gap-3">
                <h2 className="text-sm font-semibold">By category</h2>
                <span className="text-xs text-slate-400">Tap to filter</span>
              </div>
              <ul className="mt-2 grid gap-x-4 gap-y-1 @md/sum:grid-cols-2 @3xl/sum:grid-cols-3">
                {rows.map((row, index) => {
                  const share = total > 0 ? row.amount / total : 0
                  const active = row.name === category
                  return (
                    <li key={row.name} className={index >= PHONE_ROWS && !active && !showAll ? 'max-sm:hidden' : undefined}>
                      <button
                        type="button"
                        aria-pressed={active}
                        onClick={() => onCategory(row.name)}
                        className={`flex min-h-12 w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                          active ? 'bg-brand-soft ring-1 ring-brand/25' : category ? 'opacity-60 hover:bg-canvas hover:opacity-100' : 'hover:bg-canvas active:bg-field'
                        }`}
                      >
                        <CategoryIcon name={row.name} size="sm" />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline justify-between gap-2 text-sm">
                            <span className="truncate font-medium">{row.name}</span>
                            <span className="shrink-0 tabular-nums">{money(row.amount)}</span>
                          </span>
                          <span className="mt-1 flex items-center gap-2">
                            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                              <span className="block h-full rounded-full bg-brand" style={{ width: `${Math.max(2, share * 100)}%` }} />
                            </span>
                            <span className="w-9 shrink-0 text-right text-xs tabular-nums text-slate-400">{Math.round(share * 100)}%</span>
                          </span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
              {rows.length > PHONE_ROWS && (
                <button
                  type="button"
                  aria-expanded={showAll}
                  onClick={() => setShowAll((prev) => !prev)}
                  className="mt-1 h-11 w-full rounded-xl text-sm font-medium text-brand active:bg-brand-tint sm:hidden"
                >
                  {showAll ? 'Show fewer' : `Show all ${rows.length} categories`}
                </button>
              )}
            </>
          )}
        </>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------
   LIST ROW — stacked on narrow widths, a table row on wide ones
------------------------------------------------------------------ */

function ExpenseRow({ expense, money, onOpen }: { expense: Expense; money: (value: number) => string; onOpen: () => void }) {
  const voided = Boolean(expense.voidedAt)
  return (
    <button
      type="button"
      onClick={onOpen}
      className="grid min-h-16 w-full grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-xl py-3 text-left transition hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand active:bg-field @2xl/list:grid-cols-[2.5rem_minmax(0,1fr)_8.5rem_7rem_8rem]"
    >
      <span className={voided ? 'opacity-40' : ''}>
        <CategoryIcon name={expense.category} />
      </span>

      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-2">
          <span className={`truncate text-[15px] font-medium ${voided ? 'text-slate-400 line-through' : ''}`}>{expense.description}</span>
          {voided && <Badge tone="red">Voided</Badge>}
          {!voided && expense.paidFromDrawer && <Badge tone="gray">Register</Badge>}
        </span>
        {/* Narrow: one meta line. Wide: only the reference (category and date get their own columns). */}
        <span className="block truncate text-xs text-slate-500 @2xl/list:hidden">
          {formatDate(expense.expenseDate)} · {expense.category}
          {expense.reference && ` · ${expense.reference}`}
        </span>
        <span className="hidden truncate text-xs text-slate-500 @2xl/list:block">
          {expense.expenseNumber}
          {expense.reference && ` · ${expense.reference}`}
        </span>
      </span>

      <span className="hidden truncate text-sm text-slate-600 @2xl/list:block">{expense.category}</span>
      <span className="hidden text-sm tabular-nums text-slate-600 @2xl/list:block">{formatDate(expense.expenseDate)}</span>

      <span className={`text-right text-[15px] font-semibold tabular-nums ${voided ? 'font-normal text-slate-400 line-through' : ''}`}>
        {money(expense.amount)}
      </span>
    </button>
  )
}

/* ------------------------------------------------------------------
   RECORD
------------------------------------------------------------------ */

function ExpenseForm({
  onClose,
  onSaved,
  onDirtyChange,
}: {
  onClose: () => void
  onSaved: () => Promise<void>
  onDirtyChange: (dirty: boolean) => void
}) {
  const { notify } = useToast()
  const { settings } = useSettings()
  const [category, setCategory] = useState('')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [reference, setReference] = useState('')
  const [expenseDate, setExpenseDate] = useState(() => dateKey(new Date()))
  const [fromDrawer, setFromDrawer] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dirty = Boolean(category || amount || description.trim() || reference.trim())
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange])

  const value = Number(amount) || 0
  const problem = value <= 0 ? 'Enter the amount' : !category ? 'Choose a category' : description.trim().length < 3 ? 'Describe the expense' : null

  async function save() {
    if (busy || problem) return
    setBusy(true)
    setError(null)
    try {
      const saved = await expenseApi.create({ category, amount: value, description, reference, expenseDate, paidFromDrawer: fromDrawer })
      notify(`${saved.expenseNumber}: ${formatMoney(saved.amount, settings.currencySymbol)} recorded.`)
      await onSaved()
    } catch (err) {
      setError(getErrorMessage(err))
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Record expense"
      onClose={onClose}
      preventClose={busy}
      size="lg"
      mobileFullScreen
      panelClassName="max-h-[min(92dvh,48rem)] max-w-2xl"
      footer={
        <div className="flex w-full flex-wrap items-center gap-2">
          <p aria-live="polite" className={`basis-full text-sm sm:mr-auto sm:basis-auto ${problem ? 'text-slate-500' : 'font-medium text-brand'}`}>
            {problem ?? 'Ready to save'}
          </p>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="h-12 flex-1 rounded-2xl text-[15px] font-medium text-slate-600 active:bg-slate-100 disabled:opacity-50 sm:flex-none sm:px-5"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy || Boolean(problem)}
            className="h-12 flex-2 rounded-2xl bg-brand px-6 text-[15px] font-semibold text-white transition hover:bg-brand-hover active:scale-[0.99] disabled:bg-slate-200 disabled:text-slate-500 sm:flex-none"
          >
            {busy ? 'Saving…' : 'Save expense'}
          </button>
        </div>
      }
    >
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <TextField label="Amount" amount prefix={settings.currencySymbol} value={amount} onChange={setAmount} placeholder="0.00" autoFocus />

        <fieldset>
          <legend className="text-sm font-medium">Category</legend>
          <div className="mt-1.5 grid grid-cols-2 gap-2 min-[420px]:grid-cols-3">
            {EXPENSE_CATEGORIES.map((name) => {
              const active = category === name
              return (
                <button
                  key={name}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setCategory(name)}
                  className={`flex h-12 min-w-0 items-center gap-2.5 rounded-2xl px-3 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                    active ? 'bg-brand font-semibold text-white shadow-sm' : 'bg-field text-slate-700 active:bg-line'
                  }`}
                >
                  <FontAwesomeIcon icon={CATEGORY_ICONS[name] ?? faReceipt} className={`shrink-0 ${active ? 'text-white/80' : 'text-brand'}`} />
                  <span className="truncate">{name}</span>
                </button>
              )
            })}
          </div>
        </fieldset>

        <TextField label="Description" value={description} onChange={setDescription} placeholder="e.g. Electricity bill for September" maxLength={160} />
        <div className="grid gap-5 sm:grid-cols-2">
          <DateField label="Date paid" value={expenseDate} max={dateKey(new Date())} onChange={setExpenseDate} />
          <TextField label="Receipt / reference no." optional value={reference} onChange={setReference} autoCapitalize="characters" />
        </div>
        <SwitchRow
          label="Paid from the register"
          description="Takes the cash out of your open shift’s drawer"
          checked={fromDrawer}
          onChange={setFromDrawer}
        />
        {error && (
          <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </p>
        )}
      </form>
    </Modal>
  )
}

/* ------------------------------------------------------------------
   DETAIL / VOID
------------------------------------------------------------------ */

function ExpenseDetail({ expense, onClose, onVoided }: { expense: Expense; onClose: () => void; onVoided: () => Promise<void> }) {
  const { notify } = useToast()
  const { settings } = useSettings()
  const [voiding, setVoiding] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const voided = Boolean(expense.voidedAt)

  async function confirmVoid() {
    if (busy) return
    if (reason.trim().length < 3) {
      setError('Enter a reason for voiding this expense.')
      return
    }
    setBusy(true)
    try {
      await expenseApi.void(expense.id, reason)
      notify(`${expense.expenseNumber} voided.`)
      await onVoided()
    } catch (err) {
      setError(getErrorMessage(err))
      setBusy(false)
    }
  }

  return (
    <Modal
      title={expense.expenseNumber}
      onClose={onClose}
      preventClose={busy}
      size="md"
      mobileFullScreen
      footer={
        voided ? undefined : voiding ? (
          <div className="flex w-full gap-2">
            <button
              type="button"
              onClick={() => {
                setVoiding(false)
                setError(null)
              }}
              disabled={busy}
              className="h-12 flex-1 rounded-2xl text-[15px] font-medium text-slate-600 active:bg-slate-100 sm:flex-none sm:px-5"
            >
              Keep expense
            </button>
            <button
              type="button"
              onClick={() => void confirmVoid()}
              disabled={busy}
              className="h-12 flex-1 rounded-2xl bg-rose-600 px-6 text-[15px] font-semibold text-white disabled:opacity-50"
            >
              {busy ? 'Voiding…' : 'Void expense'}
            </button>
          </div>
        ) : (
          <div className="flex w-full justify-between gap-2">
            <button
              type="button"
              onClick={() => setVoiding(true)}
              className="h-12 rounded-2xl px-4 text-[15px] font-medium text-rose-600 active:bg-rose-50"
            >
              Void…
            </button>
            <button type="button" onClick={onClose} className="h-12 rounded-2xl bg-field px-6 text-[15px] font-medium text-ink active:bg-line">
              Done
            </button>
          </div>
        )
      }
    >
      <div className="flex items-start gap-3">
        <CategoryIcon name={expense.category} />
        <div className="min-w-0 flex-1">
          <p className={`text-3xl font-bold tracking-tight tabular-nums ${voided ? 'text-slate-400 line-through' : ''}`}>
            {formatMoney(expense.amount, settings.currencySymbol)}
          </p>
          <p className="mt-1 wrap-break-word text-[15px]">{expense.description}</p>
          {voided && (
            <div className="mt-2">
              <Badge tone="red">Voided</Badge>
            </div>
          )}
        </div>
      </div>

      {voided && (
        <p className="mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
          Voided {formatDateTime(expense.voidedAt)} by {expense.voidedBy}. Reason: {expense.voidReason}
        </p>
      )}

      <div className="mt-3">
        <DetailList>
          <DetailRow label="Category" value={expense.category} />
          <DetailRow label="Date paid" value={formatDate(expense.expenseDate)} />
          <DetailRow label="Reference" value={expense.reference} />
          <DetailRow label="Paid from" value={expense.paidFromDrawer ? 'The register (shift cash-out)' : 'Outside the register'} />
          <DetailRow label="Recorded" value={`${formatDateTime(expense.createdAt)} · ${expense.createdBy}`} />
        </DetailList>
      </div>

      {voiding && (
        <div className="mt-4 space-y-2 rounded-2xl bg-canvas p-4">
          <ReasonField
            label="Why void this expense?"
            value={reason}
            onChange={(value) => {
              setReason(value)
              setError(null)
            }}
            suggestions={['Entered twice', 'Wrong amount', 'Not a store expense']}
            error={error}
            disabled={busy}
          />
          <p className="text-xs text-slate-500">
            It stays on record but no longer counts toward totals or the profit report.
            {expense.paidFromDrawer && ' If the cash went back into the register, record a cash-in on the shift so the drawer still balances.'}
          </p>
        </div>
      )}
    </Modal>
  )
}

export default ExpensesPage
