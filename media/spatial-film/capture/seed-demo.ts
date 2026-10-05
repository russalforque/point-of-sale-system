// Capture-only stand-in for src/database/seed.ts: runs the app's real seed, then fills the
// in-browser database with a demo café so every screen in the film shows realistic data.
import { seedDatabase as baseSeed } from '../../../src/database/seed'
import { initDatabase } from './sqlite-web'

const CATEGORIES = ['Coffee', 'Pastries', 'Meals', 'Desserts', 'Drinks']
// name, category index, price, cost, stock, reorder, emoji, tint
const PRODUCTS: [string, number, number, number, number, number, string, string][] = [
  ['Iced Coffee', 0, 120, 38, 64, 15, '🧋', '#fef3c7'],
  ['Café Latte', 0, 140, 45, 52, 15, '☕', '#fde68a'],
  ['Spanish Latte', 0, 155, 50, 41, 12, '🥛', '#fef9c3'],
  ['Americano', 0, 110, 30, 70, 15, '☕', '#e7e5e4'],
  ['Ensaymada', 1, 45, 15, 36, 12, '🥐', '#ffedd5'],
  ['Pandesal (10 pcs)', 1, 50, 18, 80, 20, '🍞', '#fed7aa'],
  ['Ube Cheese Pandesal', 1, 60, 22, 0, 10, '🟣', '#ede9fe'],
  ['Cinnamon Roll', 1, 85, 28, 24, 8, '🥨', '#fde68a'],
  ['Chicken Adobo Rice', 2, 165, 70, 22, 8, '🍗', '#fee2e2'],
  ['Pork Sisig Rice', 2, 175, 75, 18, 8, '🥘', '#ffe4e6'],
  ['Pancit Canton', 2, 95, 35, 27, 8, '🍜', '#fef3c7'],
  ['Tapsilog', 2, 185, 80, 3, 8, '🍳', '#fef9c3'],
  ['Halo-Halo', 3, 140, 48, 30, 10, '🍧', '#fce7f3'],
  ['Leche Flan', 3, 90, 30, 4, 10, '🍮', '#fef3c7'],
  ['Mango Float', 3, 120, 42, 16, 6, '🥭', '#ffedd5'],
  ['Mango Shake', 4, 110, 35, 41, 12, '🥤', '#fef08a'],
  ['Calamansi Juice', 4, 70, 18, 48, 12, '🍋', '#ecfccb'],
  ['Bottled Water', 4, 25, 10, 120, 24, '💧', '#e0f2fe'],
]
const CUSTOMERS = ['Juan Dela Cruz', 'Ana Reyes', 'Paolo Santos', 'Bea Villanueva', 'Carlo Mendoza', 'Liza Garcia', 'Miguel Ramos', 'Trisha Navarro']
const SUPPLIERS = [['SUP-001', 'Benguet Coffee Traders', 'Ramon Bautista'], ['SUP-002', 'Panaderia Supply Co.', 'Grace Lim'], ['SUP-003', 'Metro Fresh Produce', 'Dennis Cruz']]

const image = (emoji: string, tint: string) =>
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><rect width="240" height="240" fill="${tint}"/><text x="120" y="122" font-size="132" text-anchor="middle" dominant-baseline="central" font-family="Noto Color Emoji">${emoji}</text></svg>`)

let seed = 20261005
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)

export async function seedDatabase(): Promise<void> {
  await baseSeed()
  const db = await initDatabase()
  const has = await db.query('SELECT COUNT(*) AS c FROM products')
  if (has.values[0].c > 0) return

  const now = new Date()
  const iso = (d: Date) => d.toISOString()
  const set: { statement: string; values: unknown[] }[] = []
  const q = (statement: string, ...values: unknown[]) => set.push({ statement, values })

  q(`UPDATE users SET full_name = 'Maria Santos' WHERE email = 'admin@sellix.local'`)
  q(`UPDATE store_settings SET store_name = 'Sellix Café', phone = '0917 555 0142', address = '123 Rizal Ave, Manila', receipt_footer = 'Thank you! Come again.' WHERE id = 1`)
  CATEGORIES.forEach((name, i) => q(`INSERT INTO categories (id, name, description, is_active) VALUES (?, ?, NULL, 1)`, i + 1, name))
  SUPPLIERS.forEach(([code, name, contact], i) =>
    q(`INSERT INTO suppliers (id, supplier_code, company_name, contact_person, phone, email, address, is_active) VALUES (?, ?, ?, ?, ?, NULL, 'Metro Manila', 1)`, i + 1, code, name, contact, `0918 555 01${i}0`))
  const created = iso(new Date(now.getTime() - 120 * 864e5))
  PRODUCTS.forEach(([name, cat, price, cost, stock, reorder, emoji, tint], i) =>
    q(`INSERT INTO products (id, sku, name, description, category_id, supplier_id, cost_price, selling_price, stock_quantity, reorder_level, is_active, created_at, updated_at, image_url)
       VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      i + 1, `SKU-${String(1001 + i)}`, name, cat + 1, (cat % 3) + 1, cost, price, stock, reorder, created, iso(now), image(emoji, tint)))
  CUSTOMERS.forEach((name, i) =>
    q(`INSERT INTO customers (id, customer_code, full_name, phone, email, address, is_active, created_at, loyalty_points) VALUES (?, ?, ?, ?, NULL, 'Manila', 1, ?, ?)`,
      i + 1, `CUST-${String(i + 1).padStart(4, '0')}`, name, `0917 555 02${i}${i}`, created, Math.round(rand() * 400)))

  // Today's open shift for the signed-in user.
  const shiftStart = new Date(now); shiftStart.setHours(7, 0, 0, 0)
  q(`INSERT INTO shifts (id, employee_id, employee_name, starting_cash, status, started_at) VALUES (1, 1, 'Maria Santos', 2000, 0, ?)`, iso(shiftStart))

  // ~12 weeks of sales history, busier at lunch and on weekends, trending up.
  let saleId = 0
  const weights = PRODUCTS.map((p) => (p[1] === 0 ? 3 : p[1] === 2 ? 2 : 1.4))
  const totalW = weights.reduce((a, b) => a + b, 0)
  const pick = () => { let r = rand() * totalW; for (let i = 0; i < weights.length; i++) { r -= weights[i]; if (r <= 0) return i } return 0 }
  for (let day = 84; day >= 0; day--) {
    const date = new Date(now); date.setDate(now.getDate() - day)
    const weekend = date.getDay() === 0 || date.getDay() === 6
    const count = Math.round((14 + (84 - day) * 0.12 + rand() * 8) * (weekend ? 1.35 : 1))
    const span = day === 0 ? Math.max(1, now.getHours() + now.getMinutes() / 60 - 7) : 13
    const times = Array.from({ length: count }, () => {
      const at = new Date(date); at.setHours(7, 0, 0, 0)
      return new Date(at.getTime() + Math.pow(rand(), 0.9) * span * 3600e3)
    }).filter((at) => at <= now).sort((a, b) => a.getTime() - b.getTime())
    for (const at of times) {
      saleId++
      const lines = new Map<number, number>()
      const lineCount = 1 + Math.floor(rand() * 3)
      for (let l = 0; l < lineCount; l++) { const p = pick(); lines.set(p, (lines.get(p) ?? 0) + (rand() < 0.25 ? 2 : 1)) }
      const subtotal = [...lines].reduce((s, [p, qty]) => s + PRODUCTS[p][2] * qty, 0)
      const tax = Math.round(subtotal * 0.12 * 100) / 100
      const total = subtotal + tax
      const r = rand(), method = r < 0.55 ? 0 : r < 0.85 ? 2 : 1
      const received = method === 0 ? Math.ceil(total / 100) * 100 + (rand() < 0.3 ? 100 : 0) : null
      const customer = rand() < 0.35 ? 1 + Math.floor(rand() * CUSTOMERS.length) : null
      const invoice = `INV-${String(saleId).padStart(6, '0')}`
      q(`INSERT INTO sales (id, invoice_number, customer_id, cashier_id, shift_id, subtotal, discount, tax, total, status, created_at, order_type) VALUES (?, ?, ?, '1', ?, ?, 0, ?, ?, 1, ?, ?)`,
        saleId, invoice, customer, day === 0 ? 1 : null, subtotal, tax, total, iso(at), rand() < 0.6 ? 0 : 1)
      for (const [p, qty] of lines)
        q(`INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, line_total) VALUES (?, ?, ?, ?, ?)`, saleId, p + 1, qty, PRODUCTS[p][2], PRODUCTS[p][2] * qty)
      q(`INSERT INTO payments (sale_id, method, amount, amount_received, change_amount, reference) VALUES (?, ?, ?, ?, ?, NULL)`,
        saleId, method, total, received, received === null ? null : received - total)
      q(`INSERT INTO sale_payments (sale_id, method, amount, reference) VALUES (?, ?, ?, NULL)`, saleId, method, total)
    }
  }

  // A little stock history for the inventory screens.
  PRODUCTS.forEach(([name, , , , stock], i) => {
    const at = new Date(now.getTime() - (3 + i) * 3600e3 * 7)
    q(`INSERT INTO inventory_transactions (product_id, type, quantity_change, quantity_after, reason, created_by, created_at) VALUES (?, 1, ?, ?, ?, 'Maria Santos', ?)`,
      i + 1, 24, stock + 24, `Stock in from supplier (${name})`, iso(at))
  })
  const audit = [
    ['shift_open', 'Maria Santos opened shift #1 with ₱2,000.00 starting cash', 'shift', '1', 9.5],
    ['stock_receive', 'Received 48 items from Benguet Coffee Traders', 'stock_receipt', '1', 6],
    ['product_update', 'Updated price of Spanish Latte to ₱155.00', 'product', '3', 4],
    ['login', 'Maria Santos signed in', 'user', '1', 9.6],
  ] as const
  audit.forEach(([action, description, type, id, hoursAgo]) =>
    q(`INSERT INTO audit_logs (user_id, user_name, action, description, entity_type, entity_id, created_at) VALUES ('1', 'Maria Santos', ?, ?, ?, ?, ?)`,
      action, description, type, id, iso(new Date(now.getTime() - hoursAgo * 3600e3))))

  await db.executeSet(set, true)
  console.log(`=== DEMO DATA SEEDED: ${saleId} sales ===`)
}
