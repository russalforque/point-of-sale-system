import type { StoreSetting } from '../types'
import { querySQL, executeSQL } from '../database/sqlite'
import { runTransaction } from '../database/tx'
import { auditStatement } from '../services/audit'
import { requirePermission } from '../services/authz'
import { ApiError } from '../utils/errors'

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
  max_discount_percent: number | null
  senior_discount_percent: number | null
  loyalty_enabled: number | null
  loyalty_amount_per_point: number | null
  loyalty_point_value: number | null
  credit_enabled: number | null
  credit_default_days: number | null
  allow_negative_stock: number | null
  food_service_enabled: number | null
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
    maxDiscountPercent: row.max_discount_percent ?? 10,
    seniorDiscountPercent: row.senior_discount_percent ?? 20,
    loyaltyEnabled: Boolean(row.loyalty_enabled),
    loyaltyAmountPerPoint: row.loyalty_amount_per_point ?? 100,
    loyaltyPointValue: row.loyalty_point_value ?? 1,
    creditEnabled: Boolean(row.credit_enabled),
    creditDefaultDays: row.credit_default_days ?? 30,
    allowNegativeStock: Boolean(row.allow_negative_stock),
    foodServiceEnabled: Boolean(row.food_service_enabled),
  }
}

function validate(payload: SettingsPayload): void {
  if (!payload.storeName.trim()) throw new ApiError('Enter the store name.', 400)
  if (!Number.isFinite(payload.taxRate) || payload.taxRate < 0 || payload.taxRate > 1) {
    throw new ApiError('Tax rate must be between 0% and 100%.', 400)
  }
  if (!Number.isFinite(payload.maxDiscountPercent) || payload.maxDiscountPercent < 0 || payload.maxDiscountPercent > 100) {
    throw new ApiError('The discount limit must be between 0% and 100%.', 400)
  }
  if (!Number.isFinite(payload.seniorDiscountPercent) || payload.seniorDiscountPercent < 0 || payload.seniorDiscountPercent > 100) {
    throw new ApiError('The Senior/PWD discount must be between 0% and 100%.', 400)
  }
  if (payload.loyaltyEnabled) {
    if (!(payload.loyaltyAmountPerPoint > 0)) throw new ApiError('Enter how much a customer spends to earn 1 point.', 400)
    if (!(payload.loyaltyPointValue > 0)) throw new ApiError('Enter how much 1 point is worth.', 400)
  }
  if (!Number.isInteger(payload.creditDefaultDays) || payload.creditDefaultDays < 0 || payload.creditDefaultDays > 365) {
    throw new ApiError('Credit terms must be 0 to 365 days.', 400)
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
    await requirePermission('settings.manage')
    validate(payload)
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
      maxDiscountPercent: 'discount limit',
      seniorDiscountPercent: 'Senior/PWD discount',
      loyaltyEnabled: 'loyalty',
      loyaltyAmountPerPoint: 'points earning rule',
      loyaltyPointValue: 'point value',
      creditEnabled: 'customer credit',
      creditDefaultDays: 'credit terms',
      allowNegativeStock: 'out-of-stock rule',
      foodServiceEnabled: 'recipes & ingredients',
    }
    const changed = (Object.keys(labels) as (keyof SettingsPayload)[]).filter(
      (key) => (before[key] ?? null) !== (payload[key] ?? null),
    )
    const pct = (value: number) => `${Math.round(value * 10000) / 100}%`
    const describe = (key: keyof SettingsPayload) => {
      switch (key) {
        case 'taxRate':
          return `tax rate ${pct(before.taxRate)} → ${pct(payload.taxRate)}`
        case 'maxDiscountPercent':
          return `discount limit ${before.maxDiscountPercent}% → ${payload.maxDiscountPercent}%`
        case 'seniorDiscountPercent':
          return `Senior/PWD discount ${before.seniorDiscountPercent}% → ${payload.seniorDiscountPercent}%`
        case 'loyaltyEnabled':
          return payload.loyaltyEnabled ? 'loyalty turned on' : 'loyalty turned off'
        case 'creditEnabled':
          return payload.creditEnabled ? 'customer credit turned on' : 'customer credit turned off'
        case 'allowNegativeStock':
          return payload.allowNegativeStock ? 'sales allowed when stock runs out' : 'sales blocked when stock runs out'
        case 'foodServiceEnabled':
          return payload.foodServiceEnabled ? 'recipes & ingredients turned on' : 'recipes & ingredients turned off'
        default:
          return labels[key]
      }
    }

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
          show_logo_on_receipt = ?,
          max_discount_percent = ?,
          senior_discount_percent = ?,
          loyalty_enabled = ?,
          loyalty_amount_per_point = ?,
          loyalty_point_value = ?,
          credit_enabled = ?,
          credit_default_days = ?,
          allow_negative_stock = ?,
          food_service_enabled = ?
         WHERE id = 1`,
        values: [
          payload.storeName.trim(),
          payload.phone ?? null,
          payload.email ?? null,
          payload.address ?? null,
          payload.currency,
          payload.currencySymbol,
          payload.taxRate,
          payload.receiptFooter,
          payload.showLogoOnReceipt ? 1 : 0,
          payload.maxDiscountPercent,
          payload.seniorDiscountPercent,
          payload.loyaltyEnabled ? 1 : 0,
          payload.loyaltyAmountPerPoint,
          payload.loyaltyPointValue,
          payload.creditEnabled ? 1 : 0,
          payload.creditDefaultDays,
          payload.allowNegativeStock ? 1 : 0,
          payload.foodServiceEnabled ? 1 : 0,
        ],
      },
      ...(changed.length
        ? [auditStatement('settings', `Store settings updated: ${changed.map(describe).join(', ')}`, { type: 'settings', id: 1 })]
        : []),
    ])

    return settingsApi.get()
  },
}
