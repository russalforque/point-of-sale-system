import { useId } from 'react'

import { formatQty, parseQty, qtyInputValue, toStored, unitFactor, unitShort, unitsForItem, type BaseUnit, type Conversions } from '../../services/units'

/** An amount as typed plus the unit it was typed in. */
export type QtyDraft = { text: string; unit: string }

/** Typed amount → stored thousandths of the base unit; null while empty or invalid. */
export function draftToStored(draft: QtyDraft, baseUnit: BaseUnit, conversions: Conversions = {}): number | null {
  const typed = parseQty(draft.text)
  const factor = unitFactor(draft.unit, baseUnit, conversions)
  if (typed === null || !factor) return null
  return toStored(typed, factor)
}

/** A stored amount shown in `unit` for editing (falls back to the base unit). */
export function storedToDraft(stored: number, unit: string, baseUnit: BaseUnit, conversions: Conversions = {}): QtyDraft {
  const factor = unitFactor(unit, baseUnit, conversions)
  return factor ? { text: stored ? qtyInputValue(stored, factor) : '', unit } : { text: stored ? qtyInputValue(stored) : '', unit: baseUnit }
}

/**
 * Amount + unit, e.g. "5" [bag] or "250" [ml]. Units are big tap targets (no native select,
 * which Android WebView can't style); switching unit keeps the same real amount.
 */
export function QuantityUnitField({
  label,
  value,
  onChange,
  baseUnit,
  conversions = {},
  error,
  hint,
  autoFocus,
  disabled,
  optional,
}: {
  label: string
  value: QtyDraft
  onChange: (value: QtyDraft) => void
  baseUnit: BaseUnit
  conversions?: Conversions
  error?: string
  hint?: string
  autoFocus?: boolean
  disabled?: boolean
  optional?: boolean
}) {
  const id = useId()
  const units = unitsForItem(baseUnit, conversions)
  const stored = draftToStored(value, baseUnit, conversions)
  const inOtherUnit = stored !== null && value.unit !== baseUnit ? formatQty(stored, baseUnit) : null

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium">
        {label} {optional && <span className="font-normal text-slate-400">(optional)</span>}
      </label>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          autoFocus={autoFocus}
          disabled={disabled}
          value={value.text}
          onChange={(e) => onChange({ ...value, text: e.target.value.replace(/[^\d.,]/g, '').slice(0, 14) })}
          placeholder="0"
          aria-invalid={Boolean(error)}
          aria-describedby={error || hint || inOtherUnit ? `${id}-message` : undefined}
          className={`h-12 w-32 rounded-2xl border-0 px-4 text-[15px] tabular-nums outline-none transition focus:bg-white focus:ring-2 ${
            error ? 'bg-rose-50 ring-2 ring-rose-300 focus:ring-rose-500' : 'bg-[#F3F5F4] focus:ring-[#1F5E3B]'
          }`}
        />
        <div role="radiogroup" aria-label={`${label} unit`} className="flex flex-wrap gap-1.5">
          {units.map((unit) => {
            const on = unit.code === value.unit
            return (
              <button
                key={unit.code}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={disabled}
                onClick={() => {
                  const factor = unitFactor(unit.code, baseUnit, conversions)!
                  onChange({ unit: unit.code, text: stored !== null && stored !== 0 ? qtyInputValue(stored, factor) : value.text })
                }}
                className={`h-12 min-w-12 rounded-2xl px-3.5 text-sm font-medium transition disabled:opacity-50 ${
                  on ? 'bg-[#1F5E3B] text-white' : 'bg-[#F3F5F4] text-slate-600 hover:bg-[#E9EEEB]'
                }`}
              >
                {unitShort(unit.code)}
              </button>
            )
          })}
        </div>
      </div>
      {(error || hint || inOtherUnit) && (
        <p id={`${id}-message`} className={`mt-1.5 text-sm ${error ? 'text-rose-600' : 'text-slate-500'}`}>
          {error ?? [inOtherUnit && `= ${inOtherUnit}`, hint].filter(Boolean).join(' · ')}
        </p>
      )}
    </div>
  )
}

/** "₱ [900] per [g] [kg] [bag]": a price for one unit of an item, in any unit it can be measured in. */
export function CostPerUnitField({
  label,
  amount,
  onAmount,
  unit,
  onUnit,
  baseUnit,
  conversions = {},
  currencySymbol,
  error,
  hint,
}: {
  label: string
  amount: string
  onAmount: (value: string) => void
  unit: string
  onUnit: (unit: string) => void
  baseUnit: BaseUnit
  conversions?: Conversions
  currencySymbol: string
  error?: string
  hint?: string
}) {
  const id = useId()
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <div
          className={`flex h-12 w-36 items-center rounded-2xl px-4 transition focus-within:bg-white focus-within:ring-2 ${
            error ? 'bg-rose-50 ring-2 ring-rose-300 focus-within:ring-rose-500' : 'bg-[#F3F5F4] focus-within:ring-[#1F5E3B]'
          }`}
        >
          <span className="text-[15px] text-slate-400">{currencySymbol}</span>
          <input
            id={id}
            inputMode="decimal"
            autoComplete="off"
            value={amount}
            onChange={(e) => onAmount(e.target.value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1').slice(0, 12))}
            placeholder="0.00"
            aria-invalid={Boolean(error)}
            aria-describedby={error || hint ? `${id}-message` : undefined}
            className="h-12 min-w-0 flex-1 border-0 bg-transparent pl-2 text-[15px] tabular-nums outline-none"
          />
        </div>
        <span className="text-sm text-slate-500">per</span>
        <div role="radiogroup" aria-label={`${label}: per`} className="flex flex-wrap gap-1.5">
          {unitsForItem(baseUnit, conversions).map((option) => (
            <button
              key={option.code}
              type="button"
              role="radio"
              aria-checked={unit === option.code}
              onClick={() => onUnit(option.code)}
              className={`h-12 min-w-12 rounded-2xl px-3.5 text-sm font-medium ${
                unit === option.code ? 'bg-[#1F5E3B] text-white' : 'bg-[#F3F5F4] text-slate-600 hover:bg-[#E9EEEB]'
              }`}
            >
              {unitShort(option.code)}
            </button>
          ))}
        </div>
      </div>
      {(error || hint) && (
        <p id={`${id}-message`} className={`mt-1.5 text-sm ${error ? 'text-rose-600' : 'text-xs text-slate-500'}`}>
          {error ?? hint}
        </p>
      )}
    </div>
  )
}
