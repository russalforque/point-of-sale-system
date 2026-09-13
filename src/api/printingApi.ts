import client from './axios'
import type { Sale, StoreSetting } from '../types'

export type ReceiptPrintRequest = {
  receiptNumber: string
  transactionId: number
  transactionDate: string
  storeName: string
  storeAddress?: string | null
  storePhone?: string | null
  cashierName: string
  customerName?: string | null
  items: Sale['items']
  subtotal: number
  discountTotal: number
  tax: number
  grandTotal: number
  paymentMethod: string
  amountPaid?: number | null
  change?: number | null
  footerMessage?: string | null
  charactersPerLine?: number
  openCashDrawer?: boolean
}

function toReceiptRequest(sale: Sale, settings: StoreSetting): ReceiptPrintRequest {
  return {
    receiptNumber: sale.invoiceNumber,
    transactionId: sale.id,
    transactionDate: sale.createdAt,
    storeName: settings.storeName,
    storeAddress: settings.address,
    storePhone: settings.phone,
    cashierName: sale.cashierName,
    customerName: sale.customerName,
    items: sale.items,
    subtotal: sale.subtotal,
    discountTotal: sale.discount,
    tax: sale.tax,
    grandTotal: sale.total,
    paymentMethod: sale.paymentMethod,
    amountPaid: sale.amountReceived,
    change: sale.change,
    footerMessage: settings.receiptFooter,
    openCashDrawer: sale.paymentMethod.trim().toLowerCase() === 'cash',
  }
}

export const printingApi = {
  printReceipt: (sale: Sale, settings: StoreSetting) =>
    client.post('/api/printing/receipt', toReceiptRequest(sale, settings)).then((response) => response.data),
}