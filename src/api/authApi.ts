import { hasLocalDatabase } from '../services/platform'
import type { LoginResponse, User } from '../types'
import { querySQL, executeSQL } from '../database/sqlite'
import { hashPassword, verifyPassword } from '../utils/hash'
import { getStoredUser } from '../utils/session'
import { ApiError } from '../utils/errors'
import { APPROVER_ROLES, hasPermission, type Permission, type Role } from '../utils/permissions'
import { auditStatement, logAudit } from '../services/audit'
import { runTransaction } from '../database/tx'

export type Approver = { id: number; fullName: string; role: Role }

/** 4-6 digit approval PIN. */
export const PIN_PATTERN = /^\d{4,6}$/

/** Salted per user, so equal PINs on two accounts never produce the same hash. */
export function hashPin(userId: number, pin: string): Promise<string> {
  return hashPassword(`sellix-pin:${userId}:${pin}`)
}

// Slows down guessing a short PIN at an unattended register.
const MAX_PIN_ATTEMPTS = 5
const PIN_LOCKOUT_MS = 30_000
let failedPinAttempts = 0
let pinLockedUntil = 0

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
    if (!hasLocalDatabase()) {
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

    if (!(await verifyPassword(password, row.password_hash))) {
      throw new ApiError('Invalid email or password.', 401)
    }
    if (!row.password_hash.startsWith('pbkdf2-sha256$')) {
      await executeSQL('UPDATE users SET password_hash = ? WHERE id = ? AND password_hash = ?', [await hashPassword(password), row.id, row.password_hash])
    }

    await logAudit('login', `${row.full_name} signed in`, { type: 'user', id: row.id }, { id: row.id, fullName: row.full_name })

    return {
      token: makeToken(row.id),
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(),
      user: toUser(row),
    }
  },

  logout: async (): Promise<void> => {
    const user = getStoredUser()
    if (user && hasLocalDatabase()) {
      await logAudit('logout', `${user.fullName} signed out`, { type: 'user', id: user.id })
    }
  },

  /**
   * Manager/admin approval for a sensitive action: finds the active approver whose PIN matches
   * and confirms their role actually allows `permission`.
   */
  verifyApproval: async (pin: string, permission: Permission): Promise<Approver> => {
    if (!hasLocalDatabase()) {
      throw new ApiError('PIN approval is only available in the Windows or Android app.', 400)
    }
    if (Date.now() < pinLockedUntil) {
      throw new ApiError('Too many wrong PINs. Wait 30 seconds and try again.', 429)
    }
    if (!PIN_PATTERN.test(pin)) throw new ApiError('Enter a 4 to 6 digit PIN.', 400)

    const placeholders = APPROVER_ROLES.map(() => '?').join(', ')
    const result = await querySQL(
      `SELECT id, full_name, role, pin_hash FROM users
       WHERE is_active = 1 AND pin_hash IS NOT NULL AND role IN (${placeholders})`,
      APPROVER_ROLES,
    )
    const rows = (result.values ?? []) as { id: number; full_name: string; role: Role; pin_hash: string }[]
    if (rows.length === 0) {
      throw new ApiError('No manager PIN is set up yet. An admin can set one in Users.', 400)
    }

    for (const row of rows) {
      if (!(await verifyPassword(`sellix-pin:${row.id}:${pin}`, row.pin_hash))) continue
      if (!row.pin_hash.startsWith('pbkdf2-sha256$')) {
        await executeSQL('UPDATE users SET pin_hash = ? WHERE id = ? AND pin_hash = ?', [await hashPin(row.id, pin), row.id, row.pin_hash])
      }
      failedPinAttempts = 0
      if (!hasPermission(row.role, permission)) {
        throw new ApiError(`${row.full_name} isn’t allowed to approve this.`, 403)
      }
      return { id: row.id, fullName: row.full_name, role: row.role }
    }

    failedPinAttempts += 1
    if (failedPinAttempts >= MAX_PIN_ATTEMPTS) {
      failedPinAttempts = 0
      pinLockedUntil = Date.now() + PIN_LOCKOUT_MS
      throw new ApiError('Too many wrong PINs. Wait 30 seconds and try again.', 429)
    }
    throw new ApiError('Incorrect PIN.', 401)
  },

  me: async (): Promise<User> => {
    const stored = getStoredUser()
    if (!stored) {
      throw new ApiError('Not signed in.', 401)
    }

    if (!hasLocalDatabase()) {
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
    if (newPassword.length < 8) throw new ApiError('Use at least 8 characters for the password.', 400)
    if (newPassword === currentPassword) throw new ApiError('Choose a different password.', 400)
    const stored = getStoredUser()
    if (!stored) {
      throw new ApiError('Not signed in.', 401)
    }

    if (!hasLocalDatabase()) {
      throw new ApiError('Password changes are only available on the Windows or Android app.', 400)
    }

    const result = await querySQL(
      `SELECT id, password_hash FROM users WHERE id = ? AND is_active = 1 LIMIT 1`,
      [Number(stored.id)],
    )

    const row = result.values?.[0] as { id: number; password_hash: string } | undefined
    if (!row) {
      throw new ApiError('Session expired.', 401)
    }

    if (!(await verifyPassword(currentPassword, row.password_hash))) {
      throw new ApiError('Current password is incorrect.', 400)
    }

    const newHash = await hashPassword(newPassword)
    await runTransaction([
      { statement: `UPDATE users SET password_hash = ? WHERE id = ?`, values: [newHash, row.id] },
      auditStatement('user', 'Changed sign-in password', { type: 'user', id: row.id }),
    ])
  },
}
