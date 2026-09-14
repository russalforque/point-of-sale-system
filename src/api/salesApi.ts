import type { PagedResult, PaymentMethod, Sale, SaleItem } from '../types'
import { initDatabase, querySQL } from '../database/sqlite'
import { settingsApi } from './settingsApi'
import { getStoredUser } from '../utils/session'
import { PAYMENT_OPTIONS } from '../utils/pos'
import { ApiError } from '../utils/errors'

export type CreateSalePayload = {
  customerId?: number | null
  discount: number
  paymentMethod: PaymentMethod
  amountReceived?: number | null
  reference?: string
  items: { productId: number; quantity: number }[]
}

type SaleRow = {
  id: number
  invoice_number: string
  customer_id: number | null
  customerName: string | null
  cashier_id: string
  subtotal: number
  discount: number
  tax: number
  total: number
  status: number
  created_at: string
}

type PaymentRow = {
  method: number
  amount: number
  amount_received: number | null
  change_amount: number | null
  reference: string | null
}

type SaleItemRow = {
  product_id: number
  productName: string
  sku: string
  quantity: number
  unit_price: number
  line_total: number
}

function paymentLabel(method: number): string {
  return PAYMENT_OPTIONS.find((opt) => opt.value === method)?.label ?? 'Other'
}

function statusLabel(status: number): string {
  if (status === 2) return 'Voided'
  if (status === 1) return 'Completed'
  return 'Pending'
}

async function buildSale(saleRow: SaleRow): Promise<Sale> {
  const [itemsResult, paymentResult] = await Promise.all([
    querySQL(
      `SELECT si.product_id AS product_id, p.name AS productName, p.sku AS sku,
              si.quantity AS quantity, si.unit_price AS unit_price, si.line_total AS line_total
       FROM sale_items si
       LEFT JOIN products p ON p.id = si.product_id
       WHERE si.sale_id = ?`,
      [saleRow.id],
    ),
    querySQL(
      `SELECT method, amount, amount_received, change_amount, reference FROM payments WHERE sale_id = ? LIMIT 1`,
      [saleRow.id],
    ),
  ])

  const items: SaleItem[] = ((itemsResult.values ?? []) as SaleItemRow[]).map((row) => ({
    productId: row.product_id,
    productName: row.productName ?? 'Unknown product',
    sku: row.sku ?? '',
    quantity: row.quantity,
    unitPrice: row.unit_price,
    lineTotal: row.line_total,
  }))

  const payment = paymentResult.values?.[0] as PaymentRow | undefined

  return {
    id: saleRow.id,
    invoiceNumber: saleRow.invoice_number,
    customerId: saleRow.customer_id,
    customerName: saleRow.customerName,
    cashierName: saleRow.cashier_id,
    subtotal: saleRow.subtotal,
    discount: saleRow.discount,
    tax: saleRow.tax,
    total: saleRow.total,
    status: statusLabel(saleRow.status),
    createdAt: saleRow.created_at,
    paymentMethod: payment ? paymentLabel(payment.method) : 'Unknown',
    amountReceived: payment?.amount_received ?? null,
    change: payment?.change_amount ?? null,
    items,
  }
}

const SALE_SELECT = `
  SELECT
    s.id AS id,
    s.invoice_number AS invoice_number,
    s.customer_id AS customer_id,
    c.full_name AS customerName,
    s.cashier_id AS cashier_id,
    s.subtotal AS subtotal,
    s.discount AS discount,
    s.tax AS tax,
    s.total AS total,
    s.status AS status,
    s.created_at AS created_at
  FROM sales s
  LEFT JOIN customers c ON c.id = s.customer_id
`

export const salesApi = {
  list: async (params: {
    search?: string
    page?: number
    pageSize?: number
    /** Restrict to sales rung up by this cashier (used to scope cashiers to their own transaction history). */
    cashierName?: string
  }): Promise<PagedResult<Sale>> => {
    const clauses: string[] = []
    const values: unknown[] = []

    if (params.search) {
      clauses.push('(s.invoice_number LIKE ? OR c.full_name LIKE ?)')
      const term = `%${params.search}%`
      values.push(term, term)
    }

    if (params.cashierName) {
      clauses.push('s.cashier_id = ?')
      values.push(params.cashierName)
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    const page = params.page ?? 1
    const pageSize = params.pageSize ?? 10

    const countResult = await querySQL(
      `SELECT COUNT(*) AS count FROM sales s LEFT JOIN customers c ON c.id = s.customer_id ${where}`,
      values,
    )
    const totalCount = (countResult.values?.[0]?.count as number | undefined) ?? 0

    const result = await querySQL(
      `${SALE_SELECT} ${where} ORDER BY s.created_at DESC LIMIT ? OFFSET ?`,
      [...values, pageSize, (page - 1) * pageSize],
    )

    const rows = (result.values ?? []) as SaleRow[]
    const items = await Promise.all(rows.map(buildSale))

    return {
      items,
      totalCount,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
    }
  },

  get: async (id: number): Promise<Sale> => {
    const result = await querySQL(`${SALE_SELECT} WHERE s.id = ? LIMIT 1`, [id])
    const row = result.values?.[0] as SaleRow | undefined
    if (!row) throw new ApiError('Sale not found.', 404)
    return buildSale(row)
  },

  create: async (payload: CreateSalePayload): Promise<Sale> => {
    if (payload.items.length === 0) {
      throw new ApiError('Cannot create a sale with no items.', 400)
    }

    const db = await initDatabase()
    const settings = await settingsApi.get()
    const cashierName = getStoredUser()?.fullName ?? 'Cashier'
    const now = new Date().toISOString()

    const productRows = await Promise.all(
      payload.items.map(async (item) => {
        const result = await db.query(
          `SELECT id, name, selling_price, stock_quantity, is_active FROM products WHERE id = ? LIMIT 1`,
          [item.productId],
        )
        const row = result.values?.[0] as
          | { id: number; name: string; selling_price: number; stock_quantity: number; is_active: number }
          | undefined
        if (!row) throw new ApiError(`Product ${item.productId} not found.`, 404)
        if (!row.is_active) throw new ApiError(`${row.name} is not available for sale.`, 400)
        if (row.stock_quantity < item.quantity) {
          throw new ApiError(`Not enough stock for ${row.name}.`, 400)
        }
        return { ...row, quantity: item.quantity }
      }),
    )

    const subtotal = productRows.reduce((sum, row) => sum + row.selling_price * row.quantity, 0)
    const discount = Math.min(Math.max(payload.discount, 0), subtotal)
    const taxable = subtotal - discount
    const tax = Math.round(taxable * settings.taxRate * 100) / 100
    const total = Math.round((taxable + tax) * 100) / 100

    const amountReceived = payload.amountReceived ?? total
    const change = Math.max(amountReceived - total, 0)

    const countResult = await db.query(`SELECT COUNT(*) AS count FROM sales`)
    const nextNumber = ((countResult.values?.[0]?.count as number | undefined) ?? 0) + 1
    const invoiceNumber = `INV-${String(nextNumber).padStart(6, '0')}`

    // A saved sale's rowid is not known until the INSERT below actually runs, so every
    // dependent statement locates it via the (unique) invoice number instead of a JS-side id -
    // that lets the whole write go through executeSet() as a single real SQLite transaction
    // instead of interleaving run() calls (each of which opens its own implicit transaction
    // and would otherwise collide with a manual BEGIN/COMMIT).
    const statements: { statement: string; values: unknown[] }[] = [
      {
        statement: `INSERT INTO sales (invoice_number, customer_id, cashier_id, subtotal, discount, tax, total, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        values: [invoiceNumber, payload.customerId ?? null, cashierName, subtotal, discount, tax, total, now],
      },
    ]

    for (const row of productRows) {
      const lineTotal = Math.round(row.selling_price * row.quantity * 100) / 100
      const newStock = row.stock_quantity - row.quantity

      statements.push({
        statement: `INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, line_total)
           VALUES ((SELECT id FROM sales WHERE invoice_number = ?), ?, ?, ?, ?)`,
        values: [invoiceNumber, row.id, row.quantity, row.selling_price, lineTotal],
      })
      statements.push({
        statement: `UPDATE products SET stock_quantity = ?, updated_at = ? WHERE id = ?`,
        values: [newStock, now, row.id],
      })
      statements.push({
        statement: `INSERT INTO inventory_transactions (product_id, type, quantity_change, quantity_after, reason, created_by, created_at)
           VALUES (?, 2, ?, ?, ?, ?, ?)`,
        values: [row.id, -row.quantity, newStock, `Sale ${invoiceNumber}`, cashierName, now],
      })
    }

    statements.push({
      statement: `INSERT INTO payments (sale_id, method, amount, amount_received, change_amount, reference)
         VALUES ((SELECT id FROM sales WHERE invoice_number = ?), ?, ?, ?, ?, ?)`,
      values: [invoiceNumber, payload.paymentMethod, total, amountReceived, change, payload.reference ?? null],
    })

    try {
      await db.executeSet(statements, true)
    } catch (error) {
      throw error instanceof ApiError ? error : new ApiError('Failed to complete sale.', 500)
    }

    const saleRow = await db.query(`SELECT id FROM sales WHERE invoice_number = ? LIMIT 1`, [
      invoiceNumber,
    ])
    const saleId = saleRow.values?.[0]?.id as number | undefined
    if (!saleId) throw new ApiError('Failed to complete sale.', 500)

    return salesApi.get(saleId)
  },
}
