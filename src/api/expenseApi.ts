import type { Expense, PagedResult } from '../types'
import { querySQL } from '../database/sqlite'
import { idByNumber, nextDocumentNumber, runTransaction, type SqlStatement } from '../database/tx'
import { settingsApi } from './settingsApi'
import { shiftApi } from './shiftApi'
import { auditStatement } from '../services/audit'
import { requirePermission } from '../services/authz'
import { roundMoney } from '../utils/amount'
import { ApiError } from '../utils/errors'
import { formatMoney } from '../utils/format'

/**
 * Business expenses (rent, utilities, supplies…). They are never deleted: a mistake is voided
 * with a reason and drops out of the totals. An expense paid from the register is also a
 * cash-out on the recorder's open shift, so the drawer count still balances.
 */

export const EXPENSE_CATEGORIES = [
  'Rent',
  'Utilities',
  'Salaries',
  'Supplies',
  'Transport',
  'Repairs',
  'Marketing',
  'Taxes & fees',
  'Other',
] as const

export type ExpensePayload = {
  category: string
  amount: number
  description: string
  reference?: string
  /** yyyy-mm-dd */
  expenseDate: string
  paidFromDrawer: boolean
}

type ExpenseRow = {
  id: number
  expense_number: string
  category: string
  amount: number
  description: string
  reference: string | null
  expense_date: string
  paid_from_drawer: number
  created_by: string
  created_at: string
  voided_at: string | null
  voided_by: string | null
  void_reason: string | null
}

function toExpense(row: ExpenseRow): Expense {
  return {
    id: row.id,
    expenseNumber: row.expense_number,
    category: row.category,
    amount: row.amount,
    description: row.description,
    reference: row.reference,
    expenseDate: row.expense_date,
    paidFromDrawer: Boolean(row.paid_from_drawer),
    createdBy: row.created_by,
    createdAt: row.created_at,
    voidedAt: row.voided_at,
    voidedBy: row.voided_by,
    voidReason: row.void_reason,
  }
}

export type ExpenseFilters = {
  /** yyyy-mm-dd, inclusive */
  from?: string
  /** yyyy-mm-dd, inclusive */
  to?: string
  category?: string
  search?: string
  includeVoided?: boolean
}

function filters(params: ExpenseFilters) {
  const clauses: string[] = []
  const values: unknown[] = []
  if (!params.includeVoided) clauses.push('voided_at IS NULL')
  if (params.from) {
    clauses.push('expense_date >= ?')
    values.push(params.from)
  }
  if (params.to) {
    clauses.push('expense_date <= ?')
    values.push(params.to)
  }
  if (params.category) {
    clauses.push('category = ?')
    values.push(params.category)
  }
  if (params.search?.trim()) {
    clauses.push('(description LIKE ? OR reference LIKE ? OR expense_number LIKE ?)')
    const term = `%${params.search.trim()}%`
    values.push(term, term, term)
  }
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', values }
}

export const expenseApi = {
  list: async (params: ExpenseFilters & { page?: number; pageSize?: number } = {}): Promise<PagedResult<Expense>> => {
    const { where, values } = filters(params)
    const page = params.page ?? 1
    const pageSize = params.pageSize ?? 20
    const countResult = await querySQL(`SELECT COUNT(*) AS count FROM expenses ${where}`, values)
    const totalCount = (countResult.values?.[0]?.count as number | undefined) ?? 0
    const result = await querySQL(
      `SELECT * FROM expenses ${where} ORDER BY expense_date DESC, created_at DESC LIMIT ? OFFSET ?`,
      [...values, pageSize, (page - 1) * pageSize],
    )
    return {
      items: ((result.values ?? []) as ExpenseRow[]).map(toExpense),
      totalCount,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
    }
  },

  /** Totals for a period (voided expenses excluded), overall and per category. */
  summary: async (params: ExpenseFilters = {}): Promise<{ total: number; count: number; byCategory: { name: string; amount: number; count: number }[] }> => {
    const { where, values } = filters({ ...params, includeVoided: false })
    const result = await querySQL(
      `SELECT category AS name, ROUND(SUM(amount), 2) AS amount, COUNT(*) AS count FROM expenses ${where} GROUP BY category ORDER BY amount DESC`,
      values,
    )
    const byCategory = (result.values ?? []) as { name: string; amount: number; count: number }[]
    return {
      total: roundMoney(byCategory.reduce((sum, row) => sum + row.amount, 0)),
      count: byCategory.reduce((sum, row) => sum + row.count, 0),
      byCategory,
    }
  },

  create: async (payload: ExpensePayload): Promise<Expense> => {
    const actor = await requirePermission('expenses.manage')
    const category = payload.category.trim()
    const description = payload.description.trim()
    const amount = roundMoney(payload.amount)
    if (!category) throw new ApiError('Choose a category.', 400)
    if (!Number.isFinite(amount) || amount <= 0) throw new ApiError('Enter an amount above zero.', 400)
    if (description.length < 3) throw new ApiError('Describe what the expense was for.', 400)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.expenseDate)) throw new ApiError('Enter the expense date.', 400)

    const settings = await settingsApi.get()
    const money = (value: number) => formatMoney(value, settings.currencySymbol)
    const now = new Date().toISOString()
    const expenseNumber = await nextDocumentNumber('expenses', 'EX')
    const reference = payload.reference?.trim() || null

    let shiftId: number | null = null
    if (payload.paidFromDrawer) {
      const active = await shiftApi.getActive()
      if (!active) throw new ApiError('Start your shift first to pay this from the register.', 400)
      const { summary } = await shiftApi.summary()
      if (amount > summary.expectedCash + 0.005) {
        throw new ApiError(`The drawer should only have ${money(summary.expectedCash)}.`, 400)
      }
      shiftId = active.id
    }

    const statements: SqlStatement[] = [
      {
        statement: `INSERT INTO expenses (expense_number, category, amount, description, reference, expense_date, paid_from_drawer, shift_id, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        values: [expenseNumber, category, amount, description, reference, payload.expenseDate, payload.paidFromDrawer ? 1 : 0, shiftId, actor.fullName, now],
      },
    ]
    if (shiftId) {
      statements.push({
        statement: `INSERT INTO cash_movements (shift_id, type, amount, reason, created_by, created_at) VALUES (?, 2, ?, ?, ?, ?)`,
        values: [shiftId, amount, `Expense ${expenseNumber} · ${description}`, actor.fullName, now],
      })
    }
    statements.push(
      auditStatement(
        'expense',
        `${expenseNumber}: ${money(amount)} ${category} · ${description}${reference ? ` (ref ${reference})` : ''}${shiftId ? ' · paid from register' : ''}`,
        { type: 'expense', id: expenseNumber },
        actor,
        now,
      ),
    )
    await runTransaction(statements)

    const id = await idByNumber('expenses', 'expense_number', expenseNumber)
    if (!id) throw new ApiError('Failed to save the expense.', 500)
    const result = await querySQL(`SELECT * FROM expenses WHERE id = ? LIMIT 1`, [id])
    return toExpense(result.values?.[0] as ExpenseRow)
  },

  /**
   * Voids a mistaken expense. Cash taken from a drawer is not put back automatically: if the
   * money really went back into the register, record a cash-in on the shift.
   */
  void: async (id: number, reason: string): Promise<void> => {
    const actor = await requirePermission('expenses.manage')
    const trimmed = reason.trim()
    if (trimmed.length < 3) throw new ApiError('Enter a reason for voiding this expense.', 400)
    const result = await querySQL(`SELECT * FROM expenses WHERE id = ? LIMIT 1`, [id])
    const row = result.values?.[0] as ExpenseRow | undefined
    if (!row) throw new ApiError('Expense not found.', 404)
    if (row.voided_at) throw new ApiError('This expense is already voided.', 400)
    const now = new Date().toISOString()
    const symbol = (await settingsApi.get()).currencySymbol
    await runTransaction([
      {
        statement: `UPDATE expenses SET voided_at = ?, voided_by = ?, void_reason = ? WHERE id = ? AND voided_at IS NULL`,
        values: [now, actor.fullName, trimmed, id],
      },
      auditStatement(
        'expense',
        `${row.expense_number} voided · ${formatMoney(row.amount, symbol)} ${row.category} · ${trimmed}`,
        { type: 'expense', id: row.expense_number },
        actor,
        now,
      ),
    ])
  },
}
