import type { Customer, PagedResult } from '../types'
import { querySQL, executeSQL } from '../database/sqlite'
import { ApiError } from '../utils/errors'

export type CustomerPayload = {
  fullName: string
  phone?: string
  email?: string
  address?: string
  isActive: boolean
}

type CustomerRow = {
  id: number
  customer_code: string
  full_name: string
  phone: string | null
  email: string | null
  address: string | null
  is_active: number
  created_at: string
  loyalty_points: number
}

function toCustomer(row: CustomerRow): Customer {
  return {
    id: row.id,
    customerCode: row.customer_code,
    fullName: row.full_name,
    phone: row.phone,
    email: row.email,
    address: row.address,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    loyaltyPoints: row.loyalty_points,
  }
}

function buildFilters(params?: { search?: string; isActive?: boolean }) {
  const clauses: string[] = []
  const values: unknown[] = []

  if (params?.search) {
    clauses.push('(full_name LIKE ? OR phone LIKE ? OR customer_code LIKE ? OR email LIKE ?)')
    const term = `%${params.search}%`
    values.push(term, term, term, term)
  }

  if (params?.isActive !== undefined) {
    clauses.push('is_active = ?')
    values.push(params.isActive ? 1 : 0)
  }

  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', values }
}

export const customerApi = {
  list: async (params: {
    search?: string
    isActive?: boolean
    page?: number
    pageSize?: number
  }): Promise<PagedResult<Customer>> => {
    const { where, values } = buildFilters(params)
    const page = params.page ?? 1
    const pageSize = params.pageSize ?? 10

    const countResult = await querySQL(`SELECT COUNT(*) AS count FROM customers ${where}`, values)
    const totalCount = (countResult.values?.[0]?.count as number | undefined) ?? 0

    const result = await querySQL(
      `SELECT * FROM customers ${where} ORDER BY full_name ASC LIMIT ? OFFSET ?`,
      [...values, pageSize, (page - 1) * pageSize],
    )

    return {
      items: ((result.values ?? []) as CustomerRow[]).map(toCustomer),
      totalCount,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
    }
  },

  lookup: async (search?: string): Promise<Customer[]> => {
    const { where, values } = buildFilters({ search, isActive: true })
    const result = await querySQL(
      `SELECT * FROM customers ${where} ORDER BY full_name ASC LIMIT 20`,
      values,
    )
    return ((result.values ?? []) as CustomerRow[]).map(toCustomer)
  },

  get: async (id: number): Promise<Customer> => {
    const result = await querySQL(`SELECT * FROM customers WHERE id = ? LIMIT 1`, [id])
    const row = result.values?.[0] as CustomerRow | undefined
    if (!row) throw new ApiError('Customer not found.', 404)
    return toCustomer(row)
  },

  create: async (payload: CustomerPayload): Promise<Customer> => {
    const result = await executeSQL(
      `INSERT INTO customers (customer_code, full_name, phone, email, address, is_active, created_at, loyalty_points)
       VALUES ('', ?, ?, ?, ?, ?, ?, 0)`,
      [
        payload.fullName,
        payload.phone || null,
        payload.email || null,
        payload.address || null,
        payload.isActive ? 1 : 0,
        new Date().toISOString(),
      ],
    )
    const id = result.changes?.lastId
    if (!id) throw new ApiError('Failed to create customer.', 500)
    await executeSQL(`UPDATE customers SET customer_code = ? WHERE id = ?`, [
      `CUS-${String(id).padStart(4, '0')}`,
      id,
    ])
    return customerApi.get(id)
  },

  update: async (id: number, payload: CustomerPayload): Promise<Customer> => {
    await executeSQL(
      `UPDATE customers SET full_name = ?, phone = ?, email = ?, address = ?, is_active = ? WHERE id = ?`,
      [
        payload.fullName,
        payload.phone || null,
        payload.email || null,
        payload.address || null,
        payload.isActive ? 1 : 0,
        id,
      ],
    )
    return customerApi.get(id)
  },

  deactivate: async (id: number): Promise<void> => {
    await executeSQL(`UPDATE customers SET is_active = 0 WHERE id = ?`, [id])
  },
}
