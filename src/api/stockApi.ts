import type { PagedResult, StockCount, StockCountItem, StockReceipt, StockReceiptItem } from '../types'
import { querySQL } from '../database/sqlite'
import { idByNumber, nextDocumentNumber, runTransaction, type SqlStatement } from '../database/tx'
import { settingsApi } from './settingsApi'
import { auditStatement } from '../services/audit'
import { stockChangeStatements, stockSetStatements, MOVEMENT_TYPE } from '../services/inventoryMovements'
import { roundMoney, sumMoney } from '../utils/amount'
import { ApiError } from '../utils/errors'
import { formatMoney } from '../utils/format'
import { getStoredUser } from '../utils/session'

/** Physical stock counts and stock receiving (restocking from suppliers). */

export type StockCountPayload = {
  notes?: string
  items: { productId: number; countedQuantity: number }[]
}

export type StockReceiptPayload = {
  supplierId: number | null
  reference?: string
  /** yyyy-mm-dd, the day the goods arrived. */
  receivedDate: string
  notes?: string
  /** Also make each product's cost price the cost on this delivery. */
  updateCostPrices: boolean
  items: { productId: number; quantity: number; unitCost: number }[]
}

function actorName(): string {
  const user = getStoredUser()
  if (!user) throw new ApiError('Not signed in.', 401)
  return user.fullName
}

function paged<T>(items: T[], totalCount: number, page: number, pageSize: number): PagedResult<T> {
  return { items, totalCount, page, pageSize, totalPages: Math.max(1, Math.ceil(totalCount / pageSize)) }
}

type ProductStockRow = { id: number; name: string; sku: string; stock_quantity: number; cost_price: number }

async function productsById(ids: number[]): Promise<Map<number, ProductStockRow>> {
  if (ids.length === 0) return new Map()
  const result = await querySQL(
    `SELECT id, name, sku, stock_quantity, cost_price FROM products WHERE id IN (${ids.map(() => '?').join(', ')})`,
    ids,
  )
  return new Map(((result.values ?? []) as ProductStockRow[]).map((row) => [row.id, row]))
}

/* ------------------------------------------------------------------
   STOCK COUNTS
------------------------------------------------------------------ */

type CountRow = {
  id: number
  count_number: string
  notes: string | null
  items_counted: number
  items_adjusted: number
  net_change: number
  created_by: string
  created_at: string
}

async function countItems(countId: number): Promise<StockCountItem[]> {
  const result = await querySQL(
    `SELECT i.product_id AS productId, p.name AS productName, p.sku AS sku, i.system_quantity AS systemQuantity,
            i.counted_quantity AS countedQuantity, i.difference AS difference
     FROM stock_count_items i LEFT JOIN products p ON p.id = i.product_id
     WHERE i.count_id = ? ORDER BY ABS(i.difference) DESC, p.name ASC`,
    [countId],
  )
  return ((result.values ?? []) as StockCountItem[]).map((row) => ({
    ...row,
    productName: row.productName ?? 'Unknown product',
    sku: row.sku ?? '',
  }))
}

function toStockCount(row: CountRow, items: StockCountItem[] = []): StockCount {
  return {
    id: row.id,
    countNumber: row.count_number,
    notes: row.notes,
    itemsCounted: row.items_counted,
    itemsAdjusted: row.items_adjusted,
    netChange: row.net_change,
    createdBy: row.created_by,
    createdAt: row.created_at,
    items,
  }
}

/* ------------------------------------------------------------------
   STOCK RECEIPTS
------------------------------------------------------------------ */

type ReceiptRow = {
  id: number
  receipt_number: string
  supplier_id: number | null
  supplier_name: string | null
  reference: string | null
  received_date: string
  notes: string | null
  total_cost: number
  created_by: string
  created_at: string
}

async function receiptItems(receiptId: number): Promise<StockReceiptItem[]> {
  const result = await querySQL(
    `SELECT i.product_id AS productId, p.name AS productName, p.sku AS sku, i.quantity AS quantity,
            i.unit_cost AS unitCost, i.line_total AS lineTotal
     FROM stock_receipt_items i LEFT JOIN products p ON p.id = i.product_id
     WHERE i.receipt_id = ? ORDER BY i.id`,
    [receiptId],
  )
  return ((result.values ?? []) as StockReceiptItem[]).map((row) => ({
    ...row,
    productName: row.productName ?? 'Unknown product',
    sku: row.sku ?? '',
  }))
}

function toReceipt(row: ReceiptRow, items: StockReceiptItem[] = []): StockReceipt {
  return {
    id: row.id,
    receiptNumber: row.receipt_number,
    supplierId: row.supplier_id,
    supplierName: row.supplier_name,
    reference: row.reference,
    receivedDate: row.received_date,
    notes: row.notes,
    totalCost: row.total_cost,
    createdBy: row.created_by,
    createdAt: row.created_at,
    items,
  }
}

const RECEIPT_SELECT = `
  SELECT r.id, r.receipt_number, r.supplier_id, s.company_name AS supplier_name, r.reference, r.received_date,
         r.notes, r.total_cost, r.created_by, r.created_at
  FROM stock_receipts r LEFT JOIN suppliers s ON s.id = r.supplier_id
`

export type CountSheetRow = { productId: number; name: string; sku: string; categoryName: string | null; stockQuantity: number }

export const stockApi = {
  /** Every active product with its current system stock, for a physical count. */
  countSheet: async (): Promise<CountSheetRow[]> => {
    const result = await querySQL(
      `SELECT p.id AS productId, p.name AS name, p.sku AS sku, c.name AS categoryName, p.stock_quantity AS stockQuantity
       FROM products p LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.is_active = 1
       ORDER BY p.name ASC`,
    )
    return (result.values ?? []) as CountSheetRow[]
  },

  counts: async (params: { page?: number; pageSize?: number } = {}): Promise<PagedResult<StockCount>> => {
    const page = params.page ?? 1
    const pageSize = params.pageSize ?? 10
    const countResult = await querySQL(`SELECT COUNT(*) AS count FROM stock_counts`)
    const result = await querySQL(`SELECT * FROM stock_counts ORDER BY created_at DESC LIMIT ? OFFSET ?`, [
      pageSize,
      (page - 1) * pageSize,
    ])
    return paged(
      ((result.values ?? []) as CountRow[]).map((row) => toStockCount(row)),
      (countResult.values?.[0]?.count as number | undefined) ?? 0,
      page,
      pageSize,
    )
  },

  getCount: async (id: number): Promise<StockCount> => {
    const result = await querySQL(`SELECT * FROM stock_counts WHERE id = ? LIMIT 1`, [id])
    const row = result.values?.[0] as CountRow | undefined
    if (!row) throw new ApiError('Stock count not found.', 404)
    return toStockCount(row, await countItems(id))
  },

  /**
   * Confirms a physical count. Differences are measured against the stock on hand right now
   * (not when counting started), and each one becomes a "Count Correction" movement.
   */
  confirmCount: async (payload: StockCountPayload): Promise<StockCount> => {
    const entries = payload.items.filter((item) => Number.isFinite(item.countedQuantity))
    if (entries.length === 0) throw new ApiError('Enter at least one counted quantity.', 400)
    for (const entry of entries) {
      if (!Number.isInteger(entry.countedQuantity) || entry.countedQuantity < 0) {
        throw new ApiError('Counted quantities must be whole numbers, zero or more.', 400)
      }
    }

    const createdBy = actorName()
    const now = new Date().toISOString()
    const products = await productsById(entries.map((entry) => entry.productId))
    const countNumber = await nextDocumentNumber('stock_counts', 'SC')
    const countIdSql = `(SELECT id FROM stock_counts WHERE count_number = ?)`

    const lines = entries.map((entry) => {
      const product = products.get(entry.productId)
      if (!product) throw new ApiError('A counted product no longer exists.', 404)
      return { product, counted: entry.countedQuantity, difference: entry.countedQuantity - product.stock_quantity }
    })
    const adjusted = lines.filter((line) => line.difference !== 0)
    const netChange = adjusted.reduce((sum, line) => sum + line.difference, 0)

    const statements: SqlStatement[] = [
      {
        statement: `INSERT INTO stock_counts (count_number, notes, items_counted, items_adjusted, net_change, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        values: [countNumber, payload.notes?.trim() || null, lines.length, adjusted.length, netChange, createdBy, now],
      },
    ]
    for (const line of lines) {
      statements.push({
        statement: `INSERT INTO stock_count_items (count_id, product_id, system_quantity, counted_quantity, difference)
           VALUES (${countIdSql}, ?, ?, ?, ?)`,
        values: [countNumber, line.product.id, line.product.stock_quantity, line.counted, line.difference],
      })
    }
    for (const line of adjusted) {
      statements.push(
        ...stockSetStatements({
          productId: line.product.id,
          quantity: line.counted,
          reason: `Stock count ${countNumber}`,
          createdBy,
          at: now,
        }),
      )
    }
    const signed = (value: number) => (value > 0 ? `+${value}` : String(value))
    statements.push(
      auditStatement(
        'stock_count',
        `${countNumber}: ${lines.length} counted, ${adjusted.length} adjusted (net ${signed(netChange)})` +
          (adjusted.length
            ? ` · ${adjusted
                .slice(0, 5)
                .map((line) => `${line.product.name} ${line.product.stock_quantity}→${line.counted}`)
                .join(', ')}${adjusted.length > 5 ? '…' : ''}`
            : ''),
        { type: 'stock_count', id: countNumber },
        undefined,
        now,
      ),
    )

    await runTransaction(statements)
    const id = await idByNumber('stock_counts', 'count_number', countNumber)
    if (!id) throw new ApiError('Failed to save the stock count.', 500)
    return stockApi.getCount(id)
  },

  receipts: async (params: { page?: number; pageSize?: number; supplierId?: number } = {}): Promise<PagedResult<StockReceipt>> => {
    const page = params.page ?? 1
    const pageSize = params.pageSize ?? 10
    const where = params.supplierId ? 'WHERE r.supplier_id = ?' : ''
    const values = params.supplierId ? [params.supplierId] : []
    const countResult = await querySQL(`SELECT COUNT(*) AS count FROM stock_receipts r ${where}`, values)
    const result = await querySQL(`${RECEIPT_SELECT} ${where} ORDER BY r.created_at DESC LIMIT ? OFFSET ?`, [
      ...values,
      pageSize,
      (page - 1) * pageSize,
    ])
    return paged(
      ((result.values ?? []) as ReceiptRow[]).map((row) => toReceipt(row)),
      (countResult.values?.[0]?.count as number | undefined) ?? 0,
      page,
      pageSize,
    )
  },

  getReceipt: async (id: number): Promise<StockReceipt> => {
    const result = await querySQL(`${RECEIPT_SELECT} WHERE r.id = ? LIMIT 1`, [id])
    const row = result.values?.[0] as ReceiptRow | undefined
    if (!row) throw new ApiError('Stock receipt not found.', 404)
    return toReceipt(row, await receiptItems(id))
  },

  /** Receives a delivery: stock goes up, every line gets a "Stock In" movement. */
  receive: async (payload: StockReceiptPayload): Promise<StockReceipt> => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.receivedDate)) throw new ApiError('Enter the date received.', 400)
    const items = payload.items.filter((item) => item.quantity !== 0)
    if (items.length === 0) throw new ApiError('Add at least one product.', 400)
    const seen = new Set<number>()
    for (const item of items) {
      if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
        throw new ApiError('Quantities must be whole numbers above zero.', 400)
      }
      if (!Number.isFinite(item.unitCost) || item.unitCost < 0) throw new ApiError('Costs can’t be negative.', 400)
      if (seen.has(item.productId)) throw new ApiError('Each product can only be listed once.', 400)
      seen.add(item.productId)
    }

    const createdBy = actorName()
    const now = new Date().toISOString()
    const products = await productsById(items.map((item) => item.productId))
    const receiptNumber = await nextDocumentNumber('stock_receipts', 'RS')
    const receiptIdSql = `(SELECT id FROM stock_receipts WHERE receipt_number = ?)`
    const reference = payload.reference?.trim() || null

    const lines = items.map((item) => {
      const product = products.get(item.productId)
      if (!product) throw new ApiError('A product on this delivery no longer exists.', 404)
      const unitCost = roundMoney(item.unitCost)
      return { product, quantity: item.quantity, unitCost, lineTotal: roundMoney(unitCost * item.quantity) }
    })
    const totalCost = sumMoney(lines.map((line) => line.lineTotal))

    let supplierName: string | null = null
    if (payload.supplierId) {
      const supplier = await querySQL(`SELECT company_name FROM suppliers WHERE id = ? LIMIT 1`, [payload.supplierId])
      supplierName = (supplier.values?.[0]?.company_name as string | undefined) ?? null
      if (!supplierName) throw new ApiError('Supplier not found.', 404)
    }

    const statements: SqlStatement[] = [
      {
        statement: `INSERT INTO stock_receipts (receipt_number, supplier_id, reference, received_date, notes, total_cost, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        values: [receiptNumber, payload.supplierId, reference, payload.receivedDate, payload.notes?.trim() || null, totalCost, createdBy, now],
      },
    ]

    const symbol = (await settingsApi.get()).currencySymbol
    const costChanges: string[] = []
    for (const line of lines) {
      statements.push({
        statement: `INSERT INTO stock_receipt_items (receipt_id, product_id, quantity, unit_cost, line_total)
           VALUES (${receiptIdSql}, ?, ?, ?, ?)`,
        values: [receiptNumber, line.product.id, line.quantity, line.unitCost, line.lineTotal],
      })
      statements.push(
        ...stockChangeStatements({
          productId: line.product.id,
          delta: line.quantity,
          type: MOVEMENT_TYPE.STOCK_IN,
          reason: `Restock ${receiptNumber}${reference ? ` (ref ${reference})` : ''}`,
          createdBy,
          at: now,
        }),
      )
      if (payload.updateCostPrices && line.unitCost !== line.product.cost_price) {
        statements.push({ statement: `UPDATE products SET cost_price = ? WHERE id = ?`, values: [line.unitCost, line.product.id] })
        costChanges.push(`${line.product.name} ${formatMoney(line.product.cost_price, symbol)} → ${formatMoney(line.unitCost, symbol)}`)
      }
      // Products received from a supplier for the first time are linked to it.
      if (payload.supplierId) {
        statements.push({
          statement: `UPDATE products SET supplier_id = ? WHERE id = ? AND supplier_id IS NULL`,
          values: [payload.supplierId, line.product.id],
        })
      }
    }

    const units = lines.reduce((sum, line) => sum + line.quantity, 0)
    statements.push(
      auditStatement(
        'restock',
        `${receiptNumber}: ${units} units of ${lines.length} ${lines.length === 1 ? 'product' : 'products'}` +
          `${supplierName ? ` from ${supplierName}` : ''}${reference ? ` (ref ${reference})` : ''} · ${formatMoney(totalCost, symbol)}`,
        { type: 'stock_receipt', id: receiptNumber },
        undefined,
        now,
      ),
    )
    if (costChanges.length > 0) {
      statements.push(auditStatement('price_change', `Cost updated from ${receiptNumber}: ${costChanges.join(', ')}`, undefined, undefined, now))
    }

    await runTransaction(statements)
    const id = await idByNumber('stock_receipts', 'receipt_number', receiptNumber)
    if (!id) throw new ApiError('Failed to save the delivery.', 500)
    return stockApi.getReceipt(id)
  },
}
