import type { StoreSetting } from '../types'
import { roundMoney } from '../utils/amount'
import { calculateTotals, unitPrice, type CartLine, type CartTotals } from '../utils/pos'
import { loyaltyActive, pointsValue } from './loyalty'

/**
 * Register totals, the one place the cart, payment screen and held orders get them from.
 * salesApi.create recomputes the same figures from the database before saving.
 */

export type CheckoutDiscountState = {
  cart: CartLine[]
  discount: number
  discountType: 'manual' | 'senior_pwd'
  redeemPoints: number
}

export type CheckoutTotals = CartTotals & {
  /** Cashier or Senior/PWD discount (money). */
  manualDiscount: number
  /** Value of the loyalty points being redeemed. */
  loyaltyDiscount: number
  /** Manual discount as a % of the subtotal. */
  discountPercent: number
  /** A manual discount above the store's limit (needs a manager or admin). */
  overLimit: boolean
}

export function checkoutTotals(state: CheckoutDiscountState, settings: StoreSetting): CheckoutTotals {
  const subtotal = roundMoney(state.cart.reduce((sum, line) => sum + unitPrice(line) * line.quantity, 0))
  const manualDiscount =
    state.discountType === 'senior_pwd'
      ? roundMoney((subtotal * settings.seniorDiscountPercent) / 100)
      : roundMoney(Math.min(Math.max(state.discount, 0), subtotal))
  const loyaltyDiscount =
    state.redeemPoints > 0 && loyaltyActive(settings)
      ? Math.min(pointsValue(state.redeemPoints, settings), roundMoney(subtotal - manualDiscount))
      : 0
  const totals = calculateTotals(state.cart, manualDiscount + loyaltyDiscount, settings.taxRate)
  const discountPercent = subtotal > 0 ? (manualDiscount / subtotal) * 100 : 0
  return {
    ...totals,
    manualDiscount,
    loyaltyDiscount,
    discountPercent,
    overLimit: state.discountType === 'manual' && manualDiscount > roundMoney((subtotal * settings.maxDiscountPercent) / 100) + 0.005,
  }
}
