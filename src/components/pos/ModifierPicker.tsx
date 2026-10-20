import { useEffect, useMemo, useState } from 'react'

import { modifierApi } from '../../api/modifierApi'
import { useAsync } from '../../hooks/useAsync'
import { useDismissOnBack } from '../../hooks/useDismissOnBack'
import type { ModifierGroup, Product } from '../../types'
import { roundMoney } from '../../utils/amount'
import type { CartModifier } from '../../utils/pos'
import { Check, Minus, Plus } from '../ui/Icons'
import { Modal } from '../ui/Modal'
import { Sheet, SheetBody, SheetFooter, SheetHeader } from '../ui/MobileKit'
import { Spinner } from '../ui/States'

/**
 * Options for a product before it goes into the order: Size, Milk, Add-ons… Required groups must
 * be answered; pre-selected options start ticked so a regular order is one tap on "Add".
 * The tablet register shows it as a dialog, the phone register as a bottom sheet.
 */
export function ModifierPicker({
  product,
  money,
  maxQuantity,
  variant,
  onAdd,
  onClose,
}: {
  product: Product
  money: (value: number) => string
  /** Most units that can still be added (stock); Infinity when nothing limits it. */
  maxQuantity: number
  variant: 'modal' | 'sheet'
  onAdd: (modifiers: CartModifier[], quantity: number) => void
  onClose: () => void
}) {
  const groups = useAsync(() => modifierApi.forProduct(product.id), [product.id])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [quantity, setQuantity] = useState(1)
  const [showMissing, setShowMissing] = useState(false)
  const { close } = useDismissOnBack('modifierPickerOpen', onClose)

  // Start from each group's pre-selected option.
  useEffect(() => {
    if (!groups.data) return
    setSelected(new Set(groups.data.flatMap((group) => group.modifiers.filter((modifier) => modifier.isDefault).map((modifier) => modifier.id))))
  }, [groups.data])

  const list = groups.data ?? []
  const chosen: CartModifier[] = useMemo(
    () =>
      list.flatMap((group) =>
        group.modifiers
          .filter((modifier) => selected.has(modifier.id))
          .map((modifier) => ({ id: modifier.id, groupId: group.id, groupName: group.name, name: modifier.name, priceDelta: modifier.priceDelta })),
      ),
    [list, selected],
  )
  const missing = list.filter((group) => group.isRequired && !group.modifiers.some((modifier) => selected.has(modifier.id)))
  const each = roundMoney(product.sellingPrice + chosen.reduce((sum, modifier) => sum + modifier.priceDelta, 0))
  const canAdd = !groups.loading && !groups.error && missing.length === 0 && quantity >= 1 && quantity <= maxQuantity

  function toggle(group: ModifierGroup, modifierId: number) {
    setSelected((current) => {
      const next = new Set(current)
      if (group.selection === 'single') {
        const wasOn = next.has(modifierId)
        for (const modifier of group.modifiers) next.delete(modifier.id)
        // A required single choice can't be cleared, only changed.
        if (!wasOn || group.isRequired) next.add(modifierId)
      } else if (next.has(modifierId)) {
        next.delete(modifierId)
      } else {
        next.add(modifierId)
      }
      return next
    })
  }

  function submit() {
    if (missing.length) {
      setShowMissing(true)
      return
    }
    if (!canAdd) return
    onAdd(chosen, quantity)
  }

  const body = (
    <div className="space-y-5">
      {groups.loading && !groups.data && (
        <div className="py-10">
          <Spinner label="Loading options…" />
        </div>
      )}
      {groups.error && (
        <div className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {groups.error}{' '}
          <button type="button" onClick={() => void groups.reload()} className="font-semibold underline">
            Try again
          </button>
        </div>
      )}
      {list.map((group) => {
        const isMissing = showMissing && missing.includes(group)
        return (
          <fieldset key={group.id}>
            <legend className="flex w-full items-baseline justify-between gap-3">
              <span className="text-[15px] font-semibold text-[#091413]">{group.name}</span>
              <span className={`text-xs ${isMissing ? 'font-semibold text-rose-600' : 'text-slate-500'}`}>
                {isMissing ? 'Choose one' : group.isRequired ? 'Required' : group.selection === 'single' ? 'Optional' : 'Pick any'}
              </span>
            </legend>
            <div
              role={group.selection === 'single' ? 'radiogroup' : 'group'}
              aria-label={group.name}
              className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3"
            >
              {group.modifiers.map((modifier) => {
                const on = selected.has(modifier.id)
                return (
                  <button
                    key={modifier.id}
                    type="button"
                    role={group.selection === 'single' ? 'radio' : 'checkbox'}
                    aria-checked={on}
                    onClick={() => toggle(group, modifier.id)}
                    className={`flex min-h-14 items-center gap-2 rounded-2xl px-3 py-2 text-left transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B] ${
                      on ? 'bg-[#E6F1EA] text-[#1F5E3B] ring-2 ring-[#1F5E3B]' : `bg-[#F3F5F4] text-[#091413] ${isMissing ? 'ring-1 ring-rose-300' : ''}`
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`flex h-5 w-5 shrink-0 items-center justify-center ${group.selection === 'single' ? 'rounded-full' : 'rounded-md'} ${
                        on ? 'bg-[#1F5E3B] text-white' : 'bg-white ring-1 ring-slate-300'
                      }`}
                    >
                      {on && <Check size={10} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium leading-5">{modifier.name}</span>
                      {modifier.priceDelta !== 0 && (
                        <span className="block text-xs tabular-nums text-slate-500">
                          {modifier.priceDelta > 0 ? '+' : '−'}
                          {money(Math.abs(modifier.priceDelta))}
                        </span>
                      )}
                    </span>
                  </button>
                )
              })}
            </div>
          </fieldset>
        )
      })}

      {list.length > 0 && (
        <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
          <span className="text-[15px] font-medium">Quantity</span>
          <div className="flex h-12 items-center rounded-2xl bg-[#E6F1EA] text-[#1F5E3B]">
            <button
              type="button"
              onClick={() => setQuantity((value) => Math.max(1, value - 1))}
              disabled={quantity <= 1}
              aria-label="Fewer"
              className="flex h-full w-12 items-center justify-center rounded-2xl disabled:opacity-30"
            >
              <Minus size={12} />
            </button>
            <span className="w-10 text-center text-base font-semibold tabular-nums" aria-live="polite">
              {quantity}
            </span>
            <button
              type="button"
              onClick={() => setQuantity((value) => value + 1)}
              disabled={quantity + 1 > maxQuantity}
              aria-label="More"
              className="flex h-full w-12 items-center justify-center rounded-2xl disabled:opacity-30"
            >
              <Plus size={12} />
            </button>
          </div>
        </div>
      )}
      {quantity > maxQuantity && <p className="text-sm text-amber-700">Only {maxQuantity} can still be made with the stock on hand.</p>}
    </div>
  )

  const addButton = (
    <button
      type="button"
      onClick={submit}
      disabled={groups.loading || Boolean(groups.error) || quantity > maxQuantity}
      className="flex h-14 w-full items-center justify-between gap-3 rounded-2xl bg-[#1F5E3B] px-5 text-white transition active:scale-[0.99] disabled:bg-slate-200 disabled:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B] focus-visible:ring-offset-2"
    >
      <span className="text-[15px] font-semibold">{missing.length && showMissing ? `Choose a ${missing[0]!.name.toLowerCase()}` : 'Add to order'}</span>
      <span className="text-lg font-semibold tabular-nums">{money(roundMoney(each * quantity))}</span>
    </button>
  )

  if (variant === 'sheet') {
    return (
      <Sheet label={`Options for ${product.name}`} onClose={close}>
        <SheetHeader title={product.name} subtitle={money(product.sellingPrice)} onClose={close} />
        <SheetBody>{body}</SheetBody>
        <SheetFooter>{addButton}</SheetFooter>
      </Sheet>
    )
  }
  return (
    <Modal title={product.name} description={money(product.sellingPrice)} onClose={close} size="md" footer={<div className="w-full">{addButton}</div>}>
      {body}
    </Modal>
  )
}
