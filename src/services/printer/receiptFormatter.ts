import type { Sale, StoreSetting } from '../../types'
import { ReceiptBuilder, sanitizeForPrinter, wrapText, type PreviewLine } from './escpos'
import type { PrinterConnectionType, PrinterPaperWidth } from './types'

export type ReceiptOptions = {
  /** Send the paper-cut command at the end (only for printers with a cutter). */
  cut?: boolean
}

export type FormattedReceipt = {
  bytes: Uint8Array
  /** Plain-text rendering of the same receipt, for testing without hardware. */
  text: string
  /** Line-by-line rendering with alignment/bold, for the on-screen receipt preview. */
  preview: PreviewLine[]
  /** Characters per line on this paper width. */
  columns: number
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

/** Free text (store details, footer) word-wrapped to the paper, instead of the printer breaking mid-word. */
function printWrapped(b: ReceiptBuilder, text: string) {
  for (const line of wrapText(sanitizeForPrinter(text), b.columns)) b.line(line)
}

function printHeader(b: ReceiptBuilder, settings: StoreSetting) {
  const storeName = settings.storeName?.trim() || 'Sellix POS'

  b.align('center')
  // No logo image is stored in store_settings (only the show_logo_on_receipt flag), and
  // raster logos are unreliable on generic 58mm printers - so the "logo" is the store name
  // printed double-height and bold. Without the flag it prints bold at normal size.
  b.bold(true)
  if (settings.showLogoOnReceipt) b.tall(true)
  printWrapped(b, storeName)
  b.tall(false).bold(false)

  if (settings.address) printWrapped(b, settings.address)
  if (settings.phone) printWrapped(b, settings.phone)
  if (settings.email) printWrapped(b, settings.email)
  b.feed(1)
}

/**
 * 80mm item line: the numeric cells are right-aligned and never truncated (a clipped
 * "10000" would silently print as "1000"), and the product name fills the remaining
 * columns, wrapping onto extra lines instead of being cut off.
 */
function printItemRow(b: ReceiptBuilder, name: string, cells: { text: string; width: number }[]) {
  const right = cells
    .map(({ text, width }) => {
      const safe = sanitizeForPrinter(text)
      return safe.length >= width ? ` ${safe}` : safe.padStart(width)
    })
    .join('')
  const nameWidth = Math.max(8, b.columns - cells.reduce((sum, cell) => sum + cell.width, 0))
  const [first = '', ...rest] = wrapText(sanitizeForPrinter(name), nameWidth - 1)
  b.line(first.padEnd(nameWidth) + right)
  for (const continuation of rest) b.line(continuation)
}

function printItems(b: ReceiptBuilder, sale: Sale, paperWidth: PrinterPaperWidth) {
  if (paperWidth === 80) {
    b.bold(true)
    printItemRow(b, 'Item', [
      { text: 'Qty', width: 5 },
      { text: 'Price', width: 9 },
      { text: 'Amount', width: 10 },
    ])
    b.bold(false)
    for (const item of sale.items) {
      printItemRow(b, item.productName, [
        { text: String(item.quantity), width: 5 },
        { text: money(item.unitPrice), width: 9 },
        { text: money(item.lineTotal), width: 10 },
      ])
    }
    return
  }

  // 58mm (32 columns): the full product name on its own line, then
  // "  2 x 45.00                90.00" - quantity, unit price and line total all fit.
  b.bold(true).row('Item', 'Amount').bold(false)
  for (const item of sale.items) {
    printWrapped(b, item.productName)
    b.row(`  ${item.quantity} x ${money(item.unitPrice)}`, money(item.lineTotal))
  }
}

export function buildReceipt(
  sale: Sale,
  settings: StoreSetting,
  paperWidth: PrinterPaperWidth = 58,
  options: ReceiptOptions = {},
): FormattedReceipt {
  const b = new ReceiptBuilder(paperWidth)

  b.init()
  printHeader(b, settings)

  if (sale.status === 'Voided') {
    b.align('center').bold(true).line('*** VOIDED SALE ***').bold(false)
  }

  b.align('left')
  b.row('Invoice', sale.invoiceNumber)
  b.row('Date', formatDateTime(sale.createdAt))
  b.row('Cashier', sale.cashierName || '-')
  if (sale.customerName) printWrapped(b, `Customer: ${sale.customerName}`)

  b.divider()
  printItems(b, sale, paperWidth)
  b.divider()

  b.row('Subtotal', money(sale.subtotal))
  if (sale.discount > 0) b.row('Discount', `-${money(sale.discount)}`)
  b.row('Tax', money(sale.tax))
  b.divider('=')
  b.bold(true).tall(true).row('TOTAL', money(sale.total)).tall(false).bold(false)
  b.divider('=')

  b.row('Payment', sale.paymentMethod || '-')
  if (sale.amountReceived != null) b.row('Amount received', money(sale.amountReceived))
  if (sale.change != null) b.row('Change', money(sale.change))

  b.feed(1)
  b.align('center')
  if (settings.receiptFooter?.trim()) printWrapped(b, settings.receiptFooter.trim())
  b.bold(true).line('Thank you for your purchase!').bold(false)

  b.finish(options.cut ?? false)

  return { bytes: b.toBytes(), text: b.toText(), preview: b.toPreview(), columns: b.columns }
}

/** Printer settings "Test Print": checks connection, width, alignment and text styles in one short slip. */
export function buildTestReceipt(
  settings: StoreSetting,
  paperWidth: PrinterPaperWidth = 58,
  options: ReceiptOptions & { connectionType?: PrinterConnectionType; printerName?: string } = {},
): FormattedReceipt {
  const b = new ReceiptBuilder(paperWidth)

  b.init()
  b.align('center')
  b.bold(true).tall(true).line('TEST PRINT').tall(false).bold(false)
  printWrapped(b, settings.storeName?.trim() || 'Sellix POS')
  b.feed(1)

  b.align('left')
  b.divider()
  b.row('Printer', options.printerName ?? 'Receipt printer')
  b.row('Connection', options.connectionType === 'usb' ? 'USB' : 'Bluetooth')
  b.row('Paper', `${paperWidth}mm / ${b.columns} columns`)
  b.row('Printed', formatDateTime(new Date().toISOString()))
  b.divider()

  // Column ruler: every digit should fit on one line with nothing wrapping.
  b.line('1234567890'.repeat(Math.ceil(b.columns / 10)).slice(0, b.columns))
  b.line('Left aligned')
  b.align('center').line('Centered').align('right').line('Right aligned').align('left')
  b.bold(true).line('Bold text').bold(false)
  b.tall(true).line('Tall text').tall(false)
  b.row('Item total', '1,234.50')
  b.divider()

  b.align('center')
  b.line('If this looks right,')
  b.line('your printer is ready.')

  b.finish(options.cut ?? false)

  return { bytes: b.toBytes(), text: b.toText(), preview: b.toPreview(), columns: b.columns }
}
