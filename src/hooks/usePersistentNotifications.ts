import { useEffect, useMemo, useState } from 'react'

import { useAuth } from '../context/AuthContext'

type StoredNotificationState = {
  read: string[]
  dismissed: string[]
}

const STORAGE_PREFIX = 'sellix.notifications'
const EMPTY_STATE: StoredNotificationState = { read: [], dismissed: [] }

function storageKey(userId: unknown): string {
  return `${STORAGE_PREFIX}.${userId ?? 'guest'}`
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function loadState(key: string): StoredNotificationState {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return EMPTY_STATE
    const parsed = JSON.parse(raw) as Partial<StoredNotificationState>
    return {
      read: isStringArray(parsed.read) ? parsed.read : [],
      dismissed: isStringArray(parsed.dismissed) ? parsed.dismissed : [],
    }
  } catch {
    return EMPTY_STATE
  }
}

function saveState(key: string, state: StoredNotificationState) {
  try {
    localStorage.setItem(key, JSON.stringify(state))
  } catch {
    // Storage unavailable (private mode / quota) — state simply won't persist.
  }
}

/**
 * Dashboard notifications are generated from live data on every load, so their
 * read / dismissed state has to live outside component state to survive a refresh
 * or navigation. This keeps it in localStorage per signed-in user.
 *
 * Stored IDs whose alert no longer exists (e.g. a product was restocked) are pruned,
 * so if the same alert happens again later it shows as new.
 *
 * @param generated Notifications derived from the latest data, all with `read: false`.
 * @param ready     True once data has loaded — pruning is skipped until then.
 */
export function usePersistentNotifications<T extends { id: string; read: boolean }>(generated: T[], ready: boolean) {
  const { user } = useAuth()
  const key = storageKey(user?.id)

  const [stored, setStored] = useState<StoredNotificationState>(() => loadState(key))

  // Switch to the right user's saved state after a login change.
  useEffect(() => {
    setStored(loadState(key))
  }, [key])

  function update(change: (previous: StoredNotificationState) => StoredNotificationState) {
    setStored((previous) => {
      const next = change(previous)
      if (next !== previous) saveState(key, next)
      return next
    })
  }

  // Forget IDs for alerts that no longer exist.
  useEffect(() => {
    if (!ready) return
    const currentIds = new Set(generated.map((notification) => notification.id))
    update((previous) => {
      const read = previous.read.filter((id) => currentIds.has(id))
      const dismissed = previous.dismissed.filter((id) => currentIds.has(id))
      return read.length === previous.read.length && dismissed.length === previous.dismissed.length
        ? previous
        : { read, dismissed }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generated, ready, key])

  const notifications = useMemo(() => {
    const readIds = new Set(stored.read)
    const dismissedIds = new Set(stored.dismissed)
    return generated
      .filter((notification) => !dismissedIds.has(notification.id))
      .map((notification) => (readIds.has(notification.id) ? { ...notification, read: true } : notification))
  }, [generated, stored])

  function markAsRead(id: string) {
    update((previous) => (previous.read.includes(id) ? previous : { ...previous, read: [...previous.read, id] }))
  }

  function markAllAsRead() {
    update((previous) => {
      const unread = notifications.map((n) => n.id).filter((id) => !previous.read.includes(id))
      return unread.length === 0 ? previous : { ...previous, read: [...previous.read, ...unread] }
    })
  }

  function dismiss(id: string) {
    update((previous) =>
      previous.dismissed.includes(id) ? previous : { ...previous, dismissed: [...previous.dismissed, id] },
    )
  }

  function clearAll() {
    update((previous) => {
      const toDismiss = generated.map((n) => n.id).filter((id) => !previous.dismissed.includes(id))
      return toDismiss.length === 0 ? previous : { ...previous, dismissed: [...previous.dismissed, ...toDismiss] }
    })
  }

  return { notifications, markAsRead, markAllAsRead, dismiss, clearAll }
}
