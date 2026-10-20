import { useMemo, useState } from 'react'

import { ingredientApi } from '../../api/ingredientApi'
import { modifierApi, type ModifierEffectInput, type ModifierGroupPayload } from '../../api/modifierApi'
import { productApi } from '../../api/productApi'
import { draftToStored, QuantityUnitField, storedToDraft, type QtyDraft } from '../../components/inventory/QuantityUnitField'
import { Check, ChevronDown, Plus, Trash2 } from '../../components/ui/Icons'
import { PickerField, PrimaryButton, SwitchRow, TextButton, TextField } from '../../components/ui/MobileKit'
import { ConfirmDialog, Modal } from '../../components/ui/Modal'
import { SearchBox } from '../../components/ui/WorkPage'
import { useSettings } from '../../context/SettingsContext'
import { useToast } from '../../context/ToastContext'
import { useAsync } from '../../hooks/useAsync'
import { useDismissOnBack } from '../../hooks/useDismissOnBack'
import { EFFECT_ACTIONS, type EffectAction } from '../../services/recipes'
import type { Ingredient, ModifierGroup } from '../../types'
import { getErrorMessage } from '../../utils/errors'

type EffectDraft = {
  key: string
  action: EffectAction
  itemId: string
  replacementId: string
  amount: QtyDraft
  percent: string
}

type OptionDraft = {
  key: string
  id?: number
  name: string
  price: string
  priceSign: 1 | -1
  isDefault: boolean
  effects: EffectDraft[]
  open: boolean
}

export type GroupDraft = {
  name: string
  selection: 'single' | 'multiple'
  isRequired: boolean
  isActive: boolean
  options: OptionDraft[]
  productIds: number[]
}

let keySeq = 0
const nextKey = () => `k${++keySeq}`

function emptyOption(name = '', price = 0): OptionDraft {
  return { key: nextKey(), name, price: price ? String(Math.abs(price)) : '', priceSign: price < 0 ? -1 : 1, isDefault: false, effects: [], open: false }
}

/** Starting points for the most common café option groups. */
export const TEMPLATES: { label: string; draft: () => GroupDraft }[] = [
  {
    label: 'Size',
    draft: () => ({
      name: 'Size',
      selection: 'single',
      isRequired: true,
      isActive: true,
      productIds: [],
      options: [{ ...emptyOption('Small', -20) }, { ...emptyOption('Medium'), isDefault: true }, emptyOption('Large', 30)],
    }),
  },
  {
    label: 'Milk',
    draft: () => ({ name: 'Milk', selection: 'single', isRequired: false, isActive: true, productIds: [], options: [emptyOption('Oat Milk', 40), emptyOption('Soy Milk', 30)] }),
  },
  {
    label: 'Add-ons',
    draft: () => ({ name: 'Add-ons', selection: 'multiple', isRequired: false, isActive: true, productIds: [], options: [emptyOption('Extra Shot', 30), emptyOption('Extra Syrup', 20)] }),
  },
  {
    label: 'Sugar level',
    draft: () => ({
      name: 'Sugar level',
      selection: 'single',
      isRequired: false,
      isActive: true,
      productIds: [],
      options: [emptyOption('Less Sugar'), emptyOption('No Sugar')],
    }),
  },
]

export function emptyGroup(): GroupDraft {
  return { name: '', selection: 'single', isRequired: false, isActive: true, productIds: [], options: [emptyOption()] }
}

export function groupToDraft(group: ModifierGroup, productIds: number[], ingredients: Ingredient[]): GroupDraft {
  const byId = new Map(ingredients.map((item) => [item.id, item]))
  return {
    name: group.name,
    selection: group.selection,
    isRequired: group.isRequired,
    isActive: group.isActive,
    productIds,
    options: group.modifiers.map((modifier) => ({
      key: nextKey(),
      id: modifier.id,
      name: modifier.name,
      price: modifier.priceDelta ? String(Math.abs(modifier.priceDelta)) : '',
      priceSign: modifier.priceDelta < 0 ? -1 : 1,
      isDefault: modifier.isDefault,
      open: false,
      effects: modifier.effects.map((effect) => {
        const item = effect.inventoryItemId ? byId.get(effect.inventoryItemId) : undefined
        return {
          key: nextKey(),
          action: effect.action,
          itemId: effect.inventoryItemId ? String(effect.inventoryItemId) : '',
          replacementId: effect.replacementItemId ? String(effect.replacementItemId) : '',
          amount:
            effect.quantity && item
              ? storedToDraft(effect.quantity, effect.unitCode ?? item.baseUnit, item.baseUnit, item.conversions)
              : { text: '', unit: item?.baseUnit ?? 'g' },
          percent: effect.scalePercent != null ? String(effect.scalePercent) : '',
        }
      }),
    })),
  }
}

function effectError(effect: EffectDraft, byId: Map<number, Ingredient>): string | null {
  const item = byId.get(Number(effect.itemId))
  switch (effect.action) {
    case 'add': {
      if (!item) return 'Choose the ingredient.'
      const amount = draftToStored(effect.amount, item.baseUnit, item.conversions)
      return amount && amount > 0 ? null : 'Enter how much it uses.'
    }
    case 'remove':
      return item ? null : 'Choose the ingredient to leave out.'
    case 'replace': {
      const replacement = byId.get(Number(effect.replacementId))
      if (!item || !replacement) return 'Choose both ingredients.'
      if (item.id === replacement.id) return 'Choose a different ingredient.'
      if (!effect.amount.text.trim()) return null
      const amount = draftToStored(effect.amount, replacement.baseUnit, replacement.conversions)
      return amount && amount > 0 ? null : 'Enter a valid amount or leave it blank.'
    }
    case 'scale': {
      const percent = Number(effect.percent)
      return effect.percent.trim() && Number.isInteger(percent) && percent >= 0 && percent <= 1000 ? null : 'Enter a percentage, e.g. 150.'
    }
  }
}

function toPayload(draft: GroupDraft, byId: Map<number, Ingredient>): ModifierGroupPayload {
  return {
    name: draft.name.trim(),
    selection: draft.selection,
    isRequired: draft.isRequired,
    isActive: draft.isActive,
    productIds: draft.productIds,
    modifiers: draft.options.map((option) => ({
      id: option.id,
      name: option.name.trim(),
      priceDelta: (Number(option.price) || 0) * option.priceSign,
      isDefault: draft.selection === 'single' && option.isDefault,
      effects: option.effects.map((effect): ModifierEffectInput => {
        const item = byId.get(Number(effect.itemId))
        const replacement = byId.get(Number(effect.replacementId))
        const target = effect.action === 'replace' ? replacement : item
        const amount = target && effect.amount.text.trim() ? draftToStored(effect.amount, target.baseUnit, target.conversions) : null
        return {
          action: effect.action,
          inventoryItemId: effect.action === 'scale' && effect.itemId === '' ? null : Number(effect.itemId) || null,
          replacementItemId: effect.action === 'replace' ? Number(effect.replacementId) || null : null,
          quantity: effect.action === 'add' || effect.action === 'replace' ? amount : null,
          unitCode: effect.action === 'add' || effect.action === 'replace' ? effect.amount.unit : null,
          scalePercent: effect.action === 'scale' ? Number(effect.percent) : null,
        }
      }),
    })),
  }
}

/** Create or edit an option group (Size, Milk, Add-ons…). */
export function ModifierGroupEditor({
  group,
  initial,
  onClose,
  onSaved,
}: {
  /** Existing group, or null for a new one. */
  group: ModifierGroup | null
  initial: GroupDraft
  onClose: () => void
  onSaved: () => void
}) {
  const { notify } = useToast()
  const { settings } = useSettings()
  const [draft, setDraft] = useState<GroupDraft>(initial)
  const [savedJson] = useState(() => JSON.stringify(initial))
  const [showErrors, setShowErrors] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [productSearch, setProductSearch] = useState('')
  const ingredients = useAsync(() => ingredientApi.all(), [])
  const products = useAsync(() => productApi.catalog(), [])
  const dirty = JSON.stringify(draft) !== savedJson
  const { close } = useDismissOnBack('modifierEditorOpen', onClose, busy || dirty, () => !busy && setConfirmDiscard(true))

  const byId = useMemo(() => new Map((ingredients.data ?? []).map((item) => [item.id, item])), [ingredients.data])
  const set = (patch: Partial<GroupDraft>) => setDraft((current) => ({ ...current, ...patch }))
  const setOption = (key: string, patch: Partial<OptionDraft>) =>
    setDraft((current) => ({ ...current, options: current.options.map((option) => (option.key === key ? { ...option, ...patch } : option)) }))
  const setEffect = (optionKey: string, effectKey: string, patch: Partial<EffectDraft>) =>
    setDraft((current) => ({
      ...current,
      options: current.options.map((option) =>
        option.key === optionKey ? { ...option, effects: option.effects.map((effect) => (effect.key === effectKey ? { ...effect, ...patch } : effect)) } : option,
      ),
    }))

  const nameError = !draft.name.trim() ? 'Enter a name, e.g. Size.' : undefined
  const names = draft.options.map((option) => option.name.trim().toLowerCase())
  const optionErrors = new Map<string, string>()
  draft.options.forEach((option, index) => {
    const price = option.price.trim() === '' ? 0 : Number(option.price)
    if (!option.name.trim()) optionErrors.set(option.key, 'Enter the option name.')
    else if (names.indexOf(option.name.trim().toLowerCase()) !== index) optionErrors.set(option.key, 'This name is already in the group.')
    else if (!Number.isFinite(price) || price < 0) optionErrors.set(option.key, 'Enter a valid price.')
  })
  const effectErrors = new Map<string, string>()
  for (const option of draft.options) {
    for (const effect of option.effects) {
      const error = effectError(effect, byId)
      if (error) effectErrors.set(effect.key, error)
    }
  }
  const valid = !nameError && draft.options.length > 0 && optionErrors.size === 0 && effectErrors.size === 0

  function requestClose() {
    if (busy) return
    if (dirty) setConfirmDiscard(true)
    else close()
  }

  async function save() {
    setShowErrors(true)
    if (!valid || busy) {
      // Open the options that have problems so they can be seen.
      setDraft((current) => ({ ...current, options: current.options.map((option) => (option.effects.some((effect) => effectErrors.has(effect.key)) ? { ...option, open: true } : option)) }))
      return
    }
    setBusy(true)
    try {
      const payload = toPayload(draft, byId)
      if (group) await modifierApi.update(group.id, payload)
      else await modifierApi.create(payload)
      notify(group ? 'Options saved.' : `${payload.name} added.`)
      onSaved()
      close()
    } catch (err) {
      notify(getErrorMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  const ingredientOptions = (ingredients.data ?? []).map((item) => ({ value: String(item.id), label: item.name }))
  const term = productSearch.trim().toLowerCase()
  const productList = (products.data ?? []).filter((product) => !term || product.name.toLowerCase().includes(term))

  return (
    <>
      <Modal
        title={group ? `Edit ${group.name}` : 'New option group'}
        description="What the cashier picks when adding a product."
        size="xl"
        mobileFullScreen
        onClose={requestClose}
        preventClose={busy}
        footer={
          <div className="flex w-full items-center gap-3">
            {showErrors && !valid && <p className="text-sm text-rose-600">Fix the highlighted fields.</p>}
            <div className="flex-1" />
            <TextButton onClick={requestClose} disabled={busy} className="h-12">
              Cancel
            </TextButton>
            <PrimaryButton onClick={() => void save()} disabled={busy || (Boolean(group) && !dirty)} className="h-12 flex-none px-8">
              {busy ? 'Saving…' : group ? 'Save changes' : 'Create'}
            </PrimaryButton>
          </div>
        }
      >
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Group name" value={draft.name} onChange={(name) => set({ name })} error={showErrors ? nameError : undefined} placeholder="e.g. Size, Milk, Add-ons" autoFocus={!group} />
            <div>
              <p className="text-sm font-medium">Customer picks</p>
              <div role="radiogroup" aria-label="Customer picks" className="mt-1.5 grid grid-cols-2 gap-2">
                {(['single', 'multiple'] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={draft.selection === value}
                    onClick={() => set({ selection: value, options: value === 'multiple' ? draft.options.map((option) => ({ ...option, isDefault: false })) : draft.options })}
                    className={`h-12 rounded-2xl text-sm font-semibold ${
                      draft.selection === value ? 'bg-[#E6F1EA] text-[#1F5E3B] ring-2 ring-[#1F5E3B]' : 'bg-[#F3F5F4] text-slate-600'
                    }`}
                  >
                    {value === 'single' ? 'One' : 'Any number'}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <SwitchRow
            label="Required"
            description={draft.isRequired ? 'The cashier must choose before adding the product' : 'Can be skipped'}
            checked={draft.isRequired}
            onChange={(isRequired) => set({ isRequired })}
          />

          <section className="space-y-3">
            <h3 className="text-[15px] font-semibold">Options</h3>
            {draft.options.map((option) => {
              const error = showErrors ? optionErrors.get(option.key) : undefined
              return (
                <div key={option.key} className="rounded-2xl bg-[#F6F8F7] p-3">
                  <div className="flex flex-wrap items-start gap-2">
                    <div className="min-w-0 flex-1 basis-48">
                      <TextField label="Option" value={option.name} onChange={(name) => setOption(option.key, { name })} error={error} placeholder="e.g. Large" />
                    </div>
                    <div className="w-44">
                      <p className="text-sm font-medium">Price change</p>
                      <div className="mt-1.5 flex h-12 items-center rounded-2xl bg-white ring-1 ring-slate-200 focus-within:ring-2 focus-within:ring-[#1F5E3B]">
                        <button
                          type="button"
                          onClick={() => setOption(option.key, { priceSign: option.priceSign === 1 ? -1 : 1 })}
                          aria-label={option.priceSign === 1 ? 'Adds to the price; tap to make it a discount' : 'Lowers the price; tap to make it an add-on'}
                          className="h-12 w-11 shrink-0 rounded-l-2xl text-base font-semibold text-[#1F5E3B]"
                        >
                          {option.priceSign === 1 ? '+' : '−'}
                        </button>
                        <span className="text-slate-400">{settings.currencySymbol}</span>
                        <input
                          inputMode="decimal"
                          value={option.price}
                          onChange={(e) => setOption(option.key, { price: e.target.value.replace(/[^\d.]/g, '').slice(0, 9) })}
                          placeholder="0"
                          aria-label={`Price change for ${option.name || 'this option'}`}
                          className="h-12 min-w-0 flex-1 rounded-r-2xl border-0 bg-transparent px-2 text-[15px] tabular-nums outline-none"
                        />
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => set({ options: draft.options.filter((entry) => entry.key !== option.key) })}
                      disabled={draft.options.length === 1}
                      aria-label={`Remove ${option.name || 'option'}`}
                      className="mt-7 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {draft.selection === 'single' && (
                      <button
                        type="button"
                        aria-pressed={option.isDefault}
                        onClick={() => set({ options: draft.options.map((entry) => ({ ...entry, isDefault: entry.key === option.key ? !entry.isDefault : false })) })}
                        className={`inline-flex h-11 items-center gap-2 rounded-full px-3.5 text-sm font-medium ${option.isDefault ? 'bg-[#1F5E3B] text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'}`}
                      >
                        {option.isDefault && <Check size={10} />}
                        Pre-selected
                      </button>
                    )}
                    <button
                      type="button"
                      aria-expanded={option.open}
                      onClick={() => setOption(option.key, { open: !option.open })}
                      className="inline-flex h-11 items-center gap-2 rounded-full bg-white px-3.5 text-sm font-medium text-[#1F5E3B] ring-1 ring-slate-200"
                    >
                      Ingredients{option.effects.length ? ` (${option.effects.length})` : ''}
                      <ChevronDown size={11} className={option.open ? 'rotate-180' : ''} />
                    </button>
                  </div>

                  {option.open && (
                    <div className="mt-3 space-y-2 border-t border-slate-200 pt-3">
                      <p className="text-xs text-slate-500">How this option changes what is used. Leave empty if it only changes the price.</p>
                      {ingredients.data && ingredients.data.length === 0 && <p className="text-sm text-slate-500">Add ingredients first to link them here.</p>}
                      {option.effects.map((effect) => {
                        const item = byId.get(Number(effect.itemId))
                        const replacement = byId.get(Number(effect.replacementId))
                        const amountItem = effect.action === 'replace' ? replacement : item
                        const effectErr = showErrors ? effectErrors.get(effect.key) : undefined
                        return (
                          <div key={effect.key} className="space-y-3 rounded-2xl bg-white p-3 ring-1 ring-slate-100">
                            <div className="flex items-start gap-2">
                              <div role="radiogroup" aria-label="What it does" className="flex flex-1 flex-wrap gap-1.5">
                                {EFFECT_ACTIONS.map((action) => (
                                  <button
                                    key={action.value}
                                    type="button"
                                    role="radio"
                                    aria-checked={effect.action === action.value}
                                    title={action.hint}
                                    onClick={() => setEffect(option.key, effect.key, { action: action.value })}
                                    className={`h-11 rounded-full px-3.5 text-sm font-medium ${
                                      effect.action === action.value ? 'bg-[#1F5E3B] text-white' : 'bg-[#F3F5F4] text-slate-600'
                                    }`}
                                  >
                                    {action.label}
                                  </button>
                                ))}
                              </div>
                              <button
                                type="button"
                                onClick={() => setOption(option.key, { effects: option.effects.filter((entry) => entry.key !== effect.key) })}
                                aria-label="Remove this ingredient change"
                                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                            <p className="text-xs text-slate-500">{EFFECT_ACTIONS.find((action) => action.value === effect.action)?.hint}</p>
                            <div className="grid gap-3 sm:grid-cols-2">
                              <PickerField
                                label={effect.action === 'replace' ? 'Instead of' : effect.action === 'scale' ? 'Ingredient' : effect.action === 'remove' ? 'Leave out' : 'Uses'}
                                value={effect.itemId}
                                noneLabel={effect.action === 'scale' ? 'The whole recipe' : undefined}
                                onChange={(value) => {
                                  const picked = byId.get(Number(value))
                                  setEffect(option.key, effect.key, {
                                    itemId: value,
                                    amount: effect.action === 'add' && picked ? { text: effect.amount.text, unit: picked.baseUnit } : effect.amount,
                                  })
                                }}
                                options={ingredientOptions}
                                placeholder="Choose ingredient"
                                emptyText="No ingredients yet."
                              />
                              {effect.action === 'replace' && (
                                <PickerField
                                  label="Use"
                                  value={effect.replacementId}
                                  onChange={(value) => {
                                    const picked = byId.get(Number(value))
                                    setEffect(option.key, effect.key, { replacementId: value, amount: { text: '', unit: picked?.baseUnit ?? 'ml' } })
                                  }}
                                  options={ingredientOptions}
                                  placeholder="Choose ingredient"
                                  emptyText="No ingredients yet."
                                />
                              )}
                              {effect.action === 'scale' && (
                                <TextField
                                  label="Amount"
                                  value={effect.percent}
                                  onChange={(percent) => setEffect(option.key, effect.key, { percent: percent.replace(/\D/g, '').slice(0, 4) })}
                                  inputMode="numeric"
                                  placeholder="e.g. 150"
                                  trailing={<span className="px-3 text-[15px] text-slate-400">%</span>}
                                  hint="100% = normal, 150% = half more, 50% = half."
                                />
                              )}
                            </div>
                            {(effect.action === 'add' || effect.action === 'replace') && amountItem && (
                              <QuantityUnitField
                                label={effect.action === 'add' ? 'Extra amount' : `Amount of ${amountItem.name}`}
                                optional={effect.action === 'replace'}
                                hint={effect.action === 'replace' ? 'Blank = same amount as the recipe.' : undefined}
                                value={effect.amount}
                                onChange={(amount) => setEffect(option.key, effect.key, { amount })}
                                baseUnit={amountItem.baseUnit}
                                conversions={amountItem.conversions}
                              />
                            )}
                            {effectErr && <p className="text-sm text-rose-600">{effectErr}</p>}
                          </div>
                        )
                      })}
                      {(ingredients.data?.length ?? 0) > 0 && (
                        <button
                          type="button"
                          onClick={() =>
                            setOption(option.key, {
                              effects: [...option.effects, { key: nextKey(), action: 'add', itemId: '', replacementId: '', amount: { text: '', unit: 'g' }, percent: '' }],
                            })
                          }
                          className="inline-flex h-11 items-center gap-2 rounded-full px-3 text-sm font-semibold text-[#1F5E3B] hover:bg-white"
                        >
                          <Plus size={10} />
                          Add ingredient change
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
            <button
              type="button"
              onClick={() => set({ options: [...draft.options, emptyOption()] })}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-[#1F5E3B]/40 text-sm font-semibold text-[#1F5E3B] hover:bg-[#F2F8F4]"
            >
              <Plus size={11} />
              Add option
            </button>
          </section>

          <section className="space-y-2">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-[15px] font-semibold">Offered on</h3>
              <p className="text-sm text-slate-500">
                {draft.productIds.length} {draft.productIds.length === 1 ? 'product' : 'products'}
              </p>
            </div>
            <SearchBox value={productSearch} onChange={setProductSearch} placeholder="Find products" label="Find products" />
            <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto overscroll-contain rounded-2xl ring-1 ring-slate-100">
              {productList.map((product) => {
                const on = draft.productIds.includes(product.id)
                return (
                  <li key={product.id}>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      onClick={() => set({ productIds: on ? draft.productIds.filter((id) => id !== product.id) : [...draft.productIds, product.id] })}
                      className="flex min-h-12 w-full items-center gap-3 px-4 text-left text-[15px] hover:bg-slate-50"
                    >
                      <span aria-hidden="true" className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md ${on ? 'bg-[#1F5E3B] text-white' : 'ring-1 ring-slate-300'}`}>
                        {on && <Check size={10} />}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{product.name}</span>
                      <span className="text-xs text-slate-400">{product.categoryName}</span>
                    </button>
                  </li>
                )
              })}
              {products.data && productList.length === 0 && <li className="px-4 py-4 text-sm text-slate-500">No products match.</li>}
            </ul>
          </section>

          {group && (
            <SwitchRow
              label="Active"
              description={draft.isActive ? 'Shown at the register' : 'Hidden at the register; past sales keep their options'}
              checked={draft.isActive}
              onChange={(isActive) => set({ isActive })}
            />
          )}
        </div>
      </Modal>
      {confirmDiscard && (
        <ConfirmDialog
          title="Discard changes?"
          message="What you entered will not be saved."
          confirmLabel="Discard"
          danger
          onCancel={() => setConfirmDiscard(false)}
          onConfirm={() => {
            setConfirmDiscard(false)
            close()
          }}
        />
      )}
    </>
  )
}
