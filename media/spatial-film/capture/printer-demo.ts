// Capture-only stand-in for src/services/printer/printerService.ts: a connected virtual
// thermal printer, so checkout shows the normal "printed" path instead of a printer error.
import type { DiscoveredPrinter, PrinterService } from '../../../src/services/printer/types'

const printer: DiscoveredPrinter = { id: '00:11:22:33:44:55', name: 'POS-80 Thermal', type: 'bluetooth', paired: true, likelyPrinter: true }
const ok = async () => {}
const service: PrinterService = {
  isBluetoothEnabled: async () => true,
  getAvailability: async () => 'ready',
  requestEnableBluetooth: async () => true,
  isLocationEnabled: async () => true,
  listPairedPrinters: async () => [printer],
  scanPrinters: async (onFound) => onFound(printer),
  stopScan: ok,
  listUsbPrinters: async () => [],
  onUsbDevicesChanged: () => () => {},
  connect: ok,
  disconnect: ok,
  getStatus: () => 'connected',
  getConnectedPrinter: () => printer,
  onStatusChange: () => () => {},
  printReceipt: () => new Promise((r) => setTimeout(r, 400)),
  testPrint: ok,
  openCashDrawer: ok,
}
export const getPrinterService = () => service
export const ensurePrinterConnected = ok
export const connectSavedPrinter = async () => true
