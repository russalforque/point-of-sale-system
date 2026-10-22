import { querySQL } from '../database/sqlite'
import { requirePermission } from '../services/authz'
import { LAUNDRY_STATUSES } from '../types/laundry'

export function localDate(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
export function dateRange(from: string, to: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to)
    throw new Error('Choose a valid date range.')
  const start = new Date(`${from}T00:00:00`),
    end = new Date(`${to}T00:00:00`)
  if (
    !Number.isFinite(start.getTime()) ||
    !Number.isFinite(end.getTime()) ||
    localDate(start) !== from ||
    localDate(end) !== to
  )
    throw new Error('Choose valid calendar dates.')
  end.setDate(end.getDate() + 1)
  return [start.toISOString(), end.toISOString()]
}
const scalar = async (sql: string, args: unknown[] = []) =>
  ((await querySQL(sql, args)).values?.[0]?.n as number) ?? 0
export const laundryReportsApi = {
  async dashboard() {
    await requirePermission('sales.process')
    const range = dateRange(localDate(), localDate())
    const [collections, orders, states, outstanding] = await Promise.all([
      scalar(
        'SELECT COALESCE(SUM(amount_cents),0) AS n FROM laundry_payments WHERE created_at >= ? AND created_at < ?',
        range,
      ),
      scalar('SELECT COUNT(*) AS n FROM laundry_orders WHERE archived_at IS NULL AND created_at >= ? AND created_at < ?', range),
      querySQL('SELECT status,COUNT(*) AS n FROM laundry_orders WHERE archived_at IS NULL GROUP BY status'),
      scalar(
        'SELECT COALESCE(SUM(total_cents - COALESCE((SELECT SUM(amount_cents) FROM laundry_payments p WHERE p.order_id=o.id),0)),0) AS n FROM laundry_orders o WHERE archived_at IS NULL',
      ),
    ])
    return {
      collections,
      orders,
      outstanding,
      states: Object.fromEntries(LAUNDRY_STATUSES.map(status => [status, Number(states.values?.find(row => row.status === status)?.n ?? 0)])),
    }
  },
  async report(from: string, to: string) {
    await requirePermission('reports.view')
    const range = dateRange(from, to)
    const [collections, orders, outstanding, services, balances] = await Promise.all([
      querySQL(
        `SELECT p.*,o.order_number,o.customer_name,u.full_name AS staff FROM laundry_payments p JOIN laundry_orders o ON o.id=p.order_id JOIN users u ON u.id=p.created_by WHERE p.created_at >= ? AND p.created_at < ? ORDER BY p.created_at,p.id`,
        range,
      ),
      querySQL(
        `SELECT status,COUNT(*) AS count,COALESCE(SUM(total_cents),0) AS value FROM laundry_orders WHERE archived_at IS NULL AND created_at >= ? AND created_at < ? GROUP BY status`,
        range,
      ),
      scalar(
        'SELECT COALESCE(SUM(total_cents - COALESCE((SELECT SUM(amount_cents) FROM laundry_payments p WHERE p.order_id=o.id),0)),0) AS n FROM laundry_orders o WHERE archived_at IS NULL',
      ),
      // Allocate discounts by cumulative rounded shares, so every cent is allocated once.
      // These are booked amounts; payment-date collections remain a separate metric.
      querySQL(
        `WITH lines AS (
    SELECT id,order_id,service_id AS catalog_id,name,pricing,quantity_milli,total_cents,0 AS kind FROM laundry_order_items
    UNION ALL SELECT id,order_id,addon_id AS catalog_id,name,pricing,quantity_milli,total_cents,1 AS kind FROM laundry_order_addons
   ), running AS (
    SELECT l.*,o.discount_cents,o.subtotal_cents,o.discounts_version,COALESCE(d.amount_cents,0) AS line_discount,SUM(l.total_cents) OVER (PARTITION BY l.order_id ORDER BY l.kind,l.id ROWS UNBOUNDED PRECEDING) AS cumulative
    FROM lines l JOIN laundry_orders o ON o.id=l.order_id LEFT JOIN laundry_line_discounts d ON d.order_id=l.order_id AND d.kind=l.kind AND d.catalog_id=l.catalog_id WHERE o.archived_at IS NULL AND o.created_at >= ? AND o.created_at < ?
   ) SELECT name,pricing,kind,SUM(quantity_milli) AS quantity_milli,SUM(total_cents) AS value,
    SUM(total_cents-CASE WHEN discounts_version=1 THEN line_discount ELSE COALESCE((discount_cents*cumulative+subtotal_cents/2)/NULLIF(subtotal_cents,0)-(discount_cents*(cumulative-total_cents)+subtotal_cents/2)/NULLIF(subtotal_cents,0),0) END) AS net_value
    FROM running GROUP BY name,pricing,kind ORDER BY net_value DESC`,
        range,
      ),
      querySQL(
        `SELECT o.order_number,o.customer_name,o.total_cents-COALESCE(SUM(p.amount_cents),0) AS balance FROM laundry_orders o LEFT JOIN laundry_payments p ON p.order_id=o.id WHERE o.archived_at IS NULL GROUP BY o.id HAVING balance > 0 ORDER BY o.created_at`,
      ),
    ])
    return {
      collections: (collections.values ?? []) as {
        id: number
        order_number: string
        customer_name: string
        method: string
        amount_cents: number
        created_at: string
        staff: string
        reference: string | null
      }[],
      orders: (orders.values ?? []) as { status: string; count: number; value: number }[],
      services: (services.values ?? []) as {
        name: string
        pricing: string
        kind: number
        quantity_milli: number
        value: number
        net_value: number
      }[],
      balances: (balances.values ?? []) as { order_number: string; customer_name: string; balance: number }[],
      outstanding,
    }
  },
}
