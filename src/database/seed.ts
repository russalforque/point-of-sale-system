import { initDatabase } from './sqlite'
import { sha256 } from '../utils/hash'

export async function seedDatabase(): Promise<void> {
  const db = await initDatabase()

  const userCount = await db.query('SELECT COUNT(*) AS count FROM users')
  if ((userCount.values?.[0]?.count ?? 0) === 0) {
    const adminHash = await sha256('Admin123!')
    const managerHash = await sha256('Manager123!')
    const cashierHash = await sha256('Cashier123!')

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
  } else {
    // Installs from before the manager role existed won't have this account -
    // add it once, without touching any existing accounts or their data.
    const managerExists = await db.query(`SELECT id FROM users WHERE email = ? LIMIT 1`, [
      'manager@sellix.local',
    ])
    if (!managerExists.values?.length) {
      const managerHash = await sha256('Manager123!')
      await db.run(
        `INSERT INTO users (email, full_name, password_hash, role, is_active) VALUES (?, ?, ?, ?, 1)`,
        ['manager@sellix.local', 'Store Manager', managerHash, 'manager'],
      )
      console.log('=== SEEDED DEFAULT MANAGER ACCOUNT ===')
    }
  }

  const settingsCount = await db.query('SELECT COUNT(*) AS count FROM store_settings')
  if ((settingsCount.values?.[0]?.count ?? 0) === 0) {
    await db.run(
      `INSERT INTO store_settings (id, store_name, phone, email, address, currency, currency_symbol, tax_rate, receipt_footer, show_logo_on_receipt)
       VALUES (1, ?, NULL, NULL, NULL, 'PHP', '₱', 0.12, '', 1)`,
      ['Sellix POS'],
    )

    console.log('=== SEEDED DEFAULT STORE SETTINGS ===')
  }
}
