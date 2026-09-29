import type { HeldOrder, HeldOrderLine } from '../types'
import { executeSQL, querySQL } from '../database/sqlite'
import { runTransaction } from '../database/tx'
import { auditStatement } from '../services/audit'
import { ApiError } from '../utils/errors'
import { getStoredUser } from '../utils/session'

/**
 * Parked (held) orders. Holding only saves the cart - stock is untouched until the order is
 * resumed and actually paid for, and prices/stock are re-checked on resume.
 */

export type HoldOrderPayload = {
  label?: string
  customerId: number | null
  customerName: string | null
  orderType: number
  discount: number
  lines: HeldOrderLine[]
  subtotal: number
  total: number
}

type HeldRow = {
  id: number
  label: string | null
  customer_id: number | null
  customer_name: string | null
  order_type: number
  discount: number
  items_json: string
  item_count: number
  subtotal: number
  total: number
  cashier_name: string
  created_at: string
}

function parseLines(json: string): HeldOrderLine[] {
  try {
    const parsed = JSON.parse(json) as HeldOrderLine[]
    return Array.isArray(parsed) ? parsed.filter((line) => Number.isInteger(line.productId) && line.quantity > 0) : []
  } catch {
    return []
  }
}

function toHeldOrder(row: HeldRow): HeldOrder {
  return {
    id: row.id,
    label: row.label,
    customerId: row.customer_id,
    customerName: row.customer_name,
    orderType: row.order_type,
    discount: row.discount,
    lines: parseLines(row.items_json),
    itemCount: row.item_count,
    subtotal: row.subtotal,
    total: row.total,
    cashierName: row.cashier_name,
    createdAt: row.created_at,
  }
}

export const heldOrdersApi = {
  list: async (): Promise<HeldOrder[]> => {
    const result = await querySQL(`SELECT * FROM held_orders ORDER BY created_at DESC`)
    return ((result.values ?? []) as HeldRow[]).map(toHeldOrder)
  },

  count: async (): Promise<number> => {
    const result = await querySQL(`SELECT COUNT(*) AS count FROM held_orders`)
    return (result.values?.[0]?.count as number | undefined) ?? 0
  },

  hold: async (payload: HoldOrderPayload): Promise<void> => {
    const lines = payload.lines.filter((line) => line.quantity > 0)
    if (lines.length === 0) throw new ApiError('Add items before holding the order.', 400)

    const user = getStoredUser()
    const cashierName = user?.fullName ?? 'Cashier'
    const label = payload.label?.trim() || null
    const itemCount = lines.reduce((sum, line) => sum + line.quantity, 0)
    const now = new Date().toISOString()

    await runTransaction([
      {
        statement: `INSERT INTO held_orders (label, customer_id, customer_name, order_type, discount, items_json, item_count, subtotal, total, cashier_id, cashier_name, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        values: [
          label,
          payload.customerId,
          payload.customerName,
          payload.orderType,
          payload.discount,
          JSON.stringify(lines),
          itemCount,
          payload.subtotal,
          payload.total,
          user ? Number(user.id) : null,
          cashierName,
          now,
        ],
      },
      auditStatement('hold', `Held order${label ? ` “${label}”` : ''} · ${itemCount} ${itemCount === 1 ? 'item' : 'items'}`, undefined, undefined, now),
    ])
  },

  /** Takes the order off hold; callers load it into the cart first. */
  remove: async (id: number): Promise<void> => {
    await executeSQL(`DELETE FROM held_orders WHERE id = ?`, [id])
  },

  /** Deleted without being sold (the customer left). */
  discard: async (order: HeldOrder): Promise<void> => {
    await runTransaction([
      { statement: `DELETE FROM held_orders WHERE id = ?`, values: [order.id] },
      auditStatement('hold', `Deleted held order${order.label ? ` “${order.label}”` : ''} · ${order.itemCount} items`),
    ])
  },
}
