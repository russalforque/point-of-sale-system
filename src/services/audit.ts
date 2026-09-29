import type { SqlStatement } from '../database/tx'
import { executeSQL } from '../database/sqlite'
import { getStoredUser } from '../utils/session'

/**
 * Append-only audit trail (audit_logs). Rows can't be edited or deleted - database triggers
 * reject UPDATE/DELETE - and nothing in the app offers to.
 */
export const AUDIT_ACTIONS = {
  login: 'Login',
  logout: 'Logout',
  sale: 'Sale',
  discount: 'Discount override',
  refund: 'Refund',
  return: 'Return',
  void: 'Void',
  hold: 'Held order',
  price_change: 'Price change',
  product: 'Product change',
  stock_adjustment: 'Stock adjustment',
  stock_count: 'Stock count',
  restock: 'Restock',
  supplier: 'Supplier',
  shift_open: 'Shift opened',
  shift_close: 'Shift closed',
  cash_movement: 'Cash in / out',
  settings: 'Settings change',
  user: 'User management',
  backup: 'Backup',
  restore: 'Restore',
} as const

export type AuditAction = keyof typeof AUDIT_ACTIONS

export type AuditActor = { id: string | number; fullName: string }

type AuditEntity = { type: string; id: string | number }

function currentActor(): AuditActor {
  const user = getStoredUser()
  return user ? { id: user.id, fullName: user.fullName } : { id: '', fullName: 'System' }
}

/** Audit row to include in the same transaction as the change it describes. */
export function auditStatement(
  action: AuditAction,
  description: string,
  entity?: AuditEntity,
  actor: AuditActor = currentActor(),
  at = new Date().toISOString(),
): SqlStatement {
  return {
    statement: `INSERT INTO audit_logs (user_id, user_name, action, description, entity_type, entity_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    values: [
      String(actor.id),
      actor.fullName,
      action,
      description,
      entity?.type ?? null,
      entity ? String(entity.id) : null,
      at,
    ],
  }
}

/**
 * Standalone audit write for actions that have no transaction of their own (login, backup...).
 * Never throws: failing to log must not block the action that already happened.
 */
export async function logAudit(
  action: AuditAction,
  description: string,
  entity?: AuditEntity,
  actor?: AuditActor,
): Promise<void> {
  try {
    const { statement, values } = auditStatement(action, description, entity, actor)
    await executeSQL(statement, values)
  } catch (err) {
    console.warn('Audit log write failed', err)
  }
}
