import { qtyCost } from './units'

/**
 * How a product uses inventory, and what selling it consumes. Pure functions (no database), so
 * the register, the stock check and salesApi.create all compute exactly the same numbers.
 *
 * Quantities are stored thousandths of each item's base unit (see units.ts).
 */

/** products.inventory_mode */
export type InventoryMode = 'direct' | 'recipe' | 'batch' | 'none'

export const INVENTORY_MODES: { value: InventoryMode; label: string; hint: string }[] = [
  { value: 'direct', label: 'Direct stock', hint: 'Count this item itself, e.g. 24 bottles of Coke.' },
  { value: 'recipe', label: 'Recipe / ingredients', hint: 'Made to order. Each sale uses up ingredients.' },
  { value: 'batch', label: 'Batch / prepared', hint: 'Made ahead in batches, e.g. cold brew or pastries.' },
  { value: 'none', label: 'Don’t track', hint: 'Services or items you don’t count.' },
]

export function isInventoryMode(value: unknown): value is InventoryMode {
  return value === 'direct' || value === 'recipe' || value === 'batch' || value === 'none'
}

export function inventoryModeLabel(mode: InventoryMode): string {
  return INVENTORY_MODES.find((option) => option.value === mode)?.label ?? 'Direct stock'
}

/** Products whose own stock figure goes up and down (receiving, counts, sales). */
export function tracksProductStock(mode: InventoryMode): boolean {
  return mode === 'direct' || mode === 'batch'
}

export type RecipeLine = { inventoryItemId: number; quantity: number }

/** modifier_inventory_effects.action */
export type EffectAction = 'add' | 'remove' | 'replace' | 'scale'

export type ModifierEffect = {
  action: EffectAction
  /** add: item used · remove/replace: recipe item affected · scale: item scaled, or null for the whole recipe. */
  inventoryItemId: number | null
  /** replace: item used instead. */
  replacementItemId?: number | null
  /** add: amount used · replace: amount of the replacement (null = same amount as the original). */
  quantity?: number | null
  /** scale: percentage of the normal amount, e.g. 150 for a large, 50 for "less sugar". */
  scalePercent?: number | null
}

export const EFFECT_ACTIONS: { value: EffectAction; label: string; hint: string }[] = [
  { value: 'add', label: 'Use extra', hint: 'Extra shot: +18 g coffee beans' },
  { value: 'replace', label: 'Swap ingredient', hint: 'Oat milk instead of fresh milk' },
  { value: 'remove', label: 'Leave out', hint: 'No sugar: skip the sugar syrup' },
  { value: 'scale', label: 'Change amount', hint: 'Large: 150% · Less sugar: 50%' },
]

/** Item id → stored quantity. */
export type Consumption = Map<number, number>

function scaled(quantity: number, percent: number): number {
  return Math.round((quantity * percent) / 100)
}

/**
 * What one unit of a product uses, after its modifiers. Effects apply in a fixed order so the
 * result never depends on the order the cashier tapped them:
 *   1. amount changes   2. swaps   3. leave-outs   4. extras
 * Amount changes come before swaps so "Large" + "Oat milk" gives 300 ml of oat milk: the large
 * scales the milk, then the oat milk takes its place at the scaled amount.
 * Amount changes, swaps and leave-outs only touch the recipe; extras work for any product
 * (an extra shot on a batch cold brew still uses coffee beans).
 */
export function unitConsumption(mode: InventoryMode, recipe: RecipeLine[], effects: ModifierEffect[] = []): Consumption {
  const lines = new Map<number, number>()
  if (mode === 'recipe') {
    for (const line of recipe) lines.set(line.inventoryItemId, (lines.get(line.inventoryItemId) ?? 0) + line.quantity)
  }

  for (const effect of effects) {
    if (effect.action !== 'scale' || effect.scalePercent == null || effect.scalePercent < 0) continue
    if (effect.inventoryItemId == null) {
      for (const [itemId, quantity] of lines) lines.set(itemId, scaled(quantity, effect.scalePercent))
    } else if (lines.has(effect.inventoryItemId)) {
      lines.set(effect.inventoryItemId, scaled(lines.get(effect.inventoryItemId)!, effect.scalePercent))
    }
  }
  for (const effect of effects) {
    if (effect.action !== 'replace' || effect.inventoryItemId == null || !effect.replacementItemId) continue
    const original = lines.get(effect.inventoryItemId)
    if (original === undefined) continue
    lines.delete(effect.inventoryItemId)
    const amount = effect.quantity && effect.quantity > 0 ? effect.quantity : original
    lines.set(effect.replacementItemId, (lines.get(effect.replacementItemId) ?? 0) + amount)
  }
  for (const effect of effects) {
    if (effect.action === 'remove' && effect.inventoryItemId != null) lines.delete(effect.inventoryItemId)
  }
  for (const effect of effects) {
    if (effect.action !== 'add' || effect.inventoryItemId == null || !(effect.quantity && effect.quantity > 0)) continue
    lines.set(effect.inventoryItemId, (lines.get(effect.inventoryItemId) ?? 0) + effect.quantity)
  }

  for (const [itemId, quantity] of lines) if (quantity <= 0) lines.delete(itemId)
  return lines
}

/** `quantity` units of a line: integer multiplication, no rounding involved. */
export function lineConsumption(perUnit: Consumption, quantity: number): Consumption {
  const total: Consumption = new Map()
  for (const [itemId, amount] of perUnit) total.set(itemId, amount * quantity)
  return total
}

/** Adds `extra` into `into` (mutates and returns `into`). */
export function addConsumption(into: Consumption, extra: Consumption): Consumption {
  for (const [itemId, amount] of extra) into.set(itemId, (into.get(itemId) ?? 0) + amount)
  return into
}

export type Shortage = {
  inventoryItemId: number
  name: string
  baseUnit: string
  required: number
  available: number
}

/** Items the order needs more of than is on hand. */
export function findShortages(
  required: Consumption,
  stock: Map<number, { name: string; onHand: number; baseUnit: string }>,
): Shortage[] {
  const shortages: Shortage[] = []
  for (const [itemId, amount] of required) {
    const item = stock.get(itemId)
    const available = item?.onHand ?? 0
    if (amount > available) {
      shortages.push({ inventoryItemId: itemId, name: item?.name ?? 'Unknown item', baseUnit: item?.baseUnit ?? '', required: amount, available })
    }
  }
  return shortages.sort((a, b) => a.name.localeCompare(b.name))
}

/** Money cost of a consumption at each item's cost per base unit (rounded to centavos once, at the end). */
export function consumptionCost(consumption: Consumption, costPerBase: Map<number, number>): number {
  let total = 0
  for (const [itemId, amount] of consumption) total += qtyCost(amount, costPerBase.get(itemId) ?? 0)
  return Math.round((total + Number.EPSILON) * 100) / 100
}

/**
 * Whole servings the ingredients on hand can make (the scarcest ingredient decides).
 * Null when the recipe is empty: nothing limits it.
 */
export function servingsAvailable(recipe: RecipeLine[], onHand: Map<number, number>): number | null {
  let servings: number | null = null
  for (const line of recipe) {
    if (line.quantity <= 0) continue
    const possible = Math.max(0, Math.floor((onHand.get(line.inventoryItemId) ?? 0) / line.quantity))
    servings = servings === null ? possible : Math.min(servings, possible)
  }
  return servings
}

export type CostBreakdown = {
  cost: number
  price: number
  grossProfit: number
  /** Cost as a % of the selling price (food/ingredient cost %). Null when the price is 0. */
  costPercent: number | null
  /** Gross profit as a % of the selling price. Null when the price is 0. */
  marginPercent: number | null
}

/** Gross figures for one unit sold. Gross profit ignores rent, wages etc., so it is not net profit. */
export function costBreakdown(cost: number, price: number): CostBreakdown {
  const grossProfit = Math.round((price - cost + Number.EPSILON) * 100) / 100
  return {
    cost,
    price,
    grossProfit,
    costPercent: price > 0 ? Math.round((cost / price) * 1000) / 10 : null,
    marginPercent: price > 0 ? Math.round((grossProfit / price) * 1000) / 10 : null,
  }
}
