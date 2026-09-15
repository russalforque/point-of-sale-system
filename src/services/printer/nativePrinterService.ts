import { buildDrawerKickCommand } from './cashDrawer'
import { logPrinterError, PrinterError, type PrinterErrorCode } from './errors'
import { SellixPrinter, type NativeBluetoothDevice } from './nativePrinter'
import { buildReceipt, buildTestReceipt } from './receiptFormatter'
import type {
  DiscoveredPrinter,
  PrinterAvailability,
  PrinterConfig,
  PrinterConnectionStatus,
  PrinterService,
  PrinterStatusListener,
} from './types'
import type { Sale, StoreSetting } from '../../types'

/** Error codes rejected by SellixPrinterPlugin.java, mapped to cashier-facing messages. */
const NATIVE_ERROR_CODES: Record<string, PrinterErrorCode> = {
  UNSUPPORTED: 'bluetooth-unsupported',
  PERMISSION_DENIED: 'bluetooth-permission-denied',
  LOCATION_PERMISSION_DENIED: 'location-permission-denied',
  BLUETOOTH_DISABLED: 'bluetooth-disabled',
  SCAN_FAILED: 'scan-failed',
  INVALID_ADDRESS: 'printer-unavailable',
  CONNECT_FAILED: 'printer-unavailable',
  USB_UNSUPPORTED: 'usb-unsupported',
  USB_NOT_FOUND: 'usb-not-found',
  USB_PERMISSION_DENIED: 'usb-permission-denied',
  USB_OPEN_FAILED: 'usb-open-failed',
  NOT_CONNECTED: 'not-connected',
  WRITE_FAILED: 'printer-disconnected',
  INVALID_DATA: 'print-failed',
}

function toPrinterError(error: unknown, fallback: PrinterErrorCode): PrinterError {
  if (error instanceof PrinterError) return error
  const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code?: unknown }).code) : ''
  return new PrinterError(NATIVE_ERROR_CODES[code] ?? fallback, error)
}

const log = (message: string, detail?: unknown) =>
  detail === undefined ? console.info(`[PRINTER] ${message}`) : console.info(`[PRINTER] ${message}`, detail)

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return btoa(binary)
}

function toPrinter(device: NativeBluetoothDevice): DiscoveredPrinter {
  return {
    id: device.id,
    name: device.name || device.address,
    address: device.address,
    type: 'bluetooth',
    paired: device.paired,
    likelyPrinter: device.likelyPrinter,
  }
}

/**
 * Android printer transport: Bluetooth Classic (SPP) and USB through SellixPrinterPlugin.
 * Everything talks to the printer directly - it works with no internet and no API server.
 */
export class NativePrinterService implements PrinterService {
  private status: PrinterConnectionStatus = 'disconnected'
  private connectedPrinter: DiscoveredPrinter | null = null
  private listeners = new Set<PrinterStatusListener>()
  private usbListeners = new Set<() => void>()
  private connectInFlight: { key: string; promise: Promise<void> } | null = null
  private jobInFlight = false
  private endScan: (() => void) | null = null
  private ready: Promise<void> | null = null

  constructor() {
    void this.ensureReady()
  }

  /** Subscribes to native events once, and adopts a connection that survived a WebView reload. */
  private ensureReady(): Promise<void> {
    if (!this.ready) {
      this.ready = (async () => {
        await SellixPrinter.addListener('connectionLost', (event) => {
          if (this.connectedPrinter && (event.id === null || event.id === this.connectedPrinter.id)) {
            log(`Disconnected (${event.reason})`)
            this.setStatus('disconnected', null)
          }
        })
        await SellixPrinter.addListener('usbDevicesChanged', () => this.usbListeners.forEach((listener) => listener()))

        const state = await SellixPrinter.getConnectionState()
        if (state.connected && state.id && state.type && this.status === 'disconnected') {
          this.setStatus('connected', { id: state.id, name: state.name ?? 'Printer', type: state.type })
        }
      })().catch((error: unknown) => {
        logPrinterError('native plugin setup', error)
        this.ready = null
      })
    }
    return this.ready
  }

  private setStatus(status: PrinterConnectionStatus, printer: DiscoveredPrinter | null = this.connectedPrinter) {
    this.status = status
    this.connectedPrinter = printer
    this.listeners.forEach((listener) => listener(status, printer))
  }

  /* ------------------------------------------------------------------
     BLUETOOTH AVAILABILITY
  ------------------------------------------------------------------ */

  async isBluetoothEnabled(): Promise<boolean> {
    try {
      return (await SellixPrinter.getBluetoothState()).enabled
    } catch {
      return false
    }
  }

  async getAvailability(): Promise<PrinterAvailability> {
    try {
      await this.ensureReady()
      let state = await SellixPrinter.getBluetoothState()
      if (!state.supported) return 'unsupported'
      if (!state.permissionGranted) {
        const result = await SellixPrinter.requestBluetoothPermissions()
        if (!result.granted) return 'permission-denied'
        state = await SellixPrinter.getBluetoothState()
      }
      return state.enabled ? 'ready' : 'bluetooth-off'
    } catch (error) {
      logPrinterError('bluetooth availability', error)
      return 'unsupported'
    }
  }

  async requestEnableBluetooth(): Promise<boolean> {
    try {
      return (await SellixPrinter.requestEnableBluetooth()).enabled
    } catch (error) {
      throw toPrinterError(error, 'bluetooth-disabled')
    }
  }

  async isLocationEnabled(): Promise<boolean> {
    try {
      return (await SellixPrinter.getBluetoothState()).locationGranted
    } catch {
      return true
    }
  }

  /* ------------------------------------------------------------------
     DISCOVERY
  ------------------------------------------------------------------ */

  async listPairedPrinters(): Promise<DiscoveredPrinter[]> {
    try {
      const { devices } = await SellixPrinter.listPairedDevices()
      return devices.map(toPrinter)
    } catch (error) {
      throw toPrinterError(error, 'scan-failed')
    }
  }

  /** Reports paired printers immediately, then any nearby unpaired devices until the scan window ends. */
  async scanPrinters(onFound: (printer: DiscoveredPrinter) => void, timeoutMs = 12000): Promise<void> {
    await this.ensureReady()
    this.endScan?.()
    log('Searching...')

    const paired = await this.listPairedPrinters()
    paired.forEach(onFound)

    let finish: () => void = () => {}
    const done = new Promise<void>((resolve) => {
      finish = resolve
    })

    const foundHandle = await SellixPrinter.addListener('bluetoothDeviceFound', (device) => onFound(toPrinter(device)))
    const finishedHandle = await SellixPrinter.addListener('bluetoothDiscoveryFinished', () => finish())
    const timer = setTimeout(() => finish(), timeoutMs)
    this.endScan = () => finish()

    try {
      try {
        await SellixPrinter.startDiscovery()
      } catch (error) {
        const mapped = toPrinterError(error, 'scan-failed')
        // Paired printers were already listed; only fail loudly when there is nothing to offer.
        if (paired.length === 0) throw mapped
        logPrinterError('discovery (paired printers still listed)', error)
        finish()
      }
      await done
    } finally {
      clearTimeout(timer)
      this.endScan = null
      await Promise.all([foundHandle.remove(), finishedHandle.remove()])
      await SellixPrinter.stopDiscovery().catch(() => {})
    }
  }

  async stopScan(): Promise<void> {
    this.endScan?.()
  }

  async listUsbPrinters(): Promise<DiscoveredPrinter[]> {
    try {
      const { supported, devices } = await SellixPrinter.listUsbDevices()
      if (!supported) throw new PrinterError('usb-unsupported')
      return devices.map((device) => ({
        id: device.id,
        name: device.name,
        address: `USB ${device.vendorId.toString(16).padStart(4, '0').toUpperCase()}:${device.productId.toString(16).padStart(4, '0').toUpperCase()}${
          device.hasPermission ? '' : ' · permission needed'
        }`,
        type: 'usb' as const,
        likelyPrinter: device.isPrinterClass,
      }))
    } catch (error) {
      throw toPrinterError(error, 'usb-unsupported')
    }
  }

  onUsbDevicesChanged(listener: () => void): () => void {
    void this.ensureReady()
    this.usbListeners.add(listener)
    return () => this.usbListeners.delete(listener)
  }

  /* ------------------------------------------------------------------
     CONNECTION
  ------------------------------------------------------------------ */

  connect(printer: DiscoveredPrinter): Promise<void> {
    const type = printer.type ?? 'bluetooth'
    if (this.status === 'connected' && this.connectedPrinter?.id === printer.id) return Promise.resolve()

    const key = `${type}:${printer.id}`
    // Settings (auto-reconnect) and checkout (reconnect before printing) can ask at the same time.
    if (this.connectInFlight?.key === key) return this.connectInFlight.promise
    if (this.jobInFlight) return Promise.reject(new PrinterError('printer-busy'))

    const previous = this.connectInFlight?.promise.catch(() => {})
    const promise = (async () => {
      await previous
      await this.ensureReady()

      if (type === 'bluetooth') {
        const availability = await this.getAvailability()
        if (availability === 'permission-denied') throw new PrinterError('bluetooth-permission-denied')
        if (availability === 'bluetooth-off') throw new PrinterError('bluetooth-disabled')
        if (availability === 'unsupported') throw new PrinterError('bluetooth-unsupported')
      }

      this.setStatus('connecting', { ...printer, type })
      log(`Connecting... ${printer.name} (${type})`)
      try {
        const result =
          type === 'usb'
            ? await SellixPrinter.connectUsb({ id: printer.id })
            : await SellixPrinter.connectBluetooth({ address: printer.id })
        this.setStatus('connected', { ...printer, type, name: result.name || printer.name })
        log(`Connected ${result.name || printer.name}`)
      } catch (error) {
        const mapped = toPrinterError(error, type === 'usb' ? 'usb-open-failed' : 'printer-unavailable')
        logPrinterError(`connect to "${printer.name}" (${printer.id})`, error)
        this.setStatus('error', null)
        throw mapped
      }
    })().finally(() => {
      if (this.connectInFlight?.promise === promise) this.connectInFlight = null
    })

    this.connectInFlight = { key, promise }
    return promise
  }

  async disconnect(): Promise<void> {
    try {
      await SellixPrinter.disconnect()
    } catch (error) {
      logPrinterError('disconnect', error)
    }
    this.setStatus('disconnected', null)
    log('Disconnected')
  }

  getStatus(): PrinterConnectionStatus {
    return this.status
  }

  getConnectedPrinter(): DiscoveredPrinter | null {
    return this.connectedPrinter
  }

  onStatusChange(listener: PrinterStatusListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /* ------------------------------------------------------------------
     PRINTING
  ------------------------------------------------------------------ */

  /** One job at a time - a second job while one is being sent is refused, never interleaved or duplicated. */
  private async runJob(bytes: Uint8Array): Promise<void> {
    if (this.jobInFlight) throw new PrinterError('printer-busy')
    if (this.status !== 'connected') throw new PrinterError('not-connected')

    this.jobInFlight = true
    log(`Printing... (${bytes.length} bytes)`)
    try {
      await SellixPrinter.write({ data: toBase64(bytes) })
      log('Print successful')
    } catch (error) {
      log('Print failed')
      logPrinterError('write', error)
      // Native closes a link that failed mid-write; mirror that so the next job reconnects.
      this.setStatus('disconnected', null)
      throw toPrinterError(error, 'print-failed')
    } finally {
      this.jobInFlight = false
    }
  }

  async printReceipt(sale: Sale, settings: StoreSetting, config: PrinterConfig): Promise<void> {
    const { bytes } = buildReceipt(sale, settings, config.paperWidth, { cut: config.autoCut })
    await this.runJob(bytes)
  }

  async testPrint(settings: StoreSetting, config: PrinterConfig): Promise<void> {
    const { bytes } = buildTestReceipt(settings, config.paperWidth, {
      cut: config.autoCut,
      connectionType: this.connectedPrinter?.type ?? config.connectionType,
      printerName: this.connectedPrinter?.name ?? config.deviceName ?? undefined,
    })
    await this.runJob(bytes)
  }

  async openCashDrawer(config: PrinterConfig): Promise<void> {
    try {
      await this.runJob(buildDrawerKickCommand(config))
    } catch (error) {
      if (
        error instanceof PrinterError &&
        (error.code === 'not-connected' || error.code === 'printer-busy' || error.code === 'printer-disconnected')
      ) {
        throw error
      }
      throw new PrinterError('drawer-unavailable', error)
    }
  }
}
