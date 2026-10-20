import type { Supplier } from '../types'
import { querySQL, executeSQL } from '../database/sqlite'
import { runTransaction } from '../database/tx'
import { auditStatement } from '../services/audit'
import { requirePermission } from '../services/authz'
import { ApiError } from '../utils/errors'

export type SupplierPayload = {
  companyName: string
  contactPerson?: string
  phone?: string
  email?: string
  address?: string
  notes?: string
  isActive: boolean
}

export type SuppliedProduct = {
  id: number
  name: string
  sku: string
  costPrice: number
  stockQuantity: number
  isActive: boolean
  /** Unit cost on the latest delivery from this supplier, and on the one before it. */
  lastCost: number | null
  previousCost: number | null
  lastReceivedDate: string | null
}

export type SupplierSummary = {
  totalPurchases: number
  deliveries: number
  lastDeliveryDate: string | null
  openOrders: number
  openOrdersValue: number
}

type SupplierRow = {
  id: number
  supplier_code: string
  company_name: string
  contact_person: string | null
  phone: string | null
  email: string | null
  address: string | null
  notes: string | null
  is_active: number
}

function toSupplier(row: SupplierRow): Supplier {
  return {
    id: row.id,
    supplierCode: row.supplier_code,
    companyName: row.company_name,
    contactPerson: row.contact_person,
    phone: row.phone,
    email: row.email,
    address: row.address,
    notes: row.notes ?? null,
    isActive: Boolean(row.is_active),
  }
}

export const supplierApi = {
  list: async (params?: { search?: string; isActive?: boolean }): Promise<Supplier[]> => {
    const clauses: string[] = []
    const values: unknown[] = []

    if (params?.search) {
      clauses.push(
        '(company_name LIKE ? OR contact_person LIKE ? OR supplier_code LIKE ?)',
      )
      const term = `%${params.search}%`
      values.push(term, term, term)
    }

    if (params?.isActive !== undefined) {
      clauses.push('is_active = ?')
      values.push(params.isActive ? 1 : 0)
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    const result = await querySQL(
      `SELECT * FROM suppliers ${where} ORDER BY company_name ASC`,
      values,
    )
    return ((result.values ?? []) as SupplierRow[]).map(toSupplier)
  },

  get: async (id: number): Promise<Supplier> => {
    const result = await querySQL(`SELECT * FROM suppliers WHERE id = ? LIMIT 1`, [id])
    const row = result.values?.[0] as SupplierRow | undefined
    if (!row) throw new ApiError('Supplier not found.', 404)
    return toSupplier(row)
  },

  /**
   * Products bought from this supplier: those set to it on the product form, plus anything ever
   * received from it, with the last two delivery costs so price changes stand out.
   */
  products: async (id: number): Promise<SuppliedProduct[]> => {
    const lastCostSql = (offset: number) => `(SELECT i.unit_cost FROM stock_receipt_items i JOIN stock_receipts r ON r.id = i.receipt_id
        WHERE i.product_id = p.id AND r.supplier_id = ? ORDER BY r.received_date DESC, r.id DESC LIMIT 1 OFFSET ${offset})`
    const result = await querySQL(
      `SELECT p.id, p.name, p.sku, p.cost_price AS costPrice, p.stock_quantity AS stockQuantity, p.is_active AS isActive,
              ${lastCostSql(0)} AS lastCost,
              ${lastCostSql(1)} AS previousCost,
              (SELECT MAX(r.received_date) FROM stock_receipt_items i JOIN stock_receipts r ON r.id = i.receipt_id
                WHERE i.product_id = p.id AND r.supplier_id = ?) AS lastReceivedDate
       FROM products p
       WHERE p.supplier_id = ?
          OR p.id IN (SELECT i.product_id FROM stock_receipt_items i JOIN stock_receipts r ON r.id = i.receipt_id WHERE r.supplier_id = ?)
       ORDER BY p.is_active DESC, p.name ASC`,
      [id, id, id, id, id],
    )
    return ((result.values ?? []) as (Omit<SuppliedProduct, 'isActive'> & { isActive: number })[]).map((row) => ({
      ...row,
      isActive: Boolean(row.isActive),
      lastCost: row.lastCost ?? null,
      previousCost: row.previousCost ?? null,
      lastReceivedDate: row.lastReceivedDate ?? null,
    }))
  },

  /** Money spent with this supplier and what's still on order. */
  summary: async (id: number): Promise<SupplierSummary> => {
    const [received, orders] = await Promise.all([
      querySQL(
        `SELECT COALESCE(SUM(total_cost), 0) AS total, COUNT(*) AS count, MAX(received_date) AS last FROM stock_receipts WHERE supplier_id = ?`,
        [id],
      ),
      querySQL(
        `SELECT COUNT(*) AS count, COALESCE(SUM(total_cost), 0) AS value FROM purchase_orders WHERE supplier_id = ? AND status IN (0, 1, 2)`,
        [id],
      ),
    ])
    const r = (received.values?.[0] ?? {}) as { total?: number; count?: number; last?: string | null }
    const o = (orders.values?.[0] ?? {}) as { count?: number; value?: number }
    return {
      totalPurchases: r.total ?? 0,
      deliveries: r.count ?? 0,
      lastDeliveryDate: r.last ?? null,
      openOrders: o.count ?? 0,
      openOrdersValue: o.value ?? 0,
    }
  },

  create: async (payload: SupplierPayload): Promise<Supplier> => {
    await requirePermission('suppliers.manage')
    if (!payload.companyName.trim()) throw new ApiError('Enter the supplier name.', 400)
    const result = await executeSQL(
      `INSERT INTO suppliers (supplier_code, company_name, contact_person, phone, email, address, notes, is_active)
       VALUES ('', ?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.companyName,
        payload.contactPerson || null,
        payload.phone || null,
        payload.email || null,
        payload.address || null,
        payload.notes?.trim() || null,
        payload.isActive ? 1 : 0,
      ],
    )
    const id = result.changes?.lastId
    if (!id) throw new ApiError('Failed to create supplier.', 500)
    const code = `SUP-${String(id).padStart(4, '0')}`
    await runTransaction([
      { statement: `UPDATE suppliers SET supplier_code = ? WHERE id = ?`, values: [code, id] },
      auditStatement('supplier', `Added supplier ${payload.companyName} (${code})`, { type: 'supplier', id }),
    ])
    return supplierApi.get(id)
  },

  update: async (id: number, payload: SupplierPayload): Promise<Supplier> => {
    await requirePermission('suppliers.manage')
    if (!payload.companyName.trim()) throw new ApiError('Enter the supplier name.', 400)
    await runTransaction([
      {
        statement: `UPDATE suppliers SET company_name = ?, contact_person = ?, phone = ?, email = ?, address = ?, notes = ?, is_active = ? WHERE id = ?`,
        values: [
          payload.companyName,
          payload.contactPerson || null,
          payload.phone || null,
          payload.email || null,
          payload.address || null,
          payload.notes?.trim() || null,
          payload.isActive ? 1 : 0,
          id,
        ],
      },
      auditStatement('supplier', `Updated supplier ${payload.companyName}`, { type: 'supplier', id }),
    ])
    return supplierApi.get(id)
  },

  deactivate: async (id: number): Promise<void> => {
    await requirePermission('suppliers.manage')
    const supplier = await supplierApi.get(id)
    await runTransaction([
      { statement: `UPDATE suppliers SET is_active = 0 WHERE id = ?`, values: [id] },
      auditStatement('supplier', `Deactivated supplier ${supplier.companyName}`, { type: 'supplier', id }),
    ])
  },
}
