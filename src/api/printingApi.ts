import type { Sale, StoreSetting } from '../types'
import { connectSavedPrinter, getPrinterService } from '../services/printer'
import { getPrinterConfig } from '../utils/printerConfig'

export const printingApi = {
  printReceipt: async (sale: Sale, settings: StoreSetting): Promise<void> => {
    const service = getPrinterService()
    // A tablet reboot or a killed app drops the BLE connection even though a
    // printer is still paired - reconnect transparently before giving up with
    // "not connected", rather than making every cashier revisit Printer
    // Settings before their first sale of the day can print.
    if (service.getStatus() !== 'connected') {
      await connectSavedPrinter()
    }
    await service.printReceipt(sale, settings, getPrinterConfig())
  },
}
