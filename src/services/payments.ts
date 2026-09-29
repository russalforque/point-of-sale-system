import type { PaymentMethod } from '../types'
import { roundMoney, sumMoney } from '../utils/amount'
import { ApiError } from '../utils/errors'
import { PAYMENT_OPTIONS } from '../utils/pos'

/**
 * Tender rules shared by the payment screen and salesApi, so the UI can never accept a payment
 * the database would reject (or the other way round).
 *
 * - Only cash can be over-tendered; the excess is change.
 * - Card / GCash / Other can never exceed what is still due.
 * - The recorded (applied) lines always add up to exactly the sale total.
 */

export const CASH_METHOD: PaymentMethod = 0

/** payments.method for a sale settled with more than one tender type. */
export const SPLIT_METHOD = 9

export type Tender = { method: PaymentMethod; amount: number; reference?: string | null }

export type SettledPayments = {
  /** Applied amounts - cash already net of change. Sums to the sale total. */
  lines: { method: PaymentMethod; amount: number; reference: string | null }[]
  amountReceived: number
  change: number
  /** Single method, or SPLIT_METHOD. */
  summaryMethod: number
}

export function methodLabel(method: number): string {
  if (method === SPLIT_METHOD) return 'Split'
  return PAYMENT_OPTIONS.find((option) => option.value === method)?.label ?? 'Other'
}

/** "Cash + GCash" for split sales, the method name otherwise. */
export function tendersLabel(methods: number[]): string {
  const unique = Array.from(new Set(methods))
  if (unique.length === 0) return 'Unknown'
  return unique.map(methodLabel).join(' + ')
}

export function tenderedTotal(tenders: Tender[]): number {
  return sumMoney(tenders.map((tender) => tender.amount))
}

/** What is still owed after these tenders (never negative). */
export function remainingDue(total: number, tenders: Tender[]): number {
  return Math.max(roundMoney(total - tenderedTotal(tenders)), 0)
}

/** Largest amount a new tender of this method may take right now. Null = no limit (cash). */
export function maxTenderAmount(total: number, tenders: Tender[], method: PaymentMethod): number | null {
  if (method === CASH_METHOD) return null
  return remainingDue(total, tenders)
}

/** Validates the tenders against the total and returns what should be stored. Throws ApiError. */
export function settlePayments(totalInput: number, tendersInput: Tender[]): SettledPayments {
  const total = roundMoney(totalInput)
  const tenders = tendersInput.map((tender) => ({
    method: tender.method,
    amount: roundMoney(tender.amount),
    reference: tender.reference?.trim() || null,
  }))

  if (tenders.length === 0) throw new ApiError('Add a payment before completing the sale.', 400)
  for (const tender of tenders) {
    if (!Number.isFinite(tender.amount) || tender.amount < 0) {
      throw new ApiError('Payment amounts must be positive.', 400)
    }
    if (!PAYMENT_OPTIONS.some((option) => option.value === tender.method)) {
      throw new ApiError('Unknown payment method.', 400)
    }
  }

  // A fully discounted (₱0.00) sale still records how it was "paid".
  if (total === 0) {
    const first = tenders[0]!
    return {
      lines: [{ method: first.method, amount: 0, reference: first.reference }],
      amountReceived: 0,
      change: 0,
      summaryMethod: first.method,
    }
  }

  const paying = tenders.filter((tender) => tender.amount > 0)
  const tendered = tenderedTotal(paying)
  if (tendered < total) {
    throw new ApiError(`Payment is short by ${roundMoney(total - tendered).toFixed(2)}.`, 400)
  }

  const nonCash = sumMoney(paying.filter((tender) => tender.method !== CASH_METHOD).map((tender) => tender.amount))
  if (nonCash > total) {
    throw new ApiError('Card, GCash and other payments can’t be more than the amount due.', 400)
  }

  // Change only ever comes out of cash; take it from the last cash tenders first.
  const change = roundMoney(tendered - total)
  let changeLeft = change
  const lines = paying.map((tender) => ({ ...tender }))
  for (let index = lines.length - 1; index >= 0 && changeLeft > 0; index -= 1) {
    const line = lines[index]!
    if (line.method !== CASH_METHOD) continue
    const taken = Math.min(line.amount, changeLeft)
    line.amount = roundMoney(line.amount - taken)
    changeLeft = roundMoney(changeLeft - taken)
  }

  const applied = lines.filter((line) => line.amount > 0)
  const methods = Array.from(new Set(applied.map((line) => line.method)))

  return {
    lines: applied,
    amountReceived: tendered,
    change,
    summaryMethod: methods.length === 1 ? methods[0]! : SPLIT_METHOD,
  }
}
