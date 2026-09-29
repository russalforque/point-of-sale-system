import { querySQL, executeSQL } from '../database/sqlite'
import { runTransaction, type SqlStatement } from '../database/tx'
import { sha256 } from '../utils/hash'
import { getStoredUser } from '../utils/session'
import { ApiError } from '../utils/errors'
import { APPROVER_ROLES, ROLE_LABELS, type Role } from '../utils/permissions'
import { auditStatement } from '../services/audit'
import { hashPin, PIN_PATTERN } from './authApi'

export type UserAccount = {
  id: number
  email: string
  fullName: string
  role: Role
  isActive: boolean
  /** Has an approval PIN (managers and admins only). */
  hasPin: boolean
}

export type UserPayload = {
  email: string
  fullName: string
  role: Role
  isActive: boolean
  password?: string
  /** New approval PIN. Empty/undefined leaves the current PIN unchanged. */
  pin?: string
  /** Remove the current approval PIN. */
  clearPin?: boolean
}

type UserRow = {
  id: number
  email: string
  full_name: string
  role: Role
  is_active: number
  has_pin: number
}

const USER_SELECT = `SELECT id, email, full_name, role, is_active, pin_hash IS NOT NULL AS has_pin FROM users`

function toUserAccount(row: UserRow): UserAccount {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    isActive: Boolean(row.is_active),
    hasPin: Boolean(row.has_pin),
  }
}

export function canHavePin(role: Role): boolean {
  return APPROVER_ROLES.includes(role)
}

/**
 * Approval PINs identify the approver, so two active approvers can't share one.
 * Returns the hash to store for `userId`.
 */
async function pinHashFor(userId: number, pin: string): Promise<string> {
  if (!PIN_PATTERN.test(pin)) throw new ApiError('PIN must be 4 to 6 digits.', 400)
  const placeholders = APPROVER_ROLES.map(() => '?').join(', ')
  const others = await querySQL(
    `SELECT id, pin_hash FROM users WHERE id != ? AND is_active = 1 AND pin_hash IS NOT NULL AND role IN (${placeholders})`,
    [userId, ...APPROVER_ROLES],
  )
  for (const row of (others.values ?? []) as { id: number; pin_hash: string }[]) {
    if ((await hashPin(row.id, pin)) === row.pin_hash) {
      throw new ApiError('Another manager already uses this PIN. Choose a different one.', 400)
    }
  }
  return hashPin(userId, pin)
}

/** Cashiers can't approve anything, so a demoted approver loses their PIN too. */
function clearPinStatements(userId: number, payload: UserPayload): SqlStatement[] {
  if (canHavePin(payload.role) && !payload.clearPin) return []
  return [{ statement: `UPDATE users SET pin_hash = NULL WHERE id = ?`, values: [userId] }]
}

export const userApi = {
  list: async (): Promise<UserAccount[]> => {
    const result = await querySQL(`${USER_SELECT} ORDER BY full_name ASC`)
    return ((result.values ?? []) as UserRow[]).map(toUserAccount)
  },

  get: async (id: number): Promise<UserAccount> => {
    const result = await querySQL(`${USER_SELECT} WHERE id = ? LIMIT 1`, [id])
    const row = result.values?.[0] as UserRow | undefined
    if (!row) throw new ApiError('User not found.', 404)
    return toUserAccount(row)
  },

  create: async (payload: UserPayload): Promise<UserAccount> => {
    if (!payload.password) {
      throw new ApiError('Password is required for a new account.', 400)
    }

    const email = payload.email.trim().toLowerCase()
    const existing = await querySQL(`SELECT id FROM users WHERE email = ? LIMIT 1`, [email])
    if (existing.values?.length) {
      throw new ApiError('An account with this email already exists.', 400)
    }

    const passwordHash = await sha256(payload.password)
    const result = await executeSQL(
      `INSERT INTO users (email, full_name, password_hash, role, is_active) VALUES (?, ?, ?, ?, ?)`,
      [email, payload.fullName, passwordHash, payload.role, payload.isActive ? 1 : 0],
    )
    const id = result.changes?.lastId
    if (!id) throw new ApiError('Failed to create user account.', 500)

    const statements: SqlStatement[] = []
    if (payload.pin && canHavePin(payload.role)) {
      statements.push({ statement: `UPDATE users SET pin_hash = ? WHERE id = ?`, values: [await pinHashFor(id, payload.pin), id] })
    }
    statements.push(
      auditStatement(
        'user',
        `Created ${ROLE_LABELS[payload.role]} account for ${payload.fullName} (${email})${payload.isActive ? '' : ', inactive'}`,
        { type: 'user', id },
      ),
    )
    await runTransaction(statements)

    return userApi.get(id)
  },

  update: async (id: number, payload: UserPayload): Promise<UserAccount> => {
    const current = getStoredUser()
    if (current && Number(current.id) === id && current.role === 'admin' && payload.role !== 'admin') {
      throw new ApiError('You cannot remove your own admin role.', 400)
    }

    const before = await userApi.get(id)
    const email = payload.email.trim().toLowerCase()

    const statements: SqlStatement[] = [
      {
        statement: `UPDATE users SET email = ?, full_name = ?, role = ?, is_active = ? WHERE id = ?`,
        values: [email, payload.fullName, payload.role, payload.isActive ? 1 : 0, id],
      },
    ]
    if (payload.password) {
      statements.push({ statement: `UPDATE users SET password_hash = ? WHERE id = ?`, values: [await sha256(payload.password), id] })
    }

    statements.push(...clearPinStatements(id, payload))
    const settingPin = Boolean(payload.pin) && canHavePin(payload.role) && !payload.clearPin
    if (settingPin) {
      statements.push({ statement: `UPDATE users SET pin_hash = ? WHERE id = ?`, values: [await pinHashFor(id, payload.pin!), id] })
    }

    const changes: string[] = []
    if (before.fullName !== payload.fullName) changes.push(`name → ${payload.fullName}`)
    if (before.email !== email) changes.push(`email → ${email}`)
    if (before.role !== payload.role) changes.push(`role ${ROLE_LABELS[before.role]} → ${ROLE_LABELS[payload.role]}`)
    if (before.isActive !== payload.isActive) changes.push(payload.isActive ? 'reactivated' : 'deactivated')
    if (payload.password) changes.push('password reset')
    if (settingPin) changes.push(before.hasPin ? 'PIN changed' : 'PIN set')
    else if (before.hasPin && (payload.clearPin || !canHavePin(payload.role))) changes.push('PIN removed')

    if (changes.length > 0) {
      statements.push(auditStatement('user', `Updated ${before.fullName}: ${changes.join(', ')}`, { type: 'user', id }))
    }
    await runTransaction(statements)

    return userApi.get(id)
  },

  deactivate: async (id: number): Promise<void> => {
    const current = getStoredUser()
    if (current && Number(current.id) === id) {
      throw new ApiError('You cannot deactivate your own account.', 400)
    }
    const user = await userApi.get(id)
    await runTransaction([
      { statement: `UPDATE users SET is_active = 0 WHERE id = ?`, values: [id] },
      auditStatement('user', `Deactivated ${user.fullName} (${user.email})`, { type: 'user', id }),
    ])
  },
}
