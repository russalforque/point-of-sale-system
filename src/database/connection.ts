/** The subset of the Capacitor connection shared by both native adapters. */
export interface LocalConnection {
  open(): Promise<void>
  close(): Promise<void>
  query(statement: string, values?: any[]): Promise<{ values?: any[] }>
  run(statement: string, values?: any[], transaction?: boolean): Promise<Changes>
  execute(statement: string, transaction?: boolean): Promise<Changes>
  executeSet(statements: { statement: string; values?: any[] }[], transaction?: boolean): Promise<Changes>
  isTransactionActive(): Promise<{ result?: boolean }>
  beginTransaction(): Promise<Changes>
  commitTransaction(): Promise<Changes>
  rollbackTransaction(): Promise<Changes>
}

export type Changes = { changes?: { changes?: number; lastId?: number } }
