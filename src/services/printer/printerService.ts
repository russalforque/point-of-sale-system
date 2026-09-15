import { Capacitor } from '@capacitor/core'

import { BluetoothPrinterService } from './bluetoothPrinter'
import { PrinterError } from './errors'
import { NativePrinterService } from './nativePrinterService'
import type { PrinterService } from './types'
import { getPrinterConfig } from '../../utils/printerConfig'

let instance: PrinterService | null = null

/**
 * Single access point the rest of the app uses to reach the printer. Callers only depend
 * on the PrinterService interface:
 * - Android app: NativePrinterService - Bluetooth Classic (SPP) and USB through the
 *   app-local SellixPrinter plugin. This is what POS-5890-series printers need.
 * - Browser preview: the Web Bluetooth (BLE) service, for development only.
 */
export function getPrinterService(): PrinterService {
  if (!instance) {
    instance = Capacitor.getPlatform() === 'android' ? new NativePrinterService() : new BluetoothPrinterService()
  }
  return instance
}

/**
 * Makes sure the saved printer is connected, reconnecting if needed, and throws a
 * PrinterError explaining why when it can't (no printer saved, Bluetooth off, permission
 * denied, printer off/unplugged). Used before printing so a rebooted or backgrounded
 * tablet doesn't need a trip through Settings before the next sale can print.
 * It makes exactly one attempt - it never retries on its own.
 */
export async function ensurePrinterConnected(): Promise<void> {
  const service = getPrinterService()
  if (service.getStatus() === 'connected') return

  const config = getPrinterConfig()
  if (!config.deviceId) throw new PrinterError('no-printer-selected')

  await service.connect({
    id: config.deviceId,
    name: config.deviceName ?? 'Saved printer',
    type: config.connectionType,
  })
}

/**
 * Best-effort silent version of ensurePrinterConnected, used when Printer settings
 * opens. Failures are logged by the service and reflected in its status, not thrown.
 */
export async function connectSavedPrinter(): Promise<boolean> {
  try {
    await ensurePrinterConnected()
    return true
  } catch {
    return false
  }
}
