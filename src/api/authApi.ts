import { Capacitor } from '@capacitor/core'
import type { LoginResponse, User } from '../types'
import { querySQL, executeSQL } from '../database/sqlite'
import { sha256 } from '../utils/hash'
import { getStoredUser } from '../utils/session'
import { ApiError } from '../utils/errors'
import type { Role } from '../utils/permissions'

type UserRow = {
  id: number
  email: string
  full_name: string
  password_hash: string
  role: string
  is_active: number
}

function toUser(row: UserRow): User {
  return {
    id: String(row.id),
    email: row.email,
    fullName: row.full_name,
    role: (row.role as Role) || 'cashier',
  }
}

function makeToken(userId: number): string {
  return `local:${userId}:${Date.now()}`
}

// Web preview has no SQLite database to authenticate against (see
// database/sqlite.ts), so login/session use this tiny localStorage-only
// fallback instead - same demo credentials as the seeded Android accounts,
// so there's one set of logins to remember across both environments. This
// branch never runs on native; @capacitor-community/sqlite's real
// implementation below is untouched.
type WebDemoAccount = { email: string; password: string; fullName: string; role: Role }

const WEB_DEMO_ACCOUNTS: WebDemoAccount[] = [
  { email: 'admin@sellix.local', password: 'Admin123!', fullName: 'Store Admin', role: 'admin' },
  { email: 'manager@sellix.local', password: 'Manager123!', fullName: 'Store Manager', role: 'manager' },
  { email: 'cashier@sellix.local', password: 'Cashier123!', fullName: 'Store Cashier', role: 'cashier' },
]

function findWebDemoAccount(email: string): WebDemoAccount | undefined {
  const normalized = email.trim().toLowerCase()
  return WEB_DEMO_ACCOUNTS.find((account) => account.email === normalized)
}

export const authApi = {
  login: async (email: string, password: string): Promise<LoginResponse> => {
    if (!Capacitor.isNativePlatform()) {
      const account = findWebDemoAccount(email)
      if (!account || account.password !== password) {
        throw new ApiError('Invalid email or password.', 401)
      }
      return {
        token: `web-preview:${account.role}:${Date.now()}`,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
        user: { id: `web-${account.role}`, email: account.email, fullName: account.fullName, role: account.role },
      }
    }

    const result = await querySQL(
      `SELECT id, email, full_name, password_hash, role, is_active FROM users WHERE email = ? LIMIT 1`,
      [email.trim().toLowerCase()],
    )

    const row = result.values?.[0] as UserRow | undefined

    if (!row || !row.is_active) {
      throw new ApiError('Invalid email or password.', 401)
    }

    const hash = await sha256(password)
    if (hash !== row.password_hash) {
      throw new ApiError('Invalid email or password.', 401)
    }

    return {
      token: makeToken(row.id),
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(),
      user: toUser(row),
    }
  },

  logout: async (): Promise<void> => {
    return Promise.resolve()
  },

  me: async (): Promise<User> => {
    const stored = getStoredUser()
    if (!stored) {
      throw new ApiError('Not signed in.', 401)
    }

    if (!Capacitor.isNativePlatform()) {
      // No SQLite users table to re-validate against in web preview - trust
      // the session localStorage already persisted at login.
      return stored
    }

    const result = await querySQL(
      `SELECT id, email, full_name, password_hash, role, is_active FROM users WHERE id = ? LIMIT 1`,
      [Number(stored.id)],
    )

    const row = result.values?.[0] as UserRow | undefined

    if (!row || !row.is_active) {
      throw new ApiError('Session expired.', 401)
    }

    return toUser(row)
  },

  changePassword: async (currentPassword: string, newPassword: string): Promise<void> => {
    const stored = getStoredUser()
    if (!stored) {
      throw new ApiError('Not signed in.', 401)
    }

    if (!Capacitor.isNativePlatform()) {
      throw new ApiError('Password changes are only available on the native Android app.', 400)
    }

    const result = await querySQL(
      `SELECT id, password_hash FROM users WHERE id = ? LIMIT 1`,
      [Number(stored.id)],
    )

    const row = result.values?.[0] as { id: number; password_hash: string } | undefined
    if (!row) {
      throw new ApiError('Session expired.', 401)
    }

    const currentHash = await sha256(currentPassword)
    if (currentHash !== row.password_hash) {
      throw new ApiError('Current password is incorrect.', 400)
    }

    const newHash = await sha256(newPassword)
    await executeSQL(`UPDATE users SET password_hash = ? WHERE id = ?`, [newHash, row.id])
  },
}
