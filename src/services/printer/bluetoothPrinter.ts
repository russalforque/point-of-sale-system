import { App } from '@capacitor/app'
import { BleClient, numbersToDataView, type BleService } from '@capacitor-community/bluetooth-le'
import { buildDrawerKickCommand } from './cashDrawer'
import { logPrinterError, PrinterError } from './errors'
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

type WriteTarget = {
  service: string
  characteristic: string
  useWriteWithoutResponse: boolean
}

// Cheap ESC/POS BLE thermal printers don't follow a standard GATT profile the
// way heart-rate monitors or the like do, so there's no fixed service/
// characteristic UUID to target. Instead, once connected, every service is
// inspected and the first writable characteristic found is used as the print
// channel - the same pragmatic approach most generic "BLE thermal printer"
// apps take in the absence of a universal spec.
function findWritableCharacteristic(services: BleService[]): WriteTarget | null {
  for (const service of services) {
    for (const characteristic of service.characteristics) {
      if (characteristic.properties.writeWithoutResponse || characteristic.properties.write) {
        return {
          service: service.uuid,
          characteristic: characteristic.uuid,
          useWriteWithoutResponse: characteristic.properties.writeWithoutResponse,
        }
      }
    }
  }
  return null
}

const DEFAULT_CHUNK_SIZE = 20 // ATT MTU 23 - 3 byte header, the safe default before negotiation
// The plugin negotiates a large MTU on connect, but many budget printers accept the
// MTU and then overflow their small internal buffer on big packets (dropped or
// garbled lines). Capping the packet size and pacing write-without-response
// packets trades a little speed for output that doesn't lose data.
const MAX_CHUNK_SIZE = 100
const WRITE_WITHOUT_RESPONSE_DELAY_MS = 15
const CONNECT_TIMEOUT_MS = 10000

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function toInitializeError(error: unknown): PrinterError {
  const message = error instanceof Error ? error.message : String(error)
  return /permission/i.test(message)
    ? new PrinterError('bluetooth-permission-denied', error)
    : new PrinterError('bluetooth-unsupported', error)
}

export class BluetoothPrinterService implements PrinterService {
  private initPromise: Promise<void> | null = null
  private status: PrinterConnectionStatus = 'disconnected'
  private connectedPrinter: DiscoveredPrinter | null = null
  private writeTarget: WriteTarget | null = null
  private listeners = new Set<PrinterStatusListener>()
  private connectInFlight: { id: string; promise: Promise<void> } | null = null
  private jobInFlight = false
  private scanSession = 0
  private endScanWait: (() => void) | null = null

  /**
   * BleClient.initialize() is also where Android shows the Bluetooth permission prompt,
   * so concurrent callers share one attempt, and a failed attempt (e.g. permission
   * denied) is not cached - the next action asks again.
   */
  private ensureInitialized(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = BleClient.initialize({ androidNeverForLocation: true }).then(
        () => this.watchLifecycle(),
        (error: unknown) => {
          this.initPromise = null
          logPrinterError('initialize', error)
          throw toInitializeError(error)
        },
      )
    }
    return this.initPromise
  }

  /**
   * The GATT disconnect callback is the primary "connection lost" signal, but it isn't
   * guaranteed to reach the WebView while the app is backgrounded or when Bluetooth
   * is switched off, so both of those are checked explicitly. Neither reconnects -
   * reconnection only happens when the user prints or opens Printer settings.
   */
  private watchLifecycle() {
    BleClient.startEnabledNotifications((enabled) => {
      if (!enabled) this.dropConnection('Bluetooth was turned off')
    }).catch((error: unknown) => logPrinterError('startEnabledNotifications', error))

    App.addListener('resume', () => void this.verifyConnection()).catch((error: unknown) =>
      logPrinterError('resume listener', error),
    )
  }

  /** Marks a connection reported as "connected" as gone if the plugin no longer has it. */
  private async verifyConnection() {
    const printer = this.connectedPrinter
    if (this.status !== 'connected' || !printer || this.jobInFlight) return
    try {
      // getMtu is a pure state lookup that rejects with "Not connected to device."
      // once the GATT link is gone - no radio traffic, so no false negatives.
      await BleClient.getMtu(printer.id)
    } catch (error) {
      if (this.status === 'connected' && this.connectedPrinter?.id === printer.id) {
        logPrinterError('connection check after resume', error)
        this.dropConnection('Connection lost while the app was in the background')
      }
    }
  }

  private dropConnection(reason: string) {
    if (this.status !== 'connected') return
    console.warn(`[printer] ${reason}`)
    this.writeTarget = null
    this.setStatus('disconnected', null)
  }

  private setStatus(status: PrinterConnectionStatus, printer: DiscoveredPrinter | null = this.connectedPrinter) {
    this.status = status
    this.connectedPrinter = printer
    this.listeners.forEach((listener) => listener(status, printer))
  }

  async isBluetoothEnabled(): Promise<boolean> {
    try {
      await this.ensureInitialized()
      return await BleClient.isEnabled()
    } catch {
      return false
    }
  }

  async getAvailability(): Promise<PrinterAvailability> {
    try {
      await this.ensureInitialized()
    } catch (error) {
      return error instanceof PrinterError && error.code === 'bluetooth-permission-denied'
        ? 'permission-denied'
        : 'unsupported'
    }
    try {
      return (await BleClient.isEnabled()) ? 'ready' : 'bluetooth-off'
    } catch (error) {
      logPrinterError('isEnabled', error)
      return 'unsupported'
    }
  }

  async requestEnableBluetooth(): Promise<boolean> {
    await this.ensureInitialized()
    try {
      await BleClient.requestEnable()
    } catch (error) {
      // User declined the system prompt, or the platform has no such prompt.
      logPrinterError('requestEnable', error)
    }
    return BleClient.isEnabled().catch(() => false)
  }

  async isLocationEnabled(): Promise<boolean> {
    try {
      return await BleClient.isLocationEnabled()
    } catch {
      return true
    }
  }

  async scanPrinters(onFound: (printer: DiscoveredPrinter) => void, timeoutMs = 10000): Promise<void> {
    await this.ensureInitialized()

    if (!(await BleClient.isEnabled())) {
      throw new PrinterError('bluetooth-disabled')
    }

    // Supersede any scan still running so its timer can't stop this one.
    const session = ++this.scanSession
    this.endScanWait?.()
    await BleClient.stopLEScan().catch(() => {})

    const names = new Map<string, string | undefined>()

    try {
      await BleClient.requestLEScan({}, (result) => {
        const id = result.device.deviceId
        const name = result.localName || result.device.name || undefined
        // Report each device once, plus once more if its name only shows up in a later packet.
        if (names.has(id) && (names.get(id) !== undefined || name === undefined)) return
        names.set(id, name)
        onFound({ id, name: name ?? 'Unnamed device', address: id, type: 'bluetooth' })
      })
    } catch (error) {
      logPrinterError('requestLEScan', error)
      throw new PrinterError('scan-failed', error)
    }

    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, timeoutMs)
      this.endScanWait = () => {
        clearTimeout(timer)
        resolve()
      }
    })

    if (session === this.scanSession) await this.stopScan()
  }

  async stopScan(): Promise<void> {
    this.endScanWait?.()
    this.endScanWait = null
    try {
      await BleClient.stopLEScan()
    } catch {
      // scan may already have stopped - nothing to surface to the caller
    }
  }

  connect(printer: DiscoveredPrinter): Promise<void> {
    if (this.status === 'connected' && this.connectedPrinter?.id === printer.id && this.writeTarget) {
      return Promise.resolve() // already connected to this exact device - nothing to do
    }
    // Printer settings (auto-reconnect on open) and checkout (reconnect before printing)
    // can both ask for the same printer at once - share one attempt instead of racing.
    if (this.connectInFlight?.id === printer.id) return this.connectInFlight.promise
    if (this.jobInFlight) return Promise.reject(new PrinterError('printer-busy'))

    const previousAttempt = this.connectInFlight?.promise.catch(() => {})
    const promise = (async () => {
      await previousAttempt
      await this.openConnection(printer)
    })().finally(() => {
      if (this.connectInFlight?.promise === promise) this.connectInFlight = null
    })
    this.connectInFlight = { id: printer.id, promise }
    return promise
  }

  private async openConnection(printer: DiscoveredPrinter): Promise<void> {
    await this.ensureInitialized()

    if (!(await BleClient.isEnabled())) {
      throw new PrinterError('bluetooth-disabled')
    }

    // Switching printers - drop whatever was previously connected first so it isn't
    // left as an orphaned GATT connection that a later disconnect() could no longer reach.
    const previous = this.connectedPrinter
    if (previous && previous.id !== printer.id) {
      this.writeTarget = null
      await BleClient.disconnect(previous.id).catch((error: unknown) =>
        logPrinterError('disconnect previous printer', error),
      )
    }

    this.setStatus('connecting', printer)

    try {
      await BleClient.connect(printer.id, (deviceId) => this.handleDeviceDisconnected(deviceId), {
        timeout: CONNECT_TIMEOUT_MS,
      })

      const services = await BleClient.getServices(printer.id)
      const target = findWritableCharacteristic(services)
      if (!target) throw new PrinterError('incompatible-printer')

      this.writeTarget = target
      this.setStatus('connected', printer)
    } catch (error) {
      logPrinterError(`connect to "${printer.name}" (${printer.id})`, error)
      this.writeTarget = null
      // A half-open link (connected but service discovery failed) would otherwise
      // be reported by the plugin as "Already connected" on the next attempt.
      await BleClient.disconnect(printer.id).catch(() => {})
      this.setStatus('error', null)
      if (error instanceof PrinterError) throw error
      throw new PrinterError('printer-unavailable', error)
    }
  }

  /**
   * Fired by the plugin whenever a device's GATT link closes - the printer powered off,
   * went out of range, or a disconnect we requested. The callback is per device and can
   * arrive late, so it only resets state if that device is still the current, established
   * connection; a failed connect attempt is reported by connect() itself.
   */
  private handleDeviceDisconnected(deviceId: string) {
    if (this.connectedPrinter?.id !== deviceId || this.status !== 'connected') return
    this.dropConnection(`Printer ${deviceId} disconnected`)
  }

  async disconnect(): Promise<void> {
    const printer = this.connectedPrinter
    this.writeTarget = null
    this.setStatus('disconnected', null)
    if (printer) {
      await BleClient.disconnect(printer.id).catch((error: unknown) => logPrinterError('disconnect', error))
    }
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

  /** One job at a time - a second job while one is being written is refused, never interleaved or duplicated. */
  private async runJob(bytes: Uint8Array): Promise<void> {
    if (this.jobInFlight) throw new PrinterError('printer-busy')
    this.jobInFlight = true
    try {
      await this.sendBytes(bytes)
    } finally {
      this.jobInFlight = false
    }
  }

  private async sendBytes(bytes: Uint8Array): Promise<void> {
    if (this.status !== 'connected' || !this.connectedPrinter || !this.writeTarget) {
      throw new PrinterError('not-connected')
    }

    const deviceId = this.connectedPrinter.id
    const target = this.writeTarget

    let chunkSize = DEFAULT_CHUNK_SIZE
    try {
      const mtu = await BleClient.getMtu(deviceId)
      if (mtu > 3) chunkSize = Math.min(MAX_CHUNK_SIZE, Math.max(DEFAULT_CHUNK_SIZE, mtu - 3))
    } catch {
      // keep the conservative default chunk size
    }

    try {
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        const chunk = numbersToDataView(Array.from(bytes.slice(offset, offset + chunkSize)))
        if (target.useWriteWithoutResponse) {
          await BleClient.writeWithoutResponse(deviceId, target.service, target.characteristic, chunk)
          if (offset + chunkSize < bytes.length) await delay(WRITE_WITHOUT_RESPONSE_DELAY_MS)
        } else {
          await BleClient.write(deviceId, target.service, target.characteristic, chunk)
        }
      }
    } catch (error) {
      logPrinterError(`write to ${deviceId}`, error)
      const linkWasLost = this.status !== 'connected' || this.connectedPrinter?.id !== deviceId
      // After a failed write the link can't be trusted (and the printer may hold a partial
      // job), so never keep reporting "Connected". Dropping it means the cashier's retry
      // starts from a fresh connection, whose ESC @ resets the printer.
      this.writeTarget = null
      await BleClient.disconnect(deviceId).catch(() => {})
      this.setStatus('disconnected', null)
      throw new PrinterError(linkWasLost ? 'printer-disconnected' : 'print-failed', error)
    }
  }

  /** BLE (browser preview) has no concept of a bonded-device list we can read. */
  async listPairedPrinters(): Promise<DiscoveredPrinter[]> {
    return []
  }

  /** USB printing needs the Android app (NativePrinterService). */
  async listUsbPrinters(): Promise<DiscoveredPrinter[]> {
    return []
  }

  onUsbDevicesChanged(): () => void {
    return () => {}
  }

  async printReceipt(sale: Sale, settings: StoreSetting, config: PrinterConfig): Promise<void> {
    const { bytes } = buildReceipt(sale, settings, config.paperWidth, { cut: config.autoCut })
    await this.runJob(bytes)
  }

  async testPrint(settings: StoreSetting, config: PrinterConfig): Promise<void> {
    const { bytes } = buildTestReceipt(settings, config.paperWidth, {
      cut: config.autoCut,
      connectionType: 'bluetooth',
      printerName: this.connectedPrinter?.name,
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
