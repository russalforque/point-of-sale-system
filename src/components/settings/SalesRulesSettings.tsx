import type { ReactNode } from 'react'

import type { SettingsPayload } from '../../api/settingsApi'
import { formatMoney } from '../../utils/format'
import { SwitchRow, TextField } from '../ui/MobileKit'
import { useSettings } from '../../context/SettingsContext'

type SalesRules = Pick<
  SettingsPayload,
  | 'maxDiscountPercent'
  | 'seniorDiscountPercent'
  | 'loyaltyEnabled'
  | 'loyaltyAmountPerPoint'
  | 'loyaltyPointValue'
  | 'creditEnabled'
  | 'creditDefaultDays'
  | 'allowNegativeStock'
  | 'foodServiceEnabled'
>

export type SalesRulesErrors = Partial<Record<keyof SalesRules, string>>

/** Field problems in the discount / loyalty / credit settings; empty when they can be saved. */
export function salesRulesErrors(form: SalesRules): SalesRulesErrors {
  const errors: SalesRulesErrors = {}
  if (!(form.maxDiscountPercent >= 0 && form.maxDiscountPercent <= 100)) errors.maxDiscountPercent = 'Enter 0 to 100.'
  if (!(form.seniorDiscountPercent >= 0 && form.seniorDiscountPercent <= 100)) errors.seniorDiscountPercent = 'Enter 0 to 100.'
  if (form.loyaltyEnabled && !(form.loyaltyAmountPerPoint > 0)) errors.loyaltyAmountPerPoint = 'Enter an amount above zero.'
  if (form.loyaltyEnabled && !(form.loyaltyPointValue > 0)) errors.loyaltyPointValue = 'Enter a value above zero.'
  if (!(Number.isInteger(form.creditDefaultDays) && form.creditDefaultDays >= 0 && form.creditDefaultDays <= 365)) {
    errors.creditDefaultDays = 'Enter 0 to 365 days.'
  }
  return errors
}

const toNumber = (raw: string) => (raw.trim() === '' ? NaN : Number(raw))

/**
 * Discount limits, loyalty points and customer credit. Shared by the tablet and phone Settings
 * pages, which pass their own section wrapper so it matches the rest of the page.
 */
export function SalesRulesSettings({
  form,
  update,
  disabled,
  currencySymbol,
  section,
}: {
  form: SalesRules
  update: (patch: Partial<SalesRules>) => void
  disabled: boolean
  currencySymbol: string
  section: (props: { title: string; description?: string; children: ReactNode }) => ReactNode
}) {
  const { settings } = useSettings()
  const errors = salesRulesErrors(form)
  const money = (value: number) => formatMoney(value, currencySymbol)
  const percentSuffix = <span className="px-3 text-[15px] text-slate-400">%</span>

  const earnExample =
    form.loyaltyAmountPerPoint > 0 && form.loyaltyPointValue > 0
      ? `A ${money(form.loyaltyAmountPerPoint * 10)} purchase earns 10 points, worth ${money(10 * form.loyaltyPointValue)} off a later purchase.`
      : undefined

  if (settings.businessType === 'laundry') return (
    <>{section({
      title: 'Laundry discounts',
      description: 'Cashiers can discount up to this limit. A manager or admin must record larger discounts.',
      children: (
        <TextField
          label="Discount limit for cashiers"
          amount
          value={Number.isNaN(form.maxDiscountPercent) ? '' : form.maxDiscountPercent}
          onChange={(raw) => update({ maxDiscountPercent: toNumber(raw) })}
          error={errors.maxDiscountPercent}
          hint="Percent of the order subtotal."
          trailing={percentSuffix}
          disabled={disabled}
        />
      ),
    })}</>
  )

  return (
    <>
      {section({
        title: 'Discounts',
        description: 'Cashiers can give discounts up to the limit. Anything above it needs a manager or admin PIN.',
        children: (
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Discount limit for cashiers"
              amount
              value={Number.isNaN(form.maxDiscountPercent) ? '' : form.maxDiscountPercent}
              onChange={(raw) => update({ maxDiscountPercent: toNumber(raw) })}
              error={errors.maxDiscountPercent}
              hint="Percent of the order subtotal."
              trailing={percentSuffix}
              disabled={disabled}
            />
            <TextField
              label="Senior citizen / PWD discount"
              amount
              value={Number.isNaN(form.seniorDiscountPercent) ? '' : form.seniorDiscountPercent}
              onChange={(raw) => update({ seniorDiscountPercent: toNumber(raw) })}
              error={errors.seniorDiscountPercent}
              hint="One tap at the register; the ID number is recorded."
              trailing={percentSuffix}
              disabled={disabled}
            />
          </div>
        ),
      })}

      {section({
        title: 'Loyalty points',
        description: 'Customers earn points on purchases and use them as a discount later.',
        children: (
          <div className="space-y-4">
            <SwitchRow
              label="Loyalty points"
              description={form.loyaltyEnabled ? 'Earned when a sale has a customer' : 'Off: no points are earned or redeemed'}
              checked={form.loyaltyEnabled}
              onChange={(loyaltyEnabled) => update({ loyaltyEnabled })}
              disabled={disabled}
            />
            {form.loyaltyEnabled && (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField
                    label="Spend per point"
                    amount
                    prefix={currencySymbol}
                    value={Number.isNaN(form.loyaltyAmountPerPoint) ? '' : form.loyaltyAmountPerPoint}
                    onChange={(raw) => update({ loyaltyAmountPerPoint: toNumber(raw) })}
                    error={errors.loyaltyAmountPerPoint}
                    hint="Customer earns 1 point for every this much paid."
                    disabled={disabled}
                  />
                  <TextField
                    label="Value of 1 point"
                    amount
                    prefix={currencySymbol}
                    value={Number.isNaN(form.loyaltyPointValue) ? '' : form.loyaltyPointValue}
                    onChange={(raw) => update({ loyaltyPointValue: toNumber(raw) })}
                    error={errors.loyaltyPointValue}
                    hint="Discount per point when redeemed."
                    disabled={disabled}
                  />
                </div>
                {earnExample && <p className="text-sm text-slate-500">{earnExample}</p>}
              </>
            )}
          </div>
        ),
      })}

      {section({
        title: 'Customer credit',
        description: 'Let trusted customers buy now and pay later (“utang”). Each customer needs a credit limit.',
        children: (
          <div className="space-y-4">
            <SwitchRow
              label="Charge to account"
              description={form.creditEnabled ? 'Shows as a payment option when a customer is selected' : 'Off: every sale is paid in full'}
              checked={form.creditEnabled}
              onChange={(creditEnabled) => update({ creditEnabled })}
              disabled={disabled}
            />
            {form.creditEnabled && (
              <div className="sm:max-w-xs">
                <TextField
                  label="Payment terms"
                  type="text"
                  inputMode="numeric"
                  value={Number.isNaN(form.creditDefaultDays) ? '' : String(form.creditDefaultDays)}
                  onChange={(raw) => update({ creditDefaultDays: toNumber(raw.replace(/\D/g, '')) })}
                  error={errors.creditDefaultDays}
                  hint="Days until a charged sale is due."
                  trailing={<span className="px-3 text-[15px] text-slate-400">days</span>}
                  disabled={disabled}
                />
              </div>
            )}
          </div>
        ),
      })}

      {section({
        title: 'Inventory',
        description: 'How stock is tracked and what happens when something runs out.',
        children: (
          <div className="space-y-4">
            <SwitchRow
              label="Recipes, ingredients & options"
              description={
                form.foodServiceEnabled
                  ? 'On: products can use up ingredients, be made in batches, and have options like size or oat milk'
                  : 'For cafés, milk tea shops, bakeries and restaurants. Off: products simply count their own stock'
              }
              checked={form.foodServiceEnabled}
              onChange={(foodServiceEnabled) => update({ foodServiceEnabled })}
              disabled={disabled}
            />
            <SwitchRow
              label="Sell even when stock runs out"
              description={
                form.allowNegativeStock
                  ? 'The cashier sees a warning, the sale goes through and stock goes below zero. Fix it with a count later.'
                  : 'Off: a sale that needs more stock or ingredients than you have is blocked.'
              }
              checked={form.allowNegativeStock}
              onChange={(allowNegativeStock) => update({ allowNegativeStock })}
              disabled={disabled}
            />
          </div>
        ),
      })}
    </>
  )
}
