import { useState } from 'react'

import { customerApi } from '../../api/customerApi'
import { useAuth } from '../../context/AuthContext'
import { useSettings } from '../../context/SettingsContext'
import { useToast } from '../../context/ToastContext'
import { useAsync } from '../../hooks/useAsync'
import { CREDIT_ENTRY_TYPE } from '../../services/credit'
import { CASH_METHOD } from '../../services/payments'
import type { Customer, PaymentMethod } from '../../types'
import { getErrorMessage } from '../../utils/errors'
import { formatDate, formatDateTime, formatMoney } from '../../utils/format'
import { PAYMENT_OPTIONS } from '../../utils/pos'
import { AmountInput } from '../ui/AmountInput'
import { Pagination } from '../ui/Pagination'
import { Spinner } from '../ui/States'

/**
 * A customer's credit account: what they owe, their limit, taking a payment and the full
 * history of charges and payments. Shared by the tablet and phone customer profiles.
 * Hidden entirely while customer credit is off and nothing is owed.
 */
export function CustomerCreditPanel({ customer, onChanged }: { customer: Customer; onChanged: (customer: Customer) => void }) {
  const { settings } = useSettings()
  const { can } = useAuth()
  const { notify } = useToast()
  const money = (value: number) => formatMoney(value, settings.currencySymbol)

  const [page, setPage] = useState(1)
  const [mode, setMode] = useState<'none' | 'pay' | 'limit'>('none')
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<PaymentMethod>(CASH_METHOD)
  const [reference, setReference] = useState('')
  const [limit, setLimit] = useState(String(customer.creditLimit || ''))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const hasHistory = settings.creditEnabled || customer.creditBalance !== 0
  const entries = useAsync(
    () => (hasHistory ? customerApi.creditEntries(customer.id, { page, pageSize: 8 }) : Promise.resolve(null)),
    [customer.id, customer.creditBalance, page, hasHistory],
  )
  const due = useAsync(
    () => (customer.creditBalance > 0.004 ? customerApi.creditDueDate(customer.id) : Promise.resolve(null)),
    [customer.id, customer.creditBalance],
  )

  if (!hasHistory) return null

  const owes = customer.creditBalance > 0.004
  const available = Math.max(customer.creditLimit - customer.creditBalance, 0)

  function start(next: 'pay' | 'limit') {
    setMode(next)
    setError(null)
    setAmount(next === 'pay' && owes ? String(customer.creditBalance) : '')
    setReference('')
    setLimit(String(customer.creditLimit || ''))
  }

  async function submit() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const updated =
        mode === 'pay'
          ? await customerApi.recordCreditPayment({ customerId: customer.id, amount: Number(amount) || 0, method, reference })
          : await customerApi.setCreditLimit(customer.id, Number(limit) || 0)
      notify(mode === 'pay' ? `Payment of ${money(Number(amount) || 0)} recorded.` : 'Credit limit updated.')
      setMode('none')
      onChanged(updated)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-2xl ring-1 ring-slate-100">
      <div className="flex flex-wrap items-start justify-between gap-3 p-4">
        <div>
          <h3 className="text-sm font-medium text-slate-500">Credit account</h3>
          <p className={`mt-0.5 text-2xl font-bold tabular-nums ${owes ? 'text-amber-700' : ''}`}>
            {customer.creditBalance < -0.004 ? `${money(-customer.creditBalance)} credit` : money(Math.max(customer.creditBalance, 0))}
          </p>
          <p className="text-xs text-slate-500">
            {owes ? 'Owed · ' : ''}
            {customer.creditLimit > 0 ? `Limit ${money(customer.creditLimit)} · ${money(available)} available` : 'No credit limit set — can’t charge yet'}
          </p>
          {due.data?.dueDate && (
            <p className={`mt-1 text-xs font-medium ${due.data.overdue ? 'text-rose-600' : 'text-slate-500'}`}>
              {due.data.overdue ? 'Overdue since' : 'Due'} {formatDate(due.data.dueDate)}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {owes && can('sales.process') && (
            <button
              type="button"
              onClick={() => start('pay')}
              className="h-11 rounded-full bg-[#1F5E3B] px-4 text-sm font-semibold text-white active:scale-95"
            >
              Record payment
            </button>
          )}
          {can('credit.manage') && (
            <button
              type="button"
              onClick={() => start('limit')}
              className="h-11 rounded-full px-4 text-sm font-medium text-[#1F5E3B] ring-1 ring-slate-200 active:bg-[#F2F8F4]"
            >
              {customer.creditLimit > 0 ? 'Change limit' : 'Set credit limit'}
            </button>
          )}
        </div>
      </div>

      {mode !== 'none' && (
        <form
          className="space-y-3 border-t border-slate-100 p-4"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          {mode === 'pay' ? (
            <>
              <label className="flex h-12 items-center gap-2 rounded-2xl bg-[#F3F5F4] px-4 focus-within:ring-2 focus-within:ring-[#1F5E3B]">
                <span className="text-sm text-slate-500">Amount {settings.currencySymbol}</span>
                <AmountInput
                  autoFocus
                  aria-label="Payment amount"
                  value={amount}
                  onChange={setAmount}
                  className="h-12 min-w-0 flex-1 bg-transparent text-right text-lg font-semibold tabular-nums outline-none"
                />
              </label>
              <div role="radiogroup" aria-label="Paid with" className="grid grid-cols-4 gap-1 rounded-2xl bg-[#F1F4F3] p-1">
                {PAYMENT_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={method === option.value}
                    onClick={() => setMethod(option.value)}
                    className={`h-11 rounded-xl text-sm transition ${
                      method === option.value ? 'bg-white font-semibold text-[#1F5E3B] shadow-sm' : 'font-medium text-slate-600'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {method !== CASH_METHOD && (
                <input
                  type="text"
                  aria-label="Payment reference"
                  value={reference}
                  onChange={(event) => setReference(event.target.value)}
                  placeholder="Reference no."
                  autoCapitalize="characters"
                  className="h-12 w-full rounded-2xl border-0 bg-[#F3F5F4] px-4 text-[15px] outline-none focus:bg-white focus:ring-2 focus:ring-[#1F5E3B]"
                />
              )}
              {method === CASH_METHOD && <p className="text-xs text-slate-500">Cash is added to your open shift’s drawer.</p>}
            </>
          ) : (
            <label className="flex h-12 items-center gap-2 rounded-2xl bg-[#F3F5F4] px-4 focus-within:ring-2 focus-within:ring-[#1F5E3B]">
              <span className="text-sm text-slate-500">Credit limit {settings.currencySymbol}</span>
              <AmountInput
                autoFocus
                aria-label="Credit limit"
                value={limit}
                onChange={setLimit}
                className="h-12 min-w-0 flex-1 bg-transparent text-right text-lg font-semibold tabular-nums outline-none"
              />
            </label>
          )}
          {error && (
            <p role="alert" className="text-sm text-rose-600">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setMode('none')} disabled={busy} className="h-11 rounded-full px-4 text-sm font-medium text-slate-600">
              Cancel
            </button>
            <button type="submit" disabled={busy} className="h-11 rounded-full bg-[#1F5E3B] px-5 text-sm font-semibold text-white disabled:opacity-50">
              {busy ? 'Saving…' : mode === 'pay' ? 'Save payment' : 'Save limit'}
            </button>
          </div>
        </form>
      )}

      <div className="border-t border-slate-100 px-4 pb-3">
        {entries.loading && !entries.data && (
          <div className="py-6">
            <Spinner />
          </div>
        )}
        {entries.data && entries.data.items.length === 0 && <p className="py-4 text-sm text-slate-400">No charges or payments yet.</p>}
        <ul>
          {(entries.data?.items ?? []).map((entry) => {
            const charge = entry.type === CREDIT_ENTRY_TYPE.CHARGE
            return (
              <li key={entry.id} className="flex items-center justify-between gap-3 border-b border-slate-100 py-2.5 text-sm last:border-b-0">
                <div className="min-w-0">
                  <p className="truncate">
                    {entry.typeLabel}
                    {entry.invoiceNumber && <span className="text-slate-500"> · {entry.invoiceNumber}</span>}
                    {entry.type === CREDIT_ENTRY_TYPE.PAYMENT && entry.methodLabel && <span className="text-slate-500"> · {entry.methodLabel}</span>}
                  </p>
                  <p className="truncate text-xs text-slate-400">
                    {formatDateTime(entry.createdAt)} · {entry.createdBy}
                    {charge && entry.dueDate && ` · due ${formatDate(entry.dueDate)}`}
                  </p>
                </div>
                <div className="shrink-0 text-right tabular-nums">
                  <p className={charge ? 'font-medium text-amber-700' : 'font-medium text-[#1F5E3B]'}>
                    {charge ? '+' : '−'}
                    {money(entry.amount)}
                  </p>
                  <p className="text-xs text-slate-400">bal {money(entry.balanceAfter)}</p>
                </div>
              </li>
            )
          })}
        </ul>
        {entries.data && entries.data.totalPages > 1 && <Pagination page={entries.data.page} totalPages={entries.data.totalPages} onPage={setPage} />}
      </div>
    </section>
  )
}
