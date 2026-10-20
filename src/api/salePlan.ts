import type { SaleItemModifier } from '../types'
import { querySQL } from '../database/sqlite'
import {
  addConsumption,
  consumptionCost,
  isInventoryMode,
  lineConsumption,
  unitConsumption,
  type Consumption,
  type EffectAction,
  type InventoryMode,
  type ModifierEffect,
  type RecipeLine,
} from '../services/recipes'
import { formatQty, isBaseUnit, type BaseUnit } from '../services/units'
import { roundMoney } from '../utils/amount'
import { ApiError } from '../utils/errors'

/**
 * Works out everything a sale will do to stock before anything is written: each line's price with
 * its options, the full ingredient consumption (recipes + modifier effects), and any shortages.
 * salesApi.create commits exactly this plan; the payment screen shows its shortages first.
 */

export type SaleLineInput = { productId: number; quantity: number; modifierIds?: number[] }

export type StockShortage = {
  name: string
  required: number
  available: number
  /** Null for a product's own stock (whole units); otherwise stored thousandths of this base unit. */
  baseUnit: BaseUnit | null
}

export type PlannedProduct = {
  id: number
  name: string
  sellingPrice: number
  costPrice: number
  stockQuantity: number
  mode: InventoryMode
}

export type PlannedLine = {
  product: PlannedProduct
  quantity: number
  /** Selling price plus option prices. */
  unitPrice: number
  /** Cost of one unit including its options (recipe ingredients, extra shots…). */
  unitCost: number
  modifiers: (SaleItemModifier & { id: number })[]
}

export type SalePlan = {
  lines: PlannedLine[]
  /** Item id → stored quantity the whole order uses. */
  ingredientUse: Consumption
  ingredients: Map<number, { name: string; onHand: number; baseUnit: BaseUnit }>
  shortages: StockShortage[]
}

function inList(ids: number[]): string {
  return ids.map(() => '?').join(', ')
}

type ProductRow = {
  id: number
  name: string
  selling_price: number
  cost_price: number
  stock_quantity: number
  is_active: number
  inventory_mode: string | null
  batch_yield: number | null
}
type ModifierRow = {
  id: number
  name: string
  price_delta: number
  sort: number
  is_active: number
  group_id: number
  group_name: string
  group_active: number
}
type ProductGroupRow = { product_id: number; group_id: number; sort: number; name: string; selection: string; is_required: number }
type EffectRow = {
  modifier_id: number
  action: EffectAction
  inventory_item_id: number | null
  replacement_item_id: number | null
  quantity: number | null
  scale_percent: number | null
}
type IngredientRow = { id: number; name: string; on_hand: number; base_unit: string; cost_per_base: number }

export async function planSale(items: SaleLineInput[]): Promise<SalePlan> {
  for (const item of items) {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new ApiError('Item quantities must be whole numbers above zero.', 400)
    }
  }
  const productIds = Array.from(new Set(items.map((item) => item.productId)))
  const modifierIds = Array.from(new Set(items.flatMap((item) => item.modifierIds ?? [])))

  const productResult = await querySQL(
    `SELECT id, name, selling_price, cost_price, stock_quantity, is_active, inventory_mode, batch_yield FROM products WHERE id IN (${inList(productIds)})`,
    productIds,
  )
  const products = new Map(((productResult.values ?? []) as ProductRow[]).map((row) => [row.id, row]))

  const recipeResult = await querySQL(
    `SELECT product_id, inventory_item_id, quantity FROM recipe_items WHERE product_id IN (${inList(productIds)}) ORDER BY sort, id`,
    productIds,
  )
  const recipes = new Map<number, RecipeLine[]>()
  for (const row of (recipeResult.values ?? []) as { product_id: number; inventory_item_id: number; quantity: number }[]) {
    const list = recipes.get(row.product_id) ?? []
    list.push({ inventoryItemId: row.inventory_item_id, quantity: row.quantity })
    recipes.set(row.product_id, list)
  }

  const groupResult = await querySQL(
    `SELECT pg.product_id, pg.group_id, pg.sort, g.name, g.selection, g.is_required
     FROM product_modifier_groups pg JOIN modifier_groups g ON g.id = pg.group_id
     WHERE pg.product_id IN (${inList(productIds)}) AND g.is_active = 1`,
    productIds,
  )
  const productGroups = new Map<number, ProductGroupRow[]>()
  for (const row of (groupResult.values ?? []) as ProductGroupRow[]) {
    const list = productGroups.get(row.product_id) ?? []
    list.push(row)
    productGroups.set(row.product_id, list)
  }

  const modifiers = new Map<number, ModifierRow>()
  const effects = new Map<number, ModifierEffect[]>()
  if (modifierIds.length) {
    const modifierResult = await querySQL(
      `SELECT m.id, m.name, m.price_delta, m.sort, m.is_active, m.group_id, g.name AS group_name, g.is_active AS group_active
       FROM modifiers m JOIN modifier_groups g ON g.id = m.group_id WHERE m.id IN (${inList(modifierIds)})`,
      modifierIds,
    )
    for (const row of (modifierResult.values ?? []) as ModifierRow[]) modifiers.set(row.id, row)
    const effectResult = await querySQL(`SELECT * FROM modifier_inventory_effects WHERE modifier_id IN (${inList(modifierIds)}) ORDER BY id`, modifierIds)
    for (const row of (effectResult.values ?? []) as EffectRow[]) {
      const list = effects.get(row.modifier_id) ?? []
      list.push({
        action: row.action,
        inventoryItemId: row.inventory_item_id,
        replacementItemId: row.replacement_item_id,
        quantity: row.quantity,
        scalePercent: row.scale_percent,
      })
      effects.set(row.modifier_id, list)
    }
  }

  type Draft = { line: PlannedLine; perUnit: Consumption; batchRecipe: RecipeLine[] | null; batchYield: number | null; addOnly: boolean }
  const drafts: Draft[] = items.map((item) => {
    const row = products.get(item.productId)
    if (!row) throw new ApiError(`Product ${item.productId} not found.`, 404)
    if (!row.is_active) throw new ApiError(`${row.name} is not available for sale.`, 400)
    const mode: InventoryMode = isInventoryMode(row.inventory_mode) ? row.inventory_mode : 'direct'
    const groups = (productGroups.get(row.id) ?? []).sort((a, b) => a.sort - b.sort)

    const chosen = Array.from(new Set(item.modifierIds ?? [])).map((id) => {
      const modifier = modifiers.get(id)
      if (!modifier || !modifier.is_active || !modifier.group_active) {
        throw new ApiError(`An option on ${row.name} is no longer offered. Remove the item and add it again.`, 409)
      }
      if (!groups.some((group) => group.group_id === modifier.group_id)) {
        throw new ApiError(`“${modifier.name}” isn’t an option for ${row.name}.`, 400)
      }
      return modifier
    })
    for (const group of groups) {
      const picked = chosen.filter((modifier) => modifier.group_id === group.group_id).length
      if (group.is_required && picked === 0) throw new ApiError(`Choose a ${group.name.toLowerCase()} for ${row.name}.`, 400)
      if (group.selection === 'single' && picked > 1) throw new ApiError(`Choose only one ${group.name.toLowerCase()} for ${row.name}.`, 400)
    }
    const groupOrder = (groupId: number) => groups.findIndex((group) => group.group_id === groupId)
    chosen.sort((a, b) => groupOrder(a.group_id) - groupOrder(b.group_id) || a.sort - b.sort || a.id - b.id)

    const unitPrice = roundMoney(row.selling_price + chosen.reduce((sum, modifier) => sum + modifier.price_delta, 0))
    if (unitPrice < 0) throw new ApiError(`The options make ${row.name} cost less than zero.`, 400)

    const lineEffects = chosen.flatMap((modifier) => effects.get(modifier.id) ?? [])
    const recipe = recipes.get(row.id) ?? []
    return {
      line: {
        product: { id: row.id, name: row.name, sellingPrice: row.selling_price, costPrice: row.cost_price, stockQuantity: row.stock_quantity, mode },
        quantity: item.quantity,
        unitPrice,
        unitCost: 0,
        modifiers: chosen.map((modifier) => ({ id: modifier.id, groupName: modifier.group_name, name: modifier.name, priceDelta: modifier.price_delta })),
      },
      perUnit: unitConsumption(mode, recipe, lineEffects),
      batchRecipe: mode === 'batch' && recipe.length ? recipe : null,
      batchYield: row.batch_yield,
      addOnly: mode !== 'recipe',
    }
  })

  const ingredientUse: Consumption = new Map()
  for (const draft of drafts) addConsumption(ingredientUse, lineConsumption(draft.perUnit, draft.line.quantity))

  const ingredientIds = new Set<number>(ingredientUse.keys())
  for (const draft of drafts) for (const line of draft.batchRecipe ?? []) ingredientIds.add(line.inventoryItemId)
  const ingredients = new Map<number, { name: string; onHand: number; baseUnit: BaseUnit }>()
  const costPerBase = new Map<number, number>()
  if (ingredientIds.size) {
    const ids = Array.from(ingredientIds)
    const result = await querySQL(`SELECT id, name, on_hand, base_unit, cost_per_base FROM inventory_items WHERE id IN (${inList(ids)})`, ids)
    for (const row of (result.values ?? []) as IngredientRow[]) {
      ingredients.set(row.id, { name: row.name, onHand: row.on_hand, baseUnit: (isBaseUnit(row.base_unit) ? row.base_unit : 'pc') as BaseUnit })
      costPerBase.set(row.id, row.cost_per_base)
    }
  }

  // Cost at the moment of sale: ingredients for recipes; the product's own cost (or its batch
  // recipe ÷ servings) for everything else, plus whatever extra ingredients its options use.
  for (const draft of drafts) {
    const optionsCost = consumptionCost(draft.perUnit, costPerBase)
    if (!draft.addOnly) {
      draft.line.unitCost = optionsCost
    } else if (draft.batchRecipe && draft.batchYield && draft.batchYield > 0) {
      const perBatch = draft.batchRecipe.reduce((sum, line) => sum + (line.quantity / 1000) * (costPerBase.get(line.inventoryItemId) ?? 0), 0)
      draft.line.unitCost = roundMoney(perBatch / draft.batchYield + optionsCost)
    } else {
      draft.line.unitCost = roundMoney(draft.line.product.costPrice + optionsCost)
    }
  }

  const shortages: StockShortage[] = []
  const productNeed = new Map<number, number>()
  for (const { line } of drafts) {
    if (line.product.mode === 'direct' || line.product.mode === 'batch') {
      productNeed.set(line.product.id, (productNeed.get(line.product.id) ?? 0) + line.quantity)
    }
  }
  for (const [productId, required] of productNeed) {
    const product = products.get(productId)!
    if (required > product.stock_quantity) {
      shortages.push({ name: product.name, required, available: product.stock_quantity, baseUnit: null })
    }
  }
  for (const [itemId, required] of ingredientUse) {
    const item = ingredients.get(itemId)
    if (!item) throw new ApiError('An ingredient this order uses no longer exists.', 409)
    if (required > item.onHand) shortages.push({ name: item.name, required, available: item.onHand, baseUnit: item.baseUnit })
  }

  return { lines: drafts.map((draft) => draft.line), ingredientUse, ingredients, shortages }
}

/** "Fresh Milk: needs 200 ml, 150 ml left" / "Coke: needs 3, 2 left". */
export function shortageText(shortage: StockShortage): string {
  if (shortage.baseUnit === null) {
    return `${shortage.name}: needs ${shortage.required}, ${Math.max(shortage.available, 0)} left`
  }
  return `${shortage.name}: needs ${formatQty(shortage.required, shortage.baseUnit)}, ${formatQty(Math.max(shortage.available, 0), shortage.baseUnit)} left`
}

/** The message a blocked sale (or batch) shows. Keeps the original wording for a single product. */
export function shortageMessage(shortages: StockShortage[], what: 'order' | 'batch' = 'order'): string {
  if (shortages.length === 1 && shortages[0]!.baseUnit === null) {
    const only = shortages[0]!
    return only.available <= 0 ? `${only.name} is out of stock.` : `Only ${only.available} ${only.name} left in stock.`
  }
  if (shortages.length === 1) return `Not enough ${shortages[0]!.name} for this ${what} (${shortageText(shortages[0]!).split(': ')[1]}).`
  return `Not enough stock for this ${what}. ${shortages.map(shortageText).join(' · ')}.`
}
