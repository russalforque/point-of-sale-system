import type { PagedResult, ProductionBatch } from '../types'
import { querySQL } from '../database/sqlite'
import { idByNumber, nextDocumentNumber, runTransaction, type SqlStatement } from '../database/tx'
import { settingsApi } from './settingsApi'
import { shortageMessage, type StockShortage } from './salePlan'
import { auditStatement } from '../services/audit'
import { requirePermission } from '../services/authz'
import { MOVEMENT_TYPE, ingredientChangeStatements, stockChangeStatements } from '../services/inventoryMovements'
import { consumptionCost, findShortages, lineConsumption, unitConsumption } from '../services/recipes'
import { formatQty, isBaseUnit, type BaseUnit } from '../services/units'
import { ApiError } from '../utils/errors'
import { formatMoney } from '../utils/format'

/**
 * Batch / prepared products (cold brew, brewed tea, pastries baked in the morning). Making a batch
 * adds ready servings to the product's stock and uses up its batch recipe, in one transaction;
 * selling then counts servings down like any stocked product. Leftovers thrown away are recorded
 * as a stock-out with a reason (Inventory → Adjust).
 */

type BatchRow = {
  id: number
  batch_number: string
  product_id: number
  product_name: string | null
  batches: number
  servings: number
  ingredient_cost: number
  notes: string | null
  created_by: string
  created_at: string
}

function toBatch(row: BatchRow): ProductionBatch {
  return {
    id: row.id,
    batchNumber: row.batch_number,
    productId: row.product_id,
    productName: row.product_name ?? 'Unknown product',
    batches: row.batches,
    servings: row.servings,
    ingredientCost: row.ingredient_cost,
    notes: row.notes,
    createdBy: row.created_by,
    createdAt: row.created_at,
  }
}

const SELECT = `
  SELECT b.*, p.name AS product_name FROM production_batches b LEFT JOIN products p ON p.id = b.product_id
`

export type MakeBatchPayload = {
  productId: number
  /** Number of batches made (each makes the product's servings per batch). */
  batches: number
  /** Servings actually made, when it differs from batches × servings per batch. */
  servings?: number
  notes?: string
}

export const batchApi = {
  list: async (params: { productId?: number; page?: number; pageSize?: number } = {}): Promise<PagedResult<ProductionBatch>> => {
    const where = params.productId ? 'WHERE b.product_id = ?' : ''
    const values = params.productId ? [params.productId] : []
    const page = params.page ?? 1
    const pageSize = params.pageSize ?? 10
    const countResult = await querySQL(`SELECT COUNT(*) AS count FROM production_batches b ${where}`, values)
    const totalCount = (countResult.values?.[0]?.count as number | undefined) ?? 0
    const result = await querySQL(`${SELECT} ${where} ORDER BY b.created_at DESC LIMIT ? OFFSET ?`, [...values, pageSize, (page - 1) * pageSize])
    return {
      items: ((result.values ?? []) as BatchRow[]).map(toBatch),
      totalCount,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
    }
  },

  /** Ingredients `batches` batches would use, and what is short. Nothing is written. */
  preview: async (productId: number, batches: number): Promise<{ uses: { name: string; quantity: number; baseUnit: BaseUnit }[]; shortages: StockShortage[]; cost: number }> => {
    const plan = await planBatch(productId, batches)
    return { uses: plan.uses, shortages: plan.shortages, cost: plan.cost }
  },

  make: async (payload: MakeBatchPayload): Promise<ProductionBatch> => {
    const actor = await requirePermission('inventory.produce')
    if (!Number.isInteger(payload.batches) || payload.batches < 1 || payload.batches > 1000) {
      throw new ApiError('Enter how many batches you made.', 400)
    }
    const plan = await planBatch(payload.productId, payload.batches)
    const servings = payload.servings ?? plan.servingsPerBatch * payload.batches
    if (!Number.isInteger(servings) || servings < 1) throw new ApiError('Enter how many servings were made.', 400)
    const settings = await settingsApi.get()
    if (plan.shortages.length && !settings.allowNegativeStock) throw new ApiError(shortageMessage(plan.shortages, 'batch'), 400)

    const now = new Date().toISOString()
    const batchNumber = await nextDocumentNumber('production_batches', 'BT')
    const statements: SqlStatement[] = [
      {
        statement: `INSERT INTO production_batches (batch_number, product_id, batches, servings, ingredient_cost, notes, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        values: [batchNumber, plan.product.id, payload.batches, servings, plan.cost, payload.notes?.trim() || null, actor.fullName, now],
      },
      ...stockChangeStatements({
        productId: plan.product.id,
        delta: servings,
        type: MOVEMENT_TYPE.STOCK_IN,
        reason: `Batch ${batchNumber}`,
        createdBy: actor.fullName,
        at: now,
      }),
    ]
    for (const [itemId, used] of plan.consumption) {
      statements.push(
        ...ingredientChangeStatements({
          inventoryItemId: itemId,
          delta: -used,
          type: 'production',
          reason: `Batch ${batchNumber} (${plan.product.name})`,
          referenceType: 'batch',
          referenceId: batchNumber,
          user: actor,
          at: now,
        }),
      )
    }
    statements.push(
      auditStatement(
        'batch',
        `${batchNumber}: ${payload.batches} × ${plan.product.name} = ${servings} servings` +
          (plan.uses.length ? ` · used ${plan.uses.map((use) => `${use.name} ${formatQty(use.quantity, use.baseUnit)}`).join(', ')}` : '') +
          ` · ${formatMoney(plan.cost, settings.currencySymbol)}`,
        { type: 'batch', id: batchNumber },
        actor,
        now,
      ),
    )
    try {
      await runTransaction(statements)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (/not enough stock/i.test(message)) throw new ApiError('Ingredient stock changed meanwhile. Check it and try again.', 409)
      throw error
    }
    const id = await idByNumber('production_batches', 'batch_number', batchNumber)
    if (!id) throw new ApiError('Failed to save the batch.', 500)
    const result = await querySQL(`${SELECT} WHERE b.id = ? LIMIT 1`, [id])
    return toBatch(result.values?.[0] as BatchRow)
  },
}

async function planBatch(productId: number, batches: number) {
  const productResult = await querySQL(`SELECT id, name, inventory_mode, batch_yield, is_active FROM products WHERE id = ? LIMIT 1`, [productId])
  const product = productResult.values?.[0] as { id: number; name: string; inventory_mode: string; batch_yield: number | null; is_active: number } | undefined
  if (!product) throw new ApiError('Product not found.', 404)
  if (product.inventory_mode !== 'batch') throw new ApiError(`${product.name} isn’t made in batches.`, 400)
  if (!product.is_active) throw new ApiError(`${product.name} is inactive.`, 400)

  const recipeResult = await querySQL(
    `SELECT ri.inventory_item_id AS inventoryItemId, ri.quantity, ii.name, ii.on_hand AS onHand, ii.base_unit AS baseUnit, ii.cost_per_base AS costPerBase
     FROM recipe_items ri JOIN inventory_items ii ON ii.id = ri.inventory_item_id WHERE ri.product_id = ? ORDER BY ri.sort, ri.id`,
    [productId],
  )
  type Row = { inventoryItemId: number; quantity: number; name: string; onHand: number; baseUnit: string; costPerBase: number }
  const rows = (recipeResult.values ?? []) as Row[]
  // A batch recipe is a recipe for one batch: the same engine, counted per batch.
  const consumption = lineConsumption(unitConsumption('recipe', rows), batches)
  const stock = new Map(rows.map((row) => [row.inventoryItemId, { name: row.name, onHand: row.onHand, baseUnit: row.baseUnit }]))
  const baseUnitOf = (value: string) => (isBaseUnit(value) ? value : 'pc') as BaseUnit
  return {
    product,
    servingsPerBatch: product.batch_yield && product.batch_yield > 0 ? product.batch_yield : 1,
    consumption,
    uses: rows.map((row) => ({ name: row.name, quantity: consumption.get(row.inventoryItemId) ?? 0, baseUnit: baseUnitOf(row.baseUnit) })),
    shortages: findShortages(consumption, stock).map((shortage) => ({
      name: shortage.name,
      required: shortage.required,
      available: shortage.available,
      baseUnit: baseUnitOf(shortage.baseUnit),
    })),
    cost: consumptionCost(consumption, new Map(rows.map((row) => [row.inventoryItemId, row.costPerBase]))),
  }
}
