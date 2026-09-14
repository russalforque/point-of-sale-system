import type { Category } from '../types'
import { querySQL, executeSQL } from '../database/sqlite'
import { ApiError } from '../utils/errors'

export type CategoryPayload = { name: string; description?: string; isActive: boolean }

type CategoryRow = {
  id: number
  name: string
  description: string | null
  is_active: number
  productCount: number
}

function toCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    isActive: Boolean(row.is_active),
    productCount: row.productCount ?? 0,
  }
}

const SELECT_BASE = `
  SELECT
    c.id AS id,
    c.name AS name,
    c.description AS description,
    c.is_active AS is_active,
    (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS productCount
  FROM categories c
`

export const categoryApi = {
  list: async (isActive?: boolean): Promise<Category[]> => {
    const where = isActive === undefined ? '' : `WHERE c.is_active = ${isActive ? 1 : 0}`
    const result = await querySQL(`${SELECT_BASE} ${where} ORDER BY c.name ASC`)
    return ((result.values ?? []) as CategoryRow[]).map(toCategory)
  },

  get: async (id: number): Promise<Category> => {
    const result = await querySQL(`${SELECT_BASE} WHERE c.id = ? LIMIT 1`, [id])
    const row = result.values?.[0] as CategoryRow | undefined
    if (!row) throw new ApiError('Category not found.', 404)
    return toCategory(row)
  },

  create: async (payload: CategoryPayload): Promise<Category> => {
    const result = await executeSQL(
      `INSERT INTO categories (name, description, is_active) VALUES (?, ?, ?)`,
      [payload.name, payload.description ?? null, payload.isActive ? 1 : 0],
    )
    const id = result.changes?.lastId
    if (!id) throw new ApiError('Failed to create category.', 500)
    return categoryApi.get(id)
  },

  update: async (id: number, payload: CategoryPayload): Promise<Category> => {
    await executeSQL(
      `UPDATE categories SET name = ?, description = ?, is_active = ? WHERE id = ?`,
      [payload.name, payload.description ?? null, payload.isActive ? 1 : 0, id],
    )
    return categoryApi.get(id)
  },

  remove: async (id: number): Promise<void> => {
    const usage = await querySQL(`SELECT COUNT(*) AS count FROM products WHERE category_id = ?`, [id])
    const count = (usage.values?.[0]?.count as number | undefined) ?? 0
    if (count > 0) {
      throw new ApiError('Cannot delete a category that is currently used by products.', 400)
    }
    await executeSQL(`DELETE FROM categories WHERE id = ?`, [id])
  },
}
