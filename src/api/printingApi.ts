import type { Sale, StoreSetting } from '../types'
import { ensurePrinterConnected, getPrinterService } from '../services/printer'
import { getPrinterConfig } from '../utils/printerConfig'

export const printingApi = {
  printReceipt: async (sale: Sale, settings: StoreSetting): Promise<void> => {
    // A tablet reboot or a killed app drops the BLE connection even though the
    // printer is still saved - reconnect once before printing, and surface the real
    // reason (Bluetooth off, permission denied, no printer selected, printer off)
    // if that isn't possible, rather than a generic "not connected".
    await ensurePrinterConnected()
    await getPrinterService().printReceipt(sale, settings, getPrinterConfig())
  },
}
