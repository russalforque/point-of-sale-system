/**
 * Units of measure for ingredients and supplies.
 *
 * Every inventory-item quantity is stored as an INTEGER count of thousandths of the item's base
 * unit (g, ml or pc): 18 g is 18000, 1.5 L of a ml-based item is 1500000, half a piece is 500.
 * All stock arithmetic is integer addition/subtraction, so totals never drift the way
 * 0.1 + 0.2 does; decimals only appear when a quantity is shown or typed.
 */

/** Stored quantities are this many units per one base unit. */
export const QTY_SCALE = 1000

export type BaseUnit = 'g' | 'ml' | 'pc'
export type Dimension = 'mass' | 'volume' | 'count'

export type UnitDef = {
  code: string
  name: string
  /** Short label shown next to numbers. */
  short: string
  dimension: Dimension
  /**
   * Stored quantity (thousandths of the base unit) in one of this unit: 1 kg = 1,000,000.
   * Null for package units (bag, box…), whose size is set per inventory item.
   */
  factor: number | null
}

/** Seeded into units_of_measure; the code is the key everything else refers to. */
export const UNITS: UnitDef[] = [
  { code: 'pc', name: 'Piece', short: 'pc', dimension: 'count', factor: QTY_SCALE },
  { code: 'g', name: 'Gram', short: 'g', dimension: 'mass', factor: QTY_SCALE },
  { code: 'kg', name: 'Kilogram', short: 'kg', dimension: 'mass', factor: 1000 * QTY_SCALE },
  { code: 'ml', name: 'Milliliter', short: 'ml', dimension: 'volume', factor: QTY_SCALE },
  { code: 'l', name: 'Liter', short: 'L', dimension: 'volume', factor: 1000 * QTY_SCALE },
  { code: 'bottle', name: 'Bottle', short: 'bottle', dimension: 'count', factor: null },
  { code: 'pack', name: 'Pack', short: 'pack', dimension: 'count', factor: null },
  { code: 'box', name: 'Box', short: 'box', dimension: 'count', factor: null },
  { code: 'bag', name: 'Bag', short: 'bag', dimension: 'count', factor: null },
  { code: 'carton', name: 'Carton', short: 'carton', dimension: 'count', factor: null },
  { code: 'serving', name: 'Serving', short: 'serving', dimension: 'count', factor: null },
]

export const BASE_UNITS: { code: BaseUnit; label: string; hint: string }[] = [
  { code: 'g', label: 'Weight (g)', hint: 'Coffee beans, sugar, powders' },
  { code: 'ml', label: 'Volume (ml)', hint: 'Milk, syrups, sauces' },
  { code: 'pc', label: 'Pieces (pc)', hint: 'Cups, lids, bottles, eggs' },
]

export const PACKAGE_UNITS = UNITS.filter((unit) => unit.factor === null)

export function isBaseUnit(code: string): code is BaseUnit {
  return code === 'g' || code === 'ml' || code === 'pc'
}

export function unitDef(code: string): UnitDef | undefined {
  return UNITS.find((unit) => unit.code === code)
}

export function unitShort(code: string): string {
  return unitDef(code)?.short ?? code
}

/** Package sizes for one item: unit code → stored quantity in one package. */
export type Conversions = Record<string, number>

/** Metric units that measure the same thing as `base` (g → g, kg). */
export function metricUnitsFor(base: BaseUnit): UnitDef[] {
  const dimension = unitDef(base)!.dimension
  return UNITS.filter((unit) => unit.factor !== null && unit.dimension === dimension)
}

/** Every unit an item can be counted in: its metric units plus the package sizes defined for it. */
export function unitsForItem(base: BaseUnit, conversions: Conversions = {}): UnitDef[] {
  const metric = metricUnitsFor(base)
  const packages = UNITS.filter((unit) => unit.factor === null && (conversions[unit.code] ?? 0) > 0)
  return [...metric, ...packages]
}

/** Stored quantity in one `unit` of this item, or null when the item has no such unit. */
export function unitFactor(unit: string, base: BaseUnit, conversions: Conversions = {}): number | null {
  const def = unitDef(unit)
  if (!def) return null
  if (def.factor !== null) return def.dimension === unitDef(base)!.dimension ? def.factor : null
  const size = conversions[unit]
  return size && size > 0 ? size : null
}

/**
 * Parses typed text ("18", "0.5", "1,250.75") into thousandths, exactly: the digits are read as a
 * string, never multiplied as a float. More than three decimals are rounded half-up.
 * Returns null for empty or invalid input.
 */
export function parseQty(text: string | number): number | null {
  const raw = String(text).replace(/,/g, '').trim()
  if (!/^-?\d*(\.\d*)?$/.test(raw) || raw === '' || raw === '-' || raw === '.' || raw === '-.') return null
  const negative = raw.startsWith('-')
  const [whole = '', fraction = ''] = raw.replace('-', '').split('.')
  const padded = (fraction + '0000').slice(0, 4)
  let value = Number(whole || '0') * QTY_SCALE + Number(padded.slice(0, 3))
  if (Number(padded[3]) >= 5) value += 1
  if (!Number.isSafeInteger(value)) return null
  return negative ? -value : value
}

/**
 * Typed quantity in `unit` → stored quantity of the base unit. 2.5 kg of a gram-based item is
 * 2,500,000; 3 bags of a 1 kg bag is 3,000,000. Rounds to the nearest thousandth of a base unit.
 */
export function toStored(typed: number, factor: number): number {
  // typed is thousandths of `unit`; factor is thousandths of base per whole unit.
  return Math.round((typed * factor) / QTY_SCALE)
}

/** Stored quantity → number of `unit`s (for display only). */
export function fromStored(stored: number, factor: number): number {
  return stored / factor
}

/** Thousandths → plain number text with up to three decimals and thousands separators. */
export function formatNumber(value: number, maxDecimals = 3): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: maxDecimals })
}

/** A stored quantity in its own base unit: 18000 g → "18 g". */
export function formatBaseQty(stored: number, base: string): string {
  return `${formatNumber(stored / QTY_SCALE)} ${unitShort(base)}`
}

/**
 * A stored quantity in the most readable metric unit: 2,500,000 (g) → "2.5 kg", 150,000 → "150 g",
 * 1,000 (pc) → "1 pc". Package units are never chosen automatically.
 */
export function formatQty(stored: number, base: string): string {
  if (base === 'g' && Math.abs(stored) >= 1000 * QTY_SCALE) return `${formatNumber(stored / (1000 * QTY_SCALE))} kg`
  if (base === 'ml' && Math.abs(stored) >= 1000 * QTY_SCALE) return `${formatNumber(stored / (1000 * QTY_SCALE))} L`
  return formatBaseQty(stored, base)
}

/** A stored quantity in a chosen unit: (5,000,000 g, bag of 1 kg) → "5 bag". */
export function formatInUnit(stored: number, unit: string, base: BaseUnit, conversions: Conversions = {}): string {
  const factor = unitFactor(unit, base, conversions)
  if (!factor) return formatQty(stored, base)
  return `${formatNumber(stored / factor)} ${unitShort(unit)}`
}

/** Thousandths → the raw string for an input box ("18", "0.5"). */
export function qtyInputValue(stored: number, factor: number = QTY_SCALE): string {
  if (!Number.isFinite(stored)) return ''
  return String(Math.round((stored / factor) * QTY_SCALE) / QTY_SCALE)
}

/** Cost per one base unit from a price for one `unit` (₱850 per kg → ₱0.85 per g). */
export function costPerBase(unitCost: number, factor: number): number {
  if (!(factor > 0) || !Number.isFinite(unitCost)) return 0
  return (unitCost * QTY_SCALE) / factor
}

/** Money value of a stored quantity at a cost per base unit (not rounded; round the total). */
export function qtyCost(stored: number, perBase: number): number {
  return (stored / QTY_SCALE) * perBase
}
