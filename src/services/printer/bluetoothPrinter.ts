import { BleClient, numbersToDataView, type BleService } from '@capacitor-community/bluetooth-le'
import { buildDrawerKickCommand } from './cashDrawer'
import { PrinterError } from './errors'
import { buildReceipt, buildTestReceipt } from './receiptFormatter'
import type {
  DiscoveredPrinter,
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

export class BluetoothPrinterService implements PrinterService {
  private initialized = false
  private status: PrinterConnectionStatus = 'disconnected'
  private connectedPrinter: DiscoveredPrinter | null = null
  private writeTarget: WriteTarget | null = null
  private listeners = new Set<PrinterStatusListener>()

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return
    try {
      await BleClient.initialize()
      this.initialized = true
    } catch {
      throw new PrinterError('bluetooth-disabled')
    }
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

  async scanPrinters(onFound: (printer: DiscoveredPrinter) => void, timeoutMs = 10000): Promise<void> {
    await this.ensureInitialized()

    if (!(await BleClient.isEnabled())) {
      throw new PrinterError('bluetooth-disabled')
    }

    const seen = new Set<string>()

    try {
      await BleClient.requestLEScan({}, (result) => {
        if (seen.has(result.device.deviceId)) return
        seen.add(result.device.deviceId)
        onFound({
          id: result.device.deviceId,
          name: result.localName || result.device.name || 'Unknown printer',
          address: result.device.deviceId,
        })
      })
    } catch {
      throw new PrinterError('printer-unavailable', 'Unable to start scanning for printers.')
    }

    await new Promise((resolve) => setTimeout(resolve, timeoutMs))
    await this.stopScan()
  }

  async stopScan(): Promise<void> {
    try {
      await BleClient.stopLEScan()
    } catch {
      // scan may already have stopped - nothing to surface to the caller
    }
  }

  async connect(printer: DiscoveredPrinter): Promise<void> {
    if (this.status === 'connected' && this.connectedPrinter?.id === printer.id) {
      return // already connected to this exact device - nothing to do
    }

    await this.ensureInitialized()

    if (!(await BleClient.isEnabled())) {
      throw new PrinterError('bluetooth-disabled')
    }

    // Switching printers (or reconnecting a stale session) - drop whatever was
    // previously connected first so it isn't left as an orphaned GATT
    // connection that a later disconnect() call could no longer reach.
    if (this.connectedPrinter && this.connectedPrinter.id !== printer.id) {
      await BleClient.disconnect(this.connectedPrinter.id).catch(() => {})
      this.writeTarget = null
    }

    this.setStatus('connecting', printer)

    try {
      await BleClient.connect(printer.id, () => {
        // Fired when the printer drops the connection on its own (out of
        // range, powered off) - reflect that immediately rather than leaving
        // the UI showing a stale "connected" state.
        this.writeTarget = null
        this.setStatus('disconnected', null)
      })

      const services = await BleClient.getServices(printer.id)
      const target = findWritableCharacteristic(services)
      if (!target) {
        await BleClient.disconnect(printer.id).catch(() => {})
        throw new PrinterError('printer-unavailable', 'This device does not expose a compatible print channel.')
      }

      this.writeTarget = target
      this.setStatus('connected', printer)
    } catch (error) {
      this.writeTarget = null
      this.setStatus('error', null)
      if (error instanceof PrinterError) throw error
      throw new PrinterError('printer-unavailable')
    }
  }

  async disconnect(): Promise<void> {
    const printer = this.connectedPrinter
    this.writeTarget = null
    if (printer) {
      await BleClient.disconnect(printer.id).catch(() => {})
    }
    this.setStatus('disconnected', null)
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

  private async sendBytes(bytes: Uint8Array): Promise<void> {
    if (this.status !== 'connected' || !this.connectedPrinter || !this.writeTarget) {
      throw new PrinterError('not-connected')
    }

    const deviceId = this.connectedPrinter.id
    const target = this.writeTarget

    let chunkSize = DEFAULT_CHUNK_SIZE
    try {
      const mtu = await BleClient.getMtu(deviceId)
      if (mtu > 3) chunkSize = Math.max(DEFAULT_CHUNK_SIZE, mtu - 3)
    } catch {
      // keep the conservative default chunk size
    }

    try {
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        const chunk = numbersToDataView(Array.from(bytes.slice(offset, offset + chunkSize)))
        if (target.useWriteWithoutResponse) {
          await BleClient.writeWithoutResponse(deviceId, target.service, target.characteristic, chunk)
        } else {
          await BleClient.write(deviceId, target.service, target.characteristic, chunk)
        }
      }
    } catch (error) {
      if (error instanceof PrinterError) throw error
      throw new PrinterError('print-failed')
    }
  }

  async printReceipt(sale: Sale, settings: StoreSetting, config: PrinterConfig): Promise<void> {
    const { bytes } = buildReceipt(sale, settings, config.paperWidth)
    await this.sendBytes(bytes)
  }

  async testPrint(settings: StoreSetting, config: PrinterConfig): Promise<void> {
    const { bytes } = buildTestReceipt(settings, config.paperWidth)
    await this.sendBytes(bytes)
  }

  async openCashDrawer(config: PrinterConfig): Promise<void> {
    try {
      await this.sendBytes(buildDrawerKickCommand(config))
    } catch (error) {
      if (error instanceof PrinterError && error.code === 'not-connected') throw error
      throw new PrinterError('drawer-unavailable')
    }
  }
}
