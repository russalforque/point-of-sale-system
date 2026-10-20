import type { SqlStatement } from '../database/tx'
import type { StoreSetting } from '../types'
import { roundMoney } from '../utils/amount'

/**
 * Loyalty points (optional, Settings → Loyalty). Customers earn one point for every
 * `loyaltyAmountPerPoint` of the amount they actually paid, and each point is worth
 * `loyaltyPointValue` off a later purchase. Redeemed points work like a pre-tax discount.
 */

export function loyaltyActive(settings: StoreSetting): boolean {
  return settings.loyaltyEnabled && settings.loyaltyAmountPerPoint > 0 && settings.loyaltyPointValue > 0
}

/** Points earned on a sale total (whole points, rounded down). */
export function pointsForAmount(amount: number, settings: StoreSetting): number {
  if (!loyaltyActive(settings) || amount <= 0) return 0
  return Math.floor(roundMoney(amount) / settings.loyaltyAmountPerPoint + 1e-9)
}

/** Money value of `points`. */
export function pointsValue(points: number, settings: StoreSetting): number {
  return roundMoney(points * settings.loyaltyPointValue)
}

/** Most points usable on a purchase: never more than the customer has, nor worth more than `maxValue`. */
export function maxRedeemablePoints(balance: number, maxValue: number, settings: StoreSetting): number {
  if (!loyaltyActive(settings) || balance <= 0 || maxValue <= 0) return 0
  return Math.max(0, Math.min(balance, Math.floor(maxValue / settings.loyaltyPointValue + 1e-9)))
}

/** Adds (or with a negative `delta`, removes) points; a balance never drops below zero. */
export function pointsChangeStatement(customerId: number, delta: number): SqlStatement {
  return {
    statement: `UPDATE customers SET loyalty_points = MAX(0, loyalty_points + ?) WHERE id = ?`,
    values: [delta, customerId],
  }
}
