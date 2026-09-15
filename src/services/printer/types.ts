import type { Sale, StoreSetting } from '../../types'

export type PrinterConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

/** Whether Bluetooth printing can be used at all right now, independent of any printer. */
export type PrinterAvailability = 'ready' | 'bluetooth-off' | 'permission-denied' | 'unsupported'

/** Common thermal receipt paper widths, in millimeters. */
export type PrinterPaperWidth = 58 | 80

/** How the printer is attached to the Android device. */
export type PrinterConnectionType = 'bluetooth' | 'usb'

export type DiscoveredPrinter = {
  /** Stable identifier used to reconnect: the MAC address (Bluetooth) or "vendorId:productId" (USB). */
  id: string
  name: string
  /** Secondary line shown under the name (MAC address, USB ids…). */
  address?: string
  /** Defaults to Bluetooth when omitted (older saved configs). */
  type?: PrinterConnectionType
  /** Bonded in Android Bluetooth settings. */
  paired?: boolean
  /** Name or device class suggests a printer - used to sort it to the top. */
  likelyPrinter?: boolean
}

export type PrinterConfig = {
  /** Connection type of the saved printer. */
  connectionType: PrinterConnectionType
  deviceId: string | null
  deviceName: string | null
  paperWidth: PrinterPaperWidth
  /** Send the paper-cut command. Off by default - the POS-5890U-L and most 58mm printers have no cutter. */
  autoCut: boolean
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
 * Everything the rest of the app needs from "a printer" - no Bluetooth/USB types leak past
 * this boundary, so the transport can change without touching checkout, reprint or settings.
 * Concrete implementations own the connection lifecycle and sending bytes; formatting the
 * receipt is delegated to receiptFormatter.ts.
 */
export interface PrinterService {
  isBluetoothEnabled(): Promise<boolean>
  /** Requests Bluetooth permission if needed, then reports adapter/permission state. */
  getAvailability(): Promise<PrinterAvailability>
  /** Shows Android's "turn on Bluetooth" prompt; resolves with whether Bluetooth is now on. */
  requestEnableBluetooth(): Promise<boolean>
  /** Whether nearby-device discovery can run (Android 11 and older need Location). Resolves true when unknown. */
  isLocationEnabled(): Promise<boolean>
  /** Printers already paired in Android Bluetooth settings. */
  listPairedPrinters(): Promise<DiscoveredPrinter[]>
  /**
   * Calls onFound once per discovered device (and again for the same id if its details change);
   * resolves when the scan window ends or stopScan() is called.
   */
  scanPrinters(onFound: (printer: DiscoveredPrinter) => void, timeoutMs?: number): Promise<void>
  stopScan(): Promise<void>
  /** USB printers currently attached (Android app only; empty elsewhere). */
  listUsbPrinters(): Promise<DiscoveredPrinter[]>
  /** Fires when a USB device is plugged in or removed. */
  onUsbDevicesChanged(listener: () => void): () => void
  connect(printer: DiscoveredPrinter): Promise<void>
  disconnect(): Promise<void>
  getStatus(): PrinterConnectionStatus
  getConnectedPrinter(): DiscoveredPrinter | null
  onStatusChange(listener: PrinterStatusListener): () => void
  printReceipt(sale: Sale, settings: StoreSetting, config: PrinterConfig): Promise<void>
  testPrint(settings: StoreSetting, config: PrinterConfig): Promise<void>
  openCashDrawer(config: PrinterConfig): Promise<void>
}
