import { querySQL } from '../database/sqlite'
import { requirePermission } from './authz'

export async function laundryActor(permission: 'sales.process' | 'products.manage' | 'sales.void' | 'reports.view' | 'customers.view' | 'settings.manage' = 'sales.process') {
  const actor = await requirePermission(permission)
  const mode = (await querySQL('SELECT business_type,business_setup_complete FROM store_settings WHERE id=1')).values?.[0]
  if (mode?.business_type !== 'laundry' || !mode.business_setup_complete) throw new Error('Select Laundry in business settings first.')
  return actor
}
