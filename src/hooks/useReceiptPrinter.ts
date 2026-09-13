import { useState } from 'react'
import { printingApi } from '../api/printingApi'
import type { Sale, StoreSetting } from '../types'

export function useReceiptPrinter() {
  const [isPrinting, setIsPrinting] = useState(false)
  const [lastPrintError, setLastPrintError] = useState<string | null>(null)

  async function printReceipt(sale: Sale, settings: StoreSetting) {
    setIsPrinting(true)
    setLastPrintError(null)
    try {
      await printingApi.printReceipt(sale, settings)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Receipt could not be printed.'
      setLastPrintError(message)
      throw error
    } finally {
      setIsPrinting(false)
    }
  }

  return { printReceipt, retryPrint: printReceipt, printerStatus: lastPrintError ? 'offline' : 'unknown', isPrinting, lastPrintError }
}