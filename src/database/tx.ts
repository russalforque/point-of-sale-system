import { initDatabase, querySQL } from './sqlite'

/** One parameterised statement inside a multi-statement write. */
export type SqlStatement = { statement: string; values: unknown[] }

/**
 * Runs every statement in one real SQLite transaction (all or nothing). New rows whose id is
 * not known yet are referenced by a unique document number via sub-selects, the same pattern
 * salesApi.create has always used.
 */
export async function runTransaction(statements: SqlStatement[]): Promise<void> {
  if (statements.length === 0) return
  const db = await initDatabase()
  await db.executeSet(statements as { statement: string; values: any[] }[], true)
}

/**
 * Next human-readable document number, e.g. RF-000012. Based on MAX(id) so numbers never repeat
 * even though rows are never deleted; the column's UNIQUE constraint is the final guard.
 */
export async function nextDocumentNumber(table: string, prefix: string, pad = 6): Promise<string> {
  const result = await querySQL(`SELECT COALESCE(MAX(id), 0) + 1 AS next FROM ${table}`)
  const next = (result.values?.[0]?.next as number | undefined) ?? 1
  return `${prefix}-${String(next).padStart(pad, '0')}`
}

/** Row id of a freshly inserted document, looked up by its unique number after the transaction commits. */
export async function idByNumber(table: string, column: string, value: string): Promise<number | null> {
  const result = await querySQL(`SELECT id FROM ${table} WHERE ${column} = ? LIMIT 1`, [value])
  return (result.values?.[0]?.id as number | undefined) ?? null
}
