import { BluetoothPrinterService } from './bluetoothPrinter'
import type { PrinterService } from './types'
import { getPrinterConfig } from '../../utils/printerConfig'

let instance: PrinterService | null = null

/**
 * Single access point the rest of the app should use to reach the printer.
 * Everything downstream only ever depends on the PrinterService interface, so
 * the concrete transport (currently BLE via @capacitor-community/bluetooth-le)
 * can be swapped here without touching any caller.
 */
export function getPrinterService(): PrinterService {
  if (!instance) instance = new BluetoothPrinterService()
  return instance
}

/**
 * Attempts a silent reconnect to whichever printer was last saved locally.
 * Used both by the Printer Settings page (on open) and by checkout (before
 * printing a receipt), so a tablet that was rebooted or backgrounded doesn't
 * need a trip through Settings before the next sale can print. Failures are
 * swallowed - this is a best-effort convenience, not a user-facing action.
 */
export async function connectSavedPrinter(): Promise<boolean> {
  const config = getPrinterConfig()
  if (!config.deviceId) return false

  const service = getPrinterService()
  if (service.getStatus() === 'connected') return true

  try {
    await service.connect({ id: config.deviceId, name: config.deviceName ?? 'Saved printer' })
    return true
  } catch {
    return false
  }
}
