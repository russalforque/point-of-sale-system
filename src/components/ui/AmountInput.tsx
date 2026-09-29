import { useLayoutEffect, useRef, useState } from 'react'
import type { InputHTMLAttributes, KeyboardEvent } from 'react'
import { formatAmount, parseAmount, sanitizeAmount, toRawAmount } from '../../utils/amount'

type AmountInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'inputMode'> & {
  /** Raw value (number or unformatted string). */
  value: string | number
  /** Receives the raw, comma-free string — e.g. "12500.5" — safe to pass to `Number()`. */
  onChange: (raw: string) => void
  /** Decimal places allowed. Use 0 for whole-number amounts. */
  decimals?: number
}

/**
 * Money input that shows thousands separators while typing ("1000" → "1,000")
 * without moving the caret. Use for prices, cash, discounts and other amounts —
 * never for quantities, phone numbers, PINs or IDs.
 */
export function AmountInput({ value, onChange, decimals = 2, onKeyDown, ...inputProps }: AmountInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const pendingCaret = useRef<number | null>(null)
  const [text, setText] = useState(() => formatAmount(toRawAmount(value, decimals)))
  const [syncedValue, setSyncedValue] = useState(value)

  // Adopt outside changes (reset, quick-amount buttons) but keep in-progress text
  // like "12." or "5.50" when it already means the same number.
  if (value !== syncedValue) {
    setSyncedValue(value)
    if (parseAmount(text) !== parseAmount(value)) setText(formatAmount(toRawAmount(value, decimals)))
  }

  useLayoutEffect(() => {
    if (pendingCaret.current === null || !inputRef.current) return
    inputRef.current.setSelectionRange(pendingCaret.current, pendingCaret.current)
    pendingCaret.current = null
  })

  function handleChange(typed: string, caret: number | null) {
    const raw = sanitizeAmount(typed, decimals)
    const formatted = formatAmount(raw)

    if (caret !== null) {
      // Keep the caret after the same number of digits it was after in the typed text.
      const target = sanitizeAmount(typed.slice(0, caret), decimals).length
      let seen = 0
      let position = 0
      while (position < formatted.length && seen < target) {
        if (formatted[position] !== ',') seen += 1
        position += 1
      }
      pendingCaret.current = position
    }

    setText(formatted)
    setSyncedValue(raw)
    onChange(raw)
  }

  // Deleting next to a comma removes the neighbouring digit instead of the (re-added) comma.
  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    onKeyDown?.(event)
    if (event.defaultPrevented) return
    const input = event.currentTarget
    const { selectionStart: start, selectionEnd: end } = input
    if (start === null || start !== end) return
    if (event.key === 'Backspace' && input.value[start - 1] === ',') input.setSelectionRange(start - 1, start - 1)
    if (event.key === 'Delete' && input.value[start] === ',') input.setSelectionRange(start + 1, start + 1)
  }

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode={decimals > 0 ? 'decimal' : 'numeric'}
      autoComplete="off"
      {...inputProps}
      value={text}
      onChange={(e) => handleChange(e.target.value, e.target.selectionStart)}
      onKeyDown={handleKeyDown}
    />
  )
}
