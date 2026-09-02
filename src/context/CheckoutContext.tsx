import { createContext, useContext, useState, ReactNode } from 'react'
import type { CartLine, PaymentMethod } from '../utils/pos'

interface CheckoutState {
  customerId: number | null
  cart: CartLine[]
  discount: number
  method: PaymentMethod
  cash: string
  paymentReference: string
}

interface CheckoutContextType {
  state: CheckoutState
  setState: (state: CheckoutState) => void
  clearCheckout: () => void
}

const defaultState: CheckoutState = {
  customerId: null,
  cart: [],
  discount: 0,
  method: 0,
  cash: '',
  paymentReference: '',
}

const CheckoutContext = createContext<CheckoutContextType | undefined>(undefined)

export function CheckoutProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CheckoutState>(defaultState)

  const clearCheckout = () => setState(defaultState)

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
