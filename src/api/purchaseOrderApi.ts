import type { PagedResult, PurchaseOrder, PurchaseOrderItem, PurchaseOrderStatus } from '../types'
import { querySQL } from '../database/sqlite'
import { idByNumber, nextDocumentNumber, runTransaction, type SqlStatement } from '../database/tx'
import { settingsApi } from './settingsApi'
import { PO_STATUS } from './stockApi'
import { auditStatement } from '../services/audit'
import { requirePermission } from '../services/authz'
import { roundMoney, sumMoney } from '../utils/amount'
import { ApiError } from '../utils/errors'
import { formatMoney } from '../utils/format'

/**
 * Purchase orders: Draft → Ordered → (Partially) Received, or Cancelled.
 * Deliveries are recorded with stockApi.receive({ purchaseOrderId }), which raises stock,
 * writes the movements and moves the PO along in one transaction.
 */

export type PurchaseOrderPayload = {
  supplierId: number
  /** yyyy-mm-dd */
  expectedDate?: string | null
  notes?: string
  items: { productId: number; quantity: number; unitCost: number }[]
}

export const PO_STATUS_LABELS: Record<number, PurchaseOrderStatus> = {
  [PO_STATUS.DRAFT]: 'Draft',
  [PO_STATUS.ORDERED]: 'Ordered',
  [PO_STATUS.PARTIAL]: 'Partially received',
  [PO_STATUS.RECEIVED]: 'Received',
  [PO_STATUS.CANCELLED]: 'Cancelled',
}

type PoRow = {
  id: number
  po_number: string
  supplier_id: number
  supplier_name: string | null
  status: number
  expected_date: string | null
  notes: string | null
  total_cost: number
  created_by: string
  created_at: string
  updated_at: string
  ordered_at: string | null
  closed_at: string | null
  line_count: number
  units_ordered: number | null
  units_received: number | null
}

const PO_SELECT = `
  SELECT po.id, po.po_number, po.supplier_id, s.company_name AS supplier_name, po.status, po.expected_date, po.notes,
         po.total_cost, po.created_by, po.created_at, po.updated_at, po.ordered_at, po.closed_at,
         (SELECT COUNT(*) FROM purchase_order_items i WHERE i.purchase_order_id = po.id) AS line_count,
         (SELECT SUM(i.quantity_ordered) FROM purchase_order_items i WHERE i.purchase_order_id = po.id) AS units_ordered,
         (SELECT SUM(i.quantity_received) FROM purchase_order_items i WHERE i.purchase_order_id = po.id) AS units_received
  FROM purchase_orders po
  LEFT JOIN suppliers s ON s.id = po.supplier_id
`

function toPurchaseOrder(row: PoRow, items: PurchaseOrderItem[] = []): PurchaseOrder {
  return {
    id: row.id,
    poNumber: row.po_number,
    supplierId: row.supplier_id,
    supplierName: row.supplier_name ?? 'Unknown supplier',
    status: PO_STATUS_LABELS[row.status] ?? 'Draft',
    expectedDate: row.expected_date,
    notes: row.notes,
    totalCost: row.total_cost,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    orderedAt: row.ordered_at,
    closedAt: row.closed_at,
    lineCount: row.line_count,
    unitsOrdered: row.units_ordered ?? 0,
    unitsReceived: row.units_received ?? 0,
    items,
  }
}

async function poItems(poId: number): Promise<PurchaseOrderItem[]> {
  const result = await querySQL(
    `SELECT i.id, i.product_id AS productId, p.name AS productName, p.sku AS sku, i.quantity_ordered AS quantityOrdered,
            i.quantity_received AS quantityReceived, i.unit_cost AS unitCost
     FROM purchase_order_items i LEFT JOIN products p ON p.id = i.product_id
     WHERE i.purchase_order_id = ? ORDER BY i.id`,
    [poId],
  )
  return ((result.values ?? []) as Omit<PurchaseOrderItem, 'lineTotal'>[]).map((row) => ({
    ...row,
    productName: row.productName ?? 'Unknown product',
    sku: row.sku ?? '',
    lineTotal: roundMoney(row.unitCost * row.quantityOrdered),
  }))
}

async function rawStatus(id: number): Promise<{ status: number; po_number: string }> {
  const result = await querySQL(`SELECT status, po_number FROM purchase_orders WHERE id = ? LIMIT 1`, [id])
  const row = result.values?.[0] as { status: number; po_number: string } | undefined
  if (!row) throw new ApiError('Purchase order not found.', 404)
  return row
}

async function validatePayload(payload: PurchaseOrderPayload) {
  const supplier = await querySQL(`SELECT company_name, is_active FROM suppliers WHERE id = ? LIMIT 1`, [payload.supplierId])
  const supplierRow = supplier.values?.[0] as { company_name: string; is_active: number } | undefined
  if (!supplierRow) throw new ApiError('Choose a supplier.', 400)
  if (!supplierRow.is_active) throw new ApiError(`${supplierRow.company_name} is inactive.`, 400)
  if (payload.expectedDate && !/^\d{4}-\d{2}-\d{2}$/.test(payload.expectedDate)) throw new ApiError('Enter a valid expected date.', 400)
  if (payload.items.length === 0) throw new ApiError('Add at least one product.', 400)

  const seen = new Set<number>()
  for (const item of payload.items) {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) throw new ApiError('Quantities must be whole numbers above zero.', 400)
    if (!Number.isFinite(item.unitCost) || item.unitCost < 0) throw new ApiError('Costs can’t be negative.', 400)
    if (seen.has(item.productId)) throw new ApiError('Each product can only be listed once.', 400)
    seen.add(item.productId)
  }
  const ids = Array.from(seen)
  const found = await querySQL(`SELECT id FROM products WHERE id IN (${ids.map(() => '?').join(', ')})`, ids)
  if ((found.values ?? []).length !== ids.length) throw new ApiError('A product on this order no longer exists.', 404)

  const lines = payload.items.map((item) => ({ ...item, unitCost: roundMoney(item.unitCost) }))
  return { supplierName: supplierRow.company_name, lines, total: sumMoney(lines.map((line) => roundMoney(line.unitCost * line.quantity))) }
}

function itemStatements(poIdSql: string, poIdValue: unknown, lines: { productId: number; quantity: number; unitCost: number }[]): SqlStatement[] {
  return lines.map((line) => ({
    statement: `INSERT INTO purchase_order_items (purchase_order_id, product_id, quantity_ordered, quantity_received, unit_cost) VALUES (${poIdSql}, ?, ?, 0, ?)`,
    values: [poIdValue, line.productId, line.quantity, line.unitCost],
  }))
}

export const purchaseOrderApi = {
  list: async (params: {
    status?: PurchaseOrderStatus | 'open'
    supplierId?: number
    search?: string
    page?: number
    pageSize?: number
  } = {}): Promise<PagedResult<PurchaseOrder>> => {
    const clauses: string[] = []
    const values: unknown[] = []
    if (params.status === 'open') {
      clauses.push('po.status IN (?, ?, ?)')
      values.push(PO_STATUS.DRAFT, PO_STATUS.ORDERED, PO_STATUS.PARTIAL)
    } else if (params.status) {
      const code = Number(Object.entries(PO_STATUS_LABELS).find(([, label]) => label === params.status)?.[0])
      clauses.push('po.status = ?')
      values.push(code)
    }
    if (params.supplierId) {
      clauses.push('po.supplier_id = ?')
      values.push(params.supplierId)
    }
    if (params.search?.trim()) {
      clauses.push('(po.po_number LIKE ? OR s.company_name LIKE ?)')
      const term = `%${params.search.trim()}%`
      values.push(term, term)
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    const page = params.page ?? 1
    const pageSize = params.pageSize ?? 15
    const countResult = await querySQL(
      `SELECT COUNT(*) AS count FROM purchase_orders po LEFT JOIN suppliers s ON s.id = po.supplier_id ${where}`,
      values,
    )
    const totalCount = (countResult.values?.[0]?.count as number | undefined) ?? 0
    const result = await querySQL(`${PO_SELECT} ${where} ORDER BY po.created_at DESC LIMIT ? OFFSET ?`, [
      ...values,
      pageSize,
      (page - 1) * pageSize,
    ])
    return {
      items: ((result.values ?? []) as PoRow[]).map((row) => toPurchaseOrder(row)),
      totalCount,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
    }
  },

  /** How many orders are in each state, for the filter pills. */
  counts: async (): Promise<Record<PurchaseOrderStatus, number>> => {
    const result = await querySQL(`SELECT status, COUNT(*) AS count FROM purchase_orders GROUP BY status`)
    const counts: Record<PurchaseOrderStatus, number> = { Draft: 0, Ordered: 0, 'Partially received': 0, Received: 0, Cancelled: 0 }
    for (const row of (result.values ?? []) as { status: number; count: number }[]) {
      const label = PO_STATUS_LABELS[row.status]
      if (label) counts[label] = row.count
    }
    return counts
  },

  get: async (id: number): Promise<PurchaseOrder> => {
    const result = await querySQL(`${PO_SELECT} WHERE po.id = ? LIMIT 1`, [id])
    const row = result.values?.[0] as PoRow | undefined
    if (!row) throw new ApiError('Purchase order not found.', 404)
    return toPurchaseOrder(row, await poItems(id))
  },

  /** New draft. */
  create: async (payload: PurchaseOrderPayload): Promise<PurchaseOrder> => {
    const actor = await requirePermission('purchasing.manage')
    const { supplierName, lines, total } = await validatePayload(payload)
    const now = new Date().toISOString()
    const poNumber = await nextDocumentNumber('purchase_orders', 'PO')
    const symbol = (await settingsApi.get()).currencySymbol

    await runTransaction([
      {
        statement: `INSERT INTO purchase_orders (po_number, supplier_id, status, expected_date, notes, total_cost, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        values: [poNumber, payload.supplierId, PO_STATUS.DRAFT, payload.expectedDate || null, payload.notes?.trim() || null, total, actor.fullName, now, now],
      },
      ...itemStatements(`(SELECT id FROM purchase_orders WHERE po_number = ?)`, poNumber, lines),
      auditStatement(
        'purchase_order',
        `${poNumber} drafted for ${supplierName} · ${lines.length} ${lines.length === 1 ? 'product' : 'products'} · ${formatMoney(total, symbol)}`,
        { type: 'purchase_order', id: poNumber },
        actor,
        now,
      ),
    ])
    const id = await idByNumber('purchase_orders', 'po_number', poNumber)
    if (!id) throw new ApiError('Failed to save the purchase order.', 500)
    return purchaseOrderApi.get(id)
  },

  /** Replaces a draft's supplier, dates and lines. Orders already sent can't be edited. */
  update: async (id: number, payload: PurchaseOrderPayload): Promise<PurchaseOrder> => {
    const actor = await requirePermission('purchasing.manage')
    const current = await rawStatus(id)
    if (current.status !== PO_STATUS.DRAFT) throw new ApiError(`${current.po_number} was already sent and can’t be edited.`, 400)
    const { supplierName, lines, total } = await validatePayload(payload)
    const now = new Date().toISOString()
    const symbol = (await settingsApi.get()).currencySymbol

    await runTransaction([
      {
        statement: `UPDATE purchase_orders SET supplier_id = ?, expected_date = ?, notes = ?, total_cost = ?, updated_at = ? WHERE id = ? AND status = ?`,
        values: [payload.supplierId, payload.expectedDate || null, payload.notes?.trim() || null, total, now, id, PO_STATUS.DRAFT],
      },
      // Draft lines have nothing received against them, so they can simply be replaced.
      { statement: `DELETE FROM purchase_order_items WHERE purchase_order_id = ? AND quantity_received = 0`, values: [id] },
      ...itemStatements('?', id, lines),
      auditStatement(
        'purchase_order',
        `${current.po_number} draft updated · ${supplierName} · ${lines.length} ${lines.length === 1 ? 'product' : 'products'} · ${formatMoney(total, symbol)}`,
        { type: 'purchase_order', id: current.po_number },
        actor,
        now,
      ),
    ])
    return purchaseOrderApi.get(id)
  },

  /** Draft → Ordered (sent to the supplier). */
  markOrdered: async (id: number): Promise<PurchaseOrder> => {
    const actor = await requirePermission('purchasing.manage')
    const current = await rawStatus(id)
    if (current.status !== PO_STATUS.DRAFT) throw new ApiError(`${current.po_number} was already sent.`, 400)
    const now = new Date().toISOString()
    await runTransaction([
      {
        statement: `UPDATE purchase_orders SET status = ?, ordered_at = ?, updated_at = ? WHERE id = ? AND status = ?`,
        values: [PO_STATUS.ORDERED, now, now, id, PO_STATUS.DRAFT],
      },
      auditStatement('purchase_order', `${current.po_number} marked as ordered`, { type: 'purchase_order', id: current.po_number }, actor, now),
    ])
    return purchaseOrderApi.get(id)
  },

  /**
   * Cancels a draft or an open order. On a partly received order, what already arrived stays
   * in stock; only the rest is cancelled.
   */
  cancel: async (id: number, reason: string): Promise<PurchaseOrder> => {
    const actor = await requirePermission('purchasing.manage')
    const trimmed = reason.trim()
    if (trimmed.length < 3) throw new ApiError('Enter a reason for cancelling.', 400)
    const current = await rawStatus(id)
    if (current.status === PO_STATUS.RECEIVED || current.status === PO_STATUS.CANCELLED) {
      throw new ApiError(`${current.po_number} is already closed.`, 400)
    }
    const now = new Date().toISOString()
    await runTransaction([
      {
        statement: `UPDATE purchase_orders SET status = ?, closed_at = ?, updated_at = ?, notes = TRIM(COALESCE(notes, '') || ?) WHERE id = ? AND status IN (?, ?, ?)`,
        values: [
          PO_STATUS.CANCELLED,
          now,
          now,
          `\nCancelled: ${trimmed}`,
          id,
          PO_STATUS.DRAFT,
          PO_STATUS.ORDERED,
          PO_STATUS.PARTIAL,
        ],
      },
      auditStatement(
        'purchase_order',
        `${current.po_number} cancelled${current.status === PO_STATUS.PARTIAL ? ' (remaining items)' : ''} · ${trimmed}`,
        { type: 'purchase_order', id: current.po_number },
        actor,
        now,
      ),
    ])
    return purchaseOrderApi.get(id)
  },
}
