import type { PagedResult, PaymentMethod, Refund, RefundItem, Sale } from '../types'
import { querySQL } from '../database/sqlite'
import { idByNumber, nextDocumentNumber, runTransaction, type SqlStatement } from '../database/tx'
import { salesApi } from './salesApi'
import { settingsApi } from './settingsApi'
import { auditStatement } from '../services/audit'
import { assertApprover, currentActor, type Approver } from '../services/authz'
import { CHARGE_METHOD, CREDIT_ENTRY_TYPE, creditEntryStatements } from '../services/credit'
import { ingredientChangeStatements, stockChangeStatements } from '../services/inventoryMovements'
import { tracksProductStock } from '../services/recipes'
import { pointsChangeStatement } from '../services/loyalty'
import { methodLabel } from '../services/payments'
import { roundMoney, sumMoney } from '../utils/amount'
import { ApiError } from '../utils/errors'
import { formatMoney } from '../utils/format'
import { PAYMENT_OPTIONS } from '../utils/pos'

/**
 * Returns, refunds and voids. The original sale row is never deleted or rewritten beyond its
 * status/void columns, so history and reports can always show what really happened.
 */

export type { Approver }

export const MIN_REASON_LENGTH = 3

/** A line to return. `saleItemId` picks the exact line; older callers that only send the product still work. */
export type RefundSelection = { saleItemId?: number; productId: number; quantity: number }

export type RefundPayload = {
  saleId: number
  items: RefundSelection[]
  reason: string
  method: PaymentMethod
  /** Put the returned units back on the shelf (off for damaged / expired goods). */
  restock: boolean
  approvedBy: Approver
}

export type VoidPayload = {
  saleId: number
  reason: string
  approvedBy: Approver
}

type RefundRow = {
  id: number
  refund_number: string
  sale_id: number
  invoice_number: string | null
  amount: number
  method: number
  reason: string
  restocked: number
  processed_by: string
  approved_by: string | null
  created_at: string
}

function requireReason(reason: string): string {
  const trimmed = reason.trim()
  if (trimmed.length < MIN_REASON_LENGTH) throw new ApiError('Enter a reason for this change.', 400)
  return trimmed
}

async function openShiftId(employeeId: number): Promise<number | null> {
  const result = await querySQL(`SELECT id FROM shifts WHERE employee_id = ? AND status = 0 LIMIT 1`, [employeeId])
  return (result.values?.[0]?.id as number | undefined) ?? null
}

/** Part of a sale that was charged to the customer's account. */
function chargedAmount(sale: Sale): number {
  return sumMoney(sale.payments.filter((payment) => payment.method === CHARGE_METHOD).map((payment) => payment.amount))
}

/**
 * Share of `points` that belongs to a refund of `amount`, worked out cumulatively over all the
 * sale's refunds so a series of partial returns ends at exactly `points` when everything is back.
 */
function pointsShare(points: number, sale: Sale, amount: number, returnsEverything: boolean): number {
  if (points <= 0 || sale.total <= 0) return 0
  const before = Math.round((points * sale.refundedAmount) / sale.total)
  const after = returnsEverything ? points : Math.min(points, Math.round((points * (sale.refundedAmount + amount)) / sale.total))
  return Math.max(0, after - before)
}

/** Refund payout methods for a sale: the money tenders, plus back to the account for charged sales. */
export function refundMethodsFor(sale: Sale): { value: PaymentMethod; label: string }[] {
  const options = [...PAYMENT_OPTIONS]
  if (sale.customerId && chargedAmount(sale) > 0) options.push({ value: CHARGE_METHOD as PaymentMethod, label: 'Back to account' })
  return options
}

/**
 * Whether returned units of a line can go back on the shelf. Made-to-order (recipe) drinks and
 * untracked items can't: their ingredients were already used.
 */
export function canRestock(item: Sale['items'][number]): boolean {
  return tracksProductStock(item.stockMode ?? 'direct')
}

function findLine(sale: Sale, entry: RefundSelection): Sale['items'][number] | undefined {
  return entry.saleItemId ? sale.items.find((item) => item.id === entry.saleItemId) : sale.items.find((item) => item.productId === entry.productId)
}

/** Units of each line that can still be returned. */
export function returnableQuantity(item: Sale['items'][number]): number {
  return Math.max(item.quantity - item.refundedQuantity, 0)
}

/**
 * Refund value of returning `quantity` units of a line: its share of the final total, so the
 * discount and tax the customer actually paid are returned proportionally.
 */
export function refundLineAmount(sale: Sale, unitPrice: number, quantity: number): number {
  if (sale.subtotal <= 0) return 0
  return roundMoney(unitPrice * quantity * (sale.total / sale.subtotal))
}

/** Amount and per-line split for a return, with the final return absorbing any rounding remainder. */
export function calculateRefund(sale: Sale, selection: RefundSelection[]) {
  const lines = selection
    .filter((entry) => entry.quantity > 0)
    .map((entry) => {
      const item = findLine(sale, entry)
      if (!item) throw new ApiError('That item is not on this receipt.', 400)
      if (!Number.isInteger(entry.quantity) || entry.quantity > returnableQuantity(item)) {
        throw new ApiError(`Only ${returnableQuantity(item)} of ${item.productName} can still be returned.`, 400)
      }
      return { item, quantity: entry.quantity, amount: refundLineAmount(sale, item.unitPrice, entry.quantity) }
    })

  const remainingValue = roundMoney(sale.total - sale.refundedAmount)
  const returnsEverything = sale.items.every((item) => {
    const line = lines.find((entry) => entry.item.id === item.id)
    return returnableQuantity(item) === (line?.quantity ?? 0)
  })

  let amount = sumMoney(lines.map((line) => line.amount))
  if (returnsEverything && lines.length > 0) {
    const last = lines[lines.length - 1]!
    last.amount = roundMoney(last.amount + (remainingValue - amount))
    amount = remainingValue
  }
  amount = Math.min(amount, remainingValue)

  return { lines, amount: Math.max(amount, 0), returnsEverything }
}

async function refundItems(refundId: number): Promise<RefundItem[]> {
  const result = await querySQL(
    `SELECT ri.sale_item_id AS saleItemId, ri.product_id AS productId, p.name AS productName, ri.quantity AS quantity,
            ri.unit_price AS unitPrice, ri.amount AS amount
     FROM refund_items ri LEFT JOIN products p ON p.id = ri.product_id
     WHERE ri.refund_id = ? ORDER BY ri.id`,
    [refundId],
  )
  return ((result.values ?? []) as RefundItem[]).map((row) => ({ ...row, productName: row.productName ?? 'Unknown product' }))
}

async function toRefund(row: RefundRow): Promise<Refund> {
  return {
    id: row.id,
    refundNumber: row.refund_number,
    saleId: row.sale_id,
    invoiceNumber: row.invoice_number ?? '',
    amount: row.amount,
    method: row.method,
    methodLabel: methodLabel(row.method),
    reason: row.reason,
    restocked: Boolean(row.restocked),
    processedBy: row.processed_by,
    approvedBy: row.approved_by,
    createdAt: row.created_at,
    items: await refundItems(row.id),
  }
}

const REFUND_SELECT = `
  SELECT r.id, r.refund_number, r.sale_id, s.invoice_number, r.amount, r.method, r.reason, r.restocked,
         r.processed_by, r.approved_by, r.created_at
  FROM refunds r LEFT JOIN sales s ON s.id = r.sale_id
`

export const adjustmentsApi = {
  refundsForSale: async (saleId: number): Promise<Refund[]> => {
    const result = await querySQL(`${REFUND_SELECT} WHERE r.sale_id = ? ORDER BY r.created_at DESC`, [saleId])
    return Promise.all(((result.values ?? []) as RefundRow[]).map(toRefund))
  },

  recentRefunds: async (params: { page?: number; pageSize?: number } = {}): Promise<PagedResult<Refund>> => {
    const page = params.page ?? 1
    const pageSize = params.pageSize ?? 10
    const countResult = await querySQL(`SELECT COUNT(*) AS count FROM refunds`)
    const totalCount = (countResult.values?.[0]?.count as number | undefined) ?? 0
    const result = await querySQL(`${REFUND_SELECT} ORDER BY r.created_at DESC LIMIT ? OFFSET ?`, [
      pageSize,
      (page - 1) * pageSize,
    ])
    return {
      items: await Promise.all(((result.values ?? []) as RefundRow[]).map(toRefund)),
      totalCount,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
    }
  },

  refund: async (payload: RefundPayload): Promise<Refund> => {
    const reason = requireReason(payload.reason)

    // Always work from the latest saved state so two returns can't both refund the same units.
    const sale = await salesApi.get(payload.saleId)
    if (sale.status === 'Voided') throw new ApiError('This sale was voided and can’t be refunded.', 400)
    if (sale.status !== 'Completed') throw new ApiError('Only completed sales can be refunded.', 400)
    if (!refundMethodsFor(sale).some((option) => option.value === payload.method)) {
      throw new ApiError('Choose how the refund is paid out.', 400)
    }

    const { lines, amount, returnsEverything } = calculateRefund(sale, payload.items)
    if (lines.length === 0) throw new ApiError('Select at least one item to return.', 400)
    if (new Set(lines.map((line) => line.item.id)).size !== lines.length) throw new ApiError('Each item can only be listed once.', 400)

    const settings = await settingsApi.get()
    const money = (value: number) => formatMoney(value, settings.currencySymbol)
    const actor = await currentActor()
    const processedBy = actor.fullName
    const approvedBy = await assertApprover(payload.approvedBy, 'sales.refund')
    const shiftId = await openShiftId(actor.id)
    const now = new Date().toISOString()

    if (payload.method === CHARGE_METHOD) {
      const alreadyBack = await querySQL(
        `SELECT COALESCE(SUM(amount), 0) AS total FROM refunds WHERE sale_id = ? AND method = ?`,
        [sale.id, CHARGE_METHOD],
      )
      const returnedToAccount = (alreadyBack.values?.[0]?.total as number | undefined) ?? 0
      if (roundMoney(returnedToAccount + amount) > chargedAmount(sale) + 0.005) {
        throw new ApiError(`Only ${money(roundMoney(chargedAmount(sale) - returnedToAccount))} of this sale was charged to the account.`, 400)
      }
    }
    const refundNumber = await nextDocumentNumber('refunds', 'RF')
    const refundIdSql = `(SELECT id FROM refunds WHERE refund_number = ?)`

    const statements: SqlStatement[] = [
      {
        statement: `INSERT INTO refunds (refund_number, sale_id, amount, method, reason, restocked, shift_id, processed_by, approved_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        values: [refundNumber, sale.id, amount, payload.method, reason, payload.restock ? 1 : 0, shiftId, processedBy, approvedBy, now],
      },
    ]

    for (const line of lines) {
      statements.push({
        statement: `INSERT INTO refund_items (refund_id, product_id, quantity, unit_price, amount, sale_item_id) VALUES (${refundIdSql}, ?, ?, ?, ?, ?)`,
        values: [refundNumber, line.item.productId, line.quantity, line.item.unitPrice, line.amount, line.item.id],
      })
      if (payload.restock && canRestock(line.item)) {
        statements.push(
          ...stockChangeStatements({
            productId: line.item.productId,
            delta: line.quantity,
            reason: `Return ${refundNumber} (${sale.invoiceNumber})`,
            createdBy: processedBy,
            at: now,
          }),
        )
      }
    }

    if (payload.method === CHARGE_METHOD && sale.customerId && amount > 0) {
      statements.push(
        ...creditEntryStatements({
          entryNumber: await nextDocumentNumber('customer_credit_entries', 'CR'),
          customerId: sale.customerId,
          type: CREDIT_ENTRY_TYPE.REVERSAL,
          amount,
          saleId: sale.id,
          method: CHARGE_METHOD,
          reference: refundNumber,
          notes: reason,
          shiftId,
          createdBy: processedBy,
          at: now,
        }),
      )
    }

    // Points earned on the returned share come off the balance; points spent on it go back.
    const earnedBack = pointsShare(sale.pointsEarned, sale, amount, returnsEverything)
    const redeemedBack = pointsShare(sale.pointsRedeemed, sale, amount, returnsEverything)
    if (sale.customerId && (earnedBack > 0 || redeemedBack > 0)) {
      statements.push(pointsChangeStatement(sale.customerId, redeemedBack - earnedBack))
    }

    const entity = { type: 'sale', id: sale.invoiceNumber }
    const approval = approvedBy !== processedBy ? ` · approved by ${approvedBy}` : ''
    const itemSummary = lines
      .map((line) => `${line.quantity}× ${line.item.productName}${line.item.modifiers.length ? ` (${line.item.modifiers.map((modifier) => modifier.name).join(', ')})` : ''}`)
      .join(', ')
    const restocked = payload.restock && lines.some((line) => canRestock(line.item))
    const notRestocked = payload.restock ? lines.filter((line) => !canRestock(line.item)) : []
    const pointsNote = earnedBack || redeemedBack ? ` · points −${earnedBack} earned, +${redeemedBack} returned` : ''
    statements.push(
      auditStatement(
        'refund',
        `${refundNumber}: ${money(amount)} ${methodLabel(payload.method)} refund on ${sale.invoiceNumber}${returnsEverything ? ' (full)' : ' (partial)'} · ${reason}${approval}${pointsNote}`,
        entity,
        undefined,
        now,
      ),
      auditStatement(
        'return',
        `${refundNumber}: ${itemSummary} ${restocked ? 'returned to stock' : 'not restocked'}` +
          (notRestocked.length && restocked ? ` (made-to-order items not restocked)` : ''),
        entity,
        undefined,
        now,
      ),
    )

    await runTransaction(statements)

    const id = await idByNumber('refunds', 'refund_number', refundNumber)
    if (!id) throw new ApiError('Failed to save the refund.', 500)
    const result = await querySQL(`${REFUND_SELECT} WHERE r.id = ? LIMIT 1`, [id])
    return toRefund(result.values?.[0] as RefundRow)
  },

  void: async (payload: VoidPayload): Promise<Sale> => {
    const reason = requireReason(payload.reason)
    const sale = await salesApi.get(payload.saleId)
    if (sale.status === 'Voided') throw new ApiError('This sale is already voided.', 400)
    if (sale.status !== 'Completed') throw new ApiError('Only completed sales can be voided.', 400)
    if (sale.refundStatus !== 'None') {
      throw new ApiError('This sale already has returns. Refund the remaining items instead of voiding it.', 400)
    }

    const settings = await settingsApi.get()
    const actor = await currentActor()
    const voidedBy = actor.fullName
    const approvedBy = await assertApprover(payload.approvedBy, 'sales.void')
    const now = new Date().toISOString()

    const statements: SqlStatement[] = [
      {
        // Status was re-read just above; callers also lock the button while this runs.
        statement: `UPDATE sales SET status = 2, voided_at = ?, voided_by = ?, void_reason = ?, void_approved_by = ? WHERE id = ? AND status = 1`,
        values: [now, voidedBy, reason, approvedBy, sale.id],
      },
    ]
    // Products that count their own stock get their units back (sales before v6 were all direct stock).
    for (const item of sale.items) {
      if (!canRestock(item)) continue
      statements.push(
        ...stockChangeStatements({
          productId: item.productId,
          delta: item.quantity,
          reason: `Void ${sale.invoiceNumber}`,
          createdBy: voidedBy,
          at: now,
        }),
      )
    }
    // Ingredients come back exactly as the sale took them, recipes and options included.
    const used = await querySQL(
      `SELECT inventory_item_id, SUM(quantity) AS quantity FROM stock_movements
       WHERE reference_type = 'sale' AND reference_id = ? AND type = 'sale' GROUP BY inventory_item_id`,
      [sale.invoiceNumber],
    )
    for (const row of (used.values ?? []) as { inventory_item_id: number; quantity: number }[]) {
      if (row.quantity >= 0) continue
      statements.push(
        ...ingredientChangeStatements({
          inventoryItemId: row.inventory_item_id,
          delta: -row.quantity,
          type: 'void',
          reason: `Void ${sale.invoiceNumber}`,
          referenceType: 'void',
          referenceId: sale.invoiceNumber,
          user: actor,
          at: now,
        }),
      )
    }
    // A voided sale leaves nothing behind: the charge comes off the account and points are undone.
    const charged = chargedAmount(sale)
    if (sale.customerId && charged > 0) {
      statements.push(
        ...creditEntryStatements({
          entryNumber: await nextDocumentNumber('customer_credit_entries', 'CR'),
          customerId: sale.customerId,
          type: CREDIT_ENTRY_TYPE.REVERSAL,
          amount: charged,
          saleId: sale.id,
          method: CHARGE_METHOD,
          reference: `Void ${sale.invoiceNumber}`,
          notes: reason,
          shiftId: await openShiftId(actor.id),
          createdBy: voidedBy,
          at: now,
        }),
      )
    }
    if (sale.customerId && (sale.pointsEarned > 0 || sale.pointsRedeemed > 0)) {
      statements.push(pointsChangeStatement(sale.customerId, sale.pointsRedeemed - sale.pointsEarned))
    }

    const approval = approvedBy !== voidedBy ? ` · approved by ${approvedBy}` : ''
    statements.push(
      auditStatement(
        'void',
        `${sale.invoiceNumber} voided · ${formatMoney(sale.total, settings.currencySymbol)} · ${reason}${approval}`,
        { type: 'sale', id: sale.invoiceNumber },
        undefined,
        now,
      ),
    )

    await runTransaction(statements)
    return salesApi.get(sale.id)
  },
}
