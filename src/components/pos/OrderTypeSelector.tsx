import { useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react'

import { ORDER_TYPE_OPTIONS, type OrderType } from '../../utils/pos'

/**
 * Dine-In | Take-Out segmented control, shared by the phone register, the tablet/desktop
 * register and the payment step. Changing it only swaps `orderType` in the checkout
 * context - the cart, customer and discount are left as they are.
 */
export function OrderTypeSelector({
  value,
  onChange,
  disabled = false,
  className = '',
}: {
  value: OrderType
  onChange: (value: OrderType) => void
  disabled?: boolean
  className?: string
}) {
  const buttonsRef = useRef<(HTMLButtonElement | null)[]>([])

  // Radio-group arrow key navigation.
  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (disabled || !['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(event.key)) return
    event.preventDefault()
    const index = ORDER_TYPE_OPTIONS.findIndex((option) => option.value === value)
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1
    const nextIndex = (index + step + ORDER_TYPE_OPTIONS.length) % ORDER_TYPE_OPTIONS.length
    const next = ORDER_TYPE_OPTIONS[nextIndex]
    if (!next) return
    onChange(next.value)
    buttonsRef.current[nextIndex]?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-label="Order type"
      onKeyDown={handleKeyDown}
      className={`grid grid-cols-2 gap-1 rounded-2xl bg-[#F1F4F3] p-1 ${className}`}
    >
      {ORDER_TYPE_OPTIONS.map((option, index) => {
        const selected = value === option.value
        return (
          <button
            key={option.value}
            ref={(element) => {
              buttonsRef.current[index] = element
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={`min-h-11 rounded-xl text-[15px] transition touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B] focus-visible:ring-offset-2 disabled:opacity-50 ${
              selected ? 'bg-[#1F5E3B] font-semibold text-white shadow-sm' : 'font-medium text-slate-600 active:bg-white/60'
            }`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

export default OrderTypeSelector
