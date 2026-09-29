import { useId, type ReactNode } from 'react'

import { Minus, Plus } from './Icons'

/**
 * Shell for the operational back-office pages (returns, stock count, receiving, audit log).
 * One responsive layout for phones and tablets, matching the Shift page's look.
 */
export function WorkPage({
  title,
  subtitle,
  actions,
  children,
  maxWidth = 'max-w-5xl',
}: {
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
  children: ReactNode
  maxWidth?: string
}) {
  return (
    <div className="min-h-full bg-[#F6F8F7] text-[#091413] antialiased">
      <div className={`mx-auto ${maxWidth} px-4 pb-12 pt-5 sm:px-6 sm:pt-6`}>
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
            {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
        {children}
      </div>
    </div>
  )
}

export function Panel({
  title,
  description,
  action,
  children,
  className = '',
}: {
  title?: string
  description?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`rounded-2xl bg-white p-4 ring-1 ring-slate-100 sm:p-5 ${className}`}>
      {(title || action) && (
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title && <h2 className="text-base font-semibold">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

/** Required reason with one-tap suggestions (the text stays editable). */
export function ReasonField({
  label = 'Reason',
  value,
  onChange,
  suggestions,
  error,
  disabled,
}: {
  label?: string
  value: string
  onChange: (value: string) => void
  suggestions: string[]
  error?: string | null
  disabled?: boolean
}) {
  const id = useId()
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            disabled={disabled}
            onClick={() => onChange(suggestion)}
            aria-pressed={value === suggestion}
            className={`h-9 rounded-full px-3.5 text-sm transition disabled:opacity-40 ${
              value === suggestion ? 'bg-[#1F5E3B] font-medium text-white' : 'bg-[#F3F5F4] text-slate-600 active:bg-[#E9EEEB]'
            }`}
          >
            {suggestion}
          </button>
        ))}
      </div>
      <textarea
        id={id}
        rows={2}
        maxLength={200}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Describe what happened"
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        className={`mt-2 w-full resize-none rounded-2xl border-0 px-4 py-3 text-[15px] placeholder:text-slate-400 outline-none transition focus:bg-white focus:ring-2 ${
          error ? 'bg-rose-50 ring-2 ring-rose-300 focus:ring-rose-500' : 'bg-[#F3F5F4] focus:ring-[#1F5E3B]'
        }`}
      />
      {error && (
        <p id={`${id}-error`} className="mt-1 text-sm text-rose-600">
          {error}
        </p>
      )}
    </div>
  )
}

/** −  n  + with a directly editable number; clamps to [min, max]. */
export function QuantityStepper({
  value,
  onChange,
  min = 0,
  max,
  label,
  disabled,
}: {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  label: string
  disabled?: boolean
}) {
  const clamp = (next: number) => Math.max(min, max === undefined ? next : Math.min(max, next))
  return (
    <div className="flex h-11 shrink-0 items-center rounded-xl bg-[#E6F1EA] text-[#1F5E3B]">
      <button
        type="button"
        onClick={() => onChange(clamp(value - 1))}
        disabled={disabled || value <= min}
        aria-label={`Decrease ${label}`}
        className="flex h-11 w-11 items-center justify-center rounded-xl active:bg-[#D3E6DB] disabled:opacity-30"
      >
        <Minus size={11} />
      </button>
      <input
        type="text"
        inputMode="numeric"
        aria-label={label}
        value={String(value)}
        disabled={disabled}
        onChange={(event) => {
          const digits = event.target.value.replace(/\D/g, '')
          onChange(clamp(digits ? Number(digits) : 0))
        }}
        onFocus={(event) => event.target.select()}
        className="h-11 w-12 bg-transparent text-center text-[15px] font-semibold tabular-nums outline-none"
      />
      <button
        type="button"
        onClick={() => onChange(clamp(value + 1))}
        disabled={disabled || (max !== undefined && value >= max)}
        aria-label={`Increase ${label}`}
        className="flex h-11 w-11 items-center justify-center rounded-xl active:bg-[#D3E6DB] disabled:opacity-30"
      >
        <Plus size={11} />
      </button>
    </div>
  )
}
