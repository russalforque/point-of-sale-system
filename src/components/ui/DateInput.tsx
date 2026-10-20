import type { InputHTMLAttributes } from 'react'

/** "2026-09-29" -> "Sep 29, 2026" in the device's calendar (no UTC shift). */
function formatDateKey(value: string): string {
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return value
  return new Date(year, month - 1, day).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

/**
 * Date field that looks the same everywhere. The Android WebView draws a native
 * `<input type="date">` as an empty box with its arrow jammed against the right edge, and
 * CSS can't reach it. So we draw the field ourselves (value or placeholder + a calendar
 * icon with proper spacing) and lay the real date input invisibly over it: tapping still
 * opens the system date picker, and `value` / `onChange` stay plain "YYYY-MM-DD" strings.
 */
export function DateInput({
  value,
  onChange,
  placeholder = 'Select date',
  className = '',
  invalid = false,
  disabled,
  ...inputProps
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'className'> & {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  /** Size, radius and colours of the visible field, e.g. "h-12 rounded-2xl bg-[#F3F5F4]". */
  className?: string
  invalid?: boolean
}) {
  return (
    <div
      className={`relative flex items-center gap-4 pl-4 pr-4 transition focus-within:ring-2 ${
        invalid ? 'ring-2 ring-rose-300 focus-within:ring-rose-500' : 'focus-within:ring-[#1F5E3B]'
      } ${disabled ? 'opacity-50' : ''} ${className}`}
    >
      <span className={`min-w-0 flex-1 truncate ${value ? 'text-[#091413]' : 'text-slate-400'}`}>
        {value ? formatDateKey(value) : placeholder}
      </span>
      <svg
        width={18}
        height={18}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="shrink-0 text-slate-400"
      >
        <rect x="3" y="4.5" width="18" height="16.5" rx="2.5" />
        <path d="M3 9.5h18M8 2.5v4M16 2.5v4" />
      </svg>
      <input
        {...inputProps}
        type="date"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onClick={(e) => {
          // Desktop Chrome only opens the picker from its own (now hidden) icon; ask for it directly.
          try {
            e.currentTarget.showPicker?.()
          } catch {
            // Not supported / not allowed here: the tap still focuses the field.
          }
        }}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
      />
    </div>
  )
}

export default DateInput
