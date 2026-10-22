import { querySQL } from '../database/sqlite'
import { runTransaction } from '../database/tx'
import { requirePermission } from '../services/authz'
import { auditStatement } from '../services/audit'
import type { BusinessType } from '../types/laundry'
import { seedLaundryDefaults } from '../database/laundryDefaults'

export const businessApi = {
  async select(type: BusinessType, confirmation: string): Promise<void> {
    const actor = await requirePermission('settings.manage')
    if (!['retail', 'laundry'].includes(type) || confirmation !== `SELECT ${type.toUpperCase()}`)
      throw new Error('Type the confirmation exactly as shown.')
    const rows = await querySQL(
      'SELECT business_type, business_setup_complete FROM store_settings WHERE id = 1',
    )
    if (!rows.values?.length) throw new Error('Store settings are unavailable. Restart the app.')
    await runTransaction([
      {
        statement: 'UPDATE store_settings SET business_type = ?, business_setup_complete = 1 WHERE id = 1',
        values: [type],
      },
      auditStatement(
        'settings',
        `Business type selected: ${type}. Existing retail and laundry records retained.`,
        { type: 'settings', id: 1 },
        actor,
      ),
    ])
    if (type === 'laundry') await seedLaundryDefaults()
  },
}
