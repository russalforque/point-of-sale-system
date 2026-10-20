import type {
  Ingredient,
  IngredientUsageRow,
  LowStockIngredient,
  PagedResult,
  StockLevel,
  StockMovement,
  StockMovementType,
} from '../types'
import { querySQL } from '../database/sqlite'
import { idByNumber, nextDocumentNumber, runTransaction, type SqlStatement } from '../database/tx'
import { settingsApi } from './settingsApi'
import { auditStatement } from '../services/audit'
import { requirePermission } from '../services/authz'
import {
  ADJUSTMENT_TYPES,
  INGREDIENT_MOVEMENT_LABELS,
  WASTE_TYPES,
  ingredientChangeStatements,
  ingredientSetStatements,
} from '../services/inventoryMovements'
import {
  costPerBase,
  formatQty,
  isBaseUnit,
  unitDef,
  unitFactor,
  type BaseUnit,
  type Conversions,
} from '../services/units'
import { roundMoney } from '../utils/amount'
import { ApiError } from '../utils/errors'
import { formatMoney } from '../utils/format'

/**
 * Ingredients and supplies (inventory_items): what cafés and kitchens stock to make what they
 * sell. Every change to on_hand goes through the stock_movements ledger in the same transaction.
 */

export type IngredientPayload = {
  name: string
  sku?: string | null
  /** Fixed once the item is created (its history is recorded in this unit). */
  baseUnit: BaseUnit
  reorderLevel: number
  unitCost: number
  costUnit: string
  purchaseUnit?: string | null
  /** Package sizes: unit code → stored quantity in one package. */
  conversions: Conversions
  supplierId?: number | null
  notes?: string | null
  isActive: boolean
  /** New items only: stock already on the shelf. */
  openingQuantity?: number
}

export type IngredientAdjustmentPayload = {
  inventoryItemId: number
  type: StockMovementType
  /** Signed stored quantity: + adds stock, − removes it. */
  delta: number
  reason?: string
  /** Stock in only: new price for one `costUnit` (updates the item's cost). */
  unitCost?: number | null
  costUnit?: string | null
}

export type IngredientCountPayload = {
  notes?: string
  items: { inventoryItemId: number; countedQuantity: number }[]
}

type IngredientRow = {
  id: number
  name: string
  sku: string | null
  base_unit: string
  on_hand: number
  reorder_level: number
  unit_cost: number
  cost_unit: string
  cost_per_base: number
  purchase_unit: string | null
  supplier_id: number | null
  supplier_name: string | null
  notes: string | null
  is_active: number
  created_at: string
  updated_at: string
  recipe_count: number
  stock_status: StockLevel
}

const STATUS_SQL = `CASE WHEN i.on_hand <= 0 THEN 'Out of Stock' WHEN i.on_hand <= i.reorder_level THEN 'Low Stock' ELSE 'In Stock' END`

const SELECT = `
  SELECT i.id, i.name, i.sku, i.base_unit, i.on_hand, i.reorder_level, i.unit_cost, i.cost_unit, i.cost_per_base,
         i.purchase_unit, i.supplier_id, s.company_name AS supplier_name, i.notes, i.is_active, i.created_at, i.updated_at,
         (SELECT COUNT(*) FROM recipe_items ri JOIN products p ON p.id = ri.product_id WHERE ri.inventory_item_id = i.id AND p.is_active = 1) AS recipe_count,
         ${STATUS_SQL} AS stock_status
  FROM inventory_items i
  LEFT JOIN suppliers s ON s.id = i.supplier_id
`

async function conversionsFor(ids: number[]): Promise<Map<number, Conversions>> {
  const map = new Map<number, Conversions>()
  if (ids.length === 0) return map
  for (let start = 0; start < ids.length; start += 400) {
    const chunk = ids.slice(start, start + 400)
    const result = await querySQL(
      `SELECT inventory_item_id, unit_code, base_quantity FROM inventory_unit_conversions WHERE inventory_item_id IN (${chunk.map(() => '?').join(', ')})`,
      chunk,
    )
    for (const row of (result.values ?? []) as { inventory_item_id: number; unit_code: string; base_quantity: number }[]) {
      const conversions = map.get(row.inventory_item_id) ?? {}
      conversions[row.unit_code] = row.base_quantity
      map.set(row.inventory_item_id, conversions)
    }
  }
  return map
}

function toIngredient(row: IngredientRow, conversions: Conversions = {}): Ingredient {
  return {
    id: row.id,
    name: row.name,
    sku: row.sku || null,
    baseUnit: (isBaseUnit(row.base_unit) ? row.base_unit : 'pc') as BaseUnit,
    onHand: row.on_hand,
    reorderLevel: row.reorder_level,
    unitCost: row.unit_cost,
    costUnit: row.cost_unit,
    costPerBase: row.cost_per_base,
    purchaseUnit: row.purchase_unit || null,
    conversions,
    supplierId: row.supplier_id,
    supplierName: row.supplier_name,
    notes: row.notes,
    isActive: Boolean(row.is_active),
    stockStatus: row.stock_status,
    recipeCount: row.recipe_count ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

async function buildIngredients(rows: IngredientRow[]): Promise<Ingredient[]> {
  const conversions = await conversionsFor(rows.map((row) => row.id))
  return rows.map((row) => toIngredient(row, conversions.get(row.id)))
}

function validate(payload: IngredientPayload): { perBase: number } {
  if (!payload.name.trim()) throw new ApiError('Enter the item name.', 400)
  if (!isBaseUnit(payload.baseUnit)) throw new ApiError('Choose how this item is measured.', 400)
  if (!Number.isInteger(payload.reorderLevel) || payload.reorderLevel < 0) throw new ApiError('The low-stock level can’t be negative.', 400)
  if (!Number.isFinite(payload.unitCost) || payload.unitCost < 0) throw new ApiError('Cost can’t be negative.', 400)
  for (const [unit, size] of Object.entries(payload.conversions)) {
    const def = unitDef(unit)
    if (!def || def.factor !== null) throw new ApiError('Package sizes can only be set for bags, boxes, packs and similar units.', 400)
    if (!Number.isInteger(size) || size <= 0) throw new ApiError(`Enter how much one ${def.name.toLowerCase()} holds.`, 400)
  }
  const costFactor = unitFactor(payload.costUnit, payload.baseUnit, payload.conversions)
  if (!costFactor) throw new ApiError('Choose the unit the cost is for.', 400)
  if (payload.purchaseUnit && !unitFactor(payload.purchaseUnit, payload.baseUnit, payload.conversions)) {
    throw new ApiError('Set the size of the unit you buy it in.', 400)
  }
  if (payload.openingQuantity !== undefined && (!Number.isInteger(payload.openingQuantity) || payload.openingQuantity < 0)) {
    throw new ApiError('Opening stock can’t be negative.', 400)
  }
  return { perBase: costPerBase(payload.unitCost, costFactor) }
}

async function assertUniqueName(name: string, exceptId?: number): Promise<void> {
  const result = await querySQL(`SELECT id FROM inventory_items WHERE UPPER(TRIM(name)) = UPPER(?) AND id != ? LIMIT 1`, [
    name.trim(),
    exceptId ?? -1,
  ])
  if (result.values?.length) throw new ApiError(`There is already an item called ${name.trim()}.`, 400)
}

function conversionStatements(itemIdSql: string, itemIdValue: unknown, conversions: Conversions): SqlStatement[] {
  return Object.entries(conversions).map(([unit, size]) => ({
    statement: `INSERT INTO inventory_unit_conversions (inventory_item_id, unit_code, base_quantity) VALUES (${itemIdSql}, ?, ?)`,
    values: [itemIdValue, unit, size],
  }))
}

type MovementRow = {
  id: number
  inventory_item_id: number
  item_name: string | null
  base_unit: string | null
  type: StockMovementType
  quantity: number
  previous_quantity: number
  new_quantity: number
  unit_cost: number | null
  reference_type: string | null
  reference_id: string | null
  reason: string | null
  user_name: string | null
  created_at: string
}

function toMovement(row: MovementRow): StockMovement {
  return {
    id: row.id,
    inventoryItemId: row.inventory_item_id,
    itemName: row.item_name ?? 'Unknown item',
    baseUnit: (row.base_unit && isBaseUnit(row.base_unit) ? row.base_unit : 'pc') as BaseUnit,
    type: row.type,
    typeLabel: INGREDIENT_MOVEMENT_LABELS[row.type] ?? row.type,
    quantity: row.quantity,
    previousQuantity: row.previous_quantity,
    newQuantity: row.new_quantity,
    unitCost: row.unit_cost,
    referenceType: row.reference_type,
    referenceId: row.reference_id,
    reason: row.reason,
    userName: row.user_name,
    createdAt: row.created_at,
  }
}

const USAGE_TYPES = `('sale', 'void', 'production')`
const WASTE_TYPES_SQL = `('${WASTE_TYPES.join("', '")}')`

export const ingredientApi = {
  list: async (params: {
    search?: string
    stockStatus?: StockLevel
    includeInactive?: boolean
    page?: number
    pageSize?: number
  }): Promise<PagedResult<Ingredient>> => {
    const clauses: string[] = []
    const values: unknown[] = []
    if (!params.includeInactive) clauses.push('i.is_active = 1')
    if (params.search) {
      clauses.push('(i.name LIKE ? OR i.sku LIKE ?)')
      values.push(`%${params.search}%`, `%${params.search}%`)
    }
    if (params.stockStatus) {
      clauses.push(`${STATUS_SQL} = ?`)
      values.push(params.stockStatus)
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    const page = params.page ?? 1
    const pageSize = params.pageSize ?? 20
    const countResult = await querySQL(`SELECT COUNT(*) AS count FROM inventory_items i ${where}`, values)
    const totalCount = (countResult.values?.[0]?.count as number | undefined) ?? 0
    const result = await querySQL(`${SELECT} ${where} ORDER BY i.is_active DESC, i.name ASC LIMIT ? OFFSET ?`, [
      ...values,
      pageSize,
      (page - 1) * pageSize,
    ])
    return {
      items: await buildIngredients((result.values ?? []) as IngredientRow[]),
      totalCount,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
    }
  },

  /** Every active item, for recipe and modifier pickers and the count sheet. */
  all: async (): Promise<Ingredient[]> => {
    const result = await querySQL(`${SELECT} WHERE i.is_active = 1 ORDER BY i.name ASC`)
    return buildIngredients((result.values ?? []) as IngredientRow[])
  },

  /** Counts per stock level, for the filter pills. */
  statusCounts: async (): Promise<Record<StockLevel | 'all', number>> => {
    const result = await querySQL(`SELECT ${STATUS_SQL} AS status, COUNT(*) AS count FROM inventory_items i WHERE i.is_active = 1 GROUP BY status`)
    const counts: Record<StockLevel | 'all', number> = { all: 0, 'In Stock': 0, 'Low Stock': 0, 'Out of Stock': 0 }
    for (const row of (result.values ?? []) as { status: StockLevel; count: number }[]) {
      counts[row.status] = row.count
      counts.all += row.count
    }
    return counts
  },

  get: async (id: number): Promise<Ingredient> => {
    const result = await querySQL(`${SELECT} WHERE i.id = ? LIMIT 1`, [id])
    const row = result.values?.[0] as IngredientRow | undefined
    if (!row) throw new ApiError('Item not found.', 404)
    return (await buildIngredients([row]))[0]!
  },

  /** Active items at or below their low-stock level (dashboard, notifications). */
  lowStock: async (limit = 20): Promise<LowStockIngredient[]> => {
    const result = await querySQL(
      `SELECT id, name, on_hand AS onHand, reorder_level AS reorderLevel, base_unit AS baseUnit
       FROM inventory_items WHERE is_active = 1 AND (on_hand <= 0 OR on_hand <= reorder_level)
       ORDER BY (on_hand <= 0) DESC, (CAST(on_hand AS REAL) / MAX(reorder_level, 1)) ASC, name ASC LIMIT ?`,
      [limit],
    )
    return (result.values ?? []) as LowStockIngredient[]
  },

  create: async (payload: IngredientPayload): Promise<Ingredient> => {
    const actor = await requirePermission('inventory.manage')
    const { perBase } = validate(payload)
    await assertUniqueName(payload.name)
    const now = new Date().toISOString()
    const name = payload.name.trim()
    // The new id isn't known inside the transaction; names are unique, so the newest row with this name is it.
    const idSql = `(SELECT id FROM inventory_items WHERE name = ? ORDER BY id DESC LIMIT 1)`

    const statements: SqlStatement[] = [
      {
        statement: `INSERT INTO inventory_items (name, sku, base_unit, on_hand, reorder_level, unit_cost, cost_unit, cost_per_base, purchase_unit, supplier_id, notes, is_active, created_at, updated_at)
           VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        values: [
          name,
          payload.sku?.trim() || null,
          payload.baseUnit,
          payload.reorderLevel,
          roundMoney(payload.unitCost * 10000) / 10000,
          payload.costUnit,
          perBase,
          payload.purchaseUnit || null,
          payload.supplierId || null,
          payload.notes?.trim() || null,
          payload.isActive ? 1 : 0,
          now,
          now,
        ],
      },
      ...conversionStatements(idSql, name, payload.conversions),
    ]
    const opening = payload.openingQuantity ?? 0
    if (opening > 0) {
      statements.push(
        ...ingredientChangeStatements({
          inventoryItemId: { sql: idSql, values: [name] },
          delta: opening,
          type: 'opening',
          reason: 'Opening stock',
          user: actor,
          at: now,
        }),
      )
    }
    const symbol = (await settingsApi.get()).currencySymbol
    statements.push(
      auditStatement(
        'ingredient',
        `Added ${name} · ${formatMoney(payload.unitCost, symbol)} per ${unitDef(payload.costUnit)?.short ?? payload.costUnit}` +
          (opening > 0 ? ` · opening stock ${formatQty(opening, payload.baseUnit)}` : ''),
        { type: 'ingredient', id: name },
        actor,
        now,
      ),
    )
    await runTransaction(statements)
    const created = await querySQL(`SELECT id FROM inventory_items WHERE name = ? ORDER BY id DESC LIMIT 1`, [name])
    const id = created.values?.[0]?.id as number | undefined
    if (!id) throw new ApiError('Failed to save the item.', 500)
    return ingredientApi.get(id)
  },

  update: async (id: number, payload: IngredientPayload): Promise<Ingredient> => {
    const actor = await requirePermission('inventory.manage')
    const before = await ingredientApi.get(id)
    if (payload.baseUnit !== before.baseUnit) throw new ApiError('The measuring unit can’t change after an item is created.', 400)
    const { perBase } = validate(payload)
    await assertUniqueName(payload.name, id)
    // Recipes and modifiers keep their quantities in the base unit, so removing a package size
    // never changes what they use - it only changes how they are displayed.
    if (!payload.isActive && before.isActive) await assertNotInUse(id, before.name)
    const now = new Date().toISOString()
    const symbol = (await settingsApi.get()).currencySymbol
    const changes: string[] = []
    if (payload.name.trim() !== before.name) changes.push(`renamed from ${before.name}`)
    if (Math.abs(perBase - before.costPerBase) > 1e-9) {
      changes.push(
        `cost ${formatMoney(before.unitCost, symbol)}/${unitDef(before.costUnit)?.short ?? before.costUnit} → ${formatMoney(payload.unitCost, symbol)}/${
          unitDef(payload.costUnit)?.short ?? payload.costUnit
        }`,
      )
    }
    if (payload.reorderLevel !== before.reorderLevel) {
      changes.push(`low-stock level ${formatQty(before.reorderLevel, before.baseUnit)} → ${formatQty(payload.reorderLevel, before.baseUnit)}`)
    }
    if (payload.isActive !== before.isActive) changes.push(payload.isActive ? 'reactivated' : 'deactivated')

    await runTransaction([
      {
        statement: `UPDATE inventory_items SET name = ?, sku = ?, reorder_level = ?, unit_cost = ?, cost_unit = ?, cost_per_base = ?,
            purchase_unit = ?, supplier_id = ?, notes = ?, is_active = ?, updated_at = ? WHERE id = ?`,
        values: [
          payload.name.trim(),
          payload.sku?.trim() || null,
          payload.reorderLevel,
          roundMoney(payload.unitCost * 10000) / 10000,
          payload.costUnit,
          perBase,
          payload.purchaseUnit || null,
          payload.supplierId || null,
          payload.notes?.trim() || null,
          payload.isActive ? 1 : 0,
          now,
          id,
        ],
      },
      { statement: `DELETE FROM inventory_unit_conversions WHERE inventory_item_id = ?`, values: [id] },
      ...conversionStatements('?', id, payload.conversions),
      auditStatement('ingredient', `${payload.name.trim()} updated${changes.length ? `: ${changes.join(', ')}` : ''}`, { type: 'ingredient', id }, actor, now),
    ])
    return ingredientApi.get(id)
  },

  deactivate: async (id: number): Promise<void> => {
    const actor = await requirePermission('inventory.manage')
    const item = await ingredientApi.get(id)
    await assertNotInUse(id, item.name)
    await runTransaction([
      { statement: `UPDATE inventory_items SET is_active = 0, updated_at = ? WHERE id = ?`, values: [new Date().toISOString(), id] },
      auditStatement('ingredient', `${item.name} deactivated`, { type: 'ingredient', id }, actor),
    ])
  },

  /**
   * Stock in, stock out, waste and corrections. Removals beyond what is on hand are refused
   * unless the store allows negative stock.
   */
  adjust: async (payload: IngredientAdjustmentPayload): Promise<Ingredient> => {
    const kind = ADJUSTMENT_TYPES.find((entry) => entry.type === payload.type)
    if (!kind) throw new ApiError('Choose what kind of change this is.', 400)
    const isWaste = (WASTE_TYPES as readonly string[]).includes(payload.type)
    const actor = await requirePermission(isWaste ? 'inventory.waste' : payload.type === 'stock_in' ? 'inventory.receive' : 'inventory.manage')
    if (!Number.isInteger(payload.delta) || payload.delta === 0) throw new ApiError('Enter a quantity above zero.', 400)
    if (kind.sign !== 0 && Math.sign(payload.delta) !== kind.sign) {
      throw new ApiError(kind.sign > 0 ? `${kind.label} adds stock.` : `${kind.label} removes stock.`, 400)
    }
    const reason = payload.reason?.trim() ?? ''
    if (kind.reasonRequired && reason.length < 3) throw new ApiError('Enter a reason for this change.', 400)

    const item = await ingredientApi.get(payload.inventoryItemId)
    if (!item.isActive) throw new ApiError(`${item.name} is inactive.`, 400)
    const settings = await settingsApi.get()
    if (payload.delta < 0 && item.onHand + payload.delta < 0 && !settings.allowNegativeStock) {
      throw new ApiError(`Only ${formatQty(Math.max(item.onHand, 0), item.baseUnit)} of ${item.name} on hand.`, 400)
    }

    const now = new Date().toISOString()
    const statements: SqlStatement[] = []
    let costNote = ''
    if (payload.type === 'stock_in' && payload.unitCost != null && payload.costUnit) {
      if (!Number.isFinite(payload.unitCost) || payload.unitCost < 0) throw new ApiError('Cost can’t be negative.', 400)
      const factor = unitFactor(payload.costUnit, item.baseUnit, item.conversions)
      if (!factor) throw new ApiError('Choose the unit the cost is for.', 400)
      const perBase = costPerBase(payload.unitCost, factor)
      if (Math.abs(perBase - item.costPerBase) > 1e-9) {
        // Cost is updated before the movement so the movement records the new cost.
        statements.push({
          statement: `UPDATE inventory_items SET unit_cost = ?, cost_unit = ?, cost_per_base = ?, updated_at = ? WHERE id = ?`,
          values: [roundMoney(payload.unitCost * 10000) / 10000, payload.costUnit, perBase, now, item.id],
        })
        costNote = ` · cost now ${formatMoney(payload.unitCost, settings.currencySymbol)}/${unitDef(payload.costUnit)?.short ?? payload.costUnit}`
      }
    }
    statements.push(
      ...ingredientChangeStatements({
        inventoryItemId: item.id,
        delta: payload.delta,
        type: payload.type,
        reason: reason || kind.label,
        user: actor,
        at: now,
      }),
    )
    const signed = `${payload.delta > 0 ? '+' : '−'}${formatQty(Math.abs(payload.delta), item.baseUnit)}`
    statements.push(
      auditStatement(
        isWaste ? 'waste' : 'stock_adjustment',
        `${item.name}: ${signed} (${kind.label}${reason && reason !== kind.label ? `, ${reason}` : ''}) · ${formatQty(item.onHand, item.baseUnit)} → ${formatQty(
          item.onHand + payload.delta,
          item.baseUnit,
        )}${costNote}`,
        { type: 'ingredient', id: item.id },
        actor,
        now,
      ),
    )
    try {
      await runTransaction(statements)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (/not enough stock/i.test(message)) throw new ApiError(`Stock of ${item.name} changed meanwhile. Check it and try again.`, 409)
      throw error
    }
    return ingredientApi.get(item.id)
  },

  /**
   * Confirms a physical count of ingredients. Each difference against what is on hand right now
   * becomes a "Physical count" movement; the count itself is kept under stock_counts.
   */
  confirmCount: async (payload: IngredientCountPayload): Promise<{ countNumber: string; adjusted: number }> => {
    const actor = await requirePermission('inventory.count')
    const entries = payload.items.filter((entry) => Number.isFinite(entry.countedQuantity))
    if (entries.length === 0) throw new ApiError('Enter at least one counted quantity.', 400)
    const seen = new Set<number>()
    for (const entry of entries) {
      if (!Number.isInteger(entry.countedQuantity) || entry.countedQuantity < 0) throw new ApiError('Counted amounts can’t be negative.', 400)
      if (seen.has(entry.inventoryItemId)) throw new ApiError('Each item can only be counted once.', 400)
      seen.add(entry.inventoryItemId)
    }
    const ids = entries.map((entry) => entry.inventoryItemId)
    const result = await querySQL(
      `SELECT id, name, on_hand, base_unit FROM inventory_items WHERE id IN (${ids.map(() => '?').join(', ')})`,
      ids,
    )
    const items = new Map(((result.values ?? []) as { id: number; name: string; on_hand: number; base_unit: string }[]).map((row) => [row.id, row]))
    const lines = entries.map((entry) => {
      const item = items.get(entry.inventoryItemId)
      if (!item) throw new ApiError('A counted item no longer exists.', 404)
      return { item, counted: entry.countedQuantity, variance: entry.countedQuantity - item.on_hand }
    })
    const adjusted = lines.filter((line) => line.variance !== 0)

    const now = new Date().toISOString()
    const countNumber = await nextDocumentNumber('stock_counts', 'SC')
    const countIdSql = `(SELECT id FROM stock_counts WHERE count_number = ?)`
    const statements: SqlStatement[] = [
      {
        statement: `INSERT INTO stock_counts (count_number, notes, items_counted, items_adjusted, net_change, created_by, created_at, scope)
           VALUES (?, ?, ?, ?, 0, ?, ?, 'ingredients')`,
        values: [countNumber, payload.notes?.trim() || null, lines.length, adjusted.length, actor.fullName, now],
      },
    ]
    for (const line of lines) {
      statements.push({
        statement: `INSERT INTO stock_count_ingredient_lines (count_id, inventory_item_id, expected_quantity, counted_quantity, variance)
           VALUES (${countIdSql}, ?, ?, ?, ?)`,
        values: [countNumber, line.item.id, line.item.on_hand, line.counted, line.variance],
      })
    }
    for (const line of adjusted) {
      statements.push(
        ...ingredientSetStatements({
          inventoryItemId: line.item.id,
          quantity: line.counted,
          type: 'count',
          reason: `Stock count ${countNumber}`,
          referenceType: 'stock_count',
          referenceId: countNumber,
          user: actor,
          at: now,
        }),
      )
    }
    statements.push(
      auditStatement(
        'stock_count',
        `${countNumber} (ingredients): ${lines.length} counted, ${adjusted.length} adjusted` +
          (adjusted.length
            ? ` · ${adjusted
                .slice(0, 5)
                .map((line) => `${line.item.name} ${formatQty(line.item.on_hand, line.item.base_unit)}→${formatQty(line.counted, line.item.base_unit)}`)
                .join(', ')}${adjusted.length > 5 ? '…' : ''}`
            : ''),
        { type: 'stock_count', id: countNumber },
        actor,
        now,
      ),
    )
    await runTransaction(statements)
    if (!(await idByNumber('stock_counts', 'count_number', countNumber))) throw new ApiError('Failed to save the count.', 500)
    return { countNumber, adjusted: adjusted.length }
  },

  movements: async (params: {
    inventoryItemId?: number
    types?: StockMovementType[]
    from?: string
    to?: string
    page?: number
    pageSize?: number
  }): Promise<PagedResult<StockMovement>> => {
    const clauses: string[] = []
    const values: unknown[] = []
    if (params.inventoryItemId) {
      clauses.push('m.inventory_item_id = ?')
      values.push(params.inventoryItemId)
    }
    if (params.types?.length) {
      clauses.push(`m.type IN (${params.types.map(() => '?').join(', ')})`)
      values.push(...params.types)
    }
    if (params.from) {
      clauses.push('m.created_at >= ?')
      values.push(params.from)
    }
    if (params.to) {
      clauses.push('m.created_at < ?')
      values.push(params.to)
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    const page = params.page ?? 1
    const pageSize = params.pageSize ?? 20
    const countResult = await querySQL(`SELECT COUNT(*) AS count FROM stock_movements m ${where}`, values)
    const totalCount = (countResult.values?.[0]?.count as number | undefined) ?? 0
    const result = await querySQL(
      `SELECT m.*, i.name AS item_name, i.base_unit AS base_unit
       FROM stock_movements m LEFT JOIN inventory_items i ON i.id = m.inventory_item_id
       ${where} ORDER BY m.created_at DESC, m.id DESC LIMIT ? OFFSET ?`,
      [...values, pageSize, (page - 1) * pageSize],
    )
    return {
      items: ((result.values ?? []) as MovementRow[]).map(toMovement),
      totalCount,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
    }
  },

  /**
   * Theoretical vs actual for a period, per item, straight from the ledger:
   *   opening + purchases − usage − waste ± adjustments = expected; counts record the variance.
   * `to` is exclusive. Items with no movement in the period still show their opening = closing.
   */
  usageReport: async (params: { from: string; to: string }): Promise<IngredientUsageRow[]> => {
    const result = await querySQL(
      `SELECT i.id, i.name, i.base_unit, i.cost_per_base, i.on_hand,
         COALESCE((SELECT SUM(m.quantity) FROM stock_movements m WHERE m.inventory_item_id = i.id AND m.created_at >= ?), 0) AS since_to,
         COALESCE(SUM(CASE WHEN m.type IN ('opening', 'stock_in') THEN m.quantity END), 0) AS purchases,
         COALESCE(SUM(CASE WHEN m.type IN ${USAGE_TYPES} THEN m.quantity END), 0) AS usage,
         COALESCE(SUM(CASE WHEN m.type IN ${WASTE_TYPES_SQL} THEN m.quantity END), 0) AS waste,
         COALESCE(SUM(CASE WHEN m.type IN ('stock_out', 'correction', 'other') THEN m.quantity END), 0) AS adjustments,
         COALESCE(SUM(CASE WHEN m.type = 'count' THEN m.quantity END), 0) AS count_variance,
         COUNT(m.id) AS movement_count
       FROM inventory_items i
       LEFT JOIN stock_movements m ON m.inventory_item_id = i.id AND m.created_at >= ? AND m.created_at < ?
       GROUP BY i.id
       HAVING i.is_active = 1 OR movement_count > 0
       ORDER BY i.name ASC`,
      [params.to, params.from, params.to],
    )
    type Row = {
      id: number
      name: string
      base_unit: string
      cost_per_base: number
      on_hand: number
      since_to: number
      purchases: number
      usage: number
      waste: number
      adjustments: number
      count_variance: number
    }
    return ((result.values ?? []) as Row[]).map((row) => {
      const closing = row.on_hand - row.since_to
      const net = row.purchases + row.usage + row.waste + row.adjustments + row.count_variance
      const opening = closing - net
      return {
        inventoryItemId: row.id,
        name: row.name,
        baseUnit: (isBaseUnit(row.base_unit) ? row.base_unit : 'pc') as BaseUnit,
        costPerBase: row.cost_per_base,
        opening,
        purchases: row.purchases,
        usage: -row.usage,
        waste: -row.waste,
        adjustments: row.adjustments,
        expected: opening + row.purchases + row.usage + row.waste + row.adjustments,
        countVariance: row.count_variance,
        closing,
      }
    })
  },
}

/** An item a product still needs can't be switched off (sales would have nothing to deduct from). */
async function assertNotInUse(id: number, name: string): Promise<void> {
  const result = await querySQL(
    `SELECT DISTINCT p.name FROM recipe_items ri JOIN products p ON p.id = ri.product_id
     WHERE ri.inventory_item_id = ? AND p.is_active = 1 ORDER BY p.name LIMIT 4`,
    [id],
  )
  const names = ((result.values ?? []) as { name: string }[]).map((row) => row.name)
  if (names.length) {
    throw new ApiError(`${name} is in the recipe for ${names.slice(0, 3).join(', ')}${names.length > 3 ? ' and more' : ''}. Remove it there first.`, 400)
  }
}
