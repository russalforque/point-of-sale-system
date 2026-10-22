import type { DiscountType, PagedResult, PaymentMethod, Sale, SaleItem, SalePayment } from '../types'
import { querySQL } from '../database/sqlite'
import { nextDocumentNumber, runTransaction, type SqlStatement } from '../database/tx'
import { settingsApi } from './settingsApi'
import { auditStatement } from '../services/audit'
import { assertApprover, requirePermission, type Approver } from '../services/authz'
import { CHARGE_METHOD, CREDIT_ENTRY_TYPE, creditEntryStatements, dueDateFrom } from '../services/credit'
import { ingredientChangeStatements, stockChangeStatements } from '../services/inventoryMovements'
import { isInventoryMode, tracksProductStock } from '../services/recipes'
import { planSale, shortageMessage, shortageText, type SaleLineInput, type StockShortage } from './salePlan'
import { loyaltyActive, pointsChangeStatement, pointsForAmount, pointsValue } from '../services/loyalty'
import { CASH_METHOD, methodLabel, settlePayments, SPLIT_METHOD, tendersLabel, type Tender } from '../services/payments'
import { isOrderType, orderTypeLabel, type OrderType } from '../utils/pos'
import { roundMoney, sumMoney } from '../utils/amount'
import { formatMoney } from '../utils/format'
import { hasPermission } from '../utils/permissions'
import { ApiError } from '../utils/errors'
import { exclusive } from '../services/exclusive'

export type CreateSalePayload = {
  /** Stable for a draft and all its retries; persisted atomically with the sale. */
  requestId: string
  notes?: string
  customerId?: number | null
  /** Cashier-entered discount (money), excluding any loyalty points redeemed. */
  discount: number
  /** Defaults to 'manual'. 'senior_pwd' needs `discountReference` (the ID number). */
  discountType?: DiscountType
  discountReference?: string
  /** Manager/admin who approved a manual discount above the store limit. */
  discountApprovedBy?: Approver | null
  /** Loyalty points to spend on this sale. */
  redeemPoints?: number
  orderType: OrderType
  /** Tenders as entered (cash may exceed what is due). One entry for a normal sale, several for a split. */
  payments?: Tender[]
  /** Single-tender form, still accepted for the legacy /payment screen. Ignored when `payments` is set. */
  paymentMethod?: PaymentMethod
  amountReceived?: number | null
  reference?: string
  /** One entry per cart line. The same product may appear twice with different options. */
  items: SaleLineInput[]
}

export type { StockShortage }

type SaleRow = {
  notes: string | null
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
  discount_type: string | null
  discount_reference: string | null
  discount_approved_by: string | null
  loyalty_discount: number | null
  points_earned: number | null
  points_redeemed: number | null
  pay_method: number | null
  amount_received: number | null
  change_amount: number | null
  pay_reference: string | null
  refunded_amount: number | null
}

type SaleItemRow = {
  id: number
  sale_id: number
  product_id: number
  stock_mode: string | null
  modifiers_json: string | null
  productName: string
  sku: string
  quantity: number
  unit_price: number
  line_total: number
  refunded_quantity: number | null
}

type TenderRow = { sale_id: number; method: number; amount: number; reference: string | null }

function statusLabel(status: number): string {
  if (status === 2) return 'Voided'
  if (status === 1) return 'Completed'
  return 'Pending'
}

// Returns made before v6 have no sale_item_id; they matched their line by product, which was
// unique per sale back then because lines of the same product were merged.
const ITEM_SELECT = `
  SELECT si.id AS id, si.sale_id AS sale_id, si.product_id AS product_id, p.name AS productName, p.sku AS sku,
         si.quantity AS quantity, si.unit_price AS unit_price, si.line_total AS line_total,
         si.stock_mode AS stock_mode, si.modifiers_json AS modifiers_json,
         (SELECT COALESCE(SUM(ri.quantity), 0)
            FROM refund_items ri JOIN refunds r ON r.id = ri.refund_id
           WHERE r.sale_id = si.sale_id
             AND (ri.sale_item_id = si.id OR (ri.sale_item_id IS NULL AND ri.product_id = si.product_id))) AS refunded_quantity
  FROM sale_items si
  LEFT JOIN products p ON p.id = si.product_id
`

function parseModifiers(json: string | null): SaleItem['modifiers'] {
  if (!json) return []
  try {
    const parsed = JSON.parse(json) as SaleItem['modifiers']
    return Array.isArray(parsed) ? parsed.filter((entry) => entry && typeof entry.name === 'string') : []
  } catch {
    return []
  }
}

function assembleSale(saleRow: SaleRow, itemRows: SaleItemRow[], tenderRows: TenderRow[]): Sale {
  const items: SaleItem[] = itemRows.map((row) => ({
    id: row.id,
    productId: row.product_id,
    productName: row.productName ?? 'Unknown product',
    sku: row.sku ?? '',
    quantity: row.quantity,
    unitPrice: row.unit_price,
    lineTotal: row.line_total,
    refundedQuantity: row.refunded_quantity ?? 0,
    modifiers: parseModifiers(row.modifiers_json),
    stockMode: isInventoryMode(row.stock_mode) ? row.stock_mode : null,
  }))

  let tenders: { method: number; amount: number; reference: string | null }[] = tenderRows
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
    notes: saleRow.notes ?? null,
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
    discountType: saleRow.discount_type === 'manual' || saleRow.discount_type === 'senior_pwd' ? saleRow.discount_type : null,
    discountReference: saleRow.discount_reference ?? null,
    discountApprovedBy: saleRow.discount_approved_by ?? null,
    loyaltyDiscount: saleRow.loyalty_discount ?? 0,
    pointsEarned: saleRow.points_earned ?? 0,
    pointsRedeemed: saleRow.points_redeemed ?? 0,
  }
}

/** Items and tenders for many sales in two queries (not two per sale). */
async function buildSales(rows: SaleRow[]): Promise<Sale[]> {
  if (rows.length === 0) return []
  const itemsBySale = new Map<number, SaleItemRow[]>()
  const tendersBySale = new Map<number, TenderRow[]>()

  // SQLite caps bound parameters per statement; stay well under it.
  const CHUNK = 400
  for (let start = 0; start < rows.length; start += CHUNK) {
    const ids = rows.slice(start, start + CHUNK).map((row) => row.id)
    const placeholders = ids.map(() => '?').join(', ')
    const [itemsResult, tendersResult] = await Promise.all([
      querySQL(`${ITEM_SELECT} WHERE si.sale_id IN (${placeholders}) ORDER BY si.id`, ids),
      querySQL(`SELECT sale_id, method, amount, reference FROM sale_payments WHERE sale_id IN (${placeholders}) ORDER BY id`, ids),
    ])
    for (const item of (itemsResult.values ?? []) as SaleItemRow[]) {
      const list = itemsBySale.get(item.sale_id) ?? []
      list.push(item)
      itemsBySale.set(item.sale_id, list)
    }
    for (const tender of (tendersResult.values ?? []) as TenderRow[]) {
      const list = tendersBySale.get(tender.sale_id) ?? []
      list.push(tender)
      tendersBySale.set(tender.sale_id, list)
    }
  }

  return rows.map((row) => assembleSale(row, itemsBySale.get(row.id) ?? [], tendersBySale.get(row.id) ?? []))
}

async function buildSale(row: SaleRow): Promise<Sale> {
  return (await buildSales([row]))[0]!
}

const SALE_SELECT = `
  SELECT
    s.id AS id,
    s.notes AS notes,
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
    s.discount_type AS discount_type,
    s.discount_reference AS discount_reference,
    s.discount_approved_by AS discount_approved_by,
    s.loyalty_discount AS loyalty_discount,
    s.points_earned AS points_earned,
    s.points_redeemed AS points_redeemed,
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

/** Largest manual discount allowed without approval, for a subtotal. */
export function discountLimit(subtotal: number, maxDiscountPercent: number): number {
  return roundMoney((subtotal * maxDiscountPercent) / 100)
}

/** Senior/PWD discount for a subtotal at the configured rate. */
export function seniorDiscountAmount(subtotal: number, seniorDiscountPercent: number): number {
  return roundMoney((subtotal * seniorDiscountPercent) / 100)
}

type CustomerRow = {
  id: number
  full_name: string
  is_active: number
  loyalty_points: number
  credit_limit: number | null
  credit_balance: number | null
}

export type SaleListParams = {
  search?: string
  page?: number
  pageSize?: number
  /** Restrict to sales rung up by this cashier (used to scope cashiers to their own transaction history). */
  cashierName?: string
  /** One customer's purchases. */
  customerId?: number
  /** ISO timestamps; `to` is exclusive. */
  from?: string
  to?: string
}

function saleFilters(params: SaleListParams): { where: string; values: unknown[] } {
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
  if (params.customerId) {
    clauses.push('s.customer_id = ?')
    values.push(params.customerId)
  }
  if (params.from) {
    clauses.push('s.created_at >= ?')
    values.push(params.from)
  }
  if (params.to) {
    clauses.push('s.created_at < ?')
    values.push(params.to)
  }
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', values }
}

export const salesApi = {
  list: async (params: SaleListParams): Promise<PagedResult<Sale>> => {
    const { where, values } = saleFilters(params)
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

    return {
      items: await buildSales((result.values ?? []) as SaleRow[]),
      totalCount,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
    }
  },

  /** Every sale in a date window with items and tenders, loaded in bulk (reports and exports). */
  listInRange: async (params: { from?: string; to?: string }): Promise<Sale[]> => {
    const { where, values } = saleFilters(params)
    const result = await querySQL(`${SALE_SELECT} ${where} ORDER BY s.created_at DESC`, values)
    return buildSales((result.values ?? []) as SaleRow[])
  },

  get: async (id: number): Promise<Sale> => {
    const result = await querySQL(`${SALE_SELECT} WHERE s.id = ? LIMIT 1`, [id])
    const row = result.values?.[0] as SaleRow | undefined
    if (!row) throw new ApiError('Sale not found.', 404)
    return buildSale(row)
  },

  /**
   * What an order would run short of, checked before payment so the cashier can be warned
   * (or stopped, when the store blocks sales that go below zero). Nothing is written.
   */
  checkStock: async (items: SaleLineInput[]): Promise<{ shortages: StockShortage[]; blocked: boolean }> => {
    if (items.length === 0) return { shortages: [], blocked: false }
    const [plan, settings] = await Promise.all([planSale(items), settingsApi.get()])
    return { shortages: plan.shortages, blocked: plan.shortages.length > 0 && !settings.allowNegativeStock }
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

  create: exclusive(async (payload: CreateSalePayload): Promise<Sale> => {
    if (payload.items.length === 0) {
      throw new ApiError('Cannot create a sale with no items.', 400)
    }
    if (!isOrderType(payload.orderType)) {
      throw new ApiError('Select Dine-In or Take-Out before completing the sale.', 400)
    }

    const actor = await requirePermission('sales.process')
    const requestId = payload.requestId?.trim()
    if (!requestId || !/^[\w-]{16,128}$/.test(requestId)) throw new ApiError('A valid checkout request ID is required. Reopen the register and try again.', 400)
    const notes = payload.notes?.trim() || null
    if (notes && notes.length > 1000) throw new ApiError('Order notes must be 1000 characters or fewer.', 400)
    const { requestId: _requestId, ...requestPayload } = payload
    const fingerprint = JSON.stringify(requestPayload)
    if (requestId) {
      const existing = (await querySQL('SELECT actor_id, payload_json, sale_id FROM checkout_requests WHERE request_id = ?', [requestId])).values?.[0]
      if (existing) {
        if (existing.actor_id !== actor.id || existing.payload_json !== fingerprint) {
          throw new ApiError('This checkout was already saved with different details. Check transaction history before starting a new sale.', 409)
        }
        return salesApi.get(existing.sale_id)
      }
    }
    const settings = await settingsApi.get()
    const cashierName = actor.fullName
    const now = new Date().toISOString()
    const money = (value: number) => formatMoney(value, settings.currencySymbol)

    // Only the caller's own open shift can ever be picked up here, so a sale can
    // never be attributed to another employee's shift. No active shift is fine -
    // the sale still completes, just without a shift link.
    const shiftResult = await querySQL(`SELECT id FROM shifts WHERE employee_id = ? AND status = 0 LIMIT 1`, [actor.id])
    const shiftId = (shiftResult.values?.[0]?.id as number | undefined) ?? null

    // Prices each line with its options and works out every unit of stock and ingredient the
    // whole order uses (the same product on two lines counts once against its stock).
    const plan = await planSale(payload.items)
    if (plan.shortages.length > 0 && !settings.allowNegativeStock) {
      throw new ApiError(shortageMessage(plan.shortages), 400)
    }

    let customer: CustomerRow | null = null
    if (payload.customerId) {
      const result = await querySQL(
        `SELECT id, full_name, is_active, loyalty_points, credit_limit, credit_balance FROM customers WHERE id = ? LIMIT 1`,
        [payload.customerId],
      )
      customer = (result.values?.[0] as CustomerRow | undefined) ?? null
      if (!customer) throw new ApiError('That customer no longer exists.', 404)
    }

    const subtotal = roundMoney(plan.lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0))

    // --- discount ---
    if (!Number.isFinite(payload.discount) || payload.discount < 0) throw new ApiError('Enter a valid discount.', 400)
    const manualDiscount = roundMoney(Math.min(payload.discount, subtotal))
    const discountType: DiscountType | null = manualDiscount > 0 ? payload.discountType ?? 'manual' : null
    let discountReference: string | null = null
    let discountApprovedBy: string | null = null

    if (discountType === 'senior_pwd') {
      discountReference = payload.discountReference?.trim() || null
      if (!discountReference) throw new ApiError('Enter the Senior Citizen / PWD ID number.', 400)
      if (manualDiscount > seniorDiscountAmount(subtotal, settings.seniorDiscountPercent) + 0.005) {
        throw new ApiError(`The Senior/PWD discount is ${settings.seniorDiscountPercent}% of the subtotal.`, 400)
      }
    } else if (discountType === 'manual' && manualDiscount > discountLimit(subtotal, settings.maxDiscountPercent) + 0.005) {
      if (hasPermission(actor.role, 'sales.discount')) {
        discountApprovedBy = actor.fullName
      } else {
        discountApprovedBy = await assertApprover(payload.discountApprovedBy, 'sales.discount')
      }
    }

    // --- loyalty redemption ---
    const redeemPoints = payload.redeemPoints ?? 0
    if (!Number.isInteger(redeemPoints) || redeemPoints < 0) throw new ApiError('Points to redeem must be a whole number.', 400)
    let loyaltyDiscount = 0
    if (redeemPoints > 0) {
      if (!loyaltyActive(settings)) throw new ApiError('Loyalty points are turned off.', 400)
      if (!customer) throw new ApiError('Choose the customer to redeem points.', 400)
      if (redeemPoints > customer.loyalty_points) {
        throw new ApiError(`${customer.full_name} only has ${customer.loyalty_points} points.`, 400)
      }
      loyaltyDiscount = pointsValue(redeemPoints, settings)
      if (loyaltyDiscount > roundMoney(subtotal - manualDiscount) + 0.005) {
        throw new ApiError('Points can’t be worth more than the amount due.', 400)
      }
    }

    const discount = roundMoney(manualDiscount + loyaltyDiscount)
    const taxable = subtotal - discount
    const tax = roundMoney(taxable * settings.taxRate)
    const total = roundMoney(taxable + tax)
    const pointsEarned = customer ? pointsForAmount(total, settings) : 0

    // Throws before anything is written if the tenders don't settle the total exactly.
    const settled = settlePayments(total, payload.payments ?? legacyTenders(payload, total))

    // --- charge to account ---
    const charged = sumMoney(settled.lines.filter((line) => line.method === CHARGE_METHOD).map((line) => line.amount))
    if (charged > 0) {
      if (!settings.creditEnabled) throw new ApiError('Customer credit is turned off in Settings.', 400)
      if (!customer) throw new ApiError('Choose the customer to charge this sale to.', 400)
      if (!customer.is_active) throw new ApiError(`${customer.full_name}’s account is inactive.`, 400)
      const limit = customer.credit_limit ?? 0
      const balance = customer.credit_balance ?? 0
      if (limit <= 0) throw new ApiError(`${customer.full_name} has no credit limit set. Set one under Customers.`, 400)
      if (roundMoney(balance + charged) > limit + 0.005) {
        throw new ApiError(
          `This would put ${customer.full_name} over their ${money(limit)} limit (available ${money(Math.max(limit - balance, 0))}).`,
          400,
        )
      }
    }

    const invoiceNumber = await nextDocumentNumber('sales', 'INV')
    const saleIdSql = `(SELECT id FROM sales WHERE invoice_number = ?)`

    // A saved sale's rowid is not known until the INSERT below actually runs, so every
    // dependent statement locates it via the (unique) invoice number instead of a JS-side id -
    // that lets the whole write go through executeSet() as a single real SQLite transaction.
    const statements: SqlStatement[] = [
      {
        statement: `INSERT INTO sales (invoice_number, customer_id, cashier_id, shift_id, subtotal, discount, tax, total, status, created_at, order_type,
             discount_type, discount_reference, discount_approved_by, loyalty_discount, points_earned, points_redeemed, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        values: [
          invoiceNumber,
          customer?.id ?? null,
          cashierName,
          shiftId,
          subtotal,
          discount,
          tax,
          total,
          now,
          payload.orderType,
          discountType,
          discountReference,
          discountApprovedBy,
          loyaltyDiscount,
          pointsEarned,
          redeemPoints,
          notes,
        ],
      },
    ]

    for (const line of plan.lines) {
      const lineTotal = roundMoney(line.unitPrice * line.quantity)
      statements.push({
        statement: `INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, line_total, unit_cost, stock_mode, modifiers_json)
           VALUES (${saleIdSql}, ?, ?, ?, ?, ?, ?, ?)`,
        values: [
          invoiceNumber,
          line.product.id,
          line.quantity,
          line.unitPrice,
          lineTotal,
          line.unitCost,
          line.product.mode,
          line.modifiers.length
            ? JSON.stringify(line.modifiers.map(({ groupName, name, priceDelta }) => ({ groupName, name, priceDelta })))
            : null,
        ],
      })
      // The line just inserted is the newest one of this sale.
      for (const modifier of line.modifiers) {
        statements.push({
          statement: `INSERT INTO sale_item_modifiers (sale_item_id, modifier_id, group_name, name, price_delta)
             VALUES ((SELECT MAX(id) FROM sale_items WHERE sale_id = ${saleIdSql}), ?, ?, ?, ?)`,
          values: [invoiceNumber, modifier.id, modifier.groupName, modifier.name, modifier.priceDelta],
        })
      }
      // Direct and batch products count their own units; recipe products use ingredients (below).
      if (tracksProductStock(line.product.mode)) {
        statements.push(
          ...stockChangeStatements({
            productId: line.product.id,
            delta: -line.quantity,
            reason: `Sale ${invoiceNumber}`,
            createdBy: cashierName,
            at: now,
          }),
        )
      }
    }

    // One movement per ingredient for the whole order: -18 g coffee beans · Sale INV-001024.
    for (const [itemId, used] of Array.from(plan.ingredientUse).sort((a, b) => a[0] - b[0])) {
      statements.push(
        ...ingredientChangeStatements({
          inventoryItemId: itemId,
          delta: -used,
          type: 'sale',
          reason: `Sale ${invoiceNumber}`,
          referenceType: 'sale',
          referenceId: invoiceNumber,
          user: actor,
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

    if (customer && charged > 0) {
      statements.push(
        ...creditEntryStatements({
          entryNumber: await nextDocumentNumber('customer_credit_entries', 'CR'),
          customerId: customer.id,
          type: CREDIT_ENTRY_TYPE.CHARGE,
          amount: charged,
          saleId: { sql: saleIdSql, values: [invoiceNumber] },
          method: CHARGE_METHOD,
          dueDate: dueDateFrom(settings.creditDefaultDays),
          shiftId,
          createdBy: cashierName,
          at: now,
        }),
      )
    }
    if (customer && (pointsEarned > 0 || redeemPoints > 0)) {
      statements.push(pointsChangeStatement(customer.id, pointsEarned - redeemPoints))
    }

    const itemCount = plan.lines.reduce((sum, line) => sum + line.quantity, 0)
    const entity = { type: 'sale', id: invoiceNumber }
    statements.push(
      auditStatement(
        'sale',
        `${invoiceNumber} · ${money(total)} · ${tendersLabel(settled.lines.map((line) => line.method))} · ${itemCount} ${itemCount === 1 ? 'item' : 'items'}` +
          (charged > 0 && customer ? ` · ${money(charged)} charged to ${customer.full_name}` : '') +
          (redeemPoints > 0 ? ` · ${redeemPoints} points redeemed (${money(loyaltyDiscount)})` : '') +
          // Only reachable when the store allows selling below zero.
          (plan.shortages.length ? ` · sold short: ${plan.shortages.map(shortageText).join('; ')}` : ''),
        entity,
        actor,
        now,
      ),
    )
    if (manualDiscount > 0) {
      const kind = discountType === 'senior_pwd' ? `Senior/PWD discount (ID ${discountReference})` : 'discount'
      const approval =
        discountApprovedBy && discountApprovedBy !== cashierName
          ? ` · approved by ${discountApprovedBy}`
          : discountApprovedBy
          ? ' · above limit'
          : ''
      statements.push(
        auditStatement('discount', `${money(manualDiscount)} ${kind} on ${invoiceNumber} (subtotal ${money(subtotal)})${approval}`, entity, actor, now),
      )
    }

    if (requestId) statements.push({
      statement: `INSERT INTO checkout_requests(request_id, actor_id, payload_json, invoice_number, sale_id, created_at) VALUES (?, ?, ?, ?, ${saleIdSql}, ?)`,
      values: [requestId, actor.id, fingerprint, invoiceNumber, invoiceNumber, now],
    })

    try {
      await runTransaction(statements)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (/not enough stock/i.test(message)) throw new ApiError('Stock changed while checking out. Review the cart and try again.', 409)
      throw error instanceof ApiError ? error : new ApiError('Checkout could not be confirmed. Retry this checkout without changing it, or check transaction history before starting another sale.', 500)
    }

    try {
      const saleRow = await querySQL(`SELECT id FROM sales WHERE invoice_number = ? LIMIT 1`, [invoiceNumber])
      const saleId = saleRow.values?.[0]?.id as number | undefined
      if (!saleId) throw new Error('Saved sale could not be read')
      return await salesApi.get(saleId)
    } catch {
      throw new ApiError('Sale saved, but the receipt could not be loaded. Retry this checkout without changing it, or open transaction history.', 500)
    }
  }),
}
