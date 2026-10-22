import { querySQL } from '../database/sqlite'
import { runTransaction } from '../database/tx'
import { auditStatement, logAudit } from './audit'
import { requirePermission } from './authz'
import { ensurePrinterConnected, getPrinterService } from './printer'
import { getPrinterConfig } from '../utils/printerConfig'
import { ApiError } from '../utils/errors'

/** Audits before sending: loss of power after a drawer command still leaves a recorded attempt. */
export async function openCashDrawer(options?: { saleId: number }): Promise<void> {
  const actor = await requirePermission(options ? 'sales.process' : 'drawer.open')
  const config = getPrinterConfig()
  if (options) {
    if (!config.autoOpenDrawerOnCash) return
    const sale = (await querySQL(`SELECT s.id FROM sales s WHERE s.id = ? AND s.status = 1 AND s.cashier_id = ?
      AND (EXISTS(SELECT 1 FROM sale_payments p WHERE p.sale_id=s.id AND p.method=0 AND p.amount>0)
        OR EXISTS(SELECT 1 FROM payments p WHERE p.sale_id=s.id AND p.method=0 AND p.amount>0))`, [options.saleId, actor.fullName])).values?.[0]
    if (!sale) throw new ApiError('The drawer can only open automatically for your completed cash sale.', 403)
  }
  const label = options ? `Cash sale ${options.saleId}` : 'Manual drawer opening'
  await runTransaction([auditStatement('drawer', `${label}: command requested`, undefined, actor)])
  try {
    await ensurePrinterConnected()
    await getPrinterService().openCashDrawer(config)
  } catch (error) {
    await logAudit('drawer', `${label}: command failed`, undefined, actor)
    throw error
  }
  // Printer acceptance is not proof that a physical drawer actually moved.
  await logAudit('drawer', `${label}: command sent to printer`, undefined, actor)
}
