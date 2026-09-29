import type { PagedResult, PaymentMethod, Refund, RefundItem, Sale } from '../types'
import { querySQL } from '../database/sqlite'
import { idByNumber, nextDocumentNumber, runTransaction, type SqlStatement } from '../database/tx'
import { salesApi } from './salesApi'
import { settingsApi } from './settingsApi'
import { auditStatement } from '../services/audit'
import { stockChangeStatements } from '../services/inventoryMovements'
import { methodLabel } from '../services/payments'
import { roundMoney, sumMoney } from '../utils/amount'
import { ApiError } from '../utils/errors'
import { formatMoney } from '../utils/format'
import { getStoredUser } from '../utils/session'
import { PAYMENT_OPTIONS } from '../utils/pos'
import { hasPermission, type Permission, type Role } from '../utils/permissions'

/**
 * Returns, refunds and voids. The original sale row is never deleted or rewritten beyond its
 * status/void columns, so history and reports can always show what really happened.
 */

export type Approver = { id: string | number; fullName: string }

export const MIN_REASON_LENGTH = 3

export type RefundPayload = {
  saleId: number
  items: { productId: number; quantity: number }[]
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

function actorName(): string {
  const user = getStoredUser()
  if (!user) throw new ApiError('Not signed in.', 401)
  return user.fullName
}

/**
 * The UI collects the approval (own permission or a manager PIN); the service still re-checks
 * that the approver is an active account whose role allows the action.
 */
async function assertApprover(approver: Approver, permission: Permission): Promise<string> {
  const result = await querySQL(`SELECT full_name, role, is_active FROM users WHERE id = ? LIMIT 1`, [Number(approver.id)])
  const row = result.values?.[0] as { full_name: string; role: Role; is_active: number } | undefined
  if (!row || !row.is_active || !hasPermission(row.role, permission)) {
    throw new ApiError('This needs approval from a manager or admin.', 403)
  }
  return row.full_name
}

async function openShiftId(): Promise<number | null> {
  const user = getStoredUser()
  if (!user) return null
  const result = await querySQL(`SELECT id FROM shifts WHERE employee_id = ? AND status = 0 LIMIT 1`, [Number(user.id)])
  return (result.values?.[0]?.id as number | undefined) ?? null
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
export function calculateRefund(sale: Sale, selection: { productId: number; quantity: number }[]) {
  const lines = selection
    .filter((entry) => entry.quantity > 0)
    .map((entry) => {
      const item = sale.items.find((candidate) => candidate.productId === entry.productId)
      if (!item) throw new ApiError('That item is not on this receipt.', 400)
      if (!Number.isInteger(entry.quantity) || entry.quantity > returnableQuantity(item)) {
        throw new ApiError(`Only ${returnableQuantity(item)} of ${item.productName} can still be returned.`, 400)
      }
      return { item, quantity: entry.quantity, amount: refundLineAmount(sale, item.unitPrice, entry.quantity) }
    })

  const remainingValue = roundMoney(sale.total - sale.refundedAmount)
  const returnsEverything = sale.items.every((item) => {
    const line = lines.find((entry) => entry.item.productId === item.productId)
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
    `SELECT ri.product_id AS productId, p.name AS productName, ri.quantity AS quantity,
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
    if (!PAYMENT_OPTIONS.some((option) => option.value === payload.method)) {
      throw new ApiError('Choose how the refund is paid out.', 400)
    }

    // Always work from the latest saved state so two returns can't both refund the same units.
    const sale = await salesApi.get(payload.saleId)
    if (sale.status === 'Voided') throw new ApiError('This sale was voided and can’t be refunded.', 400)
    if (sale.status !== 'Completed') throw new ApiError('Only completed sales can be refunded.', 400)

    const { lines, amount, returnsEverything } = calculateRefund(sale, payload.items)
    if (lines.length === 0) throw new ApiError('Select at least one item to return.', 400)

    const settings = await settingsApi.get()
    const money = (value: number) => formatMoney(value, settings.currencySymbol)
    const processedBy = actorName()
    const approvedBy = await assertApprover(payload.approvedBy, 'sales.refund')
    const shiftId = await openShiftId()
    const now = new Date().toISOString()
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
        statement: `INSERT INTO refund_items (refund_id, product_id, quantity, unit_price, amount) VALUES (${refundIdSql}, ?, ?, ?, ?)`,
        values: [refundNumber, line.item.productId, line.quantity, line.item.unitPrice, line.amount],
      })
      if (payload.restock) {
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

    const entity = { type: 'sale', id: sale.invoiceNumber }
    const approval = approvedBy !== processedBy ? ` · approved by ${approvedBy}` : ''
    const itemSummary = lines.map((line) => `${line.quantity}× ${line.item.productName}`).join(', ')
    statements.push(
      auditStatement(
        'refund',
        `${refundNumber}: ${money(amount)} ${methodLabel(payload.method)} refund on ${sale.invoiceNumber}${returnsEverything ? ' (full)' : ' (partial)'} · ${reason}${approval}`,
        entity,
        undefined,
        now,
      ),
      auditStatement(
        'return',
        `${refundNumber}: ${itemSummary} ${payload.restock ? 'returned to stock' : 'not restocked'}`,
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
    const voidedBy = actorName()
    const approvedBy = await assertApprover(payload.approvedBy, 'sales.void')
    const now = new Date().toISOString()

    const statements: SqlStatement[] = [
      {
        // Status was re-read just above; callers also lock the button while this runs.
        statement: `UPDATE sales SET status = 2, voided_at = ?, voided_by = ?, void_reason = ?, void_approved_by = ? WHERE id = ? AND status = 1`,
        values: [now, voidedBy, reason, approvedBy, sale.id],
      },
    ]
    for (const item of sale.items) {
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
