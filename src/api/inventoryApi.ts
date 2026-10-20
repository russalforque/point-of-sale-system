import type { InventoryHistory, InventoryItem, PagedResult, ReorderSuggestion } from '../types'
import { querySQL } from '../database/sqlite'
import { runTransaction } from '../database/tx'
import { auditStatement } from '../services/audit'
import { requirePermission } from '../services/authz'
import { MOVEMENT_TYPE, stockChangeStatements, stockSetStatements } from '../services/inventoryMovements'
import { ApiError } from '../utils/errors'

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
    // Recipe and untracked products have no stock of their own to show or adjust.
    const clauses: string[] = [`p.inventory_mode IN ('direct', 'batch')`]
    const values: unknown[] = []

    if (params.search) {
      clauses.push('(p.name LIKE ? OR p.sku LIKE ? OR p.barcode = ?)')
      const term = `%${params.search}%`
      values.push(term, term, params.search.trim())
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
         it.created_by AS createdBy,
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
      createdBy: row.createdBy ?? null,
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

  /**
   * Active products at or below their reorder level, with a suggested order quantity: enough to
   * cover two weeks of recent sales on top of the reorder level (or double the reorder level for
   * slow sellers), minus what is already on hand. Optionally limited to one supplier's products.
   */
  reorderSuggestions: async (params: { supplierId?: number } = {}): Promise<ReorderSuggestion[]> => {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const supplierClause = params.supplierId ? 'AND p.supplier_id = ?' : ''
    const result = await querySQL(
      `SELECT p.id AS productId, p.name AS name, p.sku AS sku, p.supplier_id AS supplierId, s.company_name AS supplierName,
              p.stock_quantity AS stockQuantity, p.reorder_level AS reorderLevel, p.cost_price AS costPrice,
              COALESCE((SELECT SUM(si.quantity) FROM sale_items si JOIN sales sa ON sa.id = si.sale_id
                        WHERE si.product_id = p.id AND sa.status = 1 AND sa.created_at >= ?), 0) AS sold30
       FROM products p
       LEFT JOIN suppliers s ON s.id = p.supplier_id
       WHERE p.is_active = 1 AND p.inventory_mode IN ('direct', 'batch') AND p.stock_quantity <= p.reorder_level ${supplierClause}
       ORDER BY (p.stock_quantity <= 0) DESC, p.name ASC`,
      params.supplierId ? [since, params.supplierId] : [since],
    )
    return ((result.values ?? []) as (Omit<ReorderSuggestion, 'dailySales' | 'suggestedQuantity'> & { sold30: number })[]).map(
      ({ sold30, ...row }) => {
        const dailySales = sold30 / 30
        const target = Math.max(row.reorderLevel * 2, Math.ceil(dailySales * 14) + row.reorderLevel)
        return { ...row, dailySales: Math.round(dailySales * 10) / 10, suggestedQuantity: Math.max(target - row.stockQuantity, 1) }
      },
    )
  },

  adjust: async (payload: {
    productId: number
    type: number
    quantity: number
    reason: string
  }): Promise<void> => {
    const actor = await requirePermission('inventory.manage')
    if (!Number.isInteger(payload.quantity) || payload.quantity < 0) {
      throw new ApiError('Enter a whole-number quantity.', 400)
    }
    // Every stock change must say why (damaged, expired, found in back room…).
    const reason = payload.reason.trim()
    if (reason.length < 3) throw new ApiError('Choose or enter a reason for this stock change.', 400)

    const result = await querySQL(`SELECT name, stock_quantity, inventory_mode FROM products WHERE id = ? LIMIT 1`, [
      payload.productId,
    ])
    const product = result.values?.[0] as { name: string; stock_quantity: number; inventory_mode: string | null } | undefined
    if (!product) throw new ApiError('Product not found.', 404)
    if (product.inventory_mode === 'recipe') throw new ApiError(`${product.name} is made from a recipe. Adjust its ingredients instead.`, 400)
    if (product.inventory_mode === 'none') throw new ApiError(`${product.name} doesn’t track stock.`, 400)
    const current = product.stock_quantity

    const now = new Date().toISOString()
    const createdBy = actor.fullName

    let movement
    let newStock: number
    if (payload.type === MOVEMENT_TYPE.STOCK_IN) {
      newStock = current + payload.quantity
      movement = stockChangeStatements({ productId: payload.productId, delta: payload.quantity, type: MOVEMENT_TYPE.STOCK_IN, reason, createdBy, at: now })
    } else if (payload.type === MOVEMENT_TYPE.STOCK_OUT) {
      // Stock never goes below zero; remove at most what is on hand.
      newStock = Math.max(0, current - payload.quantity)
      movement = stockChangeStatements({ productId: payload.productId, delta: newStock - current, type: MOVEMENT_TYPE.STOCK_OUT, reason, createdBy, at: now })
    } else {
      newStock = payload.quantity
      movement = stockSetStatements({ productId: payload.productId, quantity: newStock, reason, createdBy, at: now })
    }

    await runTransaction([
      ...movement,
      auditStatement(
        'stock_adjustment',
        `${product.name}: ${current} → ${newStock} (${typeLabel(payload.type)}, ${reason})`,
        { type: 'product', id: payload.productId },
        actor,
        now,
      ),
    ])
  },
}
