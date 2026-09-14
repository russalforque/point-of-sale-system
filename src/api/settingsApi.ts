import type { StoreSetting } from '../types'
import { querySQL, executeSQL } from '../database/sqlite'

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
    await executeSQL(
      `UPDATE store_settings SET
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
      [
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
    )

    return settingsApi.get()
  },
}
