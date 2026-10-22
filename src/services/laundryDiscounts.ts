import type { LaundryAppliedDiscount, LaundryDiscount, LaundryDiscountContext, LaundryLine } from '../types/laundry'
import { cents, orderTotals } from './laundryMath'

/** Optimistic quote check; posting still calculates all prices from the database. */
export function laundryPricingKey(items: LaundryLine[], addons: LaundryLine[], context: LaundryDiscountContext, ids: number[]) {
  const lines = (rows: LaundryLine[]) => rows.map(row => [row.id, row.name, row.pricing, row.quantity_milli, row.price_cents, row.category ?? ''])
  return JSON.stringify({ items: lines(items), addons: lines(addons), rules: context.rules.revision, visits: context.visits,
    discounts: [...ids].sort((a, b) => a - b).map(id => [id, context.discounts.find(row => row.id === id)?.revision]) })
}

export function laundryDiscountReason(discount: LaundryDiscount, context: LaundryDiscountContext, at = new Date()): string {
  if (!discount.is_active) return 'Discount is disabled.'
  if (discount.weekday !== null && discount.weekday !== at.getDay()) return 'Not available today.'
  if (discount.visit_number > 0) {
    const visit = context.visits + 1
    if (visit < discount.visit_number || (discount.repeat_every > 0 ? (visit - discount.visit_number) % discount.repeat_every !== 0 : visit !== discount.visit_number))
      return `Requires qualifying visit ${discount.visit_number}${discount.repeat_every ? `, then every ${discount.repeat_every}` : ''}.`
    if (context.reservations.some(row => row.visit_number === visit)) return 'This visit reward is reserved or already used.'
  }
  return ''
}

export function laundryDiscountLineEligible(rule: LaundryDiscount, line: LaundryLine, kind: number): boolean {
  return rule.scope === 'order' || (rule.scope === 'services' && kind === 0) || (rule.scope === 'addons' && kind === 1)
    || (rule.scope === 'categories' && rule.categories.includes(line.category ?? ''))
}

/** Integer-cent pricing shared by the register and the database posting path. */
export function laundryDiscountTotals(
  items: LaundryLine[], addons: LaundryLine[], manual: number, ids: number[], context: LaundryDiscountContext, at = new Date(),
) {
  const original = orderTotals(items, addons, manual)
  if (!Array.isArray(ids) || ids.length > 100 || ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error('Select valid discounts (maximum 100).')
  if (new Set(ids).size !== ids.length) throw new Error('Select each discount only once.')
  const selected = ids.map(id => {
    const rule = context.discounts.find(row => row.id === id)
    if (!rule) throw new Error('A selected discount is no longer available. Refresh discounts.')
    const reason = laundryDiscountReason(rule, context, at)
    if (reason) throw new Error(`${rule.name}: ${reason}`)
    return rule
  }).sort((a, b) => a.id - b.id)
  const count = selected.length + Number(original.discount > 0)
  if (count > 1 && (!context.rules.allow_stacking || selected.some(rule => !rule.stackable)))
    throw new Error('These discounts cannot be combined. Choose one discount or enable stacking in shop rules.')
  const rows = [...items.map(line => ({ ...line, kind: 0 })), ...addons.map(line => ({ ...line, kind: 1 }))]
    .map(line => ({ ...line, remaining: line.total_cents }))
  const applied: LaundryAppliedDiscount[] = []
  function deduct(indices: number[], amount: number) {
    const base = indices.reduce((sum, index) => sum + rows[index]!.remaining, 0)
    const capped = Math.min(base, amount)
    if (!base || !capped) return 0
    let cumulative = 0, allocated = 0
    for (const index of indices) {
      cumulative += rows[index]!.remaining
      const share = Number((BigInt(cumulative) * BigInt(capped) + BigInt(Math.floor(base / 2))) / BigInt(base))
      rows[index]!.remaining -= share - allocated
      allocated = share
    }
    return capped
  }
  for (const rule of selected) {
    const indices = rows.flatMap((line, index) => laundryDiscountLineEligible(rule, line, line.kind) ? [index] : [])
    if (!indices.some(index => rows[index]!.total_cents > 0)) throw new Error(`${rule.name} does not apply to the selected services or add-ons.`)
    const base = indices.reduce((sum, index) => sum + rows[index]!.remaining, 0)
    const amount = rule.kind === 'percent' ? Math.round(base * rule.value / 10000) : rule.value
    applied.push({
      discount_id: rule.id, name: rule.name, kind: rule.kind, value: rule.value, amount_cents: deduct(indices, amount),
      visit_number: rule.visit_number ? context.visits + 1 : null, rule_json: JSON.stringify(rule),
    })
  }
  if (original.discount > 0) applied.push({
    discount_id: null, name: 'Manual discount', kind: 'fixed', value: cents(manual),
    amount_cents: deduct(rows.map((_, index) => index), original.discount), visit_number: null, rule_json: '{}',
  })
  const discount = applied.reduce((sum, rule) => sum + rule.amount_cents, 0)
  return {
    subtotal: original.subtotal, discount, total: original.subtotal - discount, applied,
    lineDiscounts: rows.map(row => ({ kind: row.kind, catalog_id: row.id, amount_cents: row.total_cents - row.remaining })),
  }
}
