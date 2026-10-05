// Capture-only stand-in for src/database/sqlite.ts: the same exports, backed by sql.js
// (SQLite compiled to WebAssembly) so the real app runs in desktop Chromium with data.
import initSqlJs, { type Database } from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'

type Row = Record<string, unknown>
const clean = (values: unknown[] = []) =>
  values.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v)) as (string | number | null)[]

function rows(db: Database, statement: string, values: unknown[]): Row[] {
  const stmt = db.prepare(statement)
  try {
    stmt.bind(clean(values))
    const out: Row[] = []
    while (stmt.step()) out.push(stmt.getAsObject())
    return out
  } finally {
    stmt.free()
  }
}

class WebConnection {
  constructor(private db: Database) {}
  async open() {}
  async close() {}
  async query(statement: string, values: unknown[] = []) {
    return { values: rows(this.db, statement, values) }
  }
  async run(statement: string, values: unknown[] = []) {
    rows(this.db, statement, values)
    const lastId = Number(this.db.exec('SELECT last_insert_rowid() AS id')[0]?.values[0][0] ?? 0)
    return { changes: { changes: this.db.getRowsModified(), lastId } }
  }
  async execute(statements: string) {
    this.db.exec(statements)
    return { changes: { changes: this.db.getRowsModified() } }
  }
  async executeSet(set: { statement: string; values: unknown[] }[], transaction = true) {
    if (transaction) this.db.exec('BEGIN')
    try {
      for (const s of set) rows(this.db, s.statement, s.values)
      if (transaction) this.db.exec('COMMIT')
    } catch (e) {
      if (transaction) this.db.exec('ROLLBACK')
      throw e
    }
    return { changes: { changes: set.length } }
  }
  async isTransactionActive() { return { result: false } }
  async beginTransaction() { this.db.exec('BEGIN'); return {} }
  async commitTransaction() { this.db.exec('COMMIT'); return {} }
  async rollbackTransaction() { this.db.exec('ROLLBACK'); return {} }
}

let conn: WebConnection | null = null
let opening: Promise<WebConnection> | null = null

export async function initDatabase(): Promise<any> {
  if (conn) return conn
  opening ??= initSqlJs({ locateFile: () => wasmUrl }).then((SQL) => (conn = new WebConnection(new SQL.Database())))
  return opening
}
export async function closeDatabase() {}
export async function releaseDatabase() {}
export async function executeSQL(statement: string, values: any[] = []) {
  return (await initDatabase()).run(statement, values)
}
export async function querySQL(statement: string, values: any[] = []) {
  return (await initDatabase()).query(statement, values)
}
export async function testDatabase() {}
