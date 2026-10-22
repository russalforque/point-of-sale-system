import { desktopInvoke } from '../platform'
import { buildDrawerKickCommand } from './cashDrawer'
import { PrinterError } from './errors'
import { buildProductLabels, buildReceipt, buildTestReceipt, type ProductLabel } from './receiptFormatter'
import type { DiscoveredPrinter, PrinterConfig, PrinterConnectionStatus, PrinterService, PrinterStatusListener } from './types'
import type { Sale, StoreSetting } from '../../types'

/** RAW ESC/POS through an installed Windows queue, including compatible Bluetooth drivers. */
export class WindowsPrinterService implements PrinterService {
  private status: PrinterConnectionStatus = 'disconnected'
  private printer: DiscoveredPrinter | null = null
  private busy = false
  private listeners = new Set<PrinterStatusListener>()

  private update(status: PrinterConnectionStatus, printer = this.printer) {
    this.status = status
    this.printer = printer
    this.listeners.forEach(listener => listener(status, printer))
  }
  async getAvailability() { return 'unsupported' as const }
  async isBluetoothEnabled() { return false }
  async requestEnableBluetooth() { return false }
  async isLocationEnabled() { return true }
  async listPairedPrinters(): Promise<DiscoveredPrinter[]> { return [] }
  async scanPrinters() { throw new PrinterError('bluetooth-unsupported') }
  async stopScan() {}
  async listUsbPrinters(): Promise<DiscoveredPrinter[]> { return this.listWindowsPrinters() }
  async listWindowsPrinters(): Promise<DiscoveredPrinter[]> { return desktopInvoke('printers') }
  onUsbDevicesChanged(): () => void { return () => {} }
  async connect(printer: DiscoveredPrinter) {
    if (this.busy) throw new PrinterError('printer-busy')
    if (printer.type !== 'windows') throw new PrinterError('incompatible-printer')
    this.busy = true
    this.update('connecting', printer)
    try {
      await desktopInvoke('printers', { name: printer.id })
      this.update('connected', printer)
    } catch (error) {
      this.update('error', null)
      throw error
    } finally { this.busy = false }
  }
  async disconnect() {
    if (this.busy) throw new PrinterError('printer-busy')
    this.update('disconnected', null)
  }
  getStatus() { return this.status }
  getConnectedPrinter() { return this.printer }
  onStatusChange(listener: PrinterStatusListener) {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  async printDocument(bytes: Uint8Array): Promise<void> {
    if (this.busy) throw new PrinterError('printer-busy')
    if (!this.printer || this.status !== 'connected') throw new PrinterError('not-connected')
    this.busy = true
    try {
      await desktopInvoke('print_raw', { name: this.printer.id, bytes: Array.from(bytes) })
    } catch (error) {
      this.update('disconnected', null)
      throw error
    } finally { this.busy = false }
  }
  async printReceipt(sale: Sale, settings: StoreSetting, config: PrinterConfig) {
    await this.printDocument(buildReceipt(sale, settings, config.paperWidth, { cut: config.autoCut }).bytes)
  }
  async testPrint(settings: StoreSetting, config: PrinterConfig) {
    await this.printDocument(buildTestReceipt(settings, config.paperWidth, { cut: config.autoCut, connectionType: 'windows', printerName: this.printer?.name }).bytes)
  }
  async printLabels(labels: { label: ProductLabel; copies: number }[], settings: StoreSetting, config: PrinterConfig) {
    await this.printDocument(buildProductLabels(labels, settings, config.paperWidth, { cut: config.autoCut }).bytes)
  }
  async openCashDrawer(config: PrinterConfig) { await this.printDocument(buildDrawerKickCommand(config)) }
}
