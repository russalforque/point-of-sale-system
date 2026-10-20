import type { PaymentBreakdown, PaymentMethod, Product } from '../types'
import { roundMoney } from './amount'

export type { PaymentMethod }

/** An option chosen for a cart line (Size: Large, Milk: Oat). */
export type CartModifier = { id: number; groupId: number; groupName: string; name: string; priceDelta: number }

export type CartLine = {
  /** Product + chosen options: the same drink with different options is a separate line. */
  key: string
  product: Product
  quantity: number
  modifiers: CartModifier[]
}

export type CartTotals = {
  subtotal: number
  discount: number
  tax: number
  total: number
}

/**
 * Most products the register grid shows at once. Stores with 10,000+ products find items by
 * search, scan or category; rendering the whole catalog would make the register sluggish.
 */
export const REGISTER_GRID_LIMIT = 200

export const EMPTY_PAYMENT_BREAKDOWN: PaymentBreakdown = {
  cash: 0,
  card: 0,
  gcash: 0,
  transfer: 0,
  other: 0,
}

export function lineKey(productId: number, modifiers: CartModifier[] = []): string {
  if (modifiers.length === 0) return String(productId)
  return `${productId}:${modifiers.map((modifier) => modifier.id).sort((a, b) => a - b).join('-')}`
}

/** Price of one unit of a line: the product plus its options. */
export function unitPrice(line: Pick<CartLine, 'product' | 'modifiers'>): number {
  return roundMoney(line.product.sellingPrice + line.modifiers.reduce((sum, modifier) => sum + modifier.priceDelta, 0))
}

export function lineTotal(line: CartLine): number {
  return roundMoney(unitPrice(line) * line.quantity)
}

/** Units of a product in the order, across all its lines (for stock limits). */
export function lineQty(lines: CartLine[], productId: number): number {
  return lines.filter((l) => l.product.id === productId).reduce((sum, l) => sum + l.quantity, 0)
}

/**
 * Whether `extra` more units fit what is available: own stock, servings the ingredients can make,
 * or no limit for untracked products. `allowOversell` (store setting) lifts the limit; the
 * payment screen still warns, and checkout re-checks every ingredient including options.
 */
export function canSell(product: Product, lines: CartLine[], extra = 1, allowOversell = false): boolean {
  if (allowOversell || product.availableQuantity === null) return true
  return lineQty(lines, product.id) + extra <= product.availableQuantity
}

/** Most units a line can have, given the product's other lines. Infinity when nothing limits it. */
export function lineMax(lines: CartLine[], line: CartLine, allowOversell = false): number {
  if (allowOversell || line.product.availableQuantity === null) return Infinity
  return Math.max(line.product.availableQuantity - (lineQty(lines, line.product.id) - line.quantity), 0)
}

export function addToCart(
  lines: CartLine[],
  product: Product,
  options: { modifiers?: CartModifier[]; quantity?: number; allowOversell?: boolean } = {},
): CartLine[] {
  const modifiers = options.modifiers ?? []
  const quantity = options.quantity ?? 1
  if (!canSell(product, lines, quantity, options.allowOversell)) return lines
  const key = lineKey(product.id, modifiers)
  const existing = lines.find((l) => l.key === key)
  if (!existing) return [...lines, { key, product, quantity, modifiers }]
  return lines.map((l) => (l.key === key ? { ...l, quantity: l.quantity + quantity } : l))
}

export function setLineQty(lines: CartLine[], key: string, quantity: number, allowOversell = false): CartLine[] {
  if (quantity <= 0) return lines.filter((l) => l.key !== key)
  return lines.map((l) => (l.key === key ? { ...l, quantity: Math.min(quantity, lineMax(lines, l, allowOversell)) } : l))
}

export function removeLine(lines: CartLine[], key: string): CartLine[] {
  return lines.filter((l) => l.key !== key)
}

/** The cart as salesApi.create / checkStock take it: one entry per line, with its options. */
export function saleItems(lines: CartLine[]): { productId: number; quantity: number; modifierIds: number[] }[] {
  return lines.map((line) => ({ productId: line.product.id, quantity: line.quantity, modifierIds: line.modifiers.map((modifier) => modifier.id) }))
}

/** Changes whenever what the order needs from stock changes (for re-running the stock check). */
export function cartStockKey(lines: CartLine[]): string {
  return lines.map((line) => `${line.key}x${line.quantity}`).join(',')
}

/** "Large · Oat Milk · Extra Shot" */
export function modifierSummary(modifiers: { name: string }[]): string {
  return modifiers.map((modifier) => modifier.name).join(' · ')
}

export function calculateTotals(lines: CartLine[], discount: number, taxRate: number): CartTotals {
  const subtotal = roundMoney(lines.reduce((sum, l) => sum + unitPrice(l) * l.quantity, 0))
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

/** Tenders that collect money at the counter. Charge to account (4) is separate: see CHARGE_OPTION. */
export const PAYMENT_OPTIONS: { value: PaymentMethod; label: string }[] = [
  { value: 0, label: 'Cash' },
  { value: 1, label: 'Card' },
  { value: 2, label: 'GCash' },
  { value: 3, label: 'Other' },
]

/** Sale put on the customer's credit account (only when customer credit is on in Settings). */
export const CHARGE_OPTION: { value: PaymentMethod; label: string } = { value: 4, label: 'Charge' }

/** Every tender a sale can carry, for reports and filters. */
export const ALL_TENDER_OPTIONS = [...PAYMENT_OPTIONS, CHARGE_OPTION]

/** Stored as `sales.order_type`. 0 = Dine-In, 1 = Take-Out. */
export type OrderType = 0 | 1

/** Every new order starts as Dine-In; Take-Out is an explicit cashier choice. */
export const DEFAULT_ORDER_TYPE: OrderType = 0

export const ORDER_TYPE_OPTIONS: { value: OrderType; label: string }[] = [
  { value: 0, label: 'Dine-In' },
  { value: 1, label: 'Take-Out' },
]

export function isOrderType(value: unknown): value is OrderType {
  return ORDER_TYPE_OPTIONS.some((option) => option.value === value)
}

/** Sales recorded before order types existed have no order type (null). */
export function orderTypeLabel(value: number | null | undefined): string | null {
  return ORDER_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? null
}
