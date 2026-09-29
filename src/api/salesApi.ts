import type { PagedResult, PaymentMethod, Sale, SaleItem, SalePayment } from '../types'
import { initDatabase, querySQL } from '../database/sqlite'
import type { SqlStatement } from '../database/tx'
import { settingsApi } from './settingsApi'
import { auditStatement } from '../services/audit'
import { stockChangeStatements } from '../services/inventoryMovements'
import { CASH_METHOD, methodLabel, settlePayments, SPLIT_METHOD, tendersLabel, type Tender } from '../services/payments'
import { getStoredUser } from '../utils/session'
import { isOrderType, orderTypeLabel, type OrderType } from '../utils/pos'
import { roundMoney } from '../utils/amount'
import { formatMoney } from '../utils/format'
import { ApiError } from '../utils/errors'

export type CreateSalePayload = {
  customerId?: number | null
  discount: number
  orderType: OrderType
  /** Tenders as entered (cash may exceed what is due). One entry for a normal sale, several for a split. */
  payments?: Tender[]
  /** Single-tender form, still accepted for the legacy /payment screen. Ignored when `payments` is set. */
  paymentMethod?: PaymentMethod
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
  shift_id: number | null
  subtotal: number
  discount: number
  tax: number
  total: number
  status: number
  created_at: string
  order_type: number | null
  voided_at: string | null
  voided_by: string | null
  void_reason: string | null
  void_approved_by: string | null
  pay_method: number | null
  amount_received: number | null
  change_amount: number | null
  pay_reference: string | null
  refunded_amount: number | null
}

type SaleItemRow = {
  product_id: number
  productName: string
  sku: string
  quantity: number
  unit_price: number
  line_total: number
  refunded_quantity: number | null
}

type TenderRow = { method: number; amount: number; reference: string | null }

function statusLabel(status: number): string {
  if (status === 2) return 'Voided'
  if (status === 1) return 'Completed'
  return 'Pending'
}

async function buildSale(saleRow: SaleRow): Promise<Sale> {
  const [itemsResult, tendersResult] = await Promise.all([
    querySQL(
      `SELECT si.product_id AS product_id, p.name AS productName, p.sku AS sku,
              si.quantity AS quantity, si.unit_price AS unit_price, si.line_total AS line_total,
              (SELECT COALESCE(SUM(ri.quantity), 0)
                 FROM refund_items ri JOIN refunds r ON r.id = ri.refund_id
                WHERE r.sale_id = si.sale_id AND ri.product_id = si.product_id) AS refunded_quantity
       FROM sale_items si
       LEFT JOIN products p ON p.id = si.product_id
       WHERE si.sale_id = ?`,
      [saleRow.id],
    ),
    querySQL(`SELECT method, amount, reference FROM sale_payments WHERE sale_id = ? ORDER BY id`, [saleRow.id]),
  ])

  const items: SaleItem[] = ((itemsResult.values ?? []) as SaleItemRow[]).map((row) => ({
    productId: row.product_id,
    productName: row.productName ?? 'Unknown product',
    sku: row.sku ?? '',
    quantity: row.quantity,
    unitPrice: row.unit_price,
    lineTotal: row.line_total,
    refundedQuantity: row.refunded_quantity ?? 0,
  }))

  let tenders = (tendersResult.values ?? []) as TenderRow[]
  if (tenders.length === 0 && saleRow.pay_method !== null && saleRow.pay_method !== SPLIT_METHOD) {
    tenders = [{ method: saleRow.pay_method, amount: saleRow.total, reference: saleRow.pay_reference }]
  }
  const payments: SalePayment[] = tenders.map((tender) => ({
    method: tender.method,
    label: methodLabel(tender.method),
    amount: tender.amount,
    reference: tender.reference,
  }))

  const soldQuantity = items.reduce((sum, item) => sum + item.quantity, 0)
  const refundedQuantity = items.reduce((sum, item) => sum + item.refundedQuantity, 0)
  const refundStatus: Sale['refundStatus'] =
    refundedQuantity === 0 ? 'None' : refundedQuantity >= soldQuantity ? 'Full' : 'Partial'

  return {
    id: saleRow.id,
    invoiceNumber: saleRow.invoice_number,
    customerId: saleRow.customer_id,
    customerName: saleRow.customerName,
    cashierName: saleRow.cashier_id,
    shiftId: saleRow.shift_id,
    subtotal: saleRow.subtotal,
    discount: saleRow.discount,
    tax: saleRow.tax,
    total: saleRow.total,
    status: statusLabel(saleRow.status),
    createdAt: saleRow.created_at,
    orderType: orderTypeLabel(saleRow.order_type),
    paymentMethod: payments.length ? tendersLabel(payments.map((p) => p.method)) : 'Unknown',
    amountReceived: saleRow.amount_received ?? null,
    change: saleRow.change_amount ?? null,
    items,
    payments,
    refundedAmount: roundMoney(saleRow.refunded_amount ?? 0),
    refundStatus,
    voidedAt: saleRow.voided_at,
    voidedBy: saleRow.voided_by,
    voidReason: saleRow.void_reason,
    voidApprovedBy: saleRow.void_approved_by,
  }
}

const SALE_SELECT = `
  SELECT
    s.id AS id,
    s.invoice_number AS invoice_number,
    s.customer_id AS customer_id,
    c.full_name AS customerName,
    s.cashier_id AS cashier_id,
    s.shift_id AS shift_id,
    s.subtotal AS subtotal,
    s.discount AS discount,
    s.tax AS tax,
    s.total AS total,
    s.status AS status,
    s.created_at AS created_at,
    s.order_type AS order_type,
    s.voided_at AS voided_at,
    s.voided_by AS voided_by,
    s.void_reason AS void_reason,
    s.void_approved_by AS void_approved_by,
    pay.method AS pay_method,
    pay.amount_received AS amount_received,
    pay.change_amount AS change_amount,
    pay.reference AS pay_reference,
    (SELECT COALESCE(SUM(r.amount), 0) FROM refunds r WHERE r.sale_id = s.id) AS refunded_amount
  FROM sales s
  LEFT JOIN customers c ON c.id = s.customer_id
  LEFT JOIN payments pay ON pay.sale_id = s.id
`

/** The single-tender legacy payload, expressed as tenders. Non-cash never carried an amount before. */
function legacyTenders(payload: CreateSalePayload, total: number): Tender[] {
  const method = payload.paymentMethod ?? CASH_METHOD
  const amount = method === CASH_METHOD ? payload.amountReceived ?? total : total
  return [{ method, amount, reference: payload.reference }]
}

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

  /** Exact receipt lookup. Accepts "INV-000123", "inv-123" or just "123". */
  findByInvoice: async (input: string): Promise<Sale | null> => {
    const raw = input.trim().toUpperCase()
    if (!raw) return null
    const digits = raw.replace(/^INV-?/, '')
    const candidates = /^\d+$/.test(digits) ? [raw, `INV-${digits.padStart(6, '0')}`] : [raw]
    const result = await querySQL(
      `${SALE_SELECT} WHERE UPPER(s.invoice_number) IN (${candidates.map(() => '?').join(', ')}) LIMIT 1`,
      candidates,
    )
    const row = result.values?.[0] as SaleRow | undefined
    return row ? buildSale(row) : null
  },

  create: async (payload: CreateSalePayload): Promise<Sale> => {
    if (payload.items.length === 0) {
      throw new ApiError('Cannot create a sale with no items.', 400)
    }
    if (!isOrderType(payload.orderType)) {
      throw new ApiError('Select Dine-In or Take-Out before completing the sale.', 400)
    }

    const db = await initDatabase()
    const settings = await settingsApi.get()
    const currentUser = getStoredUser()
    const cashierName = currentUser?.fullName ?? 'Cashier'
    const now = new Date().toISOString()
    const money = (value: number) => formatMoney(value, settings.currencySymbol)

    // Only the caller's own open shift can ever be picked up here, so a sale can
    // never be attributed to another employee's shift. No active shift is fine -
    // the sale still completes, just without a shift link.
    let shiftId: number | null = null
    if (currentUser) {
      const shiftResult = await db.query(
        `SELECT id FROM shifts WHERE employee_id = ? AND status = 0 LIMIT 1`,
        [Number(currentUser.id)],
      )
      shiftId = (shiftResult.values?.[0]?.id as number | undefined) ?? null
    }

    const productRows = await Promise.all(
      payload.items.map(async (item) => {
        if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
          throw new ApiError('Item quantities must be whole numbers above zero.', 400)
        }
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

    const subtotal = roundMoney(productRows.reduce((sum, row) => sum + row.selling_price * row.quantity, 0))
    const discount = roundMoney(Math.min(Math.max(payload.discount, 0), subtotal))
    const taxable = subtotal - discount
    const tax = roundMoney(taxable * settings.taxRate)
    const total = roundMoney(taxable + tax)

    // Throws before anything is written if the tenders don't settle the total exactly.
    const settled = settlePayments(total, payload.payments ?? legacyTenders(payload, total))

    const countResult = await db.query(`SELECT COUNT(*) AS count FROM sales`)
    const nextNumber = ((countResult.values?.[0]?.count as number | undefined) ?? 0) + 1
    const invoiceNumber = `INV-${String(nextNumber).padStart(6, '0')}`
    const saleIdSql = `(SELECT id FROM sales WHERE invoice_number = ?)`

    // A saved sale's rowid is not known until the INSERT below actually runs, so every
    // dependent statement locates it via the (unique) invoice number instead of a JS-side id -
    // that lets the whole write go through executeSet() as a single real SQLite transaction.
    const statements: SqlStatement[] = [
      {
        statement: `INSERT INTO sales (invoice_number, customer_id, cashier_id, shift_id, subtotal, discount, tax, total, status, created_at, order_type)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        values: [
          invoiceNumber,
          payload.customerId ?? null,
          cashierName,
          shiftId,
          subtotal,
          discount,
          tax,
          total,
          now,
          payload.orderType,
        ],
      },
    ]

    for (const row of productRows) {
      const lineTotal = roundMoney(row.selling_price * row.quantity)
      statements.push({
        statement: `INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, line_total)
           VALUES (${saleIdSql}, ?, ?, ?, ?)`,
        values: [invoiceNumber, row.id, row.quantity, row.selling_price, lineTotal],
      })
      statements.push(
        ...stockChangeStatements({
          productId: row.id,
          delta: -row.quantity,
          reason: `Sale ${invoiceNumber}`,
          createdBy: cashierName,
          at: now,
        }),
      )
    }

    // `payments` keeps one summary row per sale (received / change); `sale_payments` holds each tender.
    const reference = settled.lines.find((line) => line.reference)?.reference ?? null
    statements.push({
      statement: `INSERT INTO payments (sale_id, method, amount, amount_received, change_amount, reference)
         VALUES (${saleIdSql}, ?, ?, ?, ?, ?)`,
      values: [invoiceNumber, settled.summaryMethod, total, settled.amountReceived, settled.change, reference],
    })
    for (const line of settled.lines) {
      statements.push({
        statement: `INSERT INTO sale_payments (sale_id, method, amount, reference) VALUES (${saleIdSql}, ?, ?, ?)`,
        values: [invoiceNumber, line.method, line.amount, line.reference],
      })
    }

    const itemCount = productRows.reduce((sum, row) => sum + row.quantity, 0)
    const entity = { type: 'sale', id: invoiceNumber }
    statements.push(
      auditStatement(
        'sale',
        `${invoiceNumber} · ${money(total)} · ${tendersLabel(settled.lines.map((line) => line.method))} · ${itemCount} ${itemCount === 1 ? 'item' : 'items'}`,
        entity,
        undefined,
        now,
      ),
    )
    if (discount > 0) {
      statements.push(
        auditStatement('discount', `${money(discount)} discount on ${invoiceNumber} (subtotal ${money(subtotal)})`, entity, undefined, now),
      )
    }

    try {
      await db.executeSet(statements as { statement: string; values: any[] }[], true)
    } catch (error) {
      throw error instanceof ApiError ? error : new ApiError('Failed to complete sale.', 500)
    }

    const saleRow = await db.query(`SELECT id FROM sales WHERE invoice_number = ? LIMIT 1`, [invoiceNumber])
    const saleId = saleRow.values?.[0]?.id as number | undefined
    if (!saleId) throw new ApiError('Failed to complete sale.', 500)

    return salesApi.get(saleId)
  },
}
