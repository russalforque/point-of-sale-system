import type { SqlStatement } from '../database/tx'

/**
 * Customer credit ("charge to account" / utang). Every change to a customer's balance is a row
 * in customer_credit_entries written in the same transaction as customers.credit_balance, so
 * the ledger always explains the balance. A negative balance means the store owes the customer.
 */

/** payments.method / sale_payments.method for a sale (or part of one) charged to the customer's account. */
export const CHARGE_METHOD = 4

export const CREDIT_ENTRY_TYPE = {
  /** Sale charged to the account: balance goes up. */
  CHARGE: 1,
  /** Customer paid towards the balance: balance goes down. */
  PAYMENT: 2,
  /** Charged sale refunded or voided: balance goes down. */
  REVERSAL: 3,
} as const

export type CreditEntryType = (typeof CREDIT_ENTRY_TYPE)[keyof typeof CREDIT_ENTRY_TYPE]

export function creditEntryLabel(type: number): string {
  if (type === CREDIT_ENTRY_TYPE.CHARGE) return 'Charge'
  if (type === CREDIT_ENTRY_TYPE.PAYMENT) return 'Payment'
  if (type === CREDIT_ENTRY_TYPE.REVERSAL) return 'Refund / void'
  return 'Adjustment'
}

type CreditEntry = {
  entryNumber: string
  customerId: number
  type: CreditEntryType
  /** Always positive; the type decides the direction. */
  amount: number
  /** Sub-select or literal id of the related sale, if any. */
  saleId?: { sql: string; values: unknown[] } | number | null
  method?: number | null
  reference?: string | null
  dueDate?: string | null
  notes?: string | null
  shiftId?: number | null
  createdBy: string
  at: string
}

/** Balance update + ledger row, for inclusion in the caller's transaction. */
export function creditEntryStatements(entry: CreditEntry): SqlStatement[] {
  const delta = entry.type === CREDIT_ENTRY_TYPE.CHARGE ? entry.amount : -entry.amount
  const sale =
    entry.saleId && typeof entry.saleId === 'object'
      ? { sql: entry.saleId.sql, values: entry.saleId.values }
      : { sql: '?', values: [entry.saleId ?? null] }
  return [
    {
      statement: `UPDATE customers SET credit_balance = ROUND(credit_balance + ?, 2) WHERE id = ?`,
      values: [delta, entry.customerId],
    },
    {
      statement: `INSERT INTO customer_credit_entries
         (entry_number, customer_id, type, amount, balance_after, sale_id, method, reference, due_date, notes, shift_id, created_by, created_at)
         VALUES (?, ?, ?, ?, (SELECT credit_balance FROM customers WHERE id = ?), ${sale.sql}, ?, ?, ?, ?, ?, ?, ?)`,
      values: [
        entry.entryNumber,
        entry.customerId,
        entry.type,
        entry.amount,
        entry.customerId,
        ...sale.values,
        entry.method ?? null,
        entry.reference ?? null,
        entry.dueDate ?? null,
        entry.notes ?? null,
        entry.shiftId ?? null,
        entry.createdBy,
        entry.at,
      ],
    },
  ]
}

/** yyyy-mm-dd `days` from `from`, in the device's calendar. */
export function dueDateFrom(days: number, from = new Date()): string {
  const due = new Date(from.getFullYear(), from.getMonth(), from.getDate() + Math.max(0, Math.round(days)))
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${due.getFullYear()}-${pad(due.getMonth() + 1)}-${pad(due.getDate())}`
}
