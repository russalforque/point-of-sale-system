import type { PrinterConfig } from '../services/printer/types'

const CONFIG_KEY = 'sellix.printer.config'

// 58mm is the more common budget thermal printer size, and "ON for cash" /
// pin 0 with a 25ms/250ms pulse are the defaults called out in the spec.
export const DEFAULT_PRINTER_CONFIG: PrinterConfig = {
  deviceId: null,
  deviceName: null,
  paperWidth: 58,
  autoOpenDrawerOnCash: true,
  drawerPin: 0,
  drawerOnMs: 25,
  drawerOffMs: 250,
}

export function getPrinterConfig(): PrinterConfig {
  const raw = localStorage.getItem(CONFIG_KEY)
  if (!raw) return { ...DEFAULT_PRINTER_CONFIG }
  try {
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
