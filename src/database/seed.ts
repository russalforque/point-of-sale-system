import { initDatabase } from './sqlite'
import { hashPassword } from '../utils/hash'
import { seedLaundryDefaults } from './laundryDefaults'

export async function seedDatabase(): Promise<void> {
  const db = await initDatabase()

  const userCount = await db.query('SELECT COUNT(*) AS count FROM users')
  if ((userCount.values?.[0]?.count ?? 0) === 0) {
    const adminHash = await hashPassword('Admin123!')
    const managerHash = await hashPassword('Manager123!')
    const cashierHash = await hashPassword('Cashier123!')

    await db.run(
      `INSERT INTO users (email, full_name, password_hash, role, is_active) VALUES (?, ?, ?, ?, 1)`,
      ['admin@sellix.local', 'Store Admin', adminHash, 'admin'],
    )
    await db.run(
      `INSERT INTO users (email, full_name, password_hash, role, is_active) VALUES (?, ?, ?, ?, 1)`,
      ['manager@sellix.local', 'Store Manager', managerHash, 'manager'],
    )
    await db.run(
      `INSERT INTO users (email, full_name, password_hash, role, is_active) VALUES (?, ?, ?, ?, 1)`,
      ['cashier@sellix.local', 'Store Cashier', cashierHash, 'cashier'],
    )

    console.log('=== SEEDED DEFAULT USERS ===')
  }

  const settingsCount = await db.query('SELECT COUNT(*) AS count FROM store_settings')
  if ((settingsCount.values?.[0]?.count ?? 0) === 0) {
    await db.run(
      `INSERT INTO store_settings (id, store_name, phone, email, address, currency, currency_symbol, tax_rate, receipt_footer, show_logo_on_receipt, business_setup_complete)
       VALUES (1, ?, NULL, NULL, NULL, 'PHP', '₱', 0.12, '', 1, 0)`,
      ['Sellix POS'],
    )

    console.log('=== SEEDED DEFAULT STORE SETTINGS ===')
  }
  await seedLaundryDefaults()
}
