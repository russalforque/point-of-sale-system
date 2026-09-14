import type { PrinterConfig } from './types'

const ESC = 0x1b

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)))
}

/**
 * Standard ESC/POS drawer-kick command: ESC p m t1 t2
 * m selects the drawer pin (0 or 1), t1/t2 control the pulse on/off duration.
 * Different printers wire their drawer jack slightly differently, so pin and
 * timing are configurable per the app's printer settings rather than hardcoded.
 */
export function buildDrawerKickCommand(config: Pick<PrinterConfig, 'drawerPin' | 'drawerOnMs' | 'drawerOffMs'>): Uint8Array {
  return Uint8Array.from([
    ESC,
    0x70,
    config.drawerPin === 1 ? 1 : 0,
    clampByte(config.drawerOnMs),
    clampByte(config.drawerOffMs),
  ])
}
