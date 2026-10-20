import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

import type { ProductPayload } from '../../api/productApi'
import type { Ingredient, ModifierGroup, Product, ProductRecipe } from '../../types'
import { costBreakdown, INVENTORY_MODES, type InventoryMode } from '../../services/recipes'
import {
  formatQty,
  parseQty,
  qtyCost,
  qtyInputValue,
  toStored,
  unitFactor,
  unitShort,
  unitsForItem,
  type BaseUnit,
  type Conversions,
} from '../../services/units'
import { Check, Plus, Trash2 } from '../ui/Icons'
import { PickerSheet, SwitchRow } from '../ui/MobileKit'

/**
 * "Inventory tracking" on the Add/Edit Product form (tablet and phone). Retail stores see one
 * switch: count this product's stock, or don't. With recipes & ingredients turned on in Settings
 * the four ways appear, and the recipe builder / batch settings / options only show for the way
 * that needs them.
 */

export type RecipeDraftLine = {
  inventoryItemId: number
  name: string
  baseUnit: BaseUnit
  conversions: Conversions
  costPerBase: number
  onHand: number
  /** As typed, in `unitCode`. */
  quantityText: string
  unitCode: string
}

export type TrackingDraft = {
  inventoryMode: InventoryMode
  batchYield: string
  recipe: RecipeDraftLine[]
  modifierGroupIds: number[]
  /** The product had recipe lines when the form opened (they're cleared if it stops using them). */
  hadRecipe: boolean
}

export function emptyTracking(): TrackingDraft {
  return { inventoryMode: 'direct', batchYield: '', recipe: [], modifierGroupIds: [], hadRecipe: false }
}

export function trackingFromProduct(product: Product, recipe: ProductRecipe): TrackingDraft {
  return {
    inventoryMode: product.inventoryMode,
    batchYield: product.batchYield ? String(product.batchYield) : '',
    recipe: recipe.lines.map((line) => ({
      inventoryItemId: line.inventoryItemId,
      name: line.name,
      baseUnit: line.baseUnit,
      conversions: line.conversions,
      costPerBase: line.costPerBase,
      onHand: line.onHand,
      unitCode: unitFactor(line.unitCode, line.baseUnit, line.conversions) ? line.unitCode : line.baseUnit,
      quantityText: qtyInputValue(line.quantity, unitFactor(line.unitCode, line.baseUnit, line.conversions) ?? 1000),
    })),
    modifierGroupIds: recipe.modifierGroupIds,
    hadRecipe: recipe.lines.length > 0,
  }
}

const usesRecipe = (mode: InventoryMode) => mode === 'recipe' || mode === 'batch'

/** Stored quantity of a draft line, or null while it isn't a valid amount. */
function lineQuantity(line: RecipeDraftLine): number | null {
  const typed = parseQty(line.quantityText)
  const factor = unitFactor(line.unitCode, line.baseUnit, line.conversions)
  if (typed === null || !factor) return null
  const stored = toStored(typed, factor)
  return stored > 0 ? stored : null
}

export type TrackingErrors = { recipe?: string; batchYield?: string; lines: Record<number, string> }

export function trackingErrors(draft: TrackingDraft): TrackingErrors {
  const errors: TrackingErrors = { lines: {} }
  if (!usesRecipe(draft.inventoryMode)) return errors
  for (const line of draft.recipe) {
    if (!line.quantityText.trim()) errors.lines[line.inventoryItemId] = 'Enter an amount.'
    else if (lineQuantity(line) === null) errors.lines[line.inventoryItemId] = 'Enter an amount above zero.'
  }
  if (draft.inventoryMode === 'recipe' && draft.recipe.length === 0) errors.recipe = 'Add at least one ingredient.'
  if (draft.inventoryMode === 'batch') {
    const yieldValue = Number(draft.batchYield)
    if (draft.batchYield.trim() && !(Number.isInteger(yieldValue) && yieldValue >= 1)) errors.batchYield = 'Use a whole number, 1 or more.'
    else if (draft.recipe.length > 0 && !draft.batchYield.trim()) errors.batchYield = 'Enter how many servings one batch makes.'
  }
  return errors
}

export function hasTrackingErrors(errors: TrackingErrors): boolean {
  return Boolean(errors.recipe || errors.batchYield || Object.keys(errors.lines).length)
}

/** The tracking part of the product payload. Option groups are only sent when the store uses them. */
export function trackingPayload(draft: TrackingDraft, foodService: boolean): Pick<ProductPayload, 'inventoryMode' | 'batchYield' | 'recipe' | 'modifierGroupIds'> {
  const recipe = usesRecipe(draft.inventoryMode)
    ? draft.recipe.map((line) => ({ inventoryItemId: line.inventoryItemId, quantity: lineQuantity(line) ?? 0, unitCode: line.unitCode }))
    : draft.hadRecipe
    ? []
    : undefined
  return {
    inventoryMode: draft.inventoryMode,
    batchYield: draft.inventoryMode === 'batch' && draft.batchYield.trim() ? Number(draft.batchYield) : null,
    recipe,
    modifierGroupIds: foodService ? draft.modifierGroupIds : undefined,
  }
}

/** Ingredient cost of the recipe as drafted: per serving (recipe) or per serving of a batch. Null without a recipe. */
export function draftCost(draft: TrackingDraft): number | null {
  if (!usesRecipe(draft.inventoryMode) || draft.recipe.length === 0) return null
  const total = draft.recipe.reduce((sum, line) => sum + qtyCost(lineQuantity(line) ?? 0, line.costPerBase), 0)
  if (draft.inventoryMode === 'batch') {
    const servings = Number(draft.batchYield)
    return Number.isInteger(servings) && servings >= 1 ? Math.round((total / servings + Number.EPSILON) * 100) / 100 : null
  }
  return Math.round((total + Number.EPSILON) * 100) / 100
}

export function InventoryTrackingSection({
  draft,
  onChange,
  foodService,
  ingredients,
  modifierGroups,
  sellingPrice,
  money,
  showErrors,
  stockFields,
  keptStock,
  canManageIngredients,
}: {
  draft: TrackingDraft
  onChange: (next: TrackingDraft) => void
  /** Settings → Recipes, ingredients & options. */
  foodService: boolean
  /** Active ingredients (only loaded when food service is on). */
  ingredients: Ingredient[]
  modifierGroups: ModifierGroup[]
  sellingPrice: number
  money: (value: number) => string
  showErrors: boolean
  /** Starting stock / low-stock fields, shown for products that count their own stock. */
  stockFields: ReactNode
  /** Units on hand when an existing product stops counting its own stock (kept, not used). */
  keptStock?: number
  canManageIngredients: boolean
}) {
  const [picking, setPicking] = useState(false)
  const errors = trackingErrors(draft)
  const mode = draft.inventoryMode
  const set = (patch: Partial<TrackingDraft>) => onChange({ ...draft, ...patch })
  const setLine = (id: number, patch: Partial<RecipeDraftLine>) =>
    set({ recipe: draft.recipe.map((line) => (line.inventoryItemId === id ? { ...line, ...patch } : line)) })

  function addIngredient(value: string) {
    const item = ingredients.find((candidate) => String(candidate.id) === value)
    if (!item || draft.recipe.some((line) => line.inventoryItemId === item.id)) return
    set({
      recipe: [
        ...draft.recipe,
        {
          inventoryItemId: item.id,
          name: item.name,
          baseUnit: item.baseUnit,
          conversions: item.conversions,
          costPerBase: item.costPerBase,
          onHand: item.onHand,
          quantityText: '',
          unitCode: item.baseUnit,
        },
      ],
    })
    // Focus the new amount once it renders.
    window.setTimeout(() => document.getElementById(`recipe-qty-${item.id}`)?.focus(), 50)
  }

  const cost = draftCost(draft)
  const figures = cost !== null && sellingPrice > 0 ? costBreakdown(cost, sellingPrice) : null
  const showsStockFields = mode === 'direct' || mode === 'batch'

  return (
    <section aria-labelledby="inventory-tracking-title" className="@container space-y-4 rounded-2xl bg-[#F6F8F7] p-4">
      <div>
        <h3 id="inventory-tracking-title" className="text-[15px] font-semibold text-[#091413]">
          Inventory tracking
        </h3>
        {foodService && <p className="text-sm text-slate-500">How selling this product changes your stock.</p>}
      </div>

      {foodService || (mode !== 'direct' && mode !== 'none') ? (
        <div role="radiogroup" aria-label="Inventory tracking" className="grid gap-2 sm:grid-cols-2">
          {INVENTORY_MODES.map((option) => {
            const on = mode === option.value
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => set({ inventoryMode: option.value })}
                className={`flex min-h-16 items-start gap-3 rounded-2xl px-3.5 py-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B] ${
                  on ? 'bg-white ring-2 ring-[#1F5E3B]' : 'bg-white ring-1 ring-slate-200 hover:ring-slate-300'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${on ? 'bg-[#1F5E3B] text-white' : 'ring-1 ring-slate-300'}`}
                >
                  {on && <Check size={10} />}
                </span>
                <span className="min-w-0">
                  <span className={`block text-sm font-semibold ${on ? 'text-[#1F5E3B]' : 'text-[#091413]'}`}>{option.label}</span>
                  <span className="block text-xs leading-snug text-slate-500">{option.hint}</span>
                </span>
              </button>
            )
          })}
        </div>
      ) : (
        <SwitchRow
          label="Track stock"
          description={mode === 'none' ? 'Off: sells without counting stock (services, made-to-order)' : 'Stock goes down with each sale'}
          checked={mode === 'direct'}
          onChange={(on) => set({ inventoryMode: on ? 'direct' : 'none' })}
        />
      )}

      {keptStock !== undefined && keptStock !== 0 && !showsStockFields && (
        <p className="rounded-xl bg-white px-3 py-2 text-sm text-slate-600">
          The {keptStock} already in stock is kept but won’t change while this product isn’t counted.
        </p>
      )}

      {showsStockFields && stockFields}

      {mode === 'batch' && (
        <div className="space-y-1.5">
          <label htmlFor="batch-yield" className="block text-sm font-medium">
            Servings per batch
          </label>
          <input
            id="batch-yield"
            inputMode="numeric"
            value={draft.batchYield}
            onChange={(e) => set({ batchYield: e.target.value.replace(/\D/g, '').slice(0, 6) })}
            placeholder="e.g. 20"
            aria-invalid={Boolean(showErrors && errors.batchYield)}
            className={`h-12 w-full rounded-2xl border-0 bg-white px-4 text-[15px] outline-none ring-1 focus:ring-2 focus:ring-[#1F5E3B] sm:max-w-48 ${
              showErrors && errors.batchYield ? 'ring-rose-400' : 'ring-slate-200'
            }`}
          />
          <p className={`text-xs ${showErrors && errors.batchYield ? 'text-rose-600' : 'text-slate-500'}`}>
            {showErrors && errors.batchYield
              ? errors.batchYield
              : 'Stock above is servings ready to sell. Record each batch you make from Ingredients → Batches; it adds servings and uses up the ingredients below.'}
          </p>
        </div>
      )}

      {usesRecipe(mode) && (
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-semibold">{mode === 'batch' ? 'Ingredients per batch' : 'Recipe'}</p>
            {mode === 'batch' && <p className="text-xs text-slate-500">Optional</p>}
          </div>

          {draft.recipe.length === 0 && (
            <p className={`rounded-xl bg-white px-3 py-3 text-sm ${showErrors && errors.recipe ? 'text-rose-600' : 'text-slate-500'}`}>
              {mode === 'batch'
                ? 'Add what one batch uses so making a batch deducts it.'
                : showErrors && errors.recipe
                ? errors.recipe
                : 'Add each ingredient one serving uses, e.g. 18 g coffee beans, 200 ml milk, 1 cup.'}
            </p>
          )}

          <ul className="space-y-2">
            {draft.recipe.map((line) => {
              const units = unitsForItem(line.baseUnit, line.conversions)
              const quantity = lineQuantity(line)
              const lineError = showErrors ? errors.lines[line.inventoryItemId] : undefined
              return (
                <li key={line.inventoryItemId} className="rounded-2xl bg-white p-3 ring-1 ring-slate-100">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{line.name}</p>
                      <p className="text-xs text-slate-500">
                        {formatQty(line.onHand, line.baseUnit)} on hand
                        {quantity !== null && line.costPerBase > 0 && ` · ${money(qtyCost(quantity, line.costPerBase))}`}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => set({ recipe: draft.recipe.filter((entry) => entry.inventoryItemId !== line.inventoryItemId) })}
                      aria-label={`Remove ${line.name}`}
                      className="-mr-1 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input
                      id={`recipe-qty-${line.inventoryItemId}`}
                      inputMode="decimal"
                      value={line.quantityText}
                      onChange={(e) => setLine(line.inventoryItemId, { quantityText: e.target.value.replace(/[^\d.,]/g, '').slice(0, 12) })}
                      placeholder="Amount"
                      aria-label={`Amount of ${line.name}`}
                      aria-invalid={Boolean(lineError)}
                      className={`h-11 w-28 rounded-xl border-0 bg-[#F3F5F4] px-3 text-[15px] tabular-nums outline-none focus:bg-white focus:ring-2 focus:ring-[#1F5E3B] ${
                        lineError ? 'ring-1 ring-rose-400' : ''
                      }`}
                    />
                    <div role="radiogroup" aria-label={`Unit for ${line.name}`} className="flex flex-wrap gap-1">
                      {units.map((unit) => {
                        const on = unit.code === line.unitCode
                        return (
                          <button
                            key={unit.code}
                            type="button"
                            role="radio"
                            aria-checked={on}
                            onClick={() => {
                              // Keep the same real amount when switching unit (200 ml → 0.2 L).
                              const factor = unitFactor(unit.code, line.baseUnit, line.conversions)!
                              setLine(line.inventoryItemId, {
                                unitCode: unit.code,
                                quantityText: quantity !== null ? qtyInputValue(quantity, factor) : line.quantityText,
                              })
                            }}
                            className={`h-11 min-w-11 rounded-xl px-3 text-sm font-medium transition ${
                              on ? 'bg-[#1F5E3B] text-white' : 'bg-[#F3F5F4] text-slate-600 hover:bg-[#E9EEEB]'
                            }`}
                          >
                            {unit.factor === null
                              ? `${unitShort(unit.code)} (${formatQty(line.conversions[unit.code] ?? 0, line.baseUnit)})`
                              : unitShort(unit.code)}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                  {lineError && <p className="mt-1 text-xs text-rose-600">{lineError}</p>}
                </li>
              )
            })}
          </ul>

          {ingredients.length === 0 ? (
            <p className="rounded-xl bg-white px-3 py-3 text-sm text-slate-600">
              No ingredients yet.{' '}
              {canManageIngredients ? (
                <Link to="/ingredients" className="font-semibold text-[#1F5E3B] underline">
                  Add them in Ingredients
                </Link>
              ) : (
                'Ask a manager to add them in Ingredients.'
              )}
            </p>
          ) : (
            <button
              type="button"
              onClick={() => setPicking(true)}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-white text-sm font-semibold text-[#1F5E3B] border border-dashed border-[#1F5E3B]/40 hover:bg-[#F2F8F4]"
            >
              <Plus size={11} />
              Add ingredient
            </button>
          )}
          {picking && (
            <PickerSheet
              title="Ingredient"
              value=""
              emptyText="Every ingredient is already in the recipe."
              options={ingredients
                .filter((item) => !draft.recipe.some((line) => line.inventoryItemId === item.id))
                .map((item) => ({ value: String(item.id), label: item.name, hint: `${formatQty(item.onHand, item.baseUnit)} on hand` }))}
              onPick={addIngredient}
              onClose={() => setPicking(false)}
            />
          )}

          {cost !== null && (
            <dl className="grid grid-cols-2 gap-2 rounded-2xl bg-white p-3 text-sm @md:grid-cols-4">
              <Figure label={mode === 'batch' ? 'Cost / serving' : 'Ingredient cost'} value={money(cost)} />
              <Figure label="Selling price" value={sellingPrice > 0 ? money(sellingPrice) : '—'} />
              <Figure
                label="Gross profit"
                value={figures ? money(figures.grossProfit) : '—'}
                tone={figures && figures.grossProfit < 0 ? 'bad' : undefined}
              />
              <Figure
                label="Food cost"
                value={figures?.costPercent != null ? `${figures.costPercent}%` : '—'}
                tone={figures?.costPercent != null && figures.costPercent > 40 ? 'warn' : undefined}
              />
              <p className="col-span-full text-xs text-slate-500">
                From today’s ingredient costs, so it updates when they change. Gross profit is before rent, wages and other expenses.
              </p>
            </dl>
          )}
        </div>
      )}

      {foodService && (
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-semibold">Options at the register</p>
            {canManageIngredients && (
              <Link to="/modifiers" className="text-sm font-medium text-[#1F5E3B]">
                Manage options
              </Link>
            )}
          </div>
          {modifierGroups.length === 0 ? (
            <p className="rounded-xl bg-white px-3 py-3 text-sm text-slate-500">
              No option groups yet. Create Size, Milk or Add-ons in Options to offer them here.
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {modifierGroups.map((group) => {
                const on = draft.modifierGroupIds.includes(group.id)
                return (
                  <button
                    key={group.id}
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    onClick={() =>
                      set({ modifierGroupIds: on ? draft.modifierGroupIds.filter((id) => id !== group.id) : [...draft.modifierGroupIds, group.id] })
                    }
                    className={`flex min-h-14 items-start gap-3 rounded-2xl bg-white px-3.5 py-2.5 text-left transition ${
                      on ? 'ring-2 ring-[#1F5E3B]' : 'ring-1 ring-slate-200 hover:ring-slate-300'
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md ${on ? 'bg-[#1F5E3B] text-white' : 'ring-1 ring-slate-300'}`}
                    >
                      {on && <Check size={10} />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">
                        {group.name}
                        {group.isRequired && <span className="font-normal text-slate-500"> · required</span>}
                      </span>
                      <span className="block truncate text-xs text-slate-500">{group.modifiers.map((modifier) => modifier.name).join(', ')}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: 'bad' | 'warn' }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className={`text-base font-semibold tabular-nums ${tone === 'bad' ? 'text-rose-600' : tone === 'warn' ? 'text-amber-700' : 'text-[#091413]'}`}>
        {value}
      </dd>
    </div>
  )
}
