import type { PagedResult, Shift } from '../types'
import { executeSQL, initDatabase, querySQL } from '../database/sqlite'
import { getStoredUser } from '../utils/session'
import { ApiError } from '../utils/errors'

export type StartShiftPayload = {
  startingCash: number
}

export type EndShiftPayload = {
  actualCash: number
}

type ShiftRow = {
  id: number
  employee_id: number
  employee_name: string
  starting_cash: number
  status: number
  started_at: string
  ended_at: string | null
  cash_sales: number | null
  non_cash_sales: number | null
  expected_cash: number | null
  actual_cash: number | null
  difference: number | null
}

function toShift(row: ShiftRow): Shift {
  const totalSales =
    row.cash_sales !== null && row.non_cash_sales !== null ? row.cash_sales + row.non_cash_sales : null
  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeName: row.employee_name,
    startingCash: row.starting_cash,
    status: row.status === 1 ? 'Closed' : 'Open',
    startedAt: row.started_at,
    endedAt: row.ended_at,
    cashSales: row.cash_sales,
    nonCashSales: row.non_cash_sales,
    totalSales,
    expectedCash: row.expected_cash,
    actualCash: row.actual_cash,
    difference: row.difference,
  }
}

const SHIFT_SELECT = `
  SELECT id, employee_id, employee_name, starting_cash, status, started_at, ended_at,
         cash_sales, non_cash_sales, expected_cash, actual_cash, difference
  FROM shifts
`

/** Sums a shift's linked sales by tender (method 0 = cash, everything else = non-cash). */
async function summarizeShiftSales(shiftId: number): Promise<{ cashSales: number; nonCashSales: number }> {
  const result = await querySQL(
    `SELECT p.method AS method, SUM(p.amount) AS total
     FROM payments p
     JOIN sales s ON s.id = p.sale_id
     WHERE s.shift_id = ? AND s.status != 2
     GROUP BY p.method`,
    [shiftId],
  )

  const rows = (result.values ?? []) as { method: number; total: number }[]
  let cashSales = 0
  let nonCashSales = 0
  for (const row of rows) {
    if (row.method === 0) cashSales += row.total
    else nonCashSales += row.total
  }
  return { cashSales, nonCashSales }
}

function requireEmployee(): { id: number; fullName: string } {
  const user = getStoredUser()
  if (!user) throw new ApiError('Not signed in.', 401)
  return { id: Number(user.id), fullName: user.fullName }
}

export const shiftApi = {
  /** The signed-in employee's open shift, or null if they haven't started one. */
  getActive: async (): Promise<Shift | null> => {
    const { id } = requireEmployee()
    const result = await querySQL(`${SHIFT_SELECT} WHERE employee_id = ? AND status = 0 LIMIT 1`, [id])
    const row = result.values?.[0] as ShiftRow | undefined
    return row ? toShift(row) : null
  },

  get: async (id: number): Promise<Shift> => {
    const result = await querySQL(`${SHIFT_SELECT} WHERE id = ? LIMIT 1`, [id])
    const row = result.values?.[0] as ShiftRow | undefined
    if (!row) throw new ApiError('Shift not found.', 404)
    return toShift(row)
  },

  start: async (payload: StartShiftPayload): Promise<Shift> => {
    if (!Number.isFinite(payload.startingCash) || payload.startingCash < 0) {
      throw new ApiError('Enter a valid starting cash amount.', 400)
    }

    const { id, fullName } = requireEmployee()
    const existing = await querySQL(`SELECT id FROM shifts WHERE employee_id = ? AND status = 0 LIMIT 1`, [id])
    if (existing.values?.length) {
      throw new ApiError('You already have an active shift.', 400)
    }

    const db = await initDatabase()
    const now = new Date().toISOString()

    let result
    try {
      result = await db.run(
        `INSERT INTO shifts (employee_id, employee_name, starting_cash, status, started_at)
         VALUES (?, ?, ?, 0, ?)`,
        [id, fullName, payload.startingCash, now],
      )
    } catch (err) {
      // The partial unique index (one open shift per employee) is the source of truth;
      // the pre-check above only avoids the round trip in the common case and can lose
      // a race between two rapid start requests for the same employee.
      const message = err instanceof Error ? err.message : String(err)
      if (/unique/i.test(message)) {
        throw new ApiError('You already have an active shift.', 400)
      }
      throw err
    }

    const shiftId = result.changes?.lastId
    if (!shiftId) throw new ApiError('Failed to start shift.', 500)
    return shiftApi.get(shiftId)
  },

  /** Closing summary for the signed-in employee's active shift, computed but not yet saved. */
  previewClose: async (): Promise<{ shift: Shift; cashSales: number; nonCashSales: number; expectedCash: number }> => {
    const active = await shiftApi.getActive()
    if (!active) throw new ApiError('No active shift.', 400)
    const { cashSales, nonCashSales } = await summarizeShiftSales(active.id)
    const expectedCash = active.startingCash + cashSales
    return { shift: active, cashSales, nonCashSales, expectedCash }
  },

  end: async (payload: EndShiftPayload): Promise<Shift> => {
    if (!Number.isFinite(payload.actualCash) || payload.actualCash < 0) {
      throw new ApiError('Enter a valid actual cash amount.', 400)
    }

    const { id } = requireEmployee()
    const active = await shiftApi.getActive()
    if (!active) throw new ApiError('No active shift to end.', 400)
    if (active.employeeId !== id) throw new ApiError('This shift does not belong to you.', 403)

    const { cashSales, nonCashSales } = await summarizeShiftSales(active.id)
    const expectedCash = active.startingCash + cashSales
    const difference = payload.actualCash - expectedCash
    const now = new Date().toISOString()

    await executeSQL(
      `UPDATE shifts
       SET status = 1, ended_at = ?, cash_sales = ?, non_cash_sales = ?, expected_cash = ?, actual_cash = ?, difference = ?
       WHERE id = ?`,
      [now, cashSales, nonCashSales, expectedCash, payload.actualCash, difference, active.id],
    )

    return shiftApi.get(active.id)
  },

  history: async (params: {
    employeeName?: string
    status?: 'open' | 'closed'
    page?: number
    pageSize?: number
  }): Promise<PagedResult<Shift>> => {
    const clauses: string[] = []
    const values: unknown[] = []

    if (params.employeeName) {
      clauses.push('employee_name LIKE ?')
      values.push(`%${params.employeeName}%`)
    }
    if (params.status) {
      clauses.push('status = ?')
      values.push(params.status === 'open' ? 0 : 1)
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    const page = params.page ?? 1
    const pageSize = params.pageSize ?? 20

    const countResult = await querySQL(`SELECT COUNT(*) AS count FROM shifts ${where}`, values)
    const totalCount = (countResult.values?.[0]?.count as number | undefined) ?? 0

    const result = await querySQL(
      `${SHIFT_SELECT} ${where} ORDER BY started_at DESC LIMIT ? OFFSET ?`,
      [...values, pageSize, (page - 1) * pageSize],
    )

    const rows = (result.values ?? []) as ShiftRow[]

    return {
      items: rows.map(toShift),
      totalCount,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
    }
  },
}
