import { runTransaction, type SqlStatement } from './tx'

const offerings = [
  ['services', '1-DRY', 6500, 'Core services'],
  ['services', '1-FOLD', 3000, 'Core services'],
  ['services', '1-WASH', 8000, 'Core services'],
  ['services', 'Bedsheets / Linens', 18500, 'Special-item services'],
  ['services', 'Comforter', 20000, 'Special-item services'],
  ['services', 'Drop Off', 17500, 'Core services'],
  ['addons', 'Extra Detergent', 1500, 'Optional add-ons'],
  ['addons', 'Extra Fabcon', 1500, 'Optional add-ons'],
  ['addons', 'Extra Wash / Rinse / Dry', 2000, 'Optional add-ons'],
  ['services', 'Rush Order', 24500, 'Core services'],
  ['services', 'Self-Service', 14500, 'Core services'],
] as const

/** All inserts and the marker commit together. Names already customized by the shop win. */
export async function seedLaundryDefaults(): Promise<void> {
  const statements: SqlStatement[] = offerings.map(([kind, name, price, category]) => ({
    statement: `INSERT INTO laundry_${kind}(name,pricing,price_cents,is_active,category)
      SELECT ?,'fixed',?,1,? WHERE (SELECT defaults_version FROM laundry_configuration WHERE id=1)=0
      AND EXISTS(SELECT 1 FROM store_settings WHERE id=1 AND business_type='laundry' AND business_setup_complete=1)
      AND NOT EXISTS(SELECT 1 FROM laundry_services WHERE lower(trim(name))=lower(?))
      AND NOT EXISTS(SELECT 1 FROM laundry_addons WHERE lower(trim(name))=lower(?))`,
    values: [name, price, category, name, name],
  }))
  for (const [name, kind, value, visit, weekday, note] of [
    ['10th Visit', 'percent', 10000, 10, null, 'Reward for the 10th qualifying visit.'],
    ['5th Visit', 'percent', 2000, 5, null, 'Reward for the 5th qualifying visit.'],
    ['Student', 'fixed', 3000, 0, null, 'Confirm the customer has a valid student ID.'],
    ['Wednesday Promo', 'fixed', 3000, 0, 3, 'Available on Wednesdays.'],
  ] as const) statements.push({
    statement: `INSERT INTO laundry_discounts(name,kind,value,visit_number,weekday,eligibility_note)
      SELECT ?,?,?,?,?,? WHERE (SELECT defaults_version FROM laundry_configuration WHERE id=1)=0
      AND EXISTS(SELECT 1 FROM store_settings WHERE id=1 AND business_type='laundry' AND business_setup_complete=1)
      AND NOT EXISTS(SELECT 1 FROM laundry_discounts WHERE lower(trim(name))=lower(?))`,
    values: [name, kind, value, visit, weekday, note, name],
  })
  statements.push({ statement: `UPDATE laundry_configuration SET defaults_version=1 WHERE id=1 AND defaults_version=0 AND EXISTS(SELECT 1 FROM store_settings WHERE id=1 AND business_type='laundry' AND business_setup_complete=1)`, values: [] })
  await runTransaction(statements)
}
