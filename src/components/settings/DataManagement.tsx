import { useState } from 'react'
import { Capacitor } from '@capacitor/core'

import { PrimaryButton } from '../ui/MobileKit'
import { ConfirmDialog } from '../ui/Modal'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { useAsync } from '../../hooks/useAsync'
import { backupService, type RestoreCandidate } from '../../services/backup'
import { getErrorMessage } from '../../utils/errors'
import { formatLongDateTime } from '../../utils/format'

/**
 * Backup Now / Restore Backup for the local SQLite database. Renders only the section body so
 * mobile and desktop Settings can wrap it in their own section container.
 */
export function DataManagement() {
  const { notify } = useToast()
  const { can } = useAuth()
  const supported = Capacitor.isNativePlatform()
  const canManage = can('backup.manage')

  const info = useAsync(() => (supported ? backupService.getInfo() : Promise.resolve(null)), [supported])
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(null)
  const [busy, setBusy] = useState<'backup' | 'checking' | 'restoring' | null>(null)
  const [candidate, setCandidate] = useState<RestoreCandidate | null>(null)

  const lastBackup = lastBackupAt ?? info.data?.lastBackupAt ?? null

  if (!supported) {
    return <p className="rounded-2xl bg-[#F6F8F7] px-4 py-3 text-sm text-slate-500">Backup and restore are only available in the Android app.</p>
  }
  if (!canManage) {
    return <p className="rounded-2xl bg-[#F6F8F7] px-4 py-3 text-sm text-slate-500">Only admins can back up or restore store data.</p>
  }

  async function backupNow() {
    setBusy('backup')
    try {
      const result = await backupService.createBackup()
      if (!result) return
      setLastBackupAt(result.createdAt)
      notify(`Backup saved as ${result.name}.`)
    } catch (err) {
      notify(getErrorMessage(err), 'error')
    } finally {
      setBusy(null)
    }
  }

  async function chooseRestoreFile() {
    setBusy('checking')
    try {
      const picked = await backupService.pickRestore()
      if (picked) setCandidate(picked)
    } catch (err) {
      notify(getErrorMessage(err), 'error')
    } finally {
      setBusy(null)
    }
  }

  function cancelRestore() {
    setCandidate(null)
    void backupService.discardRestore().catch(() => undefined)
  }

  async function confirmRestore() {
    setBusy('restoring')
    try {
      // Reloads the app on success.
      await backupService.applyRestore(candidate ?? undefined)
    } catch (err) {
      setCandidate(null)
      setBusy(null)
      notify(getErrorMessage(err), 'error')
    }
  }

  const count = (value: number, noun: string) => `${value.toLocaleString('en-PH')} ${noun}${value === 1 ? '' : 's'}`

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-[#F6F8F7] p-4">
        <p className="text-sm font-medium">Database</p>
        <p className="mt-0.5 text-sm text-slate-500" aria-live="polite">
          Last backup: <span className="font-medium text-[#091413]">{lastBackup ? formatLongDateTime(lastBackup) : info.loading ? '…' : 'Never'}</span>
        </p>
        <p className="mt-2 text-xs text-slate-500">
          Save the .sellix file somewhere off this device, like Google Drive, so you can recover if the phone is lost.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <PrimaryButton onClick={() => void backupNow()} disabled={busy !== null} className="h-12 w-full">
          {busy === 'backup' ? 'Backing up…' : 'Back up now'}
        </PrimaryButton>
        <button
          type="button"
          onClick={() => void chooseRestoreFile()}
          disabled={busy !== null}
          className="h-12 w-full rounded-2xl bg-[#F3F5F4] text-[15px] font-medium transition active:scale-[0.99] disabled:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B]"
        >
          {busy === 'checking' ? 'Checking backup…' : 'Restore backup'}
        </button>
      </div>

      {candidate && (
        <ConfirmDialog
          title="Replace all data with this backup?"
          message={
            `Backup from ${candidate.createdAt ? formatLongDateTime(candidate.createdAt) : 'an unknown date'}` +
            ` (${count(candidate.products, 'product')}, ${count(candidate.sales, 'sale')}).` +
            ' Everything currently on this device — sales, products, customers, users and settings — will be replaced and can’t be recovered unless you back it up first.' +
            ' You’ll sign in again afterwards.'
          }
          confirmLabel={busy === 'restoring' ? 'Restoring…' : 'Replace data'}
          danger
          busy={busy === 'restoring'}
          onCancel={cancelRestore}
          onConfirm={() => void confirmRestore()}
        />
      )}
    </div>
  )
}
