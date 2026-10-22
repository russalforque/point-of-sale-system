import { desktopInvoke } from '../services/platform'
import type { LocalConnection, Changes } from './connection'

const call = <T>(operation: string, args: Record<string, unknown> = {}) =>
  desktopInvoke<T>('database', { operation, ...args })

/** One native SQLite connection in AppData. executeSet owns its entire native transaction. */
export const desktopDatabase: LocalConnection = {
  open: () => call<void>('open'),
  close: () => call<void>('close'),
  query: (statement, values = []) => call('query', { statement, values }),
  run: (statement, values = [], transaction = true) => call<Changes>('run', { statement, values, transaction }),
  execute: (statement, transaction = true) => call<Changes>('execute', { statement, transaction }),
  executeSet: (statements, transaction = true) => call<Changes>('set', { statements, transaction }),
  isTransactionActive: () => call('active'),
  beginTransaction: () => call('begin'),
  commitTransaction: () => call('commit'),
  rollbackTransaction: () => call('rollback'),
}
