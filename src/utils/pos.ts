import type { PaymentBreakdown, Product } from '../types'

export type PaymentMethod = 0 | 1 | 2 | 3

export type CartLine = {
  product: Product
  quantity: number
}

export type CartTotals = {
  subtotal: number
  discount: number
  tax: number
  total: number
}

export const EMPTY_PAYMENT_BREAKDOWN: PaymentBreakdown = {
  cash: 0,
  card: 0,
  gcash: 0,
  transfer: 0,
  other: 0,
}

export function lineQty(lines: CartLine[], productId: number): number {
  return lines.find((l) => l.product.id === productId)?.quantity ?? 0
}

export function canSell(product: Product, lines: CartLine[], extra = 1): boolean {
  return lineQty(lines, product.id) + extra <= product.stockQuantity
}

export function addToCart(lines: CartLine[], product: Product): CartLine[] {
  if (!canSell(product, lines)) return lines
  const existing = lines.find((l) => l.product.id === product.id)
  if (!existing) return [...lines, { product, quantity: 1 }]
  return lines.map((l) => (l.product.id === product.id ? { ...l, quantity: l.quantity + 1 } : l))
}

export function setLineQty(lines: CartLine[], productId: number, quantity: number): CartLine[] {
  if (quantity <= 0) return lines.filter((l) => l.product.id !== productId)
  return lines.map((l) => {
    if (l.product.id !== productId) return l
    return { ...l, quantity: Math.min(quantity, l.product.stockQuantity) }
  })
}

export function removeLine(lines: CartLine[], productId: number): CartLine[] {
  return lines.filter((l) => l.product.id !== productId)
}

export function calculateTotals(lines: CartLine[], discount: number, taxRate: number): CartTotals {
  const subtotal = lines.reduce((sum, l) => sum + l.product.sellingPrice * l.quantity, 0)
  const safeDiscount = Math.min(Math.max(discount, 0), subtotal)
  const taxable = subtotal - safeDiscount
  const tax = Math.round(taxable * taxRate * 100) / 100
  const total = Math.round((taxable + tax) * 100) / 100
  return { subtotal, discount: safeDiscount, tax, total }
}

export function getPaymentReceived(breakdown: PaymentBreakdown): number {
  return Object.values(breakdown).reduce((sum, amount) => sum + amount, 0)
}

export function calculateChange(total: number, breakdown: PaymentBreakdown): number {
  return Math.max(getPaymentReceived(breakdown) - total, 0)
}

export function buildPaymentBreakdown(method: PaymentMethod, amount: number): PaymentBreakdown {
  const base = { ...EMPTY_PAYMENT_BREAKDOWN }

  if (method === 0) {
    base.cash = amount
    return base
  }

  if (method === 1) {
    base.card = amount
    return base
  }

  if (method === 2) {
    base.gcash = amount
    return base
  }

  if (method === 3) {
    base.other = amount
    return base
  }

  return base
}

export const PAYMENT_OPTIONS: { value: PaymentMethod; label: string }[] = [
  { value: 0, label: 'Cash' },
  { value: 1, label: 'Card' },
  { value: 2, label: 'GCash' },
  { value: 3, label: 'Other' },
]
