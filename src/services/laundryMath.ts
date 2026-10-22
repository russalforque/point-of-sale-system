import type { LaundryCatalog, LaundryLine, LaundrySelection } from '../types/laundry'

const MAX_CENTS = 100_000_000
export function cents(amount: number): number {
  if (
    !Number.isFinite(amount) ||
    amount < 0 ||
    amount > MAX_CENTS / 100 ||
    Math.abs(amount * 100 - Math.round(amount * 100)) > 0.00001
  )
    throw new Error('Enter a valid amount with up to two decimal places (maximum 1,000,000).')
  return Math.round(amount * 100)
}
export function priceLines(selected: LaundrySelection[], catalog: LaundryCatalog[]): LaundryLine[] {
  const seen = new Set<number>()
  return selected.map(({ id, quantity }) => {
    const entry = catalog.find((row) => row.id === id && row.is_active)
    if (!entry || seen.has(id)) throw new Error('Select each active service or add-on only once.')
    seen.add(id)
    const milli = Math.round(quantity * 1000)
    if (
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      quantity > 10000 ||
      Math.abs(quantity * 1000 - milli) > 0.00001 ||
      (entry.pricing !== 'kg' && milli % 1000 !== 0) ||
      (entry.pricing === 'fixed' && milli !== 1000)
    )
      throw new Error(
        'Use positive quantities: up to three decimals for kg, whole counts for loads/pieces, and 1 for fixed prices.',
      )
    const total = Math.floor((entry.price_cents * milli + 500) / 1000)
    if (!Number.isSafeInteger(total) || total > MAX_CENTS) throw new Error('Line amount is too large.')
    return {
      id,
      name: entry.name,
      pricing: entry.pricing,
      quantity_milli: milli,
      price_cents: entry.price_cents,
      total_cents: total,
      category: entry.category ?? '',
    }
  })
}
export function orderTotals(items: LaundryLine[], addons: LaundryLine[], discount: number) {
  if (!items.length) throw new Error('Select at least one laundry service.')
  const subtotal = [...items, ...addons].reduce((sum, line) => sum + line.total_cents, 0)
  const discountCents = cents(discount)
  if (subtotal > MAX_CENTS || discountCents > subtotal)
    throw new Error('Discount cannot exceed the subtotal; order value must be within 1,000,000.')
  return { subtotal, discount: discountCents, total: subtotal - discountCents }
}
export function paymentAmounts(amount: number, tendered: number, method: string, balance: number) {
  if (!['Cash', 'GCash', 'Maya'].includes(method)) throw new Error('Select Cash, GCash or Maya.')
  const paid = cents(amount),
    received = cents(tendered)
  if (paid <= 0 || paid > balance)
    throw new Error('Payment must be above zero and within the remaining balance.')
  if (received < paid || (method !== 'Cash' && received !== paid))
    throw new Error('Cash tendered must cover payment. Digital payments must equal the recorded amount.')
  return { paid, received, change: received - paid }
}
