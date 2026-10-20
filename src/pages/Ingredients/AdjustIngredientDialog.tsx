import { useState } from 'react'

import { ingredientApi } from '../../api/ingredientApi'
import { CostPerUnitField, draftToStored, QuantityUnitField, type QtyDraft } from '../../components/inventory/QuantityUnitField'
import { PrimaryButton, TextButton } from '../../components/ui/MobileKit'
import { Modal } from '../../components/ui/Modal'
import { ReasonField } from '../../components/ui/WorkPage'
import { useAuth } from '../../context/AuthContext'
import { useSettings } from '../../context/SettingsContext'
import { useToast } from '../../context/ToastContext'
import { useDismissOnBack } from '../../hooks/useDismissOnBack'
import { ADJUSTMENT_TYPES, WASTE_TYPES } from '../../services/inventoryMovements'
import { formatQty } from '../../services/units'
import type { Ingredient, StockMovementType } from '../../types'
import { getErrorMessage } from '../../utils/errors'
import { formatMoney } from '../../utils/format'

const SUGGESTIONS: Partial<Record<StockMovementType, string[]>> = {
  stock_in: ['Supplier delivery', 'Bought at market', 'Transfer in'],
  stock_out: ['Used for staff', 'Transfer out', 'Returned to supplier'],
  waste: ['Spilled', 'Wrong order remade', 'Dropped', 'Over-poured'],
  spoilage: ['Spoiled', 'Gone sour', 'Moldy'],
  expired: ['Past expiry date', 'Opened too long'],
  damaged: ['Broken', 'Leaking', 'Torn packaging'],
  correction: ['Miscounted', 'Entered wrong amount', 'Found more'],
  other: ['Sample / tasting', 'Training'],
}

const isWaste = (type: StockMovementType) => (WASTE_TYPES as readonly string[]).includes(type)

/** Stock in, waste and manual corrections for one ingredient. Every save is a stock movement. */
export function AdjustIngredientDialog({
  item,
  initialType,
  onClose,
  onSaved,
}: {
  item: Ingredient
  initialType: StockMovementType
  onClose: () => void
  onSaved: (item: Ingredient) => void
}) {
  const { notify } = useToast()
  const { can } = useAuth()
  const { settings } = useSettings()
  const money = (value: number) => formatMoney(value, settings.currencySymbol)
  const types = ADJUSTMENT_TYPES.filter((kind) =>
    isWaste(kind.type) ? can('inventory.waste') : kind.type === 'stock_in' ? can('inventory.receive') : can('inventory.manage'),
  )
  const [type, setType] = useState<StockMovementType>(types.some((kind) => kind.type === initialType) ? initialType : types[0]?.type ?? 'waste')
  const kind = ADJUSTMENT_TYPES.find((entry) => entry.type === type)!
  const [direction, setDirection] = useState<1 | -1>(1)
  const defaultUnit = (next: StockMovementType) => (next === 'stock_in' && item.purchaseUnit ? item.purchaseUnit : item.baseUnit)
  const [amount, setAmount] = useState<QtyDraft>({ text: '', unit: defaultUnit(type) })
  const [reason, setReason] = useState('')
  const [unitCost, setUnitCost] = useState(item.unitCost ? String(item.unitCost) : '')
  const [costUnit, setCostUnit] = useState(item.costUnit)
  const [showErrors, setShowErrors] = useState(false)
  const [busy, setBusy] = useState(false)
  const { close } = useDismissOnBack('adjustIngredientOpen', onClose, busy)

  const sign = kind.sign === 0 ? direction : kind.sign
  const stored = draftToStored(amount, item.baseUnit, item.conversions)
  const delta = stored !== null ? stored * sign : null
  const after = delta !== null ? item.onHand + delta : null
  const tooMuch = after !== null && after < 0 && delta! < 0 && !settings.allowNegativeStock
  const amountError = !amount.text.trim() ? 'Enter an amount.' : stored === null || stored <= 0 ? 'Enter an amount above zero.' : tooMuch ? `Only ${formatQty(Math.max(item.onHand, 0), item.baseUnit)} on hand.` : undefined
  const reasonError = kind.reasonRequired && reason.trim().length < 3 ? 'Enter a reason.' : undefined
  const costValue = unitCost.trim() === '' ? null : Number(unitCost)
  const costError = costValue !== null && (!Number.isFinite(costValue) || costValue < 0) ? 'Enter a cost of 0 or more.' : undefined
  const valid = !amountError && !reasonError && !costError

  function pickType(next: StockMovementType) {
    setType(next)
    setAmount((current) => ({ ...current, unit: next === 'stock_in' && !current.text ? defaultUnit(next) : current.unit }))
    setReason('')
    setShowErrors(false)
  }

  async function save() {
    setShowErrors(true)
    if (!valid || busy || delta === null) return
    setBusy(true)
    try {
      const updated = await ingredientApi.adjust({
        inventoryItemId: item.id,
        type,
        delta,
        reason: reason.trim() || undefined,
        ...(type === 'stock_in' && costValue !== null ? { unitCost: costValue, costUnit } : {}),
      })
      notify(`${item.name}: ${formatQty(item.onHand, item.baseUnit)} → ${formatQty(updated.onHand, updated.baseUnit)}`)
      onSaved(updated)
      close()
    } catch (err) {
      notify(getErrorMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  const verb = type === 'stock_in' ? 'Add' : isWaste(type) ? `Record ${kind.label.toLowerCase()}` : sign > 0 ? 'Add' : 'Remove'

  return (
    <Modal
      title={item.name}
      description={`${formatQty(item.onHand, item.baseUnit)} on hand`}
      size="md"
      mobileFullScreen
      onClose={close}
      preventClose={busy}
      footer={
        <div className="flex w-full items-center gap-3">
          <div className="flex-1" />
          <TextButton onClick={close} disabled={busy} className="h-12">
            Cancel
          </TextButton>
          <PrimaryButton onClick={() => void save()} disabled={busy} className="h-12 flex-none px-6">
            {busy ? 'Saving…' : stored ? `${verb} ${formatQty(stored, item.baseUnit)}` : verb}
          </PrimaryButton>
        </div>
      }
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
        className="space-y-5"
      >
        {types.length > 1 && (
          <div role="radiogroup" aria-label="What happened" className="flex flex-wrap gap-2">
            {types.map((option) => (
              <button
                key={option.type}
                type="button"
                role="radio"
                aria-checked={type === option.type}
                onClick={() => pickType(option.type)}
                className={`h-11 rounded-full px-4 text-sm font-medium transition ${
                  type === option.type ? 'bg-[#1F5E3B] text-white' : 'bg-[#F3F5F4] text-slate-600 hover:bg-[#E9EEEB]'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}

        {kind.sign === 0 && (
          <div role="radiogroup" aria-label="Direction" className="grid grid-cols-2 gap-2">
            {([1, -1] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={direction === value}
                onClick={() => setDirection(value)}
                className={`h-12 rounded-2xl text-sm font-semibold ${direction === value ? 'bg-[#E6F1EA] text-[#1F5E3B] ring-2 ring-[#1F5E3B]' : 'bg-[#F3F5F4] text-slate-600'}`}
              >
                {value > 0 ? 'Add to stock' : 'Take from stock'}
              </button>
            ))}
          </div>
        )}

        <QuantityUnitField
          label={type === 'stock_in' ? 'Amount received' : isWaste(type) ? 'Amount lost' : 'Amount'}
          value={amount}
          onChange={setAmount}
          baseUnit={item.baseUnit}
          conversions={item.conversions}
          error={showErrors ? amountError : undefined}
          autoFocus
        />

        {after !== null && stored !== null && stored > 0 && (
          <p className={`rounded-2xl px-4 py-3 text-sm ${tooMuch ? 'bg-rose-50 text-rose-700' : after < 0 ? 'bg-amber-50 text-amber-800' : 'bg-[#F6F8F7] text-slate-600'}`}>
            {formatQty(item.onHand, item.baseUnit)} → <span className="font-semibold">{formatQty(after, item.baseUnit)}</span>
            {after < 0 && !tooMuch && ' (below zero, allowed by your settings)'}
            {isWaste(type) && item.costPerBase > 0 && ` · worth ${money((stored / 1000) * item.costPerBase)}`}
          </p>
        )}

        {type === 'stock_in' && (
          <CostPerUnitField
            label="Cost (optional)"
            amount={unitCost}
            onAmount={setUnitCost}
            unit={costUnit}
            onUnit={setCostUnit}
            baseUnit={item.baseUnit}
            conversions={item.conversions}
            currencySymbol={settings.currencySymbol}
            error={showErrors ? costError : undefined}
            hint="A new price here updates the item’s cost and every recipe using it."
          />
        )}

        <ReasonField
          label={kind.reasonRequired ? 'Reason' : 'Note (optional)'}
          value={reason}
          onChange={setReason}
          suggestions={SUGGESTIONS[type] ?? []}
          error={showErrors ? reasonError : undefined}
          disabled={busy}
        />
      </form>
    </Modal>
  )
}
