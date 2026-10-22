import { querySQL } from '../database/sqlite'
import { runTransaction } from '../database/tx'
import { QUALIFIED_LAUNDRY_VISITS } from '../database/laundryPricingMigration'
import { auditStatement } from '../services/audit'
import { laundryActor } from '../services/laundryAccess'
import type { LaundryDiscount, LaundryDiscountContext, LaundryRules } from '../types/laundry'

function decode(row: any): LaundryDiscount {
  return { ...row, categories: JSON.parse(row.categories_json) }
}
export const laundryPricingApi = {
  async discounts(includeInactive = false): Promise<LaundryDiscount[]> {
    await laundryActor()
    return ((await querySQL(`SELECT * FROM laundry_discounts WHERE removed=0 ${includeInactive ? '' : 'AND is_active=1'} ORDER BY name COLLATE NOCASE`)).values ?? []).map(decode)
  },
  async rules(): Promise<LaundryRules> {
    await laundryActor()
    return (await querySQL('SELECT * FROM laundry_configuration WHERE id=1')).values![0] as LaundryRules
  },
  async context(customerId: number): Promise<LaundryDiscountContext> {
    await laundryActor()
    if (!Number.isSafeInteger(customerId) || customerId <= 0) throw new Error('Choose a customer to check visit rewards.')
    const [rules, discounts, count] = await Promise.all([
      laundryPricingApi.rules(), laundryPricingApi.discounts(), querySQL(QUALIFIED_LAUNDRY_VISITS, [customerId]),
    ])
    const visits = Number(count.values?.[0]?.visits ?? 0)
    const reservations = (await querySQL('SELECT discount_id,visit_number,order_id FROM laundry_visit_redemptions WHERE customer_id=? AND visit_number=?', [customerId, visits + 1])).values ?? []
    return { customer_id: customerId, visits, rules, discounts, reservations } as LaundryDiscountContext
  },
  async saveDiscount(entry: Omit<LaundryDiscount, 'id' | 'revision'> & { id?: number }): Promise<void> {
    const actor = await laundryActor('products.manage')
    if (!entry.name.trim() || entry.name.length > 100 || !['percent', 'fixed'].includes(entry.kind)
      || !Number.isSafeInteger(entry.value) || entry.value < 0 || entry.value > (entry.kind === 'percent' ? 10000 : 100000000)
      || !['order', 'services', 'addons', 'categories'].includes(entry.scope)
      || !Array.isArray(entry.categories) || entry.categories.length > 100 || entry.categories.some(row => typeof row !== 'string' || !row.trim() || row.length > 60)
      || (entry.scope === 'categories' && !entry.categories.length)
      || !Number.isInteger(entry.visit_number) || entry.visit_number < 0 || entry.visit_number > 1000000
      || !Number.isInteger(entry.repeat_every) || entry.repeat_every < 0 || entry.repeat_every > 1000000 || (!entry.visit_number && entry.repeat_every > 0)
      || (entry.weekday !== null && (!Number.isInteger(entry.weekday) || entry.weekday < 0 || entry.weekday > 6))
      || ![0, 1].includes(entry.stackable) || ![0, 1].includes(entry.is_active) || entry.eligibility_note.length > 300)
      throw new Error('Check the discount amount, eligibility and applicability settings.')
    if (entry.id && !(await querySQL('SELECT id FROM laundry_discounts WHERE id=? AND removed=0', [entry.id])).values?.length) throw new Error('This discount was removed. Refresh the catalogue.')
    const values = [entry.name.trim(), entry.kind, entry.value, entry.scope, JSON.stringify([...new Set(entry.categories.map(row => row.trim()))]), entry.visit_number, entry.repeat_every, entry.weekday, entry.stackable, entry.is_active, entry.eligibility_note.trim()]
    await runTransaction([
      entry.id ? { statement: 'UPDATE laundry_discounts SET name=?,kind=?,value=?,scope=?,categories_json=?,visit_number=?,repeat_every=?,weekday=?,stackable=?,is_active=?,eligibility_note=?,revision=revision+1 WHERE id=? AND removed=0', values: [...values, entry.id] }
        : { statement: 'INSERT INTO laundry_discounts(name,kind,value,scope,categories_json,visit_number,repeat_every,weekday,stackable,is_active,eligibility_note) VALUES(?,?,?,?,?,?,?,?,?,?,?)', values },
      auditStatement('discount', `Laundry: ${entry.id ? 'updated' : 'added'} discount ${entry.name.trim()}`, undefined, actor),
    ])
  },
  async removeDiscount(id: number): Promise<void> {
    const actor = await laundryActor('products.manage')
    await runTransaction([
      { statement: 'UPDATE laundry_discounts SET removed=1,is_active=0,revision=revision+1 WHERE id=?', values: [id] },
      auditStatement('discount', `Laundry: removed discount ${id}; saved discounts retained.`, undefined, actor),
    ])
  },
  async saveRules(rules: LaundryRules): Promise<void> {
    const actor = await laundryActor('settings.manage')
    if (![0, 1].includes(rules.allow_stacking) || ![0, 1].includes(rules.visit_require_paid) || !['Completed', 'Ready for Pickup'].includes(rules.visit_status)
      || ![0, 1].includes(rules.allow_unpaid_completion ?? 0)
      || !['subtotal', 'total'].includes(rules.visit_basis) || !Number.isSafeInteger(rules.visit_minimum_cents) || rules.visit_minimum_cents < 0 || rules.visit_minimum_cents > 100000000)
      throw new Error('Check visit qualification and stacking rules.')
    await runTransaction([
      { statement: 'UPDATE laundry_configuration SET allow_stacking=?,visit_status=?,visit_require_paid=?,visit_minimum_cents=?,visit_basis=?,allow_unpaid_completion=?,revision=revision+1 WHERE id=1', values: [rules.allow_stacking, rules.visit_status, rules.visit_require_paid, rules.visit_minimum_cents, rules.visit_basis, rules.allow_unpaid_completion ?? 0] },
      auditStatement('settings', `Laundry visit and discount rules: ${JSON.stringify(rules)}`, undefined, actor),
    ])
  },
}
