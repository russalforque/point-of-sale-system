import { querySQL } from '../database/sqlite'
import { runTransaction, type SqlStatement } from '../database/tx'
import { auditStatement } from '../services/audit'
import { type Actor } from '../services/authz'
import { laundryActor } from '../services/laundryAccess'
import { laundryPricingApi } from './laundryPricingApi'
import { laundryDiscountTotals, laundryPricingKey } from '../services/laundryDiscounts'
import { cents, paymentAmounts, priceLines } from '../services/laundryMath'
import {
  LAUNDRY_STATUSES,
  type LaundryCatalog,
  type LaundryDetail,
  type LaundryLine,
  type LaundryOrder,
  type LaundryPaymentInput,
  type LaundryStatus,
  type NewLaundryOrder,
} from '../types/laundry'

const ORDER_SELECT = `SELECT o.*, COALESCE((SELECT SUM(p.amount_cents) FROM laundry_payments p WHERE p.order_id=o.id),0) AS paid_cents FROM laundry_orders o`
export type LaundryCustomerSummary = { total: number; active: number; outstanding: number }
const byKey = async (table: 'laundry_orders' | 'laundry_payments', key: string, payload: string) => {
  const row = (await querySQL(`SELECT * FROM ${table} WHERE request_key = ?`, [key])).values?.[0]
  if (row && row.request_payload !== payload)
    throw new Error(
      'This request was already saved with different details. Open the saved order before trying again.',
    )
  return row
}
function requestKey(key: string) {
  if (!/^[a-zA-Z0-9:_-]{16,120}$/.test(key)) throw new Error('Invalid request key. Reopen this form.')
}
async function activeShift(actor: Actor): Promise<number> {
  const shift = (await querySQL('SELECT id FROM shifts WHERE employee_id=? AND status=0', [actor.id]))
    .values?.[0]
  if (!shift) throw new Error('Open My Shift before collecting a payment.')
  return shift.id as number
}
function paymentStatement(
  orderId: number | null,
  orderNumber: string | null,
  input: LaundryPaymentInput,
  balance: number,
  shiftId: number,
  actor: Actor,
  at: string,
): SqlStatement {
  requestKey(input.requestKey)
  const { paid, received } = paymentAmounts(input.amount, input.tendered, input.method, balance)
  if ((input.reference?.length ?? 0) > 120) throw new Error('Payment reference is too long.')
  return {
    statement: `INSERT INTO laundry_payments (order_id,request_key,request_payload,method,amount_cents,tendered_cents,reference,shift_id,created_by,created_at) VALUES (COALESCE(?,(SELECT id FROM laundry_orders WHERE order_number=?)),?,?,?,?,?,?,?,?,?)`,
    values: [
      orderId,
      orderNumber,
      input.requestKey,
      JSON.stringify({ orderId, input }),
      input.method,
      paid,
      received,
      input.reference?.trim() || null,
      shiftId,
      actor.id,
      at,
    ],
  }
}
function lineStatements(
  table: 'laundry_order_items' | 'laundry_order_addons',
  number: string,
  lines: LaundryLine[],
): SqlStatement[] {
  return lines.map((line) => ({
    statement: `INSERT INTO ${table} (order_id,${table === 'laundry_order_items' ? 'service_id' : 'addon_id'},name,pricing,quantity_milli,price_cents,total_cents,category) VALUES ((SELECT id FROM laundry_orders WHERE order_number=?),?,?,?,?,?,?,?)`,
    values: [
      number,
      line.id,
      line.name,
      line.pricing,
      line.quantity_milli,
      line.price_cents,
      line.total_cents,
      line.category ?? '',
    ],
  }))
}
export const laundryApi = {
  async catalog(kind: 'services' | 'addons', includeInactive = false): Promise<LaundryCatalog[]> {
    await laundryActor()
    if (!['services', 'addons'].includes(kind)) throw new Error('Invalid catalog.')
    return ((
      await querySQL(
        `SELECT * FROM laundry_${kind} WHERE removed_at IS NULL ${includeInactive ? '' : 'AND is_active=1'} ORDER BY name COLLATE NOCASE`,
      )
    ).values ?? []) as LaundryCatalog[]
  },
  async saveCatalog(
    kind: 'services' | 'addons',
    entry: Omit<LaundryCatalog, 'id'> & { id?: number },
  ): Promise<void> {
    const actor = await laundryActor('products.manage')
    if (!['services', 'addons'].includes(kind)) throw new Error('Invalid catalog.')
    const pricing = kind === 'services' ? ['kg', 'load', 'piece', 'fixed'] : ['fixed', 'quantity']
    if (
      !entry.name.trim() ||
      entry.name.length > 100 ||
      (entry.category?.length ?? 0) > 60 ||
      !pricing.includes(entry.pricing) ||
      !Number.isInteger(entry.price_cents) ||
      entry.price_cents < 0 ||
      entry.price_cents > 100_000_000 ||
      ![0, 1].includes(entry.is_active)
    )
      throw new Error('Enter a name, valid pricing method and nonnegative price.')
    if (entry.id && !(await querySQL(`SELECT id FROM laundry_${kind} WHERE id=? AND removed_at IS NULL`, [entry.id])).values?.length) throw new Error('This item was removed. Refresh the catalogue.')
    await runTransaction([
      entry.id
        ? {
            statement: `UPDATE laundry_${kind} SET name=?,pricing=?,price_cents=?,is_active=?,category=? WHERE id=?`,
            values: [entry.name.trim(), entry.pricing, entry.price_cents, entry.is_active, entry.category?.trim() || '', entry.id],
          }
        : {
            statement: `INSERT INTO laundry_${kind} (name,pricing,price_cents,is_active,category) VALUES (?,?,?,?,?)`,
            values: [entry.name.trim(), entry.pricing, entry.price_cents, entry.is_active, entry.category?.trim() || ''],
          },
      auditStatement(
        'laundry_catalog',
        `${entry.id ? 'Updated' : 'Added'} ${kind}: ${entry.name.trim()}`,
        undefined,
        actor,
      ),
    ])
  },
  async removeCatalog(kind: 'services' | 'addons', id: number): Promise<void> {
    const actor = await laundryActor('products.manage')
    if (!['services', 'addons'].includes(kind) || !Number.isSafeInteger(id) || id <= 0) throw new Error('Select a valid catalogue item.')
    await runTransaction([
      { statement: `UPDATE laundry_${kind} SET is_active=0,removed_at=? WHERE id=?`, values: [new Date().toISOString(), id] },
      auditStatement('laundry_catalog', `Removed ${kind} ${id}; saved orders retained.`, undefined, actor),
    ])
  },
  async list(
    filters: { search?: string; status?: string; date?: string; customerId?: number; page?: number; archived?: boolean } = {},
  ): Promise<{ orders: LaundryOrder[]; count: number }> {
    await laundryActor()
    const clauses: string[] = [filters.archived ? 'o.archived_at IS NOT NULL' : 'o.archived_at IS NULL'],
      values: unknown[] = []
    if (filters.search) {
      clauses.push('(o.order_number LIKE ? OR o.customer_name LIKE ? OR o.customer_phone LIKE ?)')
      const term = `%${filters.search.trim()}%`
      values.push(term, term, term)
    }
    if (filters.status) {
      if (!LAUNDRY_STATUSES.includes(filters.status as LaundryStatus)) throw new Error('Use one of the three laundry statuses.')
      clauses.push('o.status=?')
      values.push(filters.status)
    }
    if (filters.date) {
      const start = new Date(`${filters.date}T00:00:00`),
        end = new Date(start)
      end.setDate(end.getDate() + 1)
      clauses.push('o.created_at >= ? AND o.created_at < ?')
      values.push(start.toISOString(), end.toISOString())
    }
    if (filters.customerId) {
      clauses.push('o.customer_id=?')
      values.push(filters.customerId)
    }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''
    const count =
      (await querySQL(`SELECT COUNT(*) AS n FROM laundry_orders o${where}`, values)).values?.[0]?.n ?? 0
    const orders = ((
      await querySQL(`${ORDER_SELECT}${where} ORDER BY o.created_at DESC,o.id DESC LIMIT 30 OFFSET ?`, [
        ...values,
        Math.max(0, (filters.page ?? 1) - 1) * 30,
      ])
    ).values ?? []) as LaundryOrder[]
    return { orders, count }
  },
  async customerSummaries(customerIds: number[]): Promise<Record<number, LaundryCustomerSummary>> {
    await laundryActor('customers.view')
    const ids = [...new Set(customerIds)]
    if (ids.length > 100 || ids.some(id => !Number.isSafeInteger(id) || id <= 0))
      throw new Error('Select up to 100 valid customers.')
    const summaries: Record<number, LaundryCustomerSummary> = Object.fromEntries(
      ids.map(id => [id, { total: 0, active: 0, outstanding: 0 }]),
    )
    if (!ids.length) return summaries
    // One aggregate for the visible directory page, including orders beyond history pagination.
    const rows = (await querySQL(`SELECT o.customer_id, COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN o.status != 'Completed' THEN 1 ELSE 0 END),0) AS active,
      COALESCE(SUM(o.total_cents - COALESCE((SELECT SUM(p.amount_cents) FROM laundry_payments p WHERE p.order_id=o.id),0)),0) AS outstanding
      FROM laundry_orders o WHERE o.archived_at IS NULL AND o.customer_id IN (${ids.map(() => '?').join(',')}) GROUP BY o.customer_id`, ids)).values ?? []
    for (const row of rows) summaries[Number(row.customer_id)] = {
      total: Number(row.total), active: Number(row.active), outstanding: Number(row.outstanding),
    }
    return summaries
  },
  async customerSummary(customerId: number): Promise<LaundryCustomerSummary> {
    return (await laundryApi.customerSummaries([customerId]))[customerId]!
  },
  async detail(id: number): Promise<LaundryDetail> {
    await laundryActor()
    const order = (await querySQL(`${ORDER_SELECT} WHERE o.id=?`, [id])).values?.[0] as
      LaundryOrder | undefined
    if (!order) throw new Error('Laundry order not found.')
    const [items, addons, payments, history, discounts] = await Promise.all([
      querySQL('SELECT * FROM laundry_order_items WHERE order_id=? ORDER BY id', [id]),
      querySQL('SELECT * FROM laundry_order_addons WHERE order_id=? ORDER BY id', [id]),
      querySQL(
        'SELECT p.*,u.full_name AS staff FROM laundry_payments p JOIN users u ON u.id=p.created_by WHERE order_id=? ORDER BY p.id',
        [id],
      ),
      querySQL(
        "SELECT h.*,CASE WHEN h.event_type='migration' THEN 'System migration' ELSE u.full_name END AS staff FROM laundry_status_history h JOIN users u ON u.id=h.created_by WHERE order_id=? ORDER BY h.id",
        [id],
      ),
      querySQL('SELECT * FROM laundry_order_discounts WHERE order_id=? ORDER BY id', [id]),
    ])
    return {
      ...order,
      items: items.values ?? [],
      addons: addons.values ?? [],
      payments: payments.values ?? [],
      history: history.values ?? [],
      discounts: discounts.values ?? [],
    } as LaundryDetail
  },
  async create(input: NewLaundryOrder): Promise<number> {
    const actor = await laundryActor()
    requestKey(input.requestKey)
    const payload = JSON.stringify(input)
    const prior = await byKey('laundry_orders', input.requestKey, payload)
    if (prior) return prior.id as number
    const customer = (
      await querySQL('SELECT id,full_name,phone FROM customers WHERE id=? AND is_active=1', [
        input.customerId,
      ])
    ).values?.[0]
    if (!customer || !customer.full_name.trim())
      throw new Error('Select an active customer with a name.')
    const [services, addons] = await Promise.all([
      laundryApi.catalog('services'),
      laundryApi.catalog('addons'),
    ])
    const lines = priceLines(input.items, services),
      extras = priceLines(input.addons, addons)
    const discountContext = await laundryPricingApi.context(input.customerId)
    const totals = laundryDiscountTotals(lines, extras, input.discount, input.discountIds ?? [], discountContext)
    if (input.pricingKey && input.pricingKey !== laundryPricingKey(lines, extras, discountContext, input.discountIds ?? []))
      throw new Error('Prices or discount eligibility changed. Return to Review and refresh prices and discounts before saving.')
    const settings = (await querySQL('SELECT max_discount_percent FROM store_settings WHERE id=1'))
      .values?.[0]
    if (
      cents(input.discount) > Math.floor((totals.subtotal * (settings?.max_discount_percent ?? 10)) / 100) &&
      actor.role === 'cashier'
    )
      throw new Error('Ask a manager to record this discount; it exceeds the store limit.')
    if (
      (input.notes?.length ?? 0) > 1000 ||
      (input.pickupAt && !Number.isFinite(new Date(input.pickupAt).getTime()))
    )
      throw new Error('Check the pickup date and notes (maximum 1,000 characters).')
    const number = `L-${crypto.randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase()}`
    const at = new Date().toISOString()
    const statements: SqlStatement[] = [
      {
        statement: `INSERT INTO laundry_orders (order_number,request_key,request_payload,customer_id,customer_name,customer_phone,subtotal_cents,discount_cents,total_cents,pickup_at,notes,created_by,created_at,updated_at,discounts_version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`,
        values: [
          number,
          input.requestKey,
          payload,
          customer.id,
          customer.full_name,
          customer.phone,
          totals.subtotal,
          totals.discount,
          totals.total,
          input.pickupAt ? new Date(input.pickupAt).toISOString() : null,
          input.notes?.trim() || null,
          actor.id,
          at,
          at,
        ],
      },
      ...lineStatements('laundry_order_items', number, lines),
      ...lineStatements('laundry_order_addons', number, extras),
      {
        statement:
          'INSERT INTO laundry_status_history (order_id,status,created_by,created_at) VALUES ((SELECT id FROM laundry_orders WHERE order_number=?),?,?,?)',
        values: [number, 'Received', actor.id, at],
      },
      auditStatement(
        'laundry_order',
        `Created ${number}; value ${totals.total / 100}; discount ${totals.discount / 100}`,
        { type: 'laundry_order', id: number },
        actor,
        at,
      ),
    ]
    for (const applied of totals.applied) {
      const rule = discountContext.discounts.find(row => row.id === applied.discount_id)
      statements.push({
        statement: 'INSERT INTO laundry_order_discounts(order_id,discount_id,name,kind,value,amount_cents,visit_number,rule_json,configuration_revision,discount_revision,created_at) VALUES((SELECT id FROM laundry_orders WHERE order_number=?),?,?,?,?,?,?,?,?,?,?)',
        values: [number, applied.discount_id, applied.name, applied.kind, applied.value, applied.amount_cents, applied.visit_number, applied.rule_json, discountContext.rules.revision, rule?.revision ?? null, at],
      })
      if (applied.visit_number !== null && applied.discount_id !== null && applied.amount_cents > 0) statements.push({
        statement: 'INSERT INTO laundry_visit_redemptions(customer_id,discount_id,visit_number,order_id) VALUES(?,?,?,(SELECT id FROM laundry_orders WHERE order_number=?))',
        values: [input.customerId, applied.discount_id, applied.visit_number, number],
      })
    }
    for (const line of totals.lineDiscounts) statements.push({
      statement: 'INSERT INTO laundry_line_discounts(order_id,kind,catalog_id,amount_cents) VALUES((SELECT id FROM laundry_orders WHERE order_number=?),?,?,?)',
      values: [number, line.kind, line.catalog_id, line.amount_cents],
    })
    if (input.payment) {
      statements.push(
        paymentStatement(null, number, input.payment, totals.total, await activeShift(actor), actor, at),
      )
      statements.push(
        auditStatement(
          'laundry_payment',
          `Initial payment for ${number}: ${input.payment.amount} ${input.payment.method}`,
          { type: 'laundry_order', id: number },
          actor,
          at,
        ),
      )
    }
    try {
      await runTransaction(statements)
    } catch (error) {
      const saved = await byKey('laundry_orders', input.requestKey, payload)
      if (saved) return saved.id as number
      throw error
    }
    const saved = await byKey('laundry_orders', input.requestKey, payload)
    if (!saved) throw new Error('Unable to read the saved order. Search orders before retrying.')
    return saved.id as number
  },
  async pay(orderId: number, input: LaundryPaymentInput): Promise<void> {
    const actor = await laundryActor()
    requestKey(input.requestKey)
    const payload = JSON.stringify({ orderId, input })
    if (await byKey('laundry_payments', input.requestKey, payload)) return
    const order = await laundryApi.detail(orderId)
    if (order.archived_at) throw new Error('Cannot pay an archived legacy order.')
    const at = new Date().toISOString()
    const statement = paymentStatement(
      orderId,
      null,
      input,
      order.total_cents - order.paid_cents,
      await activeShift(actor),
      actor,
      at,
    )
    try {
      await runTransaction([
        statement,
        auditStatement(
          'laundry_payment',
          `${order.order_number}: collected ${input.amount} via ${input.method}${input.method !== 'Cash' ? ' (manual, unverified)' : ''}`,
          { type: 'laundry_order', id: orderId },
          actor,
          at,
        ),
      ])
    } catch (error) {
      if (await byKey('laundry_payments', input.requestKey, payload)) return
      throw error
    }
  },
  async status(id: number, next: LaundryStatus, reason = '', options: { correction?: boolean; confirmed?: boolean; expectedVersion?: number } = {}): Promise<void> {
    const actor = await laundryActor(options.correction ? 'sales.void' : 'sales.process')
    if (!LAUNDRY_STATUSES.includes(next)) throw new Error('Use Received, Ready for Pickup or Completed.')
    if (reason.length > 1000) throw new Error('Keep the status reason within 1,000 characters.')
    const order = await laundryApi.detail(id)
    if (order.archived_at) throw new Error('Archived legacy orders are read-only.')
    if (order.status === next) return
    if (options.expectedVersion !== undefined && options.expectedVersion !== order.status_version) throw new Error('Order status changed. Refresh before trying again.')
    if (options.correction) {
      if (reason.trim().length < 3) throw new Error('Enter a reason for the status correction.')
    } else if (!((order.status === 'Received' && next === 'Ready for Pickup') || (order.status === 'Ready for Pickup' && next === 'Completed'))) {
      throw new Error('Follow Received → Ready for Pickup → Completed. Use an authorized correction to fix a mistake.')
    }
    if (next === 'Completed') {
      if (!options.confirmed) throw new Error('Confirm that the customer has collected the laundry.')
      const rules = await laundryPricingApi.rules()
      if (!rules.allow_unpaid_completion && order.paid_cents < order.total_cents) throw new Error('Shop policy requires payment in full before completing pickup.')
    }
    const at = new Date().toISOString()
    const eventKey = crypto.randomUUID(), version = order.status_version + 1
    const audit = auditStatement('laundry_status', `${order.order_number}: ${options.correction ? 'corrected' : 'changed'} ${order.status} to ${next}${reason.trim() ? ` (${reason.trim()})` : ''}`, { type: 'laundry_order', id }, actor, at)
    await runTransaction([
      {
        statement:
          'INSERT INTO laundry_status_history (order_id,status,from_status,event_type,event_key,status_version,completion_confirmed,reason,created_by,created_at) SELECT id,?,?,?,?,?,?,?,?,? FROM laundry_orders WHERE id=? AND status=? AND status_version=?',
        values: [next, order.status, options.correction ? 'correction' : 'status', eventKey, version, Number(!!options.confirmed), reason.trim() || null, actor.id, at, id, order.status, order.status_version],
      },
      {
        statement: 'UPDATE laundry_orders SET status=?,status_version=?,updated_at=? WHERE id=? AND status=? AND status_version=?',
        values: [next, version, at, id, order.status, order.status_version],
      },
      { statement: 'INSERT INTO audit_logs(user_id,user_name,action,description,entity_type,entity_id,created_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM laundry_status_history WHERE event_key=?)', values: [...audit.values, eventKey] },
    ])
    if ((await laundryApi.detail(id)).status !== next)
      throw new Error('Another update changed this order. Refresh and try again.')
  },
}

export { cents }
