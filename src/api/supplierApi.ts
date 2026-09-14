import type { Supplier } from '../types'
import { querySQL, executeSQL } from '../database/sqlite'
import { ApiError } from '../utils/errors'

export type SupplierPayload = {
  companyName: string
  contactPerson?: string
  phone?: string
  email?: string
  address?: string
  isActive: boolean
}

type SupplierRow = {
  id: number
  supplier_code: string
  company_name: string
  contact_person: string | null
  phone: string | null
  email: string | null
  address: string | null
  is_active: number
}

function toSupplier(row: SupplierRow): Supplier {
  return {
    id: row.id,
    supplierCode: row.supplier_code,
    companyName: row.company_name,
    contactPerson: row.contact_person,
    phone: row.phone,
    email: row.email,
    address: row.address,
    isActive: Boolean(row.is_active),
  }
}

export const supplierApi = {
  list: async (params?: { search?: string; isActive?: boolean }): Promise<Supplier[]> => {
    const clauses: string[] = []
    const values: unknown[] = []

    if (params?.search) {
      clauses.push(
        '(company_name LIKE ? OR contact_person LIKE ? OR supplier_code LIKE ?)',
      )
      const term = `%${params.search}%`
      values.push(term, term, term)
    }

    if (params?.isActive !== undefined) {
      clauses.push('is_active = ?')
      values.push(params.isActive ? 1 : 0)
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    const result = await querySQL(
      `SELECT * FROM suppliers ${where} ORDER BY company_name ASC`,
      values,
    )
    return ((result.values ?? []) as SupplierRow[]).map(toSupplier)
  },

  get: async (id: number): Promise<Supplier> => {
    const result = await querySQL(`SELECT * FROM suppliers WHERE id = ? LIMIT 1`, [id])
    const row = result.values?.[0] as SupplierRow | undefined
    if (!row) throw new ApiError('Supplier not found.', 404)
    return toSupplier(row)
  },

  create: async (payload: SupplierPayload): Promise<Supplier> => {
    const result = await executeSQL(
      `INSERT INTO suppliers (supplier_code, company_name, contact_person, phone, email, address, is_active)
       VALUES ('', ?, ?, ?, ?, ?, ?)`,
      [
        payload.companyName,
        payload.contactPerson || null,
        payload.phone || null,
        payload.email || null,
        payload.address || null,
        payload.isActive ? 1 : 0,
      ],
    )
    const id = result.changes?.lastId
    if (!id) throw new ApiError('Failed to create supplier.', 500)
    await executeSQL(`UPDATE suppliers SET supplier_code = ? WHERE id = ?`, [
      `SUP-${String(id).padStart(4, '0')}`,
      id,
    ])
    return supplierApi.get(id)
  },

  update: async (id: number, payload: SupplierPayload): Promise<Supplier> => {
    await executeSQL(
      `UPDATE suppliers SET company_name = ?, contact_person = ?, phone = ?, email = ?, address = ?, is_active = ? WHERE id = ?`,
      [
        payload.companyName,
        payload.contactPerson || null,
        payload.phone || null,
        payload.email || null,
        payload.address || null,
        payload.isActive ? 1 : 0,
        id,
      ],
    )
    return supplierApi.get(id)
  },

  deactivate: async (id: number): Promise<void> => {
    await executeSQL(`UPDATE suppliers SET is_active = 0 WHERE id = ?`, [id])
  },
}
