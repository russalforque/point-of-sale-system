import type { CreditEntry, Customer, PagedResult, PaymentMethod } from '../types'
import { querySQL, executeSQL } from '../database/sqlite'
import { nextDocumentNumber, runTransaction, type SqlStatement } from '../database/tx'
import { settingsApi } from './settingsApi'
import { auditStatement } from '../services/audit'
import { requirePermission } from '../services/authz'
import { CREDIT_ENTRY_TYPE, creditEntryLabel, creditEntryStatements } from '../services/credit'
import { CASH_METHOD, methodLabel } from '../services/payments'
import { roundMoney } from '../utils/amount'
import { ApiError } from '../utils/errors'
import { formatMoney } from '../utils/format'
import { PAYMENT_OPTIONS } from '../utils/pos'

export type CustomerPayload = {
  fullName: string
  phone?: string
  email?: string
  address?: string
  notes?: string
  isActive: boolean
}

export type CreditPaymentPayload = {
  customerId: number
  amount: number
  method: PaymentMethod
  reference?: string
  notes?: string
}

/** A customer who owes money, with the due date of the oldest charge not yet paid off. */
export type Receivable = {
  customerId: number
  customerCode: string
  fullName: string
  phone: string | null
  balance: number
  creditLimit: number
  oldestDueDate: string | null
  overdue: boolean
}

type CustomerRow = {
  id: number
  customer_code: string
  full_name: string
  phone: string | null
  email: string | null
  address: string | null
  is_active: number
  created_at: string
  loyalty_points: number
  credit_limit: number | null
  credit_balance: number | null
  notes: string | null
}

function toCustomer(row: CustomerRow): Customer {
  return {
    id: row.id,
    customerCode: row.customer_code,
    fullName: row.full_name,
    phone: row.phone,
    email: row.email,
    address: row.address,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    loyaltyPoints: row.loyalty_points,
    creditLimit: row.credit_limit ?? 0,
    creditBalance: row.credit_balance ?? 0,
    notes: row.notes ?? null,
  }
}

function buildFilters(params?: { search?: string; isActive?: boolean; withBalance?: boolean }) {
  const clauses: string[] = []
  const values: unknown[] = []

  if (params?.search) {
    clauses.push('(full_name LIKE ? OR phone LIKE ? OR customer_code LIKE ? OR email LIKE ?)')
    const term = `%${params.search}%`
    values.push(term, term, term, term)
  }

  if (params?.isActive !== undefined) {
    clauses.push('is_active = ?')
    values.push(params.isActive ? 1 : 0)
  }

  if (params?.withBalance) clauses.push('credit_balance > 0.004')

  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', values }
}

function validate(payload: CustomerPayload): void {
  if (!payload.fullName.trim()) throw new ApiError('Enter the customer’s name.', 400)
}

/** Same phone number on two active customers is almost always a duplicate record. */
async function assertUniquePhone(phone: string | undefined, exceptId?: number): Promise<void> {
  const digits = (phone ?? '').replace(/\D/g, '')
  if (digits.length < 7) return
  const result = await querySQL(
    `SELECT full_name, phone FROM customers WHERE id != ? AND is_active = 1 AND phone IS NOT NULL AND phone != ''`,
    [exceptId ?? -1],
  )
  const clash = ((result.values ?? []) as { full_name: string; phone: string }[]).find(
    (row) => row.phone.replace(/\D/g, '') === digits,
  )
  if (clash) throw new ApiError(`${clash.full_name} already has this phone number.`, 400)
}

type EntryRow = {
  id: number
  entry_number: string
  customer_id: number
  type: number
  amount: number
  balance_after: number
  sale_id: number | null
  invoice_number: string | null
  method: number | null
  reference: string | null
  due_date: string | null
  notes: string | null
  created_by: string
  created_at: string
}

function toEntry(row: EntryRow): CreditEntry {
  return {
    id: row.id,
    entryNumber: row.entry_number,
    customerId: row.customer_id,
    type: row.type,
    typeLabel: creditEntryLabel(row.type),
    amount: row.amount,
    balanceAfter: row.balance_after,
    saleId: row.sale_id,
    invoiceNumber: row.invoice_number,
    method: row.method,
    methodLabel: row.method === null ? null : methodLabel(row.method),
    reference: row.reference,
    dueDate: row.due_date,
    notes: row.notes,
    createdBy: row.created_by,
    createdAt: row.created_at,
  }
}

/** Local yyyy-mm-dd for today. */
function todayKey(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/**
 * Due date of the oldest charge still unpaid. Payments and reversals pay off the oldest
 * charges first (FIFO), which is how customers and store owners think about a tab.
 */
async function oldestUnpaidDueDate(customerId: number): Promise<string | null> {
  const result = await querySQL(
    `SELECT type, amount, due_date FROM customer_credit_entries WHERE customer_id = ? ORDER BY created_at ASC, id ASC`,
    [customerId],
  )
  const open: { amount: number; dueDate: string | null }[] = []
  let credit = 0
  for (const row of (result.values ?? []) as { type: number; amount: number; due_date: string | null }[]) {
    if (row.type === CREDIT_ENTRY_TYPE.CHARGE) {
      open.push({ amount: row.amount, dueDate: row.due_date })
    } else {
      credit += row.amount
    }
    while (open.length && credit > 0.004) {
      const first = open[0]!
      const used = Math.min(first.amount, credit)
      first.amount = roundMoney(first.amount - used)
      credit = roundMoney(credit - used)
      if (first.amount <= 0.004) open.shift()
    }
  }
  return open[0]?.dueDate ?? null
}

export const customerApi = {
  list: async (params: {
    search?: string
    isActive?: boolean
    withBalance?: boolean
    page?: number
    pageSize?: number
  }): Promise<PagedResult<Customer>> => {
    const { where, values } = buildFilters(params)
    const page = params.page ?? 1
    const pageSize = params.pageSize ?? 10

    const countResult = await querySQL(`SELECT COUNT(*) AS count FROM customers ${where}`, values)
    const totalCount = (countResult.values?.[0]?.count as number | undefined) ?? 0

    const result = await querySQL(
      `SELECT * FROM customers ${where} ORDER BY full_name ASC LIMIT ? OFFSET ?`,
      [...values, pageSize, (page - 1) * pageSize],
    )

    return {
      items: ((result.values ?? []) as CustomerRow[]).map(toCustomer),
      totalCount,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
    }
  },

  lookup: async (search?: string): Promise<Customer[]> => {
    const { where, values } = buildFilters({ search, isActive: true })
    const result = await querySQL(
      `SELECT * FROM customers ${where} ORDER BY full_name ASC LIMIT 20`,
      values,
    )
    return ((result.values ?? []) as CustomerRow[]).map(toCustomer)
  },

  get: async (id: number): Promise<Customer> => {
    const result = await querySQL(`SELECT * FROM customers WHERE id = ? LIMIT 1`, [id])
    const row = result.values?.[0] as CustomerRow | undefined
    if (!row) throw new ApiError('Customer not found.', 404)
    return toCustomer(row)
  },

  create: async (payload: CustomerPayload): Promise<Customer> => {
    await requirePermission('customers.create')
    validate(payload)
    await assertUniquePhone(payload.phone)
    const result = await executeSQL(
      `INSERT INTO customers (customer_code, full_name, phone, email, address, notes, is_active, created_at, loyalty_points)
       VALUES ('', ?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        payload.fullName.trim(),
        payload.phone || null,
        payload.email || null,
        payload.address || null,
        payload.notes?.trim() || null,
        payload.isActive ? 1 : 0,
        new Date().toISOString(),
      ],
    )
    const id = result.changes?.lastId
    if (!id) throw new ApiError('Failed to create customer.', 500)
    await executeSQL(`UPDATE customers SET customer_code = ? WHERE id = ?`, [
      `CUS-${String(id).padStart(4, '0')}`,
      id,
    ])
    return customerApi.get(id)
  },

  update: async (id: number, payload: CustomerPayload): Promise<Customer> => {
    await requirePermission('customers.manage')
    validate(payload)
    await assertUniquePhone(payload.phone, id)
    const before = await customerApi.get(id)
    await executeSQL(
      `UPDATE customers SET full_name = ?, phone = ?, email = ?, address = ?, notes = ?, is_active = ? WHERE id = ?`,
      [
        payload.fullName.trim(),
        payload.phone || null,
        payload.email || null,
        payload.address || null,
        // Forms that predate notes don't send them: keep what's stored.
        payload.notes === undefined ? before.notes : payload.notes.trim() || null,
        payload.isActive ? 1 : 0,
        id,
      ],
    )
    return customerApi.get(id)
  },

  deactivate: async (id: number): Promise<void> => {
    await requirePermission('customers.manage')
    const customer = await customerApi.get(id)
    if (customer.creditBalance > 0.004) {
      throw new ApiError(`${customer.fullName} still owes a balance. Settle it before deactivating.`, 400)
    }
    await executeSQL(`UPDATE customers SET is_active = 0 WHERE id = ?`, [id])
  },

  /* ------------------------------------------------------------------
     CUSTOMER CREDIT
  ------------------------------------------------------------------ */

  setCreditLimit: async (id: number, limit: number): Promise<Customer> => {
    await requirePermission('credit.manage')
    const value = roundMoney(limit)
    if (!Number.isFinite(value) || value < 0) throw new ApiError('Enter a credit limit of zero or more.', 400)
    const customer = await customerApi.get(id)
    if (value === customer.creditLimit) return customer
    const symbol = (await settingsApi.get()).currencySymbol
    await runTransaction([
      { statement: `UPDATE customers SET credit_limit = ? WHERE id = ?`, values: [value, id] },
      auditStatement(
        'credit',
        `${customer.fullName}: credit limit ${formatMoney(customer.creditLimit, symbol)} → ${formatMoney(value, symbol)}`,
        { type: 'customer', id },
      ),
    ])
    return customerApi.get(id)
  },

  creditEntries: async (customerId: number, params: { page?: number; pageSize?: number } = {}): Promise<PagedResult<CreditEntry>> => {
    const page = params.page ?? 1
    const pageSize = params.pageSize ?? 10
    const countResult = await querySQL(`SELECT COUNT(*) AS count FROM customer_credit_entries WHERE customer_id = ?`, [customerId])
    const totalCount = (countResult.values?.[0]?.count as number | undefined) ?? 0
    const result = await querySQL(
      `SELECT e.*, s.invoice_number AS invoice_number
       FROM customer_credit_entries e LEFT JOIN sales s ON s.id = e.sale_id
       WHERE e.customer_id = ? ORDER BY e.created_at DESC, e.id DESC LIMIT ? OFFSET ?`,
      [customerId, pageSize, (page - 1) * pageSize],
    )
    return {
      items: ((result.values ?? []) as EntryRow[]).map(toEntry),
      totalCount,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
    }
  },

  /** Due date of the oldest unpaid charge, or null when nothing is owed. */
  creditDueDate: async (customerId: number): Promise<{ dueDate: string | null; overdue: boolean }> => {
    const dueDate = await oldestUnpaidDueDate(customerId)
    return { dueDate, overdue: dueDate !== null && dueDate < todayKey() }
  },

  /** Everyone who owes money, most overdue first. */
  receivables: async (): Promise<Receivable[]> => {
    const result = await querySQL(
      `SELECT id, customer_code, full_name, phone, credit_balance, credit_limit FROM customers WHERE credit_balance > 0.004 ORDER BY credit_balance DESC`,
    )
    const today = todayKey()
    const rows = (result.values ?? []) as {
      id: number
      customer_code: string
      full_name: string
      phone: string | null
      credit_balance: number
      credit_limit: number
    }[]
    const list = await Promise.all(
      rows.map(async (row) => {
        const oldestDueDate = await oldestUnpaidDueDate(row.id)
        return {
          customerId: row.id,
          customerCode: row.customer_code,
          fullName: row.full_name,
          phone: row.phone,
          balance: row.credit_balance,
          creditLimit: row.credit_limit,
          oldestDueDate,
          overdue: oldestDueDate !== null && oldestDueDate < today,
        }
      }),
    )
    return list.sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.oldestDueDate ?? '9').localeCompare(b.oldestDueDate ?? '9'))
  },

  /**
   * Customer pays towards their balance. Cash goes into the collector's open drawer (a cash-in
   * movement), so the shift's expected cash stays right.
   */
  recordCreditPayment: async (payload: CreditPaymentPayload): Promise<Customer> => {
    const actor = await requirePermission('sales.process')
    const settings = await settingsApi.get()
    const money = (value: number) => formatMoney(value, settings.currencySymbol)
    const amount = roundMoney(payload.amount)
    if (!Number.isFinite(amount) || amount <= 0) throw new ApiError('Enter an amount above zero.', 400)
    if (!PAYMENT_OPTIONS.some((option) => option.value === payload.method)) throw new ApiError('Choose how the customer paid.', 400)
    const reference = payload.reference?.trim() || null
    if (payload.method !== CASH_METHOD && !reference) throw new ApiError(`Enter the ${methodLabel(payload.method)} reference.`, 400)

    const customer = await customerApi.get(payload.customerId)
    if (amount > roundMoney(customer.creditBalance) + 0.005) {
      throw new ApiError(`${customer.fullName} only owes ${money(Math.max(customer.creditBalance, 0))}.`, 400)
    }

    const shiftResult = await querySQL(`SELECT id FROM shifts WHERE employee_id = ? AND status = 0 LIMIT 1`, [actor.id])
    const shiftId = (shiftResult.values?.[0]?.id as number | undefined) ?? null
    if (payload.method === CASH_METHOD && !shiftId) {
      throw new ApiError('Start your shift first so this cash is counted in your drawer.', 400)
    }

    const now = new Date().toISOString()
    const entryNumber = await nextDocumentNumber('customer_credit_entries', 'CR')
    const statements: SqlStatement[] = [
      ...creditEntryStatements({
        entryNumber,
        customerId: customer.id,
        type: CREDIT_ENTRY_TYPE.PAYMENT,
        amount,
        method: payload.method,
        reference,
        notes: payload.notes?.trim() || null,
        shiftId,
        createdBy: actor.fullName,
        at: now,
      }),
    ]
    if (payload.method === CASH_METHOD && shiftId) {
      statements.push({
        statement: `INSERT INTO cash_movements (shift_id, type, amount, reason, created_by, created_at) VALUES (?, 1, ?, ?, ?, ?)`,
        values: [shiftId, amount, `Credit payment ${entryNumber} · ${customer.fullName}`, actor.fullName, now],
      })
    }
    statements.push(
      auditStatement(
        'credit',
        `${entryNumber}: ${customer.fullName} paid ${money(amount)} (${methodLabel(payload.method)}${reference ? ` ref ${reference}` : ''}) · balance ${money(customer.creditBalance)} → ${money(roundMoney(customer.creditBalance - amount))}`,
        { type: 'customer', id: customer.id },
        actor,
        now,
      ),
    )
    await runTransaction(statements)
    return customerApi.get(customer.id)
  },
}
