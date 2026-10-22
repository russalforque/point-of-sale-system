import { useAuth } from '../../context/AuthContext'
import type { CheckoutState } from '../../context/CheckoutContext'
import type { CheckoutTotals } from '../../services/checkout'
import type { StoreSetting } from '../../types'
import { formatMoney } from '../../utils/format'
import { AmountInput } from '../ui/AmountInput'
import { X } from '../ui/Icons'

/** Shared money-entry control for retail and laundry manual discounts. */
export function DiscountAmountInput({ id, value, onChange, currencySymbol, disabled }: {
  id: string; value: string | number; onChange: (value: string) => void; currencySymbol: string; disabled?: boolean
}) {
  return <><span className="text-slate-400">{currencySymbol}</span><AmountInput id={id} value={value} placeholder="0.00" disabled={disabled} onChange={onChange}
    className="h-9 w-24 rounded-lg border-0 bg-[#F3F5F4] px-2.5 text-right text-sm tabular-nums text-[#091413] outline-none focus:bg-white focus:ring-2 focus:ring-[#1F5E3B] disabled:opacity-50 pointer-coarse:h-11" /></>
}

/**
 * Order discount on the register: a typed amount, or one tap for the Senior Citizen / PWD
 * discount (which follows the subtotal and records the ID number). Shared by both registers.
 */
export function DiscountControl({
  checkout,
  onChange,
  totals,
  settings,
  disabled,
}: {
  checkout: CheckoutState
  onChange: (patch: Partial<CheckoutState>) => void
  totals: CheckoutTotals
  settings: StoreSetting
  disabled?: boolean
}) {
  const { can } = useAuth()
  const money = (value: number) => formatMoney(value, settings.currencySymbol)
  const senior = checkout.discountType === 'senior_pwd'
  const seniorAvailable = settings.seniorDiscountPercent > 0

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-slate-500">
        <label htmlFor="register-discount">Discount</label>
        <div className="flex items-center gap-1.5">
          {seniorAvailable && !senior && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange({ discountType: 'senior_pwd', discount: 0 })}
              className="h-9 rounded-lg px-2.5 text-xs font-medium text-[#1F5E3B] transition hover:bg-[#E6F1EA] disabled:opacity-40 pointer-coarse:h-11"
            >
              Senior/PWD
            </button>
          )}
          {senior ? (
            <span className="text-sm tabular-nums text-[#091413]">−{money(totals.manualDiscount)}</span>
          ) : (
            <>
              <DiscountAmountInput
                id="register-discount"
                currencySymbol={settings.currencySymbol}
                value={checkout.discount || ''}
                disabled={disabled}
                onChange={(value) => onChange({ discount: Math.max(0, Number(value) || 0) })}
              />
            </>
          )}
        </div>
      </div>

      {senior && (
        <div className="flex items-center gap-2 rounded-xl bg-[#F2F8F4] py-1.5 pl-3 pr-1">
          <span className="shrink-0 text-xs font-medium text-[#1F5E3B]">Senior/PWD {settings.seniorDiscountPercent}%</span>
          <input
            type="text"
            aria-label="Senior Citizen or PWD ID number"
            placeholder="ID number"
            value={checkout.discountReference}
            disabled={disabled}
            autoCapitalize="characters"
            onChange={(event) => onChange({ discountReference: event.target.value.slice(0, 40) })}
            className={`h-9 min-w-0 flex-1 rounded-lg border-0 bg-white px-2.5 text-sm outline-none focus:ring-2 focus:ring-[#1F5E3B] pointer-coarse:h-11 ${
              checkout.discountReference.trim() ? '' : 'ring-1 ring-amber-300'
            }`}
          />
          <button
            type="button"
            onClick={() => onChange({ discountType: 'manual', discountReference: '', discount: 0 })}
            aria-label="Remove Senior/PWD discount"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-white pointer-coarse:h-11 pointer-coarse:w-11"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {senior && !checkout.discountReference.trim() && (
        <p className="text-right text-xs text-amber-700">Enter the ID number before charging.</p>
      )}
      {!senior && checkout.discount > totals.subtotal && checkout.cart.length > 0 && (
        <p className="text-right text-xs text-amber-700">Capped at the subtotal ({money(totals.subtotal)}).</p>
      )}
      {totals.overLimit && (
        <p className="text-right text-xs text-amber-700">
          {Math.round(totals.discountPercent)}% is above the {settings.maxDiscountPercent}% limit
          {can('sales.discount') ? '.' : ' — a manager PIN is needed to charge.'}
        </p>
      )}
    </div>
  )
}
