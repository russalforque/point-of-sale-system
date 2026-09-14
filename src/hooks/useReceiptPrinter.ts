import { useState } from 'react'
import { printingApi } from '../api/printingApi'
import { connectSavedPrinter, getPrinterService, printerErrorMessage } from '../services/printer'
import { getPrinterConfig } from '../utils/printerConfig'
import type { Sale, StoreSetting } from '../types'

export function useReceiptPrinter() {
  const [isPrinting, setIsPrinting] = useState(false)
  const [lastPrintError, setLastPrintError] = useState<string | null>(null)
  const [isOpeningDrawer, setIsOpeningDrawer] = useState(false)
  const [lastDrawerError, setLastDrawerError] = useState<string | null>(null)

  async function printReceipt(sale: Sale, settings: StoreSetting) {
    setIsPrinting(true)
    setLastPrintError(null)
    try {
      await printingApi.printReceipt(sale, settings)
    } catch (error) {
      setLastPrintError(printerErrorMessage(error))
      throw error
    } finally {
      setIsPrinting(false)
    }
  }

  /** Sends the ESC/POS drawer-kick command through the connected printer. */
  async function openDrawer() {
    setIsOpeningDrawer(true)
    setLastDrawerError(null)
    try {
      const service = getPrinterService()
      if (service.getStatus() !== 'connected') {
        await connectSavedPrinter()
      }
      await service.openCashDrawer(getPrinterConfig())
    } catch (error) {
      setLastDrawerError(printerErrorMessage(error))
      throw error
    } finally {
      setIsOpeningDrawer(false)
    }
  }

  return {
    printReceipt,
    retryPrint: printReceipt,
    openDrawer,
    printerStatus: lastPrintError ? 'offline' : 'unknown',
    isPrinting,
    lastPrintError,
    isOpeningDrawer,
    lastDrawerError,
  }
}
