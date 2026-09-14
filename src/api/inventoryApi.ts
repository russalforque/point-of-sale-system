import type { InventoryHistory, InventoryItem, PagedResult } from '../types'
import { initDatabase, querySQL } from '../database/sqlite'
import { getStoredUser } from '../utils/session'

type InventoryRow = {
  productId: number
  productName: string
  sku: string
  stockQuantity: number
  reorderLevel: number
  lastUpdated: string
  stockStatus: string
}

function toInventoryItem(row: InventoryRow): InventoryItem {
  return {
    productId: row.productId,
    productName: row.productName,
    sku: row.sku,
    stockQuantity: row.stockQuantity,
    reorderLevel: row.reorderLevel,
    stockStatus: row.stockStatus,
    lastUpdated: row.lastUpdated,
  }
}

const INVENTORY_SELECT = `
  SELECT
    p.id AS productId,
    p.name AS productName,
    p.sku AS sku,
    p.stock_quantity AS stockQuantity,
    p.reorder_level AS reorderLevel,
    p.updated_at AS lastUpdated,
    CASE
      WHEN p.stock_quantity <= 0 THEN 'Out of Stock'
      WHEN p.stock_quantity <= p.reorder_level THEN 'Low Stock'
      ELSE 'In Stock'
    END AS stockStatus
  FROM products p
`

function typeLabel(type: number): string {
  if (type === 1) return 'Stock In'
  if (type === 2) return 'Stock Out'
  return 'Count Correction'
}

export const inventoryApi = {
  list: async (params: {
    search?: string
    stockStatus?: string
    page?: number
    pageSize?: number
  }): Promise<PagedResult<InventoryItem>> => {
    const clauses: string[] = []
    const values: unknown[] = []

    if (params.search) {
      clauses.push('(p.name LIKE ? OR p.sku LIKE ?)')
      const term = `%${params.search}%`
      values.push(term, term)
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    const inner = `${INVENTORY_SELECT} ${where}`

    const outerWhere = params.stockStatus ? 'WHERE stockStatus = ?' : ''
    const outerValues = params.stockStatus ? [...values, params.stockStatus] : values

    const countResult = await querySQL(
      `SELECT COUNT(*) AS count FROM (${inner}) ${outerWhere}`,
      outerValues,
    )
    const totalCount = (countResult.values?.[0]?.count as number | undefined) ?? 0

    const page = params.page ?? 1
    const pageSize = params.pageSize ?? 10

    const result = await querySQL(
      `SELECT * FROM (${inner}) ${outerWhere} ORDER BY productName ASC LIMIT ? OFFSET ?`,
      [...outerValues, pageSize, (page - 1) * pageSize],
    )

    return {
      items: ((result.values ?? []) as InventoryRow[]).map(toInventoryItem),
      totalCount,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
    }
  },

  history: async (params: {
    productId?: number
    page?: number
    pageSize?: number
  }): Promise<PagedResult<InventoryHistory>> => {
    const clauses: string[] = []
    const values: unknown[] = []

    if (params.productId !== undefined) {
      clauses.push('it.product_id = ?')
      values.push(params.productId)
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    const page = params.page ?? 1
    const pageSize = params.pageSize ?? 10

    const countResult = await querySQL(
      `SELECT COUNT(*) AS count FROM inventory_transactions it ${where}`,
      values,
    )
    const totalCount = (countResult.values?.[0]?.count as number | undefined) ?? 0

    const result = await querySQL(
      `SELECT
         it.id AS id,
         it.product_id AS productId,
         p.name AS productName,
         p.sku AS sku,
         it.type AS type,
         it.quantity_change AS quantityChange,
         it.quantity_after AS quantityAfter,
         it.reason AS reason,
         it.created_at AS createdAt
       FROM inventory_transactions it
       LEFT JOIN products p ON p.id = it.product_id
       ${where}
       ORDER BY it.created_at DESC
       LIMIT ? OFFSET ?`,
      [...values, pageSize, (page - 1) * pageSize],
    )

    const items: InventoryHistory[] = ((result.values ?? []) as any[]).map((row) => ({
      id: row.id,
      productId: row.productId,
      productName: row.productName ?? 'Unknown product',
      sku: row.sku ?? '',
      type: typeLabel(row.type),
      quantityChange: row.quantityChange,
      quantityAfter: row.quantityAfter,
      reason: row.reason,
      createdAt: row.createdAt,
    }))

    return {
      items,
      totalCount,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
    }
  },

  adjust: async (payload: {
    productId: number
    type: number
    quantity: number
    reason: string
  }): Promise<void> => {
    const db = await initDatabase()

    const result = await db.query(`SELECT stock_quantity FROM products WHERE id = ? LIMIT 1`, [
      payload.productId,
    ])
    const current = (result.values?.[0]?.stock_quantity as number | undefined) ?? 0

    let newStock = current
    let quantityChange = 0

    if (payload.type === 1) {
      newStock = current + payload.quantity
      quantityChange = payload.quantity
    } else if (payload.type === 2) {
      newStock = Math.max(0, current - payload.quantity)
      quantityChange = newStock - current
    } else {
      newStock = payload.quantity
      quantityChange = newStock - current
    }

    const now = new Date().toISOString()
    const createdBy = getStoredUser()?.fullName ?? null

    await db.executeSet(
      [
        {
          statement: `UPDATE products SET stock_quantity = ?, updated_at = ? WHERE id = ?`,
          values: [newStock, now, payload.productId],
        },
        {
          statement: `INSERT INTO inventory_transactions (product_id, type, quantity_change, quantity_after, reason, created_by, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          values: [payload.productId, payload.type, quantityChange, newStock, payload.reason || '', createdBy, now],
        },
      ],
      true,
    )
  },
}
