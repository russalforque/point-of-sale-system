import type { PagedResult, Product, ProductRecipe, RecipeLineDetail } from '../types'
import { querySQL } from '../database/sqlite'
import { runTransaction, type SqlStatement } from '../database/tx'
import { settingsApi } from './settingsApi'
import { auditStatement } from '../services/audit'
import { requirePermission } from '../services/authz'
import { barcodeProblem, randomInStoreEan13 } from '../services/barcode'
import { MOVEMENT_TYPE, stockSetStatements } from '../services/inventoryMovements'
import { inventoryModeLabel, isInventoryMode, tracksProductStock, type InventoryMode } from '../services/recipes'
import { formatQty, isBaseUnit, unitFactor, type BaseUnit, type Conversions } from '../services/units'
import { roundMoney } from '../utils/amount'
import { ApiError } from '../utils/errors'
import { formatMoney } from '../utils/format'

export type ProductPayload = {
  sku: string
  barcode?: string | null
  unit?: string | null
  name: string
  description?: string
  categoryId: number
  supplierId?: number | null
  costPrice: number
  sellingPrice: number
  stockQuantity: number
  reorderLevel: number
  isActive: boolean
  imageUrl?: string
  /** Omitted by forms and imports that predate recipes: the stored mode is kept (new products: direct). */
  inventoryMode?: InventoryMode
  /** Batch products: servings one batch makes. */
  batchYield?: number | null
  /**
   * Ingredients per serving (recipe) or per batch (batch); quantities are stored thousandths of each
   * item's base unit. Omitted = keep the saved recipe.
   */
  recipe?: { inventoryItemId: number; quantity: number; unitCode: string }[]
  /** Option groups offered at the register. Omitted = keep the saved ones. */
  modifierGroupIds?: number[]
}

type ProductRow = {
  id: number
  sku: string
  barcode: string | null
  unit: string | null
  name: string
  description: string | null
  categoryId: number
  categoryName: string | null
  supplierId: number | null
  supplierName: string | null
  costPrice: number
  sellingPrice: number
  stockQuantity: number
  reorderLevel: number
  isActive: number
  createdAt: string
  updatedAt: string
  imageUrl: string | null
  stockStatus: string
  inventoryMode: string | null
  batchYield: number | null
  recipeCost: number | null
  recipeServings: number | null
  modifierGroupCount: number | null
}

function toProduct(row: ProductRow): Product {
  const inventoryMode: InventoryMode = isInventoryMode(row.inventoryMode) ? row.inventoryMode : 'direct'
  // Recipe products cost what their ingredients cost; batch products their batch recipe ÷ servings.
  let costPrice = row.costPrice
  let costSource: Product['costSource'] = 'manual'
  if (inventoryMode === 'recipe' && row.recipeCost !== null) {
    costPrice = roundMoney(row.recipeCost)
    costSource = 'recipe'
  } else if (inventoryMode === 'batch' && row.recipeCost !== null && row.batchYield && row.batchYield > 0) {
    costPrice = roundMoney(row.recipeCost / row.batchYield)
    costSource = 'recipe'
  }
  const availableQuantity =
    inventoryMode === 'none' ? null : inventoryMode === 'recipe' ? row.recipeServings ?? null : row.stockQuantity
  return {
    id: row.id,
    sku: row.sku,
    barcode: row.barcode || null,
    unit: row.unit || null,
    name: row.name,
    description: row.description,
    categoryId: row.categoryId,
    categoryName: row.categoryName ?? 'Uncategorized',
    supplierId: row.supplierId,
    supplierName: row.supplierName,
    costPrice,
    sellingPrice: row.sellingPrice,
    stockQuantity: row.stockQuantity,
    reorderLevel: row.reorderLevel,
    isActive: Boolean(row.isActive),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    imageUrl: row.imageUrl,
    stockStatus: row.stockStatus,
    inventoryMode,
    batchYield: row.batchYield ?? null,
    availableQuantity,
    costSource,
    modifierGroupCount: row.modifierGroupCount ?? 0,
  }
}

/** Cost of one recipe (per serving, or per batch), straight from current ingredient costs. */
const RECIPE_COST_SQL = `(SELECT SUM(ri.quantity * ii.cost_per_base) / 1000.0 FROM recipe_items ri JOIN inventory_items ii ON ii.id = ri.inventory_item_id WHERE ri.product_id = p.id)`
/** Whole servings the ingredients on hand can make: the scarcest ingredient decides. */
const RECIPE_SERVINGS_SQL = `(SELECT MIN(MAX(ii.on_hand, 0) / ri.quantity) FROM recipe_items ri JOIN inventory_items ii ON ii.id = ri.inventory_item_id WHERE ri.product_id = p.id)`
const RECIPE_LOW_SQL = `EXISTS (SELECT 1 FROM recipe_items ri JOIN inventory_items ii ON ii.id = ri.inventory_item_id WHERE ri.product_id = p.id AND ii.on_hand <= ii.reorder_level)`

const SELECT_BASE = `
  SELECT
    p.id AS id,
    p.sku AS sku,
    p.barcode AS barcode,
    p.unit AS unit,
    p.name AS name,
    p.description AS description,
    p.category_id AS categoryId,
    c.name AS categoryName,
    p.supplier_id AS supplierId,
    s.company_name AS supplierName,
    p.cost_price AS costPrice,
    p.selling_price AS sellingPrice,
    p.stock_quantity AS stockQuantity,
    p.reorder_level AS reorderLevel,
    p.is_active AS isActive,
    p.created_at AS createdAt,
    p.updated_at AS updatedAt,
    p.image_url AS imageUrl,
    p.inventory_mode AS inventoryMode,
    p.batch_yield AS batchYield,
    ${RECIPE_COST_SQL} AS recipeCost,
    CASE WHEN p.inventory_mode = 'recipe' THEN ${RECIPE_SERVINGS_SQL} END AS recipeServings,
    (SELECT COUNT(*) FROM product_modifier_groups pmg JOIN modifier_groups g ON g.id = pmg.group_id
      WHERE pmg.product_id = p.id AND g.is_active = 1) AS modifierGroupCount,
    CASE
      WHEN p.inventory_mode = 'none' THEN 'In Stock'
      WHEN p.inventory_mode = 'recipe' THEN
        CASE
          WHEN ${RECIPE_SERVINGS_SQL} IS NULL THEN 'In Stock'
          WHEN ${RECIPE_SERVINGS_SQL} <= 0 THEN 'Out of Stock'
          WHEN ${RECIPE_LOW_SQL} THEN 'Low Stock'
          ELSE 'In Stock'
        END
      WHEN p.stock_quantity <= 0 THEN 'Out of Stock'
      WHEN p.stock_quantity <= p.reorder_level THEN 'Low Stock'
      ELSE 'In Stock'
    END AS stockStatus
  FROM products p
  LEFT JOIN categories c ON c.id = p.category_id
  LEFT JOIN suppliers s ON s.id = p.supplier_id
`

/** Blank barcodes are stored as NULL so the unique index ignores them. */
export function cleanCode(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim()
  return trimmed ? trimmed : null
}

function validateProduct(payload: ProductPayload): void {
  if (!payload.name.trim()) throw new ApiError('Enter the product name.', 400)
  if (!payload.sku.trim()) throw new ApiError('Enter a SKU.', 400)
  if (!Number.isInteger(payload.categoryId) || payload.categoryId <= 0) throw new ApiError('Choose a category.', 400)
  if (!Number.isFinite(payload.costPrice) || payload.costPrice < 0) throw new ApiError('Cost price can’t be negative.', 400)
  if (!Number.isFinite(payload.sellingPrice) || payload.sellingPrice < 0) throw new ApiError('Selling price can’t be negative.', 400)
  if (!Number.isInteger(payload.stockQuantity) || payload.stockQuantity < 0) {
    throw new ApiError('Stock must be a whole number, zero or more.', 400)
  }
  if (!Number.isInteger(payload.reorderLevel) || payload.reorderLevel < 0) {
    throw new ApiError('Reorder level must be a whole number, zero or more.', 400)
  }
  const barcode = cleanCode(payload.barcode)
  if (barcode) {
    // Same rule as bulk import: printable characters, no spaces, at most 64 long.
    if (!/^[\x21-\x7e]{1,64}$/.test(barcode)) {
      throw new ApiError('Barcodes can’t contain spaces or be longer than 64 characters.', 400)
    }
    const problem = barcodeProblem(barcode)
    if (problem) throw new ApiError(problem, 400)
  }
  if (payload.inventoryMode !== undefined && !isInventoryMode(payload.inventoryMode)) {
    throw new ApiError('Choose how this product’s stock is tracked.', 400)
  }
  if (payload.batchYield != null && (!Number.isInteger(payload.batchYield) || payload.batchYield < 1 || payload.batchYield > 100000)) {
    throw new ApiError('Servings per batch must be a whole number, 1 or more.', 400)
  }
}

type CheckedRecipeLine = { inventoryItemId: number; quantity: number; unitCode: string; name: string; baseUnit: BaseUnit }

/**
 * Recipe lines checked against the items they use: each item once, active, a quantity above zero,
 * and a unit that item can be measured in. Quantities are already stored base-unit thousandths.
 */
async function checkedRecipe(recipe: NonNullable<ProductPayload['recipe']>): Promise<CheckedRecipeLine[]> {
  if (recipe.length === 0) return []
  const ids = recipe.map((line) => line.inventoryItemId)
  if (new Set(ids).size !== ids.length) throw new ApiError('Each ingredient can only be in the recipe once. Combine the amounts.', 400)
  const placeholders = ids.map(() => '?').join(', ')
  const [itemsResult, conversionsResult] = await Promise.all([
    querySQL(`SELECT id, name, base_unit, is_active FROM inventory_items WHERE id IN (${placeholders})`, ids),
    querySQL(`SELECT inventory_item_id, unit_code, base_quantity FROM inventory_unit_conversions WHERE inventory_item_id IN (${placeholders})`, ids),
  ])
  const items = new Map(((itemsResult.values ?? []) as { id: number; name: string; base_unit: string; is_active: number }[]).map((row) => [row.id, row]))
  const conversions = new Map<number, Conversions>()
  for (const row of (conversionsResult.values ?? []) as { inventory_item_id: number; unit_code: string; base_quantity: number }[]) {
    conversions.set(row.inventory_item_id, { ...conversions.get(row.inventory_item_id), [row.unit_code]: row.base_quantity })
  }
  return recipe.map((line) => {
    const item = items.get(line.inventoryItemId)
    if (!item) throw new ApiError('An ingredient in the recipe no longer exists.', 400)
    if (!item.is_active) throw new ApiError(`${item.name} is inactive. Reactivate it or remove it from the recipe.`, 400)
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) throw new ApiError(`Enter how much ${item.name} the recipe uses.`, 400)
    const baseUnit = (isBaseUnit(item.base_unit) ? item.base_unit : 'pc') as BaseUnit
    if (!unitFactor(line.unitCode, baseUnit, conversions.get(item.id))) {
      throw new ApiError(`${item.name} can’t be measured in that unit.`, 400)
    }
    return { inventoryItemId: item.id, quantity: line.quantity, unitCode: line.unitCode, name: item.name, baseUnit }
  })
}

function describeRecipe(lines: CheckedRecipeLine[]): string {
  return lines.length ? lines.map((line) => `${line.name} ${formatQty(line.quantity, line.baseUnit)}`).join(', ') : 'no ingredients'
}

/** Rules that depend on the mode and the recipe together. */
function assertModeReady(mode: InventoryMode, recipe: CheckedRecipeLine[], batchYield: number | null | undefined): void {
  if (mode === 'recipe' && recipe.length === 0) {
    throw new ApiError('Add at least one ingredient to the recipe, or choose another way to track stock.', 400)
  }
  if (mode === 'batch' && recipe.length > 0 && !(batchYield && batchYield >= 1)) {
    throw new ApiError('Enter how many servings one batch makes.', 400)
  }
}

function recipeStatements(productIdSql: string, productIdValues: unknown[], lines: CheckedRecipeLine[]): SqlStatement[] {
  return [
    { statement: `DELETE FROM recipe_items WHERE product_id = ${productIdSql}`, values: [...productIdValues] },
    ...lines.map((line, index) => ({
      statement: `INSERT INTO recipe_items (product_id, inventory_item_id, quantity, unit_code, sort) VALUES (${productIdSql}, ?, ?, ?, ?)`,
      values: [...productIdValues, line.inventoryItemId, line.quantity, line.unitCode, index],
    })),
  ]
}

async function modifierGroupStatements(productIdSql: string, productIdValues: unknown[], groupIds: number[]): Promise<SqlStatement[]> {
  const unique = Array.from(new Set(groupIds))
  if (unique.length) {
    const found = await querySQL(`SELECT id FROM modifier_groups WHERE id IN (${unique.map(() => '?').join(', ')})`, unique)
    if ((found.values ?? []).length !== unique.length) throw new ApiError('One of the option groups no longer exists.', 400)
  }
  return [
    { statement: `DELETE FROM product_modifier_groups WHERE product_id = ${productIdSql}`, values: [...productIdValues] },
    ...unique.map((groupId, index) => ({
      statement: `INSERT INTO product_modifier_groups (product_id, group_id, sort) VALUES (${productIdSql}, ?, ?)`,
      values: [...productIdValues, groupId, index],
    })),
  ]
}

async function savedRecipe(productId: number): Promise<CheckedRecipeLine[]> {
  const result = await querySQL(
    `SELECT ri.inventory_item_id AS inventoryItemId, ri.quantity, ri.unit_code AS unitCode, ii.name, ii.base_unit AS baseUnit
     FROM recipe_items ri JOIN inventory_items ii ON ii.id = ri.inventory_item_id WHERE ri.product_id = ? ORDER BY ri.sort, ri.id`,
    [productId],
  )
  return (result.values ?? []) as CheckedRecipeLine[]
}

/** SKUs (case-insensitive) and barcodes each identify exactly one product. */
async function assertUniqueCodes(sku: string, barcode: string | null | undefined, exceptId?: number): Promise<void> {
  const skuTaken = await querySQL(`SELECT name FROM products WHERE UPPER(sku) = UPPER(?) AND id != ? LIMIT 1`, [
    sku.trim(),
    exceptId ?? -1,
  ])
  const skuOwner = skuTaken.values?.[0]?.name as string | undefined
  if (skuOwner) throw new ApiError(`SKU ${sku.trim()} is already used by ${skuOwner}.`, 400)

  const code = cleanCode(barcode)
  if (!code) return
  const barcodeTaken = await querySQL(`SELECT name FROM products WHERE barcode = ? AND id != ? LIMIT 1`, [code, exceptId ?? -1])
  const barcodeOwner = barcodeTaken.values?.[0]?.name as string | undefined
  if (barcodeOwner) throw new ApiError(`Barcode ${code} is already used by ${barcodeOwner}.`, 400)
}

export const productApi = {
  list: async (params: {
    search?: string
    categoryId?: number
    stockStatus?: string
    isActive?: boolean
    page?: number
    pageSize?: number
  }): Promise<PagedResult<Product>> => {
    const clauses: string[] = []
    const values: unknown[] = []

    if (params.search) {
      clauses.push('(p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)')
      const term = `%${params.search}%`
      values.push(term, term, term)
    }
    if (params.categoryId !== undefined) {
      clauses.push('p.category_id = ?')
      values.push(params.categoryId)
    }
    if (params.isActive !== undefined) {
      clauses.push('p.is_active = ?')
      values.push(params.isActive ? 1 : 0)
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    const inner = `${SELECT_BASE} ${where}`

    const outerWhere = params.stockStatus ? 'WHERE stockStatus = ?' : ''
    const outerValues = params.stockStatus ? [...values, params.stockStatus] : values

    const countResult = await querySQL(
      `SELECT COUNT(*) AS count FROM (${inner}) ${outerWhere}`,
      outerValues,
    )
    const totalCount = (countResult.values?.[0]?.count as number | undefined) ?? 0

    const page = params.page ?? 1
    const pageSize = params.pageSize ?? 10

    const result = await querySQL(
      `SELECT * FROM (${inner}) ${outerWhere} ORDER BY name ASC LIMIT ? OFFSET ?`,
      [...outerValues, pageSize, (page - 1) * pageSize],
    )

    return {
      items: ((result.values ?? []) as ProductRow[]).map(toProduct),
      totalCount,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
    }
  },

  /** Active products for pickers and the register grid. `limit` keeps big catalogs (10k+) fast to render. */
  catalog: async (params?: { search?: string; categoryId?: number; limit?: number; stockedOnly?: boolean; mode?: InventoryMode }): Promise<Product[]> => {
    const clauses: string[] = ['p.is_active = 1']
    const values: unknown[] = []
    if (params?.mode) {
      clauses.push('p.inventory_mode = ?')
      values.push(params.mode)
    }
    // Receiving, purchase orders and counts: only products that keep their own stock.
    if (params?.stockedOnly) clauses.push(`p.inventory_mode IN ('direct', 'batch')`)

    if (params?.search) {
      clauses.push('(p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)')
      const term = `%${params.search}%`
      values.push(term, term, term)
    }
    if (params?.categoryId !== undefined) {
      clauses.push('p.category_id = ?')
      values.push(params.categoryId)
    }

    const limit = params?.limit && params.limit > 0 ? ` LIMIT ${Math.floor(params.limit)}` : ''
    const result = await querySQL(
      `${SELECT_BASE} WHERE ${clauses.join(' AND ')} ORDER BY p.name ASC${limit}`,
      values,
    )
    return ((result.values ?? []) as ProductRow[]).map(toProduct)
  },

  get: async (id: number): Promise<Product> => {
    const result = await querySQL(`${SELECT_BASE} WHERE p.id = ? LIMIT 1`, [id])
    const row = result.values?.[0] as ProductRow | undefined
    if (!row) throw new ApiError('Product not found.', 404)
    return toProduct(row)
  },

  /** Exact, case-insensitive match on barcode or SKU (scanner input). Active products only. */
  findByCode: async (code: string): Promise<Product | null> => {
    const term = code.trim()
    if (!term) return null
    const result = await querySQL(
      `${SELECT_BASE} WHERE p.is_active = 1 AND (p.barcode = ? OR UPPER(p.sku) = UPPER(?))
       ORDER BY CASE WHEN p.barcode = ? THEN 0 ELSE 1 END LIMIT 1`,
      [term, term, term],
    )
    const row = result.values?.[0] as ProductRow | undefined
    return row ? toProduct(row) : null
  },

  /** Next free SKU in the store's own series, e.g. SKU-000124. */
  suggestSku: async (): Promise<string> => {
    const result = await querySQL(`SELECT COALESCE(MAX(id), 0) AS maxId FROM products`)
    let next = ((result.values?.[0]?.maxId as number | undefined) ?? 0) + 1
    for (;;) {
      const sku = `SKU-${String(next).padStart(6, '0')}`
      const taken = await querySQL(`SELECT 1 FROM products WHERE UPPER(sku) = ? LIMIT 1`, [sku])
      if (!taken.values?.length) return sku
      next += 1
    }
  },

  /** An unused in-store EAN-13 for products that came without a barcode. */
  suggestBarcode: async (): Promise<string> => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const code = randomInStoreEan13()
      const taken = await querySQL(`SELECT 1 FROM products WHERE barcode = ? LIMIT 1`, [code])
      if (!taken.values?.length) return code
    }
    throw new ApiError('Couldn’t generate a free barcode. Try again.', 500)
  },

  /** The recipe and option groups behind a product (product form, product details). */
  recipe: async (productId: number): Promise<ProductRecipe> => {
    const [linesResult, conversionsResult, groupsResult] = await Promise.all([
      querySQL(
        `SELECT ri.inventory_item_id AS inventoryItemId, ii.name AS name, ii.base_unit AS baseUnit, ri.quantity AS quantity,
                ri.unit_code AS unitCode, ii.cost_per_base AS costPerBase, ii.on_hand AS onHand, ii.is_active AS isActive
         FROM recipe_items ri JOIN inventory_items ii ON ii.id = ri.inventory_item_id
         WHERE ri.product_id = ? ORDER BY ri.sort, ri.id`,
        [productId],
      ),
      querySQL(
        `SELECT c.inventory_item_id, c.unit_code, c.base_quantity FROM inventory_unit_conversions c
         JOIN recipe_items ri ON ri.inventory_item_id = c.inventory_item_id WHERE ri.product_id = ?`,
        [productId],
      ),
      querySQL(`SELECT group_id FROM product_modifier_groups WHERE product_id = ? ORDER BY sort`, [productId]),
    ])
    const conversions = new Map<number, Conversions>()
    for (const row of (conversionsResult.values ?? []) as { inventory_item_id: number; unit_code: string; base_quantity: number }[]) {
      conversions.set(row.inventory_item_id, { ...conversions.get(row.inventory_item_id), [row.unit_code]: row.base_quantity })
    }
    type Row = Omit<RecipeLineDetail, 'conversions' | 'isActive' | 'baseUnit'> & { isActive: number; baseUnit: string }
    return {
      lines: ((linesResult.values ?? []) as Row[]).map((row) => ({
        ...row,
        baseUnit: (isBaseUnit(row.baseUnit) ? row.baseUnit : 'pc') as BaseUnit,
        isActive: Boolean(row.isActive),
        conversions: conversions.get(row.inventoryItemId) ?? {},
      })),
      modifierGroupIds: ((groupsResult.values ?? []) as { group_id: number }[]).map((row) => row.group_id),
    }
  },

  create: async (payload: ProductPayload): Promise<Product> => {
    const actor = await requirePermission('products.manage')
    validateProduct(payload)
    await assertUniqueCodes(payload.sku, payload.barcode)
    const mode: InventoryMode = payload.inventoryMode ?? 'direct'
    const recipe = await checkedRecipe(payload.recipe ?? [])
    assertModeReady(mode, recipe, payload.batchYield)
    // Recipe and untracked products have no stock of their own.
    const openingStock = tracksProductStock(mode) ? payload.stockQuantity : 0
    const now = new Date().toISOString()
    const sku = payload.sku.trim()
    // The new row's id isn't known inside the transaction; SKUs are unique, so the newest row
    // with this SKU is the one just inserted.
    const newIdSql = `(SELECT id FROM products WHERE sku = ? ORDER BY id DESC LIMIT 1)`
    const statements: SqlStatement[] = [
      {
        statement: `INSERT INTO products (
          sku, name, description, category_id, supplier_id, cost_price, selling_price,
          stock_quantity, reorder_level, is_active, created_at, updated_at, image_url, barcode, unit, inventory_mode, batch_yield
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        values: [
          sku,
          payload.name.trim(),
          payload.description || null,
          payload.categoryId,
          payload.supplierId || null,
          payload.costPrice,
          payload.sellingPrice,
          openingStock,
          payload.reorderLevel,
          payload.isActive ? 1 : 0,
          now,
          now,
          payload.imageUrl || null,
          cleanCode(payload.barcode),
          payload.unit?.trim() || null,
          mode,
          mode === 'batch' ? payload.batchYield ?? null : null,
        ],
      },
    ]
    // Opening stock is a movement like any other, so every unit on hand has a traceable origin.
    if (openingStock > 0) {
      statements.push({
        statement: `INSERT INTO inventory_transactions (product_id, type, quantity_change, quantity_after, reason, created_by, created_at)
           VALUES (${newIdSql}, ?, ?, ?, 'Opening stock', ?, ?)`,
        values: [sku, MOVEMENT_TYPE.STOCK_IN, openingStock, openingStock, actor.fullName, now],
      })
    }
    if (recipe.length) statements.push(...recipeStatements(newIdSql, [sku], recipe))
    if (payload.modifierGroupIds?.length) statements.push(...(await modifierGroupStatements(newIdSql, [sku], payload.modifierGroupIds)))
    const stockNote = tracksProductStock(mode)
      ? `opening stock ${openingStock}${mode === 'batch' ? ' servings' : ''}`
      : mode === 'recipe'
      ? `recipe: ${describeRecipe(recipe)}`
      : 'stock not tracked'
    statements.push(
      auditStatement(
        'product',
        `Added ${payload.name.trim()} (${sku}) at ${formatMoney(payload.sellingPrice, (await settingsApi.get()).currencySymbol)}, ${stockNote}`,
        { type: 'product', id: sku },
        actor,
        now,
      ),
    )
    await runTransaction(statements)

    const created = await querySQL(`SELECT id FROM products WHERE sku = ? ORDER BY id DESC LIMIT 1`, [sku])
    const id = created.values?.[0]?.id as number | undefined
    if (!id) throw new ApiError('Failed to create product.', 500)
    return productApi.get(id)
  },

  update: async (id: number, payload: ProductPayload): Promise<Product> => {
    const actor = await requirePermission('products.manage')
    validateProduct(payload)
    const before = await productApi.get(id)
    await assertUniqueCodes(payload.sku, payload.barcode, id)
    const mode: InventoryMode = payload.inventoryMode ?? before.inventoryMode
    const recipeChanged = payload.recipe !== undefined
    const beforeRecipe = await savedRecipe(id)
    const recipe = recipeChanged ? await checkedRecipe(payload.recipe!) : beforeRecipe
    const batchYield = mode === 'batch' ? (payload.batchYield !== undefined ? payload.batchYield : before.batchYield) : null
    assertModeReady(mode, recipe, batchYield)
    const now = new Date().toISOString()
    const { currencySymbol } = await settingsApi.get()
    const money = (value: number) => formatMoney(value, currencySymbol)
    // A recipe product's cost comes from its ingredients; the typed cost is kept for if it ever goes back to direct stock.
    const keepStoredCost = mode === 'recipe'

    const statements: SqlStatement[] = [
      {
        statement: `UPDATE products SET
          sku = ?, name = ?, description = ?, category_id = ?, supplier_id = ?,
          cost_price = CASE WHEN ? THEN cost_price ELSE ? END, selling_price = ?, reorder_level = ?,
          is_active = ?, updated_at = ?, image_url = ?, barcode = ?, unit = ?, inventory_mode = ?, batch_yield = ?
         WHERE id = ?`,
        values: [
          payload.sku.trim(),
          payload.name.trim(),
          payload.description || null,
          payload.categoryId,
          payload.supplierId || null,
          keepStoredCost ? 1 : 0,
          payload.costPrice,
          payload.sellingPrice,
          payload.reorderLevel,
          payload.isActive ? 1 : 0,
          now,
          payload.imageUrl || null,
          // Forms that predate these fields don't send them: keep what's stored.
          payload.barcode === undefined ? before.barcode : cleanCode(payload.barcode),
          payload.unit === undefined ? before.unit : payload.unit?.trim() || null,
          mode,
          batchYield,
          id,
        ],
      },
    ]

    if (mode !== before.inventoryMode) {
      statements.push(
        auditStatement(
          'product',
          `${payload.name}: stock tracking ${inventoryModeLabel(before.inventoryMode)} → ${inventoryModeLabel(mode)}` +
            (tracksProductStock(before.inventoryMode) && !tracksProductStock(mode) && before.stockQuantity !== 0
              ? ` (${before.stockQuantity} on hand kept, not used while untracked)`
              : ''),
          { type: 'product', id },
          actor,
          now,
        ),
      )
    }
    if (recipeChanged) {
      statements.push(...recipeStatements('?', [id], recipe))
      if (describeRecipe(recipe) !== describeRecipe(beforeRecipe)) {
        statements.push(auditStatement('recipe', `${payload.name}: ${describeRecipe(beforeRecipe)} → ${describeRecipe(recipe)}`, { type: 'product', id }, actor, now))
      }
    }
    if (payload.modifierGroupIds !== undefined) statements.push(...(await modifierGroupStatements('?', [id], payload.modifierGroupIds)))

    // Editing the stock figure on the product form is a stock adjustment like any other:
    // it gets a movement record instead of silently overwriting the quantity. Only products
    // that count their own stock have one.
    if (tracksProductStock(mode) && payload.stockQuantity !== before.stockQuantity) {
      statements.push(
        ...stockSetStatements({
          productId: id,
          quantity: payload.stockQuantity,
          reason: 'Product edit',
          createdBy: actor.fullName,
          at: now,
        }),
        auditStatement(
          'stock_adjustment',
          `${payload.name}: ${before.stockQuantity} → ${payload.stockQuantity} (product edit)`,
          { type: 'product', id },
          undefined,
          now,
        ),
      )
    }

    const priceChanges: string[] = []
    if (payload.sellingPrice !== before.sellingPrice) {
      priceChanges.push(`price ${money(before.sellingPrice)} → ${money(payload.sellingPrice)}`)
    }
    if (payload.costPrice !== before.costPrice) {
      priceChanges.push(`cost ${money(before.costPrice)} → ${money(payload.costPrice)}`)
    }
    if (priceChanges.length > 0) {
      statements.push(auditStatement('price_change', `${payload.name}: ${priceChanges.join(', ')}`, { type: 'product', id }, undefined, now))
    }
    if (before.isActive !== payload.isActive) {
      statements.push(
        auditStatement('product', `${payload.name} ${payload.isActive ? 'reactivated' : 'deactivated'}`, { type: 'product', id }, undefined, now),
      )
    }

    await runTransaction(statements)
    return productApi.get(id)
  },

  deactivate: async (id: number): Promise<void> => {
    await requirePermission('products.delete')
    const product = await productApi.get(id)
    await runTransaction([
      { statement: `UPDATE products SET is_active = 0, updated_at = ? WHERE id = ?`, values: [new Date().toISOString(), id] },
      auditStatement('product', `${product.name} deactivated`, { type: 'product', id }),
    ])
  },
}
