/**
 * Bulk product import: column mapping, parsing and validation. Pure functions, no database or
 * UI, so the preview and the final import run exactly the same rules and 1,000+ rows validate
 * in milliseconds.
 */

import { barcodeProblem } from '../barcode'

export const TEMPLATE_COLUMNS = [
  'SKU',
  'Barcode',
  'Product Name',
  'Category',
  'Cost Price',
  'Selling Price',
  'Initial Stock',
  'Unit',
  'Supplier',
] as const

export const TEMPLATE_EXAMPLE = ['BEV-001', '4800012345672', 'Coca-Cola 1.5L', 'Beverages', '60', '75', '24', 'pcs', 'Metro Beverage Supply']

export type FieldKey = 'sku' | 'barcode' | 'name' | 'category' | 'cost' | 'price' | 'stock' | 'unit' | 'supplier'

export const FIELD_LABELS: Record<FieldKey, string> = {
  sku: 'SKU',
  barcode: 'Barcode',
  name: 'Product Name',
  category: 'Category',
  cost: 'Cost Price',
  price: 'Selling Price',
  stock: 'Initial Stock',
  unit: 'Unit',
  supplier: 'Supplier',
}

export const FIELD_ORDER: FieldKey[] = ['sku', 'barcode', 'name', 'category', 'cost', 'price', 'stock', 'unit', 'supplier']

/** Header text people actually use, compared after lowercasing and dropping spaces/punctuation. */
const HEADER_ALIASES: Record<FieldKey, string[]> = {
  sku: ['sku', 'itemcode', 'productcode', 'code', 'skucode'],
  barcode: ['barcode', 'upc', 'ean', 'gtin', 'barcodeno', 'barcodenumber'],
  name: ['productname', 'name', 'product', 'itemname', 'item', 'itemdescription'],
  category: ['category', 'categoryname', 'group', 'department'],
  cost: ['costprice', 'cost', 'unitcost', 'purchaseprice', 'buyingprice'],
  price: ['sellingprice', 'price', 'srp', 'retailprice', 'unitprice', 'sellprice', 'saleprice'],
  stock: ['initialstock', 'stock', 'quantity', 'qty', 'onhand', 'stockquantity', 'openingstock'],
  unit: ['unit', 'uom', 'unitofmeasure', 'units'],
  supplier: ['supplier', 'suppliername', 'vendor', 'vendorname'],
}

const REQUIRED_COLUMNS: FieldKey[] = ['name', 'price']

export const DEFAULT_CATEGORY = 'Uncategorized'
const MAX_NAME = 120
const MAX_CODE = 64

/** Same key for "Beverages", "beverages" and "  Beverages ". */
export function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

/** Display form: trimmed, single spaces, original capitalisation. */
export function tidyName(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export type ColumnMap = Partial<Record<FieldKey, number>>

export type HeaderResult = { map: ColumnMap; missing: FieldKey[]; ignored: string[] }

export function mapHeaders(header: string[]): HeaderResult {
  const map: ColumnMap = {}
  const ignored: string[] = []
  header.forEach((title, index) => {
    const key = normalizeHeader(title ?? '')
    if (!key) return
    const field = FIELD_ORDER.find((candidate) => HEADER_ALIASES[candidate].includes(key))
    if (field && map[field] === undefined) map[field] = index
    else ignored.push(tidyName(title))
  })
  return { map, missing: REQUIRED_COLUMNS.filter((field) => map[field] === undefined), ignored }
}

export type RawRow = { rowNumber: number; values: Record<FieldKey, string> }

export type SheetReadResult =
  | { ok: true; rows: RawRow[]; blankRows: number; ignoredColumns: string[] }
  | { ok: false; message: string }

/** Finds the header (first non-empty row) and turns every following non-blank row into a RawRow. */
export function readRows(sheet: string[][]): SheetReadResult {
  const headerIndex = sheet.findIndex((row) => row.some((cell) => (cell ?? '').trim() !== ''))
  if (headerIndex === -1) return { ok: false, message: 'The file is empty.' }

  const { map, missing, ignored } = mapHeaders(sheet[headerIndex]!)
  if (missing.length) {
    return {
      ok: false,
      message: `Missing column${missing.length > 1 ? 's' : ''}: ${missing.map((field) => FIELD_LABELS[field]).join(', ')}. Use the template’s column names.`,
    }
  }

  const rows: RawRow[] = []
  let blankRows = 0
  for (let index = headerIndex + 1; index < sheet.length; index += 1) {
    const cells = sheet[index] ?? []
    if (!cells.some((cell) => (cell ?? '').trim() !== '')) {
      blankRows += 1
      continue
    }
    const values = {} as Record<FieldKey, string>
    for (const field of FIELD_ORDER) {
      const col = map[field]
      values[field] = col === undefined ? '' : String(cells[col] ?? '').trim()
    }
    rows.push({ rowNumber: index + 1, values })
  }
  // Trailing empty lines aren't worth reporting.
  return { ok: true, rows, blankRows, ignoredColumns: ignored }
}

/* ------------------------------------------------------------------
   VALIDATION
------------------------------------------------------------------ */

export type ImportContext = {
  products: { id: number; sku: string; barcode: string | null; name: string; costPrice: number; sellingPrice: number }[]
  categories: { id: number; name: string; isActive: boolean }[]
  suppliers: { id: number; companyName: string; isActive: boolean }[]
}

export type ImportOptions = {
  /** What to do with rows whose SKU/barcode already belongs to a product. */
  existing: 'skip' | 'update'
  createCategories: boolean
  createSuppliers: boolean
}

export const DEFAULT_OPTIONS: ImportOptions = { existing: 'skip', createCategories: true, createSuppliers: true }

export type RowStatus = 'ready' | 'warning' | 'error' | 'duplicate' | 'update' | 'skip'

export const STATUS_LABELS: Record<RowStatus, string> = {
  ready: 'Ready',
  warning: 'Warning',
  error: 'Error',
  duplicate: 'Duplicate',
  update: 'Will Update',
  skip: 'Will Skip',
}

export type Issue = { level: 'error' | 'warning' | 'info'; message: string }

export type ParsedRow = {
  sku: string
  barcode: string | null
  name: string
  categoryName: string
  cost: number
  price: number
  stock: number
  unit: string | null
  supplierName: string | null
}

export type PlannedRow = RawRow & {
  status: RowStatus
  issues: Issue[]
  parsed: ParsedRow
  /** Matching product already in the store (by SKU or barcode). */
  existing: { id: number; name: string } | null
  category: { id: number } | { create: string }
  supplier: { id: number } | { create: string } | null
}

export type ImportSummary = {
  total: number
  ready: number
  warning: number
  error: number
  duplicate: number
  update: number
  skip: number
  /** Rows that will be written: ready + warning + update. */
  importable: number
  newCategories: string[]
  newSuppliers: string[]
}

export type ImportPlan = { rows: PlannedRow[]; summary: ImportSummary }

/** "₱1,250.00" → 1250. Empty → null. Anything else non-numeric → NaN. */
export function parseNumber(text: string): number | null {
  const cleaned = text.replace(/[₱$\s,]/g, '').replace(/^php/i, '')
  if (cleaned === '') return null
  if (!/^-?\d*\.?\d+$/.test(cleaned) && !/^-?\d+\.$/.test(cleaned)) return Number.NaN
  return Number(cleaned)
}

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100

/** Every blocking check here is also what the database layer re-checks before writing. */
export function planImport(rows: RawRow[], context: ImportContext, options: ImportOptions): ImportPlan {
  const productsBySku = new Map<string, ImportContext['products'][number]>()
  const productsByBarcode = new Map<string, ImportContext['products'][number]>()
  // Only used for rows with neither SKU nor barcode; null marks an ambiguous (repeated) name.
  const productsByName = new Map<string, ImportContext['products'][number] | null>()
  for (const product of context.products) {
    const skuKey = product.sku.trim().toUpperCase()
    if (skuKey && !productsBySku.has(skuKey)) productsBySku.set(skuKey, product)
    if (product.barcode) productsByBarcode.set(product.barcode.trim(), product)
    const nameKey = normalizeName(product.name)
    productsByName.set(nameKey, productsByName.has(nameKey) ? null : product)
  }

  // Prefer an active record when the store already has look-alike names.
  const categoriesByKey = new Map<string, ImportContext['categories'][number]>()
  for (const category of [...context.categories].sort((a, b) => Number(b.isActive) - Number(a.isActive))) {
    const key = normalizeName(category.name)
    if (!categoriesByKey.has(key)) categoriesByKey.set(key, category)
  }
  const suppliersByKey = new Map<string, ImportContext['suppliers'][number]>()
  for (const supplier of [...context.suppliers].sort((a, b) => Number(b.isActive) - Number(a.isActive))) {
    const key = normalizeName(supplier.companyName)
    if (!suppliersByKey.has(key)) suppliersByKey.set(key, supplier)
  }

  const newCategories = new Map<string, string>()
  const newSuppliers = new Map<string, string>()
  const seenSku = new Map<string, number>()
  const seenBarcode = new Map<string, number>()
  const seenNameOnly = new Map<string, number>()
  const usedSkus = new Set<string>([...productsBySku.keys()])
  for (const row of rows) if (row.values.sku) usedSkus.add(row.values.sku.trim().toUpperCase())
  let generatedCounter = 0
  const nextSku = () => {
    let sku: string
    do {
      generatedCounter += 1
      sku = `IMP-${String(generatedCounter).padStart(5, '0')}`
    } while (usedSkus.has(sku))
    usedSkus.add(sku)
    return sku
  }

  const planned = rows.map((row): PlannedRow => {
    const v = row.values
    const issues: Issue[] = []
    const error = (message: string) => issues.push({ level: 'error', message })
    const warn = (message: string) => issues.push({ level: 'warning', message })
    const info = (message: string) => issues.push({ level: 'info', message })

    // --- text fields
    const name = tidyName(v.name)
    if (!name) error('Product name is required.')
    else if (name.length > MAX_NAME) error(`Product name is longer than ${MAX_NAME} characters.`)

    const barcode = v.barcode.trim() || null
    if (barcode && (/\s/.test(barcode) || barcode.length > MAX_CODE)) error('Barcode can’t contain spaces or be longer than 64 characters.')
    else if (barcode && barcodeProblem(barcode)) error(barcodeProblem(barcode)!)
    let sku = v.sku.trim()
    if (sku.length > MAX_CODE) error('SKU is longer than 64 characters.')

    // --- numbers
    const price = parseNumber(v.price)
    if (price === null) error('Selling price is required.')
    else if (Number.isNaN(price)) error(`Selling price “${v.price}” isn’t a number.`)
    else if (price < 0) error('Selling price can’t be negative.')
    else if (price === 0) warn('Selling price is 0.')

    const costParsed = parseNumber(v.cost)
    const cost = costParsed ?? 0
    if (Number.isNaN(cost)) error(`Cost price “${v.cost}” isn’t a number.`)
    else if (cost < 0) error('Cost price can’t be negative.')

    const stockParsed = parseNumber(v.stock)
    const stock = stockParsed ?? 0
    if (Number.isNaN(stock)) error(`Initial stock “${v.stock}” isn’t a number.`)
    else if (stock < 0) error('Initial stock can’t be negative.')
    else if (!Number.isInteger(stock)) error('Initial stock must be a whole number.')

    if (price !== null && !Number.isNaN(price) && !Number.isNaN(cost) && price > 0 && cost > price) {
      warn('Selling price is lower than cost.')
    }

    // --- duplicates inside the file
    let duplicateOf: number | null = null
    if (sku) {
      const key = sku.toUpperCase()
      const first = seenSku.get(key)
      if (first !== undefined) duplicateOf = first
      else seenSku.set(key, row.rowNumber)
    }
    if (barcode) {
      const first = seenBarcode.get(barcode)
      if (first !== undefined) duplicateOf = duplicateOf ?? first
      else seenBarcode.set(barcode, row.rowNumber)
    }
    const nameOnly = !sku && !barcode && name ? normalizeName(name) : null
    if (nameOnly) {
      const first = seenNameOnly.get(nameOnly)
      if (first !== undefined) duplicateOf = duplicateOf ?? first
      else seenNameOnly.set(nameOnly, row.rowNumber)
    }

    // --- products already in the store
    const skuMatch = sku ? productsBySku.get(sku.toUpperCase()) : undefined
    const barcodeMatch = barcode ? productsByBarcode.get(barcode) : undefined
    // Without any code, an identical name is the only way to avoid adding the product twice.
    const nameMatch = nameOnly ? productsByName.get(nameOnly) ?? undefined : undefined
    let existing: PlannedRow['existing'] = null
    if (skuMatch && barcodeMatch && skuMatch.id !== barcodeMatch.id) {
      error(`SKU belongs to “${skuMatch.name}” but the barcode belongs to “${barcodeMatch.name}”.`)
    } else if (skuMatch || barcodeMatch || nameMatch) {
      const match = (skuMatch ?? barcodeMatch ?? nameMatch)!
      if (nameMatch && !skuMatch && !barcodeMatch) info('Matched by product name (the row has no SKU or barcode).')
      existing = { id: match.id, name: match.name }
      if (options.existing === 'update') {
        if (!skuMatch && sku) info(`Matched by barcode; SKU stays ${match.sku}.`)
        if (stock > 0) info('Stock of existing products isn’t changed. Use Receive Stock or Stock Count.')
        if (price !== null && !Number.isNaN(price) && price !== match.sellingPrice) info(`Price ${match.sellingPrice} → ${price}`)
      }
    }

    if (!sku && !existing) {
      sku = nextSku()
      info(`No SKU given; it will be ${sku}.`)
    }

    // --- category
    let categoryName = tidyName(v.category)
    if (!categoryName) {
      categoryName = DEFAULT_CATEGORY
      warn(`No category; it will go under “${DEFAULT_CATEGORY}”.`)
    }
    const categoryKey = normalizeName(categoryName)
    const knownCategory = categoriesByKey.get(categoryKey)
    let category: PlannedRow['category']
    if (knownCategory) {
      category = { id: knownCategory.id }
      if (!knownCategory.isActive) warn(`Category “${knownCategory.name}” is inactive.`)
    } else if (options.createCategories) {
      if (!newCategories.has(categoryKey)) newCategories.set(categoryKey, categoryName)
      category = { create: newCategories.get(categoryKey)! }
    } else {
      category = { create: categoryName }
      error(`Category “${categoryName}” doesn’t exist.`)
    }

    // --- supplier
    const supplierName = tidyName(v.supplier) || null
    let supplier: PlannedRow['supplier'] = null
    if (supplierName) {
      const supplierKey = normalizeName(supplierName)
      const knownSupplier = suppliersByKey.get(supplierKey)
      if (knownSupplier) {
        supplier = { id: knownSupplier.id }
        if (!knownSupplier.isActive) warn(`Supplier “${knownSupplier.companyName}” is inactive.`)
      } else if (options.createSuppliers) {
        if (!newSuppliers.has(supplierKey)) newSuppliers.set(supplierKey, supplierName)
        supplier = { create: newSuppliers.get(supplierKey)! }
      } else {
        supplier = { create: supplierName }
        error(`Supplier “${supplierName}” doesn’t exist.`)
      }
    }

    const hasError = issues.some((issue) => issue.level === 'error')
    let status: RowStatus
    if (duplicateOf !== null) {
      status = 'duplicate'
      issues.unshift({ level: 'error', message: `Same ${nameOnly ? 'product name' : 'SKU or barcode'} as row ${duplicateOf}.` })
    } else if (hasError) status = 'error'
    else if (existing) status = options.existing === 'update' ? 'update' : 'skip'
    else status = issues.some((issue) => issue.level === 'warning') ? 'warning' : 'ready'

    if (status === 'skip') issues.unshift({ level: 'info', message: `Already in your products as “${existing!.name}”.` })
    if (status === 'update') issues.unshift({ level: 'info', message: `Updates “${existing!.name}”.` })

    return {
      ...row,
      status,
      issues,
      existing,
      category,
      supplier,
      parsed: {
        sku,
        barcode,
        name,
        categoryName,
        cost: Number.isFinite(cost) ? round2(cost) : 0,
        price: price !== null && Number.isFinite(price) ? round2(price) : 0,
        stock: Number.isFinite(stock) ? stock : 0,
        unit: tidyName(v.unit) || null,
        supplierName,
      },
    }
  })

  // Only count new categories/suppliers that a row which will actually be written needs.
  const writes = planned.filter((row) => row.status === 'ready' || row.status === 'warning' || row.status === 'update')
  const neededCategories = new Set(writes.flatMap((row) => ('create' in row.category ? [normalizeName(row.category.create)] : [])))
  const neededSuppliers = new Set(
    writes.flatMap((row) => (row.supplier && 'create' in row.supplier ? [normalizeName(row.supplier.create)] : [])),
  )

  const count = (status: RowStatus) => planned.filter((row) => row.status === status).length
  const summary: ImportSummary = {
    total: planned.length,
    ready: count('ready'),
    warning: count('warning'),
    error: count('error'),
    duplicate: count('duplicate'),
    update: count('update'),
    skip: count('skip'),
    importable: writes.length,
    newCategories: [...newCategories].filter(([key]) => neededCategories.has(key)).map(([, label]) => label),
    newSuppliers: [...newSuppliers].filter(([key]) => neededSuppliers.has(key)).map(([, label]) => label),
  }
  return { rows: planned, summary }
}

export function isImportable(row: PlannedRow): boolean {
  return row.status === 'ready' || row.status === 'warning' || row.status === 'update'
}

/** First blocking problem, or the most useful note, for one-line display. */
export function rowReason(row: PlannedRow): string {
  const pick =
    row.issues.find((issue) => issue.level === 'error') ??
    row.issues.find((issue) => issue.level === 'warning') ??
    row.issues.find((issue) => issue.level === 'info')
  return pick?.message ?? ''
}
