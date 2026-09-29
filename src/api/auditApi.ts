import type { AuditLog, PagedResult } from '../types'
import { querySQL } from '../database/sqlite'
import { AUDIT_ACTIONS, type AuditAction } from '../services/audit'

type AuditRow = {
  id: number
  user_id: string | null
  user_name: string
  action: string
  description: string
  entity_type: string | null
  entity_id: string | null
  created_at: string
}

/** Read-only access to the audit trail. There is intentionally no update or delete. */
export const auditApi = {
  list: async (params: {
    search?: string
    action?: AuditAction | ''
    page?: number
    pageSize?: number
  }): Promise<PagedResult<AuditLog>> => {
    const clauses: string[] = []
    const values: unknown[] = []

    if (params.search) {
      clauses.push('(description LIKE ? OR user_name LIKE ?)')
      const term = `%${params.search}%`
      values.push(term, term)
    }
    if (params.action) {
      clauses.push('action = ?')
      values.push(params.action)
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    const page = params.page ?? 1
    const pageSize = params.pageSize ?? 25

    const countResult = await querySQL(`SELECT COUNT(*) AS count FROM audit_logs ${where}`, values)
    const totalCount = (countResult.values?.[0]?.count as number | undefined) ?? 0

    const result = await querySQL(
      `SELECT * FROM audit_logs ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
      [...values, pageSize, (page - 1) * pageSize],
    )

    const items = ((result.values ?? []) as AuditRow[]).map((row) => ({
      id: row.id,
      userId: row.user_id,
      userName: row.user_name,
      action: row.action,
      actionLabel: AUDIT_ACTIONS[row.action as AuditAction] ?? row.action,
      description: row.description,
      entityType: row.entity_type,
      entityId: row.entity_id,
      createdAt: row.created_at,
    }))

    return { items, totalCount, page, pageSize, totalPages: Math.max(1, Math.ceil(totalCount / pageSize)) }
  },
}
