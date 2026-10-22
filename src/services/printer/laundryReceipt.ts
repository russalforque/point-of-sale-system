import type { LaundryDetail } from '../../types/laundry'
import type { StoreSetting } from '../../types'
import type { PrinterConfig } from './types'
import { ReceiptBuilder, sanitizeForPrinter, wrapText } from './escpos'

export function buildLaundryReceipt(
  order: LaundryDetail,
  settings: StoreSetting,
  config: PrinterConfig,
  tag = false,
) {
  const b = new ReceiptBuilder(config.paperWidth).init()
  const wrap = (text: string) => wrapText(sanitizeForPrinter(text), b.columns).forEach((line) => b.line(line))
  const money = (amount: number) => `${settings.currency} ${(amount / 100).toFixed(2)}`
  if (tag) {
    // Keep the operational bag tag independent of the compact customer receipt.
    b.align('center').bold(true)
    if (settings.showLogoOnReceipt) b.tall(true)
    wrap(settings.storeName)
    b.tall(false).bold(false).line('LAUNDRY TAG').bold(true).tall(true)
    wrap(order.order_number)
    b.tall(false).bold(false).align('left').divider()
    wrap(`Customer: ${order.customer_name}`)
    wrap(`Received: ${new Date(order.created_at).toLocaleString()}`)
    if (order.pickup_at) wrap(`Pickup: ${new Date(order.pickup_at).toLocaleString()}`)
    wrap(`Status: ${order.status}`)
    b.divider()
    for (const line of order.items) {
      wrap(line.name)
      wrap(`${line.quantity_milli / 1000} ${line.pricing}`)
    }
    b.divider().align('center')
    wrap('Use order number for offline lookup')
  } else {
    // Wrap names rather than letting ReceiptBuilder.row truncate service details.
    const row = (label: string, value: string) => {
      const width = Math.max(1, b.columns - sanitizeForPrinter(value).length - 1)
      const rows = wrapText(sanitizeForPrinter(label), width)
      rows.slice(0, -1).forEach(line => b.line(line))
      b.row(rows[rows.length - 1]!, value)
    }
    const dateTime = (value: string) => new Date(value).toLocaleString('en-GB', {
      day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    })
    const units: Record<string, string> = { kg: 'kg', load: ' load', piece: ' pc', quantity: 'x', fixed: 'x' }
    const methods = [...new Set(order.payments.map(payment => payment.method))].join('/')
    const latestPayment = order.payments[order.payments.length - 1]

    b.align('center').bold(true)
    wrap(settings.storeName)
    b.bold(false)
    if (settings.phone?.trim()) wrap(settings.phone)
    b.bold(true)
    wrap(`Order: ${order.order_number}`)
    b.align('left').bold(false)
    if (order.status === 'Cancelled') b.bold(true).line('CANCELLED - NOTHING DUE').bold(false)
    wrap(`Customer: ${order.customer_name}`)
    wrap(`Received: ${dateTime(order.created_at)}`)
    if (order.pickup_at) wrap(`Pickup: ${dateTime(order.pickup_at)}`)
    b.divider().bold(true).row('QTY / SERVICE', 'AMOUNT').bold(false)
    for (const line of [...order.items, ...order.addons]) {
      const quantity = `${line.quantity_milli / 1000}${units[line.pricing] ?? ` ${line.pricing}`}`
      row(`${quantity} ${line.name}`, (line.total_cents / 100).toFixed(2))
    }
    b.divider('=')
    if (order.discount_cents > 0) {
      b.row('Subtotal', money(order.subtotal_cents))
      if (order.discounts?.length) {
        for (const discount of order.discounts) if (discount.amount_cents > 0) row(discount.name === 'Manual discount' ? 'Discount' : discount.name, `-${money(discount.amount_cents)}`)
      } else b.row('Discount', `-${money(order.discount_cents)}`)
    }
    b.bold(true).row('TOTAL', money(order.total_cents)).bold(false)
    row(methods ? `Paid (${methods})` : 'Paid', money(order.paid_cents))
    if (order.status !== 'Cancelled') b.bold(true).row('BALANCE', money(order.total_cents - order.paid_cents)).bold(false)
    // Only the latest transaction's change/reference belongs on a current receipt.
    if (latestPayment?.method === 'Cash' && latestPayment.tendered_cents > latestPayment.amount_cents) {
      b.row('Change (last cash)', money(latestPayment.tendered_cents - latestPayment.amount_cents))
    }
    if (latestPayment && latestPayment.method !== 'Cash' && latestPayment.reference) wrap(`Ref (${latestPayment.method}): ${latestPayment.reference}`)
    if (order.payments.some(payment => payment.method !== 'Cash')) wrap('Wallet: manual / unverified')
    b.divider().align('center')
    const footer = settings.receiptFooter?.trim() || 'Thank you! Keep for pickup.'
    // Respect custom line breaks, wrapping full text without adding blank paper lines.
    footer.split(/\r?\n/).map(line => line.trim()).filter(Boolean).forEach(wrap)
  }
  b.finish(config.autoCut)
  return { bytes: b.toBytes(), text: b.toText(), preview: b.toPreview(), columns: b.columns }
}
