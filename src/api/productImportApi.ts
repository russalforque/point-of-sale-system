import { querySQL } from '../database/sqlite'
import { runChunkedTransaction, type SqlStatement } from '../database/tx'
import { settingsApi } from './settingsApi'
import { auditStatement } from '../services/audit'
import { MOVEMENT_TYPE, stockChangeStatements } from '../services/inventoryMovements'
import {
  isImportable,
  normalizeName,
  planImport,
  type ImportContext,
  type ImportOptions,
  type PlannedRow,
  type RawRow,
} from '../services/productImport/importModel'
import { ApiError } from '../utils/errors'
import { formatMoney } from '../utils/format'
import { requirePermission } from '../services/authz'

export type ImportResult = {
  batch: string
  added: number
  updated: number
  skipped: number
  failed: number
  categoriesCreated: string[]
  suppliersCreated: string[]
  /** The plan as re-validated at write time; skipped/failed rows carry their reasons. */
  rows: PlannedRow[]
}

/** Rows written per chunk: small enough for smooth progress, large enough to stay fast. */
const ROWS_PER_CHUNK = 100
const DEFAULT_REORDER_LEVEL = 5

export const productImportApi = {
  /** Everything validation needs, in three queries (no per-row lookups). */
  loadContext: async (): Promise<ImportContext> => {
    const [products, categories, suppliers] = await Promise.all([
      querySQL(`SELECT id, sku, barcode, name, cost_price AS costPrice, selling_price AS sellingPrice FROM products`),
      querySQL(`SELECT id, name, is_active AS isActive FROM categories`),
      querySQL(`SELECT id, company_name AS companyName, is_active AS isActive FROM suppliers`),
    ])
    return {
      products: ((products.values ?? []) as ImportContext['products']).map((row) => ({ ...row, sku: row.sku ?? '', barcode: row.barcode || null })),
      categories: ((categories.values ?? []) as { id: number; name: string; isActive: number }[]).map((row) => ({
        ...row,
        isActive: Boolean(row.isActive),
      })),
      suppliers: ((suppliers.values ?? []) as { id: number; companyName: string; isActive: number }[]).map((row) => ({
        ...row,
        isActive: Boolean(row.isActive),
      })),
    }
  },

  /**
   * Imports every valid row in one database transaction. Rows are re-validated against the
   * current data first, so anything that changed since the preview is caught, and nothing is
   * written at all if any statement fails.
   */
  commit: async (
    rawRows: RawRow[],
    options: ImportOptions,
    onProgress?: (done: number, total: number) => void,
  ): Promise<ImportResult> => {
    const user = await requirePermission('products.manage')

    const context = await productImportApi.loadContext()
    const plan = planImport(rawRows, context, options)
    const toWrite = plan.rows.filter(isImportable)
    if (toWrite.length === 0) throw new ApiError('There are no valid rows to import.', 400)

    const now = new Date().toISOString()
    // yyyymmddhhmmssSSS: unique per import, and sorts by time.
    const batch = `IMP-${now.replace(/\D/g, '').slice(0, 17)}`
    const createdBy = user.fullName
    const { currencySymbol } = await settingsApi.get()
    const money = (value: number) => formatMoney(value, currencySymbol)

    // New ids are handed out up front. The transaction below is the only writer while it runs,
    // so MAX(id) + n stays free, and every statement can reference rows it just created.
    const nextId = async (table: string) =>
      ((await querySQL(`SELECT COALESCE(MAX(id), 0) AS id FROM ${table}`)).values?.[0]?.id as number) + 1
    let categoryId = await nextId('categories')
    let supplierId = await nextId('suppliers')
    let productId = await nextId('products')

    const setup: SqlStatement[] = []
    const categoryIds = new Map<string, number>()
    const supplierIds = new Map<string, number>()
    const categoriesCreated: string[] = []
    const suppliersCreated: string[] = []

    for (const row of toWrite) {
      if ('create' in row.category) {
        const key = normalizeName(row.category.create)
        if (!categoryIds.has(key)) {
          const id = categoryId++
          categoryIds.set(key, id)
          categoriesCreated.push(row.category.create)
          setup.push({
            statement: `INSERT INTO categories (id, name, description, is_active) VALUES (?, ?, NULL, 1)`,
            values: [id, row.category.create],
          })
        }
      }
      if (row.supplier && 'create' in row.supplier) {
        const key = normalizeName(row.supplier.create)
        if (!supplierIds.has(key)) {
          const id = supplierId++
          supplierIds.set(key, id)
          suppliersCreated.push(row.supplier.create)
          setup.push({
            statement: `INSERT INTO suppliers (id, supplier_code, company_name, contact_person, phone, email, address, notes, is_active)
               VALUES (?, ?, ?, NULL, NULL, NULL, NULL, NULL, 1)`,
            values: [id, `SUP-${String(id).padStart(4, '0')}`, row.supplier.create],
          })
        }
      }
    }

    const resolveCategory = (row: PlannedRow) =>
      'id' in row.category ? row.category.id : categoryIds.get(normalizeName(row.category.create))!
    const resolveSupplier = (row: PlannedRow) =>
      !row.supplier ? null : 'id' in row.supplier ? row.supplier.id : supplierIds.get(normalizeName(row.supplier.create))!

    const existingById = new Map(context.products.map((product) => [product.id, product]))
    const chunks: SqlStatement[][] = [setup]
    let added = 0
    let updated = 0
    let current: SqlStatement[] = []
    const priceChanges: string[] = []

    toWrite.forEach((row, index) => {
      const p = row.parsed
      if (row.status === 'update' && row.existing) {
        const before = existingById.get(row.existing.id)
        // Identity (SKU) and stock are left alone; stock only moves through receiving/counts.
        current.push({
          statement: `UPDATE products SET name = ?, barcode = COALESCE(?, barcode), unit = COALESCE(?, unit), category_id = ?,
             supplier_id = COALESCE(?, supplier_id), cost_price = ?, selling_price = ?, updated_at = ? WHERE id = ?`,
          values: [p.name, p.barcode, p.unit, resolveCategory(row), resolveSupplier(row), p.cost, p.price, now, row.existing.id],
        })
        if (before && (before.sellingPrice !== p.price || before.costPrice !== p.cost)) {
          priceChanges.push(
            `${p.name}: price ${money(before.sellingPrice)} → ${money(p.price)}, cost ${money(before.costPrice)} → ${money(p.cost)}`,
          )
        }
        updated += 1
      } else {
        const id = productId++
        // Created at 0 and brought up by a movement, so stock history shows where it came from.
        current.push({
          statement: `INSERT INTO products (id, sku, barcode, name, description, category_id, supplier_id, cost_price, selling_price,
             stock_quantity, reorder_level, is_active, created_at, updated_at, image_url, unit)
             VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, 0, ?, 1, ?, ?, NULL, ?)`,
          values: [id, p.sku, p.barcode, p.name, resolveCategory(row), resolveSupplier(row), p.cost, p.price, DEFAULT_REORDER_LEVEL, now, now, p.unit ?? 'pcs'],
        })
        if (p.stock > 0) {
          current.push(
            ...stockChangeStatements({
              productId: id,
              delta: p.stock,
              type: MOVEMENT_TYPE.STOCK_IN,
              reason: `Initial stock (import ${batch})`,
              createdBy,
              at: now,
            }),
          )
        }
        added += 1
      }
      if ((index + 1) % ROWS_PER_CHUNK === 0) {
        chunks.push(current)
        current = []
      }
    })

    const skipped = plan.summary.skip
    const failed = plan.summary.error + plan.summary.duplicate
    const summaryParts = [`${added} added`, `${updated} updated`, `${skipped} skipped`, `${failed} not imported`]
    if (categoriesCreated.length) summaryParts.push(`${categoriesCreated.length} new categories`)
    if (suppliersCreated.length) summaryParts.push(`${suppliersCreated.length} new suppliers`)
    current.push(auditStatement('product', `Bulk import ${batch}: ${summaryParts.join(', ')}`, { type: 'import', id: batch }, undefined, now))
    // Price changes are listed in batches of 20 so each audit entry stays readable.
    for (let index = 0; index < priceChanges.length; index += 20) {
      current.push(
        auditStatement('price_change', `Import ${batch}: ${priceChanges.slice(index, index + 20).join('; ')}`, { type: 'import', id: batch }, undefined, now),
      )
    }
    chunks.push(current)

    const totalRows = toWrite.length
    try {
      await runChunkedTransaction(chunks, (done, total) => {
        // Chunk 0 is setup; report progress in products.
        const rowsDone = Math.min(totalRows, Math.max(0, done - 1) * ROWS_PER_CHUNK)
        onProgress?.(done === total ? totalRows : rowsDone, totalRows)
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (/unique/i.test(message)) {
        throw new ApiError('Another product already uses one of these barcodes. Nothing was imported; check the file and try again.', 409)
      }
      throw new ApiError(`The import failed and nothing was saved. ${message}`, 500)
    }

    return { batch, added, updated, skipped, failed, categoriesCreated, suppliersCreated, rows: plan.rows }
  },
}
