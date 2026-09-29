import type { StoreSetting } from '../types'
import { querySQL, executeSQL } from '../database/sqlite'
import { runTransaction } from '../database/tx'
import { auditStatement } from '../services/audit'

export type SettingsPayload = Omit<StoreSetting, 'id'>

type SettingsRow = {
  id: number
  store_name: string
  phone: string | null
  email: string | null
  address: string | null
  currency: string
  currency_symbol: string
  tax_rate: number
  receipt_footer: string
  show_logo_on_receipt: number
}

function toStoreSetting(row: SettingsRow): StoreSetting {
  return {
    id: row.id,
    storeName: row.store_name,
    phone: row.phone,
    email: row.email,
    address: row.address,
    currency: row.currency,
    currencySymbol: row.currency_symbol,
    taxRate: row.tax_rate,
    receiptFooter: row.receipt_footer,
    showLogoOnReceipt: Boolean(row.show_logo_on_receipt),
  }
}

export const settingsApi = {
  get: async (): Promise<StoreSetting> => {
    const result = await querySQL(`SELECT * FROM store_settings WHERE id = 1 LIMIT 1`)
    const row = result.values?.[0] as SettingsRow | undefined

    if (!row) {
      await executeSQL(
        `INSERT INTO store_settings (id, store_name, currency, currency_symbol, tax_rate, receipt_footer, show_logo_on_receipt)
         VALUES (1, 'Sellix POS', 'PHP', '₱', 0.12, '', 1)`,
      )
      return settingsApi.get()
    }

    return toStoreSetting(row)
  },

  update: async (payload: SettingsPayload): Promise<StoreSetting> => {
    const before = await settingsApi.get()
    const labels: Record<keyof SettingsPayload, string> = {
      storeName: 'store name',
      phone: 'phone',
      email: 'email',
      address: 'address',
      currency: 'currency',
      currencySymbol: 'currency symbol',
      taxRate: 'tax rate',
      receiptFooter: 'receipt footer',
      showLogoOnReceipt: 'receipt logo',
    }
    const changed = (Object.keys(labels) as (keyof SettingsPayload)[]).filter(
      (key) => (before[key] ?? null) !== (payload[key] ?? null),
    )
    const describe = (key: keyof SettingsPayload) =>
      key === 'taxRate'
        ? `tax rate ${Math.round(before.taxRate * 10000) / 100}% → ${Math.round(payload.taxRate * 10000) / 100}%`
        : labels[key]

    await runTransaction([
      {
        statement: `UPDATE store_settings SET
          store_name = ?,
          phone = ?,
          email = ?,
          address = ?,
          currency = ?,
          currency_symbol = ?,
          tax_rate = ?,
          receipt_footer = ?,
          show_logo_on_receipt = ?
         WHERE id = 1`,
        values: [
          payload.storeName,
          payload.phone ?? null,
          payload.email ?? null,
          payload.address ?? null,
          payload.currency,
          payload.currencySymbol,
          payload.taxRate,
          payload.receiptFooter,
          payload.showLogoOnReceipt ? 1 : 0,
        ],
      },
      ...(changed.length
        ? [auditStatement('settings', `Store settings updated: ${changed.map(describe).join(', ')}`, { type: 'settings', id: 1 })]
        : []),
    ])

    return settingsApi.get()
  },
}
