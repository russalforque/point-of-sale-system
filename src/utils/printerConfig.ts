import type { PrinterConfig } from '../services/printer/types'

const CONFIG_KEY = 'sellix.printer.config'

// Defaults match a POS-5890U-L style printer: 58mm paper, Bluetooth, no cutter.
// Drawer: "ON for cash", pin 0, 50/500 ms (the original ESC/POS bytes 25/250).
export const DEFAULT_PRINTER_CONFIG: PrinterConfig = {
  pulseTimingVersion: 2,
  connectionType: 'bluetooth',
  deviceId: null,
  deviceName: null,
  paperWidth: 58,
  autoCut: false,
  autoOpenDrawerOnCash: true,
  drawerPin: 0,
  drawerOnMs: 50,
  drawerOffMs: 500,
}

export function getPrinterConfig(): PrinterConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    if (!raw) return { ...DEFAULT_PRINTER_CONFIG }
    const saved = JSON.parse(raw) as Partial<PrinterConfig>
    const scale = saved.pulseTimingVersion === 2 ? 1 : 2
    const timing = (value: number | undefined, fallback: number) => Number.isFinite(value) ? Math.max(0, Math.min(510, Number(value) * scale)) : fallback
    return {
      ...DEFAULT_PRINTER_CONFIG, ...saved,
      pulseTimingVersion: 2,
      drawerOnMs: timing(saved.drawerOnMs, 50),
      drawerOffMs: timing(saved.drawerOffMs, 500),
    }
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
