import { Capacitor } from '@capacitor/core'
import { isDesktop } from '../services/platform'
import { desktopDatabase } from './desktop'
import type { LocalConnection } from './connection'
import {
  CapacitorSQLite,
  SQLiteConnection,
} from '@capacitor-community/sqlite'

const sqlite = new SQLiteConnection(CapacitorSQLite)

let db: LocalConnection | null = null
let opening: Promise<LocalConnection> | null = null
let restoring = false

// The file on disk is `${DB_NAME}SQLite.db` - SellixBackupPlugin.java relies on that name.
const DB_NAME = 'sellix_pos'

export async function initDatabase(): Promise<LocalConnection> {
  if (restoring) throw new Error('A database restore is in progress. Wait for Sellix to restart.')
  if (opening) return opening
  opening = openDatabase().catch(error => {
    db = null
    throw error
  }).finally(() => { opening = null })
  return opening
}

async function openDatabase(): Promise<LocalConnection> {
  if (db) {
    return db
  }

  if (isDesktop()) {
    await desktopDatabase.open()
    db = desktopDatabase
    return db
  }

  if (!Capacitor.isNativePlatform()) {
    // The @capacitor-community/sqlite web implementation needs a <jeep-sqlite>
    // element registered in the DOM plus initWebStore() setup this project
    // doesn't ship. The native Windows adapter was already selected above. Fail fast with a
    // clear, catchable error instead of letting the native plugin throw its
    // "jeep-sqlite element is not present" error, so every existing caller's
    // try/catch (useAsync's error state, etc.) degrades gracefully instead of
    // crashing the page.
    throw new Error('Open Sellix on Windows or Android to use the local database. Web preview has no production database.')
  }

  const dbName = DB_NAME

  try {
    const consistency = await sqlite.checkConnectionsConsistency()
    const isConnected = await sqlite.isConnection(dbName, false)

    if (consistency.result && isConnected.result) {
      db = await sqlite.retrieveConnection(dbName, false)
    } else {
      db = await sqlite.createConnection(
        dbName,
        false,
        'no-encryption',
        1,
        false,
      )
    }

    await db.open()
    await db.execute('PRAGMA foreign_keys = ON;', false)

    console.log('SQLite database opened successfully')

    return db
  } catch (error) {
    console.error('Failed to initialize SQLite:', error)
    throw error
  }
}

export async function closeDatabase(): Promise<void> {
  if (!db) {
    return
  }

  try {
    await db.close()
    db = null

    console.log('SQLite database closed')
  } catch (error) {
    console.error('Failed to close SQLite database:', error)
    throw error
  }
}

/**
 * Closes and unregisters the native connection so the database file can be replaced
 * (backup restore). The next initDatabase() call opens a fresh connection.
 */
export async function releaseDatabase(): Promise<void> {
  if (isDesktop()) {
    await closeDatabase()
    return
  }
  db = null

  const isConnected = await sqlite.isConnection(DB_NAME, false)
  if (isConnected.result) {
    await sqlite.closeConnection(DB_NAME, false)
  }
}

/** Stops new SQL callers from reopening the file between close, replacement and reload. */
export async function suspendForRestore(): Promise<void> {
  if (restoring) throw new Error('A restore is already in progress.')
  restoring = true
  try {
    await opening
    await releaseDatabase()
  } catch (error) {
    restoring = false
    throw error
  }
}

export function resumeAfterFailedRestore(): void {
  restoring = false
}

export async function executeSQL(
  statement: string,
  values: any[] = [],
) {
  const database = await initDatabase()

  return database.run(statement, values)
}

export async function querySQL(
  statement: string,
  values: any[] = [],
) {
  const database = await initDatabase()

  return database.query(statement, values)
}

export async function testDatabase(): Promise<void> {
  const database = await initDatabase()

  await database.execute(`
    CREATE TABLE IF NOT EXISTS sellix_test (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message TEXT NOT NULL
    );
  `)

  await database.run(
    'INSERT INTO sellix_test (message) VALUES (?)',
    ['SQLite is working'],
  )

  const result = await database.query(
    'SELECT * FROM sellix_test',
  )

  console.log('SQLite test result:', result.values)
}
