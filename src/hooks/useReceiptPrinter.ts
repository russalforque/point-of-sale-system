import { useRef, useState } from 'react'
import { printingApi } from '../api/printingApi'
import { ensurePrinterConnected, getPrinterService, printerErrorMessage } from '../services/printer'
import { getPrinterConfig } from '../utils/printerConfig'
import type { Sale, StoreSetting } from '../types'

export function useReceiptPrinter() {
  const [isPrinting, setIsPrinting] = useState(false)
  const [lastPrintError, setLastPrintError] = useState<string | null>(null)
  const [isOpeningDrawer, setIsOpeningDrawer] = useState(false)
  const [lastDrawerError, setLastDrawerError] = useState<string | null>(null)
  // `isPrinting` only disables the button after React re-renders; this ref closes the
  // gap so a fast double tap joins the job already running instead of sending a second copy.
  const printJob = useRef<Promise<void> | null>(null)

  function printReceipt(sale: Sale, settings: StoreSetting): Promise<void> {
    if (printJob.current) return printJob.current

    setIsPrinting(true)
    setLastPrintError(null)
    const job = printingApi
      .printReceipt(sale, settings)
      .catch((error: unknown) => {
        setLastPrintError(printerErrorMessage(error))
        throw error
      })
      .finally(() => {
        printJob.current = null
        setIsPrinting(false)
      })
    printJob.current = job
    return job
  }

  /** Sends the ESC/POS drawer-kick command through the connected printer. */
  async function openDrawer() {
    setIsOpeningDrawer(true)
    setLastDrawerError(null)
    try {
      await ensurePrinterConnected()
      await getPrinterService().openCashDrawer(getPrinterConfig())
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
