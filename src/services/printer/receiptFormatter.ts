import type { Sale, StoreSetting } from '../../types'
import { ReceiptBuilder } from './escpos'
import type { PrinterPaperWidth } from './types'

export type FormattedReceipt = {
  bytes: Uint8Array
  /** Plain-text rendering of the same receipt, for on-screen preview or testing without hardware. */
  text: string
}

function money(n: number | null | undefined): string {
  return (Number.isFinite(n) ? (n as number) : 0).toFixed(2)
}

function formatDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function printHeader(b: ReceiptBuilder, settings: StoreSetting) {
  // No logo image is stored anywhere in store_settings today (only a
  // show_logo_on_receipt flag) - printing an actual raster logo needs a stored
  // image plus bitmap/dither conversion, which is out of scope until that data
  // exists. The flag currently only toggles this text badge.
  b.align('center')
  if (settings.showLogoOnReceipt) {
    b.bold(true).doubleSize(true).line('SELLIX POS').doubleSize(false).bold(false)
  }
  b.bold(true).line(settings.storeName).bold(false)
  if (settings.address) b.line(settings.address)
  if (settings.phone) b.line(settings.phone)
  if (settings.email) b.line(settings.email)
  b.feed(1)
}

function printItemsTable(b: ReceiptBuilder, sale: Sale, wide: boolean) {
  if (wide) {
    b.columnsRow([
      { text: 'Product', width: 20 },
      { text: 'Qty', width: 5, align: 'right' },
      { text: 'Price', width: 9, align: 'right' },
      { text: 'Total', width: 10, align: 'right' },
    ])
    for (const item of sale.items) {
      b.columnsRow([
        { text: item.productName, width: 20 },
        { text: String(item.quantity), width: 5, align: 'right' },
        { text: money(item.unitPrice), width: 9, align: 'right' },
        { text: money(item.lineTotal), width: 10, align: 'right' },
      ])
    }
  } else {
    // 58mm/32-column paper doesn't have room for a separate unit-price column
    // alongside name/qty/total, so it's dropped for narrow receipts.
    b.columnsRow([
      { text: 'Product', width: 18 },
      { text: 'Qty', width: 4, align: 'right' },
      { text: 'Total', width: 10, align: 'right' },
    ])
    for (const item of sale.items) {
      b.columnsRow([
        { text: item.productName, width: 18 },
        { text: String(item.quantity), width: 4, align: 'right' },
        { text: money(item.lineTotal), width: 10, align: 'right' },
      ])
    }
  }
}

export function buildReceipt(
  sale: Sale,
  settings: StoreSetting,
  paperWidth: PrinterPaperWidth = 58,
): FormattedReceipt {
  const b = new ReceiptBuilder(paperWidth)
  const wide = paperWidth === 80

  b.init()
  printHeader(b, settings)

  b.align('left')
  b.line(`Invoice: ${sale.invoiceNumber}`)
  b.line(`Date: ${formatDateTime(sale.createdAt)}`)
  b.line(`Cashier: ${sale.cashierName}`)
  if (sale.customerName) b.line(`Customer: ${sale.customerName}`)

  b.divider()
  printItemsTable(b, sale, wide)
  b.divider()

  b.row('Subtotal', money(sale.subtotal))
  if (sale.discount > 0) b.row('Discount', money(sale.discount))
  b.row('Tax', money(sale.tax))
  b.bold(true)
  b.row('TOTAL', money(sale.total))
  b.bold(false)
  b.feed(1)

  b.line(`Payment: ${sale.paymentMethod.toUpperCase()}`)
  if (sale.amountReceived != null) b.row('Received:', money(sale.amountReceived))
  if (sale.change != null) b.row('Change:', money(sale.change))

  b.feed(1)
  b.align('center')
  if (settings.receiptFooter) b.line(settings.receiptFooter)
  b.bold(true).line('Thank you for your purchase!').bold(false)

  b.cutPaper()

  return { bytes: b.toBytes(), text: b.toText() }
}

/** A short, self-contained receipt used by the printer settings page's "Test Print" action. */
export function buildTestReceipt(settings: StoreSetting, paperWidth: PrinterPaperWidth = 58): FormattedReceipt {
  const b = new ReceiptBuilder(paperWidth)

  b.init()
  b.align('center')
  b.bold(true).doubleSize(true).line('SELLIX POS').doubleSize(false).bold(false)
  b.line(settings.storeName)
  b.feed(1)

  b.align('left')
  b.divider()
  b.line('TEST PRINT')
  b.line(`Paper width: ${paperWidth}mm (${b.columns} columns)`)
  b.line(`Printed: ${formatDateTime(new Date().toISOString())}`)
  b.divider()

  b.align('center')
  b.line('If you can read this clearly,')
  b.line('your printer is set up correctly.')
  b.feed(1)

  b.cutPaper()

  return { bytes: b.toBytes(), text: b.toText() }
}
