import { querySQL, executeSQL } from '../database/sqlite'
import { sha256 } from '../utils/hash'
import { getStoredUser } from '../utils/session'
import { ApiError } from '../utils/errors'
import type { Role } from '../utils/permissions'

export type UserAccount = {
  id: number
  email: string
  fullName: string
  role: Role
  isActive: boolean
}

export type UserPayload = {
  email: string
  fullName: string
  role: Role
  isActive: boolean
  password?: string
}

type UserRow = {
  id: number
  email: string
  full_name: string
  role: Role
  is_active: number
}

function toUserAccount(row: UserRow): UserAccount {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    isActive: Boolean(row.is_active),
  }
}

export const userApi = {
  list: async (): Promise<UserAccount[]> => {
    const result = await querySQL(
      `SELECT id, email, full_name, role, is_active FROM users ORDER BY full_name ASC`,
    )
    return ((result.values ?? []) as UserRow[]).map(toUserAccount)
  },

  get: async (id: number): Promise<UserAccount> => {
    const result = await querySQL(
      `SELECT id, email, full_name, role, is_active FROM users WHERE id = ? LIMIT 1`,
      [id],
    )
    const row = result.values?.[0] as UserRow | undefined
    if (!row) throw new ApiError('User not found.', 404)
    return toUserAccount(row)
  },

  create: async (payload: UserPayload): Promise<UserAccount> => {
    if (!payload.password) {
      throw new ApiError('Password is required for a new account.', 400)
    }

    const existing = await querySQL(`SELECT id FROM users WHERE email = ? LIMIT 1`, [
      payload.email.trim().toLowerCase(),
    ])
    if (existing.values?.length) {
      throw new ApiError('An account with this email already exists.', 400)
    }

    const passwordHash = await sha256(payload.password)
    const result = await executeSQL(
      `INSERT INTO users (email, full_name, password_hash, role, is_active) VALUES (?, ?, ?, ?, ?)`,
      [payload.email.trim().toLowerCase(), payload.fullName, passwordHash, payload.role, payload.isActive ? 1 : 0],
    )
    const id = result.changes?.lastId
    if (!id) throw new ApiError('Failed to create user account.', 500)
    return userApi.get(id)
  },

  update: async (id: number, payload: UserPayload): Promise<UserAccount> => {
    const current = getStoredUser()
    if (current && Number(current.id) === id && current.role === 'admin' && payload.role !== 'admin') {
      throw new ApiError('You cannot remove your own admin role.', 400)
    }

    await executeSQL(
      `UPDATE users SET email = ?, full_name = ?, role = ?, is_active = ? WHERE id = ?`,
      [payload.email.trim().toLowerCase(), payload.fullName, payload.role, payload.isActive ? 1 : 0, id],
    )

    if (payload.password) {
      const passwordHash = await sha256(payload.password)
      await executeSQL(`UPDATE users SET password_hash = ? WHERE id = ?`, [passwordHash, id])
    }

    return userApi.get(id)
  },

  deactivate: async (id: number): Promise<void> => {
    const current = getStoredUser()
    if (current && Number(current.id) === id) {
      throw new ApiError('You cannot deactivate your own account.', 400)
    }
    await executeSQL(`UPDATE users SET is_active = 0 WHERE id = ?`, [id])
  },
}
