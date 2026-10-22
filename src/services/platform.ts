import { Capacitor } from '@capacitor/core'
import { invoke, isTauri } from '@tauri-apps/api/core'

/** Desktop is a native Tauri window; an ordinary browser never gets native privileges. */
export function isDesktop(): boolean {
  return typeof window !== 'undefined' && isTauri()
}

export function hasLocalDatabase(): boolean {
  return isDesktop() || Capacitor.isNativePlatform()
}

export function platformName(): 'windows' | 'android' | 'web' {
  return isDesktop() ? 'windows' : Capacitor.getPlatform() === 'android' ? 'android' : 'web'
}

/** Only the packaged local window can invoke these narrowly scoped native commands. */
export async function desktopInvoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!isDesktop()) throw new Error('This action requires the Windows desktop application.')
  try {
    return await invoke<T>(command, args)
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error))
  }
}
