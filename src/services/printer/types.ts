import type { Sale, StoreSetting } from '../../types'

export type PrinterConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

/** Common thermal receipt paper widths, in millimeters. */
export type PrinterPaperWidth = 58 | 80

export type DiscoveredPrinter = {
  /** Stable identifier used to reconnect - the BLE device id on Android. */
  id: string
  name: string
  /** MAC address, when the transport exposes one (not all BLE stacks surface it). */
  address?: string
}

export type PrinterConfig = {
  deviceId: string | null
  deviceName: string | null
  paperWidth: PrinterPaperWidth
  autoOpenDrawerOnCash: boolean
  drawerPin: 0 | 1
  drawerOnMs: number
  drawerOffMs: number
}

export type PrinterStatusListener = (
  status: PrinterConnectionStatus,
  printer: DiscoveredPrinter | null,
) => void

/**
 * Everything the rest of the app needs from "a printer" - no Bluetooth/BLE types
 * leak past this boundary, so swapping the transport (Phase 3) never touches a
 * caller. Concrete implementations own connection lifecycle + actually sending
 * bytes; formatting the receipt is delegated to receiptFormatter.ts.
 */
export interface PrinterService {
  isBluetoothEnabled(): Promise<boolean>
  /** Calls onFound once per discovered device; resolves when the scan window ends. */
  scanPrinters(onFound: (printer: DiscoveredPrinter) => void, timeoutMs?: number): Promise<void>
  stopScan(): Promise<void>
  connect(printer: DiscoveredPrinter): Promise<void>
  disconnect(): Promise<void>
  getStatus(): PrinterConnectionStatus
  getConnectedPrinter(): DiscoveredPrinter | null
  onStatusChange(listener: PrinterStatusListener): () => void
  printReceipt(sale: Sale, settings: StoreSetting, config: PrinterConfig): Promise<void>
  testPrint(settings: StoreSetting, config: PrinterConfig): Promise<void>
  openCashDrawer(config: PrinterConfig): Promise<void>
}
