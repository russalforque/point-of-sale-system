import { laundryApi } from '../../api/laundryApi'
import { settingsApi } from '../../api/settingsApi'
import { getPrinterConfig } from '../../utils/printerConfig'
import { ensurePrinterConnected, getPrinterService } from './printerService'
import { buildLaundryReceipt } from './laundryReceipt'
import { requirePermission } from '../authz'

export async function printLaundryOrder(id: number, tag = false): Promise<void> {
  const order = await laundryApi.detail(id),
    settings = await settingsApi.get(),
    config = getPrinterConfig()
  await ensurePrinterConnected()
  await getPrinterService().printDocument(buildLaundryReceipt(order, settings, config, tag).bytes)
}
/** Call after the database commits; a print failure must never retry the transaction. */
export async function autoPrintLaundryReceipt(
  id: number,
  notify: (message: string, tone?: 'success' | 'error') => void,
  saved: 'order' | 'payment' = 'order',
): Promise<void> {
  try {
    await printLaundryOrder(id)
    notify('Receipt sent to printer.')
  } catch {
    notify(`${saved === 'payment' ? 'Payment applied.' : 'Order saved.'} Receipt could not print; retry from order details.`, 'error')
  }
}
/** A drawer failure must never turn an already committed payment into a failed payment. */
export async function openLaundryDrawer(
  notify: (message: string, tone?: 'success' | 'error') => void,
): Promise<void> {
  const config = getPrinterConfig()
  if (!config.autoOpenDrawerOnCash || !config.deviceId) return
  try {
    await requirePermission('drawer.open')
    await ensurePrinterConnected()
    await getPrinterService().openCashDrawer(config)
  } catch {
    notify('Payment saved. The cash drawer could not open; check the printer.', 'error')
  }
}
