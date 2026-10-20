import { useState } from 'react'

import { ingredientApi, type IngredientPayload } from '../../api/ingredientApi'
import { supplierApi } from '../../api/supplierApi'
import { CostPerUnitField, draftToStored, QuantityUnitField, storedToDraft, type QtyDraft } from '../../components/inventory/QuantityUnitField'
import { Check, Plus, Trash2 } from '../../components/ui/Icons'
import { PickerField, PrimaryButton, SwitchRow, TextAreaField, TextButton, TextField } from '../../components/ui/MobileKit'
import { ConfirmDialog, Modal } from '../../components/ui/Modal'
import { useSettings } from '../../context/SettingsContext'
import { useToast } from '../../context/ToastContext'
import { useAsync } from '../../hooks/useAsync'
import { useDismissOnBack } from '../../hooks/useDismissOnBack'
import { BASE_UNITS, metricUnitsFor, PACKAGE_UNITS, unitDef, unitFactor, unitShort, unitsForItem, type BaseUnit, type Conversions } from '../../services/units'
import type { Ingredient } from '../../types'
import { getErrorMessage } from '../../utils/errors'

type PackageDraft = { unit: string; size: QtyDraft }

type Draft = {
  name: string
  sku: string
  baseUnit: BaseUnit
  packages: PackageDraft[]
  purchaseUnit: string
  unitCost: string
  costUnit: string
  reorder: QtyDraft
  opening: QtyDraft
  supplierId: string
  notes: string
  isActive: boolean
}

function biggestMetric(base: BaseUnit): string {
  return base === 'g' ? 'kg' : base === 'ml' ? 'l' : 'pc'
}

function draftFrom(item: Ingredient | null): Draft {
  if (!item) {
    return {
      name: '',
      sku: '',
      baseUnit: 'g',
      packages: [],
      purchaseUnit: '',
      unitCost: '',
      costUnit: 'kg',
      reorder: { text: '', unit: 'g' },
      opening: { text: '', unit: 'g' },
      supplierId: '',
      notes: '',
      isActive: true,
    }
  }
  const packages = Object.entries(item.conversions).map(([unit, size]) => ({
    unit,
    // Shown in the bigger metric unit when it divides nicely (1 kg rather than 1000 g).
    size: storedToDraft(size, size % (1000 * 1000) === 0 && item.baseUnit !== 'pc' ? biggestMetric(item.baseUnit) : item.baseUnit, item.baseUnit),
  }))
  return {
    name: item.name,
    sku: item.sku ?? '',
    baseUnit: item.baseUnit,
    packages,
    purchaseUnit: item.purchaseUnit ?? '',
    unitCost: item.unitCost ? String(item.unitCost) : '',
    costUnit: item.costUnit,
    reorder: storedToDraft(item.reorderLevel, item.purchaseUnit ?? item.baseUnit, item.baseUnit, item.conversions),
    opening: { text: '', unit: item.baseUnit },
    supplierId: item.supplierId ? String(item.supplierId) : '',
    notes: item.notes ?? '',
    isActive: item.isActive,
  }
}

function conversionsOf(draft: Draft): Conversions {
  const conversions: Conversions = {}
  for (const pack of draft.packages) {
    const size = draftToStored(pack.size, draft.baseUnit)
    if (size && size > 0) conversions[pack.unit] = size
  }
  return conversions
}

type Errors = Partial<Record<'name' | 'cost' | 'costUnit' | 'reorder' | 'opening' | 'purchaseUnit', string>> & { packages: Record<string, string> }

function validate(draft: Draft): Errors {
  const errors: Errors = { packages: {} }
  const conversions = conversionsOf(draft)
  if (!draft.name.trim()) errors.name = 'Enter the item name.'
  for (const pack of draft.packages) {
    const size = draftToStored(pack.size, draft.baseUnit)
    if (!size || size <= 0) errors.packages[pack.unit] = `Enter how much one ${unitDef(pack.unit)?.name.toLowerCase()} holds.`
  }
  const cost = draft.unitCost.trim() === '' ? 0 : Number(draft.unitCost)
  if (!Number.isFinite(cost) || cost < 0) errors.cost = 'Enter a cost of 0 or more.'
  if (!unitFactor(draft.costUnit, draft.baseUnit, conversions)) errors.costUnit = 'Choose what the cost is for.'
  if (draft.purchaseUnit && !unitFactor(draft.purchaseUnit, draft.baseUnit, conversions)) errors.purchaseUnit = 'Set this package size above first.'
  if (draft.reorder.text.trim() && draftToStored(draft.reorder, draft.baseUnit, conversions) === null) errors.reorder = 'Enter an amount.'
  if (draft.opening.text.trim() && draftToStored(draft.opening, draft.baseUnit, conversions) === null) errors.opening = 'Enter an amount.'
  return errors
}

const hasErrors = (errors: Errors) => Object.keys(errors).some((key) => key !== 'packages' && errors[key as keyof Errors]) || Object.keys(errors.packages).length > 0

/** Add or edit an ingredient / supply. */
export function IngredientForm({ item, onClose, onSaved }: { item: Ingredient | null; onClose: () => void; onSaved: (item: Ingredient) => void }) {
  const { notify } = useToast()
  const { settings } = useSettings()
  const [draft, setDraft] = useState<Draft>(() => draftFrom(item))
  const [initial] = useState(() => JSON.stringify(draftFrom(item)))
  const [showErrors, setShowErrors] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const suppliers = useAsync(() => supplierApi.list(), [])
  const dirty = JSON.stringify(draft) !== initial
  const { close } = useDismissOnBack('ingredientFormOpen', onClose, busy || dirty, () => !busy && setConfirmDiscard(true))

  const errors = validate(draft)
  const shown = showErrors ? errors : ({ packages: {} } as Errors)
  const conversions = conversionsOf(draft)
  const allUnits = unitsForItem(draft.baseUnit, conversions)
  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }))

  function chooseBase(baseUnit: BaseUnit) {
    if (item) return
    set({
      baseUnit,
      packages: [],
      purchaseUnit: '',
      costUnit: biggestMetric(baseUnit),
      reorder: { text: draft.reorder.text, unit: baseUnit },
      opening: { text: draft.opening.text, unit: baseUnit },
    })
  }

  function requestClose() {
    if (busy) return
    if (dirty) setConfirmDiscard(true)
    else close()
  }

  async function save() {
    setShowErrors(true)
    if (hasErrors(errors) || busy) return
    const payload: IngredientPayload = {
      name: draft.name.trim(),
      sku: draft.sku.trim() || null,
      baseUnit: draft.baseUnit,
      reorderLevel: Math.max(draftToStored(draft.reorder, draft.baseUnit, conversions) ?? 0, 0),
      unitCost: draft.unitCost.trim() === '' ? 0 : Number(draft.unitCost),
      costUnit: draft.costUnit,
      purchaseUnit: draft.purchaseUnit || null,
      conversions,
      supplierId: draft.supplierId ? Number(draft.supplierId) : null,
      notes: draft.notes.trim() || null,
      isActive: draft.isActive,
      ...(item ? {} : { openingQuantity: Math.max(draftToStored(draft.opening, draft.baseUnit, conversions) ?? 0, 0) }),
    }
    setBusy(true)
    try {
      const saved = item ? await ingredientApi.update(item.id, payload) : await ingredientApi.create(payload)
      notify(item ? 'Changes saved.' : `${saved.name} added.`)
      onSaved(saved)
      close()
    } catch (err) {
      notify(getErrorMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  const unusedPackages = PACKAGE_UNITS.filter((unit) => !draft.packages.some((pack) => pack.unit === unit.code))

  return (
    <>
      <Modal
        title={item ? `Edit ${item.name}` : 'Add ingredient or supply'}
        description={item ? undefined : 'Anything your recipes use: beans, milk, syrups, cups, lids.'}
        size="lg"
        mobileFullScreen
        onClose={requestClose}
        preventClose={busy}
        footer={
          <div className="flex w-full items-center gap-3">
            {showErrors && hasErrors(errors) && <p className="text-sm text-rose-600">Fix the highlighted fields.</p>}
            <div className="flex-1" />
            <TextButton onClick={requestClose} disabled={busy} className="h-12">
              Cancel
            </TextButton>
            <PrimaryButton onClick={() => void save()} disabled={busy || (Boolean(item) && !dirty)} className="h-12 flex-none px-8">
              {busy ? 'Saving…' : item ? 'Save changes' : 'Add item'}
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
          <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <TextField label="Name" value={draft.name} onChange={(name) => set({ name })} error={shown.name} placeholder="e.g. Fresh Milk" autoFocus={!item} autoCapitalize="words" />
            <TextField label="Code" optional value={draft.sku} onChange={(sku) => set({ sku })} placeholder="e.g. ING-001" autoComplete="off" />
          </div>

          <fieldset>
            <legend className="text-sm font-medium">Measured in</legend>
            <div role="radiogroup" aria-label="Measured in" className="mt-1.5 grid gap-2 sm:grid-cols-3">
              {BASE_UNITS.map((option) => {
                const on = draft.baseUnit === option.code
                return (
                  <button
                    key={option.code}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    disabled={Boolean(item) && !on}
                    onClick={() => chooseBase(option.code)}
                    className={`flex min-h-14 items-start gap-2.5 rounded-2xl px-3 py-2.5 text-left transition disabled:opacity-40 ${
                      on ? 'bg-[#E6F1EA] ring-2 ring-[#1F5E3B]' : 'bg-[#F3F5F4] hover:bg-[#E9EEEB]'
                    }`}
                  >
                    <span aria-hidden="true" className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${on ? 'bg-[#1F5E3B] text-white' : 'bg-white ring-1 ring-slate-300'}`}>
                      {on && <Check size={10} />}
                    </span>
                    <span>
                      <span className="block text-sm font-semibold">{option.label}</span>
                      <span className="block text-xs text-slate-500">{option.hint}</span>
                    </span>
                  </button>
                )
              })}
            </div>
            <p className="mt-1.5 text-xs text-slate-500">
              {item ? 'Can’t change after the item is created; its history is kept in this unit.' : 'Stock, recipes and counts are all kept in this unit, to the thousandth.'}
            </p>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">
              Package sizes <span className="font-normal text-slate-400">(optional)</span>
            </legend>
            <p className="text-xs text-slate-500">So you can receive and count in bags, bottles or boxes. E.g. 1 bag = 1 kg.</p>
            {draft.packages.map((pack, index) => (
              <div key={pack.unit} className="flex items-start gap-2 rounded-2xl bg-[#F6F8F7] p-3">
                <div className="min-w-0 flex-1">
                  <QuantityUnitField
                    label={`1 ${unitDef(pack.unit)?.name.toLowerCase()} =`}
                    value={pack.size}
                    baseUnit={draft.baseUnit}
                    error={shown.packages[pack.unit]}
                    onChange={(size) => set({ packages: draft.packages.map((entry, i) => (i === index ? { ...entry, size } : entry)) })}
                  />
                </div>
                <button
                  type="button"
                  onClick={() =>
                    set({
                      packages: draft.packages.filter((entry) => entry.unit !== pack.unit),
                      purchaseUnit: draft.purchaseUnit === pack.unit ? '' : draft.purchaseUnit,
                      costUnit: draft.costUnit === pack.unit ? biggestMetric(draft.baseUnit) : draft.costUnit,
                      reorder: draft.reorder.unit === pack.unit ? { text: '', unit: draft.baseUnit } : draft.reorder,
                      opening: draft.opening.unit === pack.unit ? { text: '', unit: draft.baseUnit } : draft.opening,
                    })
                  }
                  aria-label={`Remove ${unitDef(pack.unit)?.name}`}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
            {unusedPackages.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {unusedPackages.map((unit) => (
                  <button
                    key={unit.code}
                    type="button"
                    onClick={() =>
                      set({ packages: [...draft.packages, { unit: unit.code, size: { text: '', unit: metricUnitsFor(draft.baseUnit).at(-1)!.code } }] })
                    }
                    className="inline-flex h-11 items-center gap-1.5 rounded-full bg-[#F3F5F4] px-4 text-sm font-medium text-[#1F5E3B] hover:bg-[#E9EEEB]"
                  >
                    <Plus size={10} />
                    {unit.name}
                  </button>
                ))}
              </div>
            )}
          </fieldset>

          {allUnits.length > 1 && (
            <fieldset>
              <legend className="text-sm font-medium">
                Usually bought in <span className="font-normal text-slate-400">(optional)</span>
              </legend>
              <div role="radiogroup" aria-label="Usually bought in" className="mt-1.5 flex flex-wrap gap-1.5">
                {[{ code: '', label: 'Not set' }, ...allUnits.map((unit) => ({ code: unit.code, label: unitShort(unit.code) }))].map((option) => (
                  <button
                    key={option.code || 'none'}
                    type="button"
                    role="radio"
                    aria-checked={draft.purchaseUnit === option.code}
                    onClick={() => set({ purchaseUnit: option.code })}
                    className={`h-11 rounded-2xl px-4 text-sm font-medium ${
                      draft.purchaseUnit === option.code ? 'bg-[#1F5E3B] text-white' : 'bg-[#F3F5F4] text-slate-600 hover:bg-[#E9EEEB]'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {shown.purchaseUnit && <p className="mt-1.5 text-sm text-rose-600">{shown.purchaseUnit}</p>}
            </fieldset>
          )}

          <CostPerUnitField
            label="Cost"
            amount={draft.unitCost}
            onAmount={(unitCost) => set({ unitCost })}
            unit={draft.costUnit}
            onUnit={(costUnit) => set({ costUnit })}
            baseUnit={draft.baseUnit}
            conversions={conversions}
            currencySymbol={settings.currencySymbol}
            error={shown.cost ?? shown.costUnit}
            hint="Recipe costs and gross profit are worked out from this. Receiving stock can update it."
          />

          <div className="grid gap-5 sm:grid-cols-2">
            <QuantityUnitField
              label="Low-stock alert at"
              optional
              value={draft.reorder}
              onChange={(reorder) => set({ reorder })}
              baseUnit={draft.baseUnit}
              conversions={conversions}
              error={shown.reorder}
            />
            {!item && (
              <QuantityUnitField
                label="Already in stock"
                optional
                value={draft.opening}
                onChange={(opening) => set({ opening })}
                baseUnit={draft.baseUnit}
                conversions={conversions}
                error={shown.opening}
                hint="Recorded as opening stock."
              />
            )}
          </div>

          <PickerField
            label="Preferred supplier"
            optional
            value={draft.supplierId}
            onChange={(supplierId) => set({ supplierId })}
            placeholder="No supplier"
            noneLabel="No supplier"
            emptyText="No suppliers yet. Add one in Suppliers."
            options={(suppliers.data ?? [])
              .filter((s) => s.isActive || String(s.id) === draft.supplierId)
              .map((s) => ({ value: String(s.id), label: s.companyName }))}
          />

          <TextAreaField label="Notes" optional value={draft.notes} onChange={(notes) => set({ notes })} placeholder="Storage, brand, shelf life" />

          {item && (
            <SwitchRow
              label="Active"
              description={draft.isActive ? 'Can be used in recipes and counts' : 'Hidden from recipes and counts; history is kept'}
              checked={draft.isActive}
              onChange={(isActive) => set({ isActive })}
            />
          )}
        </form>
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
