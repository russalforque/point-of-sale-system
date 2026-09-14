import type { PagedResult, Product } from '../types'
import { querySQL, executeSQL } from '../database/sqlite'
import { ApiError } from '../utils/errors'

export type ProductPayload = {
  sku: string
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
}

type ProductRow = {
  id: number
  sku: string
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
}

function toProduct(row: ProductRow): Product {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    description: row.description,
    categoryId: row.categoryId,
    categoryName: row.categoryName ?? 'Uncategorized',
    supplierId: row.supplierId,
    supplierName: row.supplierName,
    costPrice: row.costPrice,
    sellingPrice: row.sellingPrice,
    stockQuantity: row.stockQuantity,
    reorderLevel: row.reorderLevel,
    isActive: Boolean(row.isActive),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    imageUrl: row.imageUrl,
    stockStatus: row.stockStatus,
  }
}

const SELECT_BASE = `
  SELECT
    p.id AS id,
    p.sku AS sku,
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
    CASE
      WHEN p.stock_quantity <= 0 THEN 'Out of Stock'
      WHEN p.stock_quantity <= p.reorder_level THEN 'Low Stock'
      ELSE 'In Stock'
    END AS stockStatus
  FROM products p
  LEFT JOIN categories c ON c.id = p.category_id
  LEFT JOIN suppliers s ON s.id = p.supplier_id
`

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
      clauses.push('(p.name LIKE ? OR p.sku LIKE ?)')
      const term = `%${params.search}%`
      values.push(term, term)
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

  catalog: async (params?: { search?: string; categoryId?: number }): Promise<Product[]> => {
    const clauses: string[] = ['p.is_active = 1']
    const values: unknown[] = []

    if (params?.search) {
      clauses.push('(p.name LIKE ? OR p.sku LIKE ?)')
      const term = `%${params.search}%`
      values.push(term, term)
    }
    if (params?.categoryId !== undefined) {
      clauses.push('p.category_id = ?')
      values.push(params.categoryId)
    }

    const result = await querySQL(
      `${SELECT_BASE} WHERE ${clauses.join(' AND ')} ORDER BY p.name ASC`,
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

  create: async (payload: ProductPayload): Promise<Product> => {
    const now = new Date().toISOString()
    const result = await executeSQL(
      `INSERT INTO products (
        sku, name, description, category_id, supplier_id, cost_price, selling_price,
        stock_quantity, reorder_level, is_active, created_at, updated_at, image_url
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.sku,
        payload.name,
        payload.description || null,
        payload.categoryId,
        payload.supplierId || null,
        payload.costPrice,
        payload.sellingPrice,
        payload.stockQuantity,
        payload.reorderLevel,
        payload.isActive ? 1 : 0,
        now,
        now,
        payload.imageUrl || null,
      ],
    )
    const id = result.changes?.lastId
    if (!id) throw new ApiError('Failed to create product.', 500)
    return productApi.get(id)
  },

  update: async (id: number, payload: ProductPayload): Promise<Product> => {
    await executeSQL(
      `UPDATE products SET
        sku = ?, name = ?, description = ?, category_id = ?, supplier_id = ?,
        cost_price = ?, selling_price = ?, stock_quantity = ?, reorder_level = ?,
        is_active = ?, updated_at = ?, image_url = ?
       WHERE id = ?`,
      [
        payload.sku,
        payload.name,
        payload.description || null,
        payload.categoryId,
        payload.supplierId || null,
        payload.costPrice,
        payload.sellingPrice,
        payload.stockQuantity,
        payload.reorderLevel,
        payload.isActive ? 1 : 0,
        new Date().toISOString(),
        payload.imageUrl || null,
        id,
      ],
    )
    return productApi.get(id)
  },

  deactivate: async (id: number): Promise<void> => {
    await executeSQL(`UPDATE products SET is_active = 0, updated_at = ? WHERE id = ?`, [
      new Date().toISOString(),
      id,
    ])
  },
}
