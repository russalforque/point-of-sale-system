import type { PrinterConfig } from '../services/printer/types'

const CONFIG_KEY = 'sellix.printer.config'

// Defaults match a POS-5890U-L style printer: 58mm paper, Bluetooth, no cutter.
// Drawer: "ON for cash", pin 0 with a 25ms/250ms pulse.
export const DEFAULT_PRINTER_CONFIG: PrinterConfig = {
  connectionType: 'bluetooth',
  deviceId: null,
  deviceName: null,
  paperWidth: 58,
  autoCut: false,
  autoOpenDrawerOnCash: true,
  drawerPin: 0,
  drawerOnMs: 25,
  drawerOffMs: 250,
}

export function getPrinterConfig(): PrinterConfig {
  const raw = localStorage.getItem(CONFIG_KEY)
  if (!raw) return { ...DEFAULT_PRINTER_CONFIG }
  try {
    // Older saved configs (Bluetooth only) simply pick up the new defaults.
    return { ...DEFAULT_PRINTER_CONFIG, ...(JSON.parse(raw) as Partial<PrinterConfig>) }
  } catch {
    return { ...DEFAULT_PRINTER_CONFIG }
  }
}

export function savePrinterConfig(config: PrinterConfig): void {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config))
}

export function updatePrinterConfig(patch: Partial<PrinterConfig>): PrinterConfig {
  const next = { ...getPrinterConfig(), ...patch }
  savePrinterConfig(next)
  return next
}
