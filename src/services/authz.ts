import { querySQL } from '../database/sqlite'
import { ApiError } from '../utils/errors'
import { hasPermission, type Permission, type Role } from '../utils/permissions'
import { getStoredUser } from '../utils/session'

/**
 * Authorization for the operations themselves, not just the buttons that lead to them.
 * The signed-in account is re-read from the users table on every sensitive write, so a
 * deactivated account or a role changed since login takes effect immediately.
 */

export type Actor = { id: number; fullName: string; role: Role }

/** Someone who approved an action (their own permission, or a manager PIN). */
export type Approver = { id: string | number; fullName: string }

const DENIED_MESSAGES: Partial<Record<Permission, string>> = {
  'products.manage': 'Only a manager or admin can change products.',
  'products.delete': 'Only a manager or admin can remove products.',
  'inventory.manage': 'Only a manager or admin can adjust stock.',
  'inventory.count': 'Only a manager or admin can confirm a stock count.',
  'inventory.receive': 'Only a manager or admin can receive stock.',
  'settings.manage': 'Only an admin can change store settings.',
  'users.manage': 'Only an admin can manage user accounts.',
  'suppliers.manage': 'Only a manager or admin can manage suppliers.',
  'categories.manage': 'Only a manager or admin can manage categories.',
  'customers.manage': 'Only a manager or admin can edit customers.',
  'expenses.manage': 'Only a manager or admin can record expenses.',
  'purchasing.manage': 'Only a manager or admin can manage purchase orders.',
  'credit.manage': 'Only a manager or admin can manage customer credit.',
  'reports.view': 'Only a manager or admin can view reports.',
}

/** The signed-in account as the database knows it right now. */
export async function currentActor(): Promise<Actor> {
  const stored = getStoredUser()
  if (!stored) throw new ApiError('Not signed in.', 401)
  const result = await querySQL(`SELECT id, full_name, role, is_active FROM users WHERE id = ? LIMIT 1`, [Number(stored.id)])
  const row = result.values?.[0] as { id: number; full_name: string; role: Role; is_active: number } | undefined
  if (!row || !row.is_active) throw new ApiError('Your account is no longer active. Sign in again.', 401)
  return { id: row.id, fullName: row.full_name, role: row.role }
}

/** Throws 403 unless the signed-in account's role allows `permission`. */
export async function requirePermission(permission: Permission): Promise<Actor> {
  const actor = await currentActor()
  if (!hasPermission(actor.role, permission)) {
    throw new ApiError(DENIED_MESSAGES[permission] ?? 'You don’t have permission to do this.', 403)
  }
  return actor
}

/**
 * The UI collects an approval (own permission or a manager PIN); this re-checks that the
 * approver is an active account whose role allows the action. Returns their name.
 */
export async function assertApprover(approver: Approver | null | undefined, permission: Permission): Promise<string> {
  if (!approver) throw new ApiError('This needs approval from a manager or admin.', 403)
  const result = await querySQL(`SELECT full_name, role, is_active FROM users WHERE id = ? LIMIT 1`, [Number(approver.id)])
  const row = result.values?.[0] as { full_name: string; role: Role; is_active: number } | undefined
  if (!row || !row.is_active || !hasPermission(row.role, permission)) {
    throw new ApiError('This needs approval from a manager or admin.', 403)
  }
  return row.full_name
}
