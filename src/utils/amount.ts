/**
 * Helpers for money/amount text inputs.
 *
 * Inputs *display* a grouped value ("12,500.50") but callers only ever see the
 * *raw* string ("12500.50"), so `Number(raw)` is always safe for calculations,
 * validation, SQLite and the API.
 */

/** Integer digits allowed (~₱9.9B) — keeps values well inside float precision. */
const MAX_INTEGER_DIGITS = 10

/**
 * Reduce any typed or pasted text to a raw amount string: digits plus at most one
 * decimal point, fraction capped at `decimals`. "₱1,2a34.567" → "1234.56".
 */
export function sanitizeAmount(input: string, decimals = 2): string {
  const cleaned = input.replace(/[^\d.]/g, '')
  if (!cleaned) return ''

  const dot = cleaned.indexOf('.')
  let whole = dot === -1 ? cleaned : cleaned.slice(0, dot)
  const fraction = dot === -1 ? undefined : cleaned.slice(dot + 1).replace(/\./g, '').slice(0, decimals)

  whole = whole.replace(/^0+(?=\d)/, '').slice(0, MAX_INTEGER_DIGITS)

  if (fraction === undefined || decimals === 0) return whole
  return `${whole || '0'}.${fraction}`
}

/** Add thousands separators to a raw amount string, keeping a trailing "." or partial decimals as typed. */
export function formatAmount(raw: string): string {
  if (!raw) return ''
  const [whole = '', fraction] = raw.split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return fraction === undefined ? grouped : `${grouped}.${fraction}`
}

/** Parse a raw or formatted amount to a number (commas ignored). Empty/invalid → 0. */
export function parseAmount(value: string | number | null | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (!value) return 0
  const amount = Number(value.replace(/,/g, ''))
  return Number.isFinite(amount) ? amount : 0
}

/** Round to centavos. Every stored money value goes through this so sums never drift. */
export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/** Sum money values without accumulating floating-point error. */
export function sumMoney(values: number[]): number {
  return roundMoney(values.reduce((sum, value) => sum + roundMoney(value), 0))
}

/** True when two money values are equal to the centavo. */
export function sameMoney(a: number, b: number): boolean {
  return Math.abs(roundMoney(a) - roundMoney(b)) < 0.005
}

/** Convert a stored value (number or string) into a raw amount string for an input. */
export function toRawAmount(value: string | number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return ''
    const factor = 10 ** decimals
    return sanitizeAmount(String(Math.round(value * factor) / factor), decimals)
  }
  return sanitizeAmount(value, decimals)
}
