import { registerPlugin } from '@capacitor/core'

import { SCHEMA_VERSION } from '../database/database'
import { initDatabase, releaseDatabase } from '../database/sqlite'
import { ApiError } from '../utils/errors'
import { clearSession, getStoredUser } from '../utils/session'
import { logAudit } from './audit'

/**
 * A restore replaces the database, so its audit entry is written into the restored copy on the
 * next start (see recordPendingRestoreAudit), attributed to whoever confirmed it.
 */
const PENDING_RESTORE_KEY = 'sellix.pendingRestoreAudit'

type PendingRestore = { userId: string; userName: string; backupName: string; backupDate: string | null; at: string }

export async function recordPendingRestoreAudit(): Promise<void> {
  let pending: PendingRestore | null = null
  try {
    const raw = localStorage.getItem(PENDING_RESTORE_KEY)
    pending = raw ? (JSON.parse(raw) as PendingRestore) : null
    localStorage.removeItem(PENDING_RESTORE_KEY)
  } catch {
    return
  }
  if (!pending) return
  await logAudit(
    'restore',
    `Restored backup ${pending.backupName}${pending.backupDate ? ` (from ${pending.backupDate})` : ''} at ${pending.at}`,
    undefined,
    { id: pending.userId, fullName: pending.userName },
  )
}

/**
 * Backup & restore of the local SQLite database as a `.sellix` file.
 * Native side: android/app/src/main/java/com/sellix/pos/backup/SellixBackupPlugin.java
 */

type Picked = { cancelled: true } | { cancelled: false; uri: string; name: string }

export type BackupInfo = { lastBackupAt: string | null; lastBackupName: string | null }

export type BackupResult = { createdAt: string; name: string; size: number }

export type RestoreCandidate = {
  name: string
  createdAt: string | null
  appVersion: string | null
  databaseVersion: number
  products: number
  sales: number
}

interface SellixBackupPlugin {
  getInfo(): Promise<BackupInfo>
  prepareSnapshot(): Promise<{ path: string }>
  pickBackupLocation(options: { fileName: string }): Promise<Picked>
  writeBackup(options: { uri: string; schemaVersion: number }): Promise<BackupResult>
  pickRestoreFile(options: { maxSchemaVersion: number }): Promise<({ cancelled: true } | ({ cancelled: false } & RestoreCandidate))>
  applyRestore(): Promise<void>
  discardRestore(): Promise<void>
}

const SellixBackup = registerPlugin<SellixBackupPlugin>('SellixBackup')

/** Native rejections already carry a user-facing message; surface it through the app's ApiError path. */
async function native<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action()
  } catch (err) {
    const message = err instanceof Error && err.message ? err.message : 'Something went wrong. Please try again.'
    throw new ApiError(message, 0)
  }
}

/** e.g. Sellix_Backup_2026-09-24_2200.sellix (local time). */
function backupFileName(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  return `Sellix_Backup_${date}_${pad(now.getHours())}${pad(now.getMinutes())}.sellix`
}

/**
 * Consistent copy of the live database via the existing connection. Queued behind any
 * in-flight plugin calls, and it sees exactly the committed data (WAL included).
 */
async function snapshotDatabase(): Promise<void> {
  const db = await initDatabase()
  const active = await db.isTransactionActive()
  if (active.result) {
    throw new ApiError('A sale or update is still being saved. Wait a moment and try again.', 0)
  }
  const { path } = await native(() => SellixBackup.prepareSnapshot())
  try {
    await db.execute(`VACUUM INTO '${path.replace(/'/g, "''")}'`, false)
  } catch {
    throw new ApiError('Couldn’t read the database to back it up. Try again.', 0)
  }
}

export const backupService = {
  getInfo: () => native(() => SellixBackup.getInfo()),

  /** Returns null when the user closes the file picker. */
  async createBackup(): Promise<BackupResult | null> {
    const location = await native(() => SellixBackup.pickBackupLocation({ fileName: backupFileName() }))
    if (location.cancelled) return null

    await snapshotDatabase()
    const result = await native(() => SellixBackup.writeBackup({ uri: location.uri, schemaVersion: SCHEMA_VERSION }))
    await logAudit('backup', `Backup saved as ${result.name}`)
    return result
  },

  /** Lets the user pick a file and fully validates it. Nothing is replaced yet. Null when cancelled. */
  async pickRestore(): Promise<RestoreCandidate | null> {
    const picked = await native(() => SellixBackup.pickRestoreFile({ maxSchemaVersion: SCHEMA_VERSION }))
    return picked.cancelled ? null : picked
  },

  discardRestore: () => native(() => SellixBackup.discardRestore()),

  /**
   * Replaces the live database with the validated backup, then reloads the app so every screen,
   * context and the SQLite connection start fresh (startApp re-runs schema migrations and seeding).
   */
  async applyRestore(candidate?: RestoreCandidate): Promise<void> {
    const db = await initDatabase()
    const active = await db.isTransactionActive()
    if (active.result) {
      throw new ApiError('A sale or update is still being saved. Wait a moment and try again.', 0)
    }

    // The file must not be replaced under an open connection - stop here if closing fails.
    try {
      await releaseDatabase()
    } catch {
      throw new ApiError('Couldn’t close the database to restore. Restart the app and try again.', 0)
    }

    try {
      await native(() => SellixBackup.applyRestore())
    } catch (err) {
      // Current data is untouched; reconnect so the app keeps working.
      await initDatabase().catch(() => undefined)
      throw err
    }

    const user = getStoredUser()
    try {
      const pending: PendingRestore = {
        userId: user?.id ?? '',
        userName: user?.fullName ?? 'Unknown user',
        backupName: candidate?.name ?? 'backup file',
        backupDate: candidate?.createdAt ?? null,
        at: new Date().toISOString(),
      }
      localStorage.setItem(PENDING_RESTORE_KEY, JSON.stringify(pending))
    } catch {
      // The restore itself already succeeded; only its audit entry is lost.
    }

    // Accounts come from the restored data, so the current sign-in may no longer be valid.
    clearSession()
    window.location.reload()
  },
}
