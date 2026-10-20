import { createContext, useContext, useState, ReactNode } from 'react'
import type { DiscountType } from '../types'
import { DEFAULT_ORDER_TYPE, type CartLine, type OrderType, type PaymentMethod } from '../utils/pos'

export interface CheckoutState {
  customerId: number | null
  cart: CartLine[]
  /** Manual discount (money). Ignored while `discountType` is 'senior_pwd', which follows the subtotal. */
  discount: number
  discountType: DiscountType
  /** Senior Citizen / PWD ID number. */
  discountReference: string
  /** Loyalty points the customer is spending on this order. */
  redeemPoints: number
  orderType: OrderType
  method: PaymentMethod
  cash: string
  paymentReference: string
}

interface CheckoutContextType {
  state: CheckoutState
  setState: (state: CheckoutState) => void
  clearCheckout: () => void
}

export const defaultCheckoutState: CheckoutState = {
  customerId: null,
  cart: [],
  discount: 0,
  discountType: 'manual',
  discountReference: '',
  redeemPoints: 0,
  orderType: DEFAULT_ORDER_TYPE,
  method: 0,
  cash: '',
  paymentReference: '',
}

const CheckoutContext = createContext<CheckoutContextType | undefined>(undefined)

export function CheckoutProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CheckoutState>(defaultCheckoutState)

  const clearCheckout = () => setState(defaultCheckoutState)

  return (
    <CheckoutContext.Provider value={{ state, setState, clearCheckout }}>
      {children}
    </CheckoutContext.Provider>
  )
}

export function useCheckout() {
  const context = useContext(CheckoutContext)
  if (!context) {
    throw new Error('useCheckout must be used within CheckoutProvider')
  }
  return context
}
