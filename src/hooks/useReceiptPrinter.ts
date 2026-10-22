import { useRef, useState } from 'react'
import { printingApi } from '../api/printingApi'
import { printerErrorMessage } from '../services/printer'
import { openCashDrawer } from '../services/drawer'
import type { Sale, StoreSetting } from '../types'

export function useReceiptPrinter() {
  const [isPrinting, setIsPrinting] = useState(false)
  const [lastPrintError, setLastPrintError] = useState<string | null>(null)
  const [isOpeningDrawer, setIsOpeningDrawer] = useState(false)
  const [lastDrawerError, setLastDrawerError] = useState<string | null>(null)
  // `isPrinting` only disables the button after React re-renders; this ref closes the
  // gap so a fast double tap joins the job already running instead of sending a second copy.
  const printJob = useRef<Promise<void> | null>(null)
  const drawerJob = useRef<Promise<void> | null>(null)

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
  function openDrawer(options?: { saleId: number }): Promise<void> {
    if (drawerJob.current) return drawerJob.current
    setIsOpeningDrawer(true)
    setLastDrawerError(null)
    const job = openCashDrawer(options).catch(error => {
      setLastDrawerError(printerErrorMessage(error))
      throw error
    }).finally(() => {
      drawerJob.current = null
      setIsOpeningDrawer(false)
    })
    drawerJob.current = job
    return job
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
