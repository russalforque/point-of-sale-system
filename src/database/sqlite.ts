import { Capacitor } from '@capacitor/core'
import {
  CapacitorSQLite,
  SQLiteConnection,
  SQLiteDBConnection,
} from '@capacitor-community/sqlite'

const sqlite = new SQLiteConnection(CapacitorSQLite)

let db: SQLiteDBConnection | null = null

export async function initDatabase(): Promise<SQLiteDBConnection> {
  if (db) {
    return db
  }

  if (!Capacitor.isNativePlatform()) {
    // The @capacitor-community/sqlite web implementation needs a <jeep-sqlite>
    // element registered in the DOM plus initWebStore() setup this project
    // doesn't ship - local SQLite is Android-only here. Fail fast with a
    // clear, catchable error instead of letting the native plugin throw its
    // "jeep-sqlite element is not present" error, so every existing caller's
    // try/catch (useAsync's error state, etc.) degrades gracefully instead of
    // crashing the page.
    throw new Error('SQLite is only available on the native Android app (no local database in web preview).')
  }

  const dbName = 'sellix_pos'

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