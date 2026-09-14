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