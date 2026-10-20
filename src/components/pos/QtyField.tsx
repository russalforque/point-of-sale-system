import { useState } from 'react'
import { useToast } from '../../context/ToastContext'

/**
 * Cart quantity used by both registers. Shows the number; a tap turns it into a numeric
 * field so a cashier can type "24" instead of pressing + 23 times.
 * Enter / blur commits, Escape cancels, 0 removes the line (same as setLineQty).
 * Quantities above `max` are reported here; the caller's setLineQty still caps them.
 */
export function QtyField({
  value,
  max,
  productName,
  onCommit,
  className = '',
}: {
  value: number
  max: number
  productName: string
  onCommit: (quantity: number) => void
  className?: string
}) {
  const { notify } = useToast()
  const [draft, setDraft] = useState<string | null>(null)

  function commit() {
    if (draft === null) return
    const next = Number.parseInt(draft, 10)
    setDraft(null)
    if (!Number.isFinite(next) || next === value) return
    if (next > max) notify(`Only ${max} of ${productName} in stock.`, 'error')
    onCommit(Math.max(0, Math.min(next, max)))
  }

  if (draft === null) {
    return (
      <button
        type="button"
        onClick={() => setDraft(String(value))}
        aria-label={`Quantity of ${productName}: ${value}. Tap to type a quantity.`}
        className={`h-full min-w-9 rounded-lg px-1 text-center font-semibold tabular-nums underline decoration-current/30 decoration-dotted underline-offset-4 hover:bg-[#D3E6DB] active:bg-[#D3E6DB] ${className}`}
      >
        {value}
      </button>
    )
  }

  return (
    <input
      autoFocus
      type="text"
      inputMode="numeric"
      enterKeyHint="done"
      pattern="[0-9]*"
      aria-label={`Quantity of ${productName}, up to ${max}`}
      value={draft}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value.replace(/\D/g, '').slice(0, 5))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          commit()
        } else if (e.key === 'Escape') {
          e.stopPropagation()
          setDraft(null)
        }
      }}
      className={`h-8 w-12 rounded-lg border-0 bg-white text-center font-semibold tabular-nums text-[#091413] outline-none ring-2 ring-[#1F5E3B] ${className}`}
    />
  )
}
