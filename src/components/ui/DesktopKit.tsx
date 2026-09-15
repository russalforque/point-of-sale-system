import { useEffect, useId, useRef, useState } from 'react'
import type { ButtonHTMLAttributes, KeyboardEvent, ReactNode } from 'react'

import { ChevronDown, Search, X } from './Icons'
import { InactivePill } from './MobileKit'
import { EmptyState, ErrorState, Spinner } from './States'

/**
 * Shared building blocks for the tablet / desktop pages (≥ 768px). They pair with
 * MobileKit's form fields so both layouts share one visual language.
 */

export function DesktopPage({
  title,
  subtitle,
  actions,
  children,
  maxWidth = 'max-w-6xl',
}: {
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
  children: ReactNode
  maxWidth?: string
}) {
  return (
    <div className="min-h-full bg-[#F6F8F7] text-[#091413] antialiased">
      <div className={`mx-auto ${maxWidth} px-6 pb-12 pt-6`}>
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
            {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2 print:hidden">{actions}</div>}
        </header>
        {children}
      </div>
    </div>
  )
}

export function SecondaryButton({ className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex h-11 items-center gap-2 rounded-full bg-white px-4 text-sm font-medium ring-1 ring-slate-200 transition hover:bg-slate-50 active:scale-95 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B] ${className}`}
    />
  )
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="mt-6 flex flex-wrap items-center justify-between gap-3 print:hidden">{children}</div>
}

export function DesktopSearch({
  value,
  onChange,
  placeholder,
  label,
  className = 'w-full max-w-md',
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
  label: string
  /** Width classes for the wrapper. Use `min-w-0 flex-1` when sharing a row with filters. */
  className?: string
}) {
  return (
    <div className={`relative ${className}`}>
      <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
      <input
        type="search"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-11 w-full rounded-2xl border-0 bg-white pl-11 pr-11 text-sm ring-1 ring-slate-200 placeholder:text-slate-400 outline-none transition focus:ring-2 focus:ring-[#1F5E3B] [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100"
        >
          <X size={13} />
        </button>
      )}
    </div>
  )
}

export type SelectOption = {
  value: string
  label: string
  /** Muted text on the right of the option, e.g. a count or "Inactive". */
  meta?: string
  muted?: boolean
}

/**
 * Toolbar dropdown that sits next to DesktopSearch.
 * - The label stays visible in the trigger ("Category  Drinks ▾").
 * - A filter that narrows the list (`clearValue` set and value differs) is tinted and
 *   gets a one-click ✕ to reset it.
 * - Keyboard: ↑/↓ Home/End to move, Enter/Space to pick, Esc to close, letters jump.
 */
export function DesktopSelect({
  label,
  value,
  options,
  onChange,
  clearValue,
}: {
  label: string
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  /** The "no filter" value. When given and not selected, the control shows as active. */
  clearValue?: string
}) {
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const listRef = useRef<HTMLUListElement | null>(null)
  const listId = useId()

  const selectedIndex = options.findIndex((option) => option.value === value)
  const selected = options[selectedIndex]
  const active = clearValue !== undefined && value !== clearValue

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [open])

  useEffect(() => {
    if (open) listRef.current?.querySelector<HTMLElement>(`[data-index="${highlight}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [open, highlight])

  function openList() {
    setHighlight(Math.max(0, selectedIndex))
    setOpen(true)
  }

  function choose(index: number) {
    const option = options[index]
    if (option && option.value !== value) onChange(option.value)
    setOpen(false)
    buttonRef.current?.focus()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const last = options.length - 1
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault()
        if (!open) return openList()
        const step = event.key === 'ArrowDown' ? 1 : -1
        setHighlight((current) => Math.min(last, Math.max(0, current + step)))
        return
      }
      case 'Home':
      case 'End':
        if (!open) return
        event.preventDefault()
        setHighlight(event.key === 'Home' ? 0 : last)
        return
      case 'Enter':
      case ' ':
        event.preventDefault()
        if (open) choose(highlight)
        else openList()
        return
      case 'Escape':
        if (open) {
          event.preventDefault()
          setOpen(false)
        }
        return
      case 'Tab':
        setOpen(false)
        return
      default:
        // Type a letter to jump to the next option starting with it.
        if (event.key.length === 1 && /\S/.test(event.key)) {
          const char = event.key.toLowerCase()
          const start = open ? highlight : Math.max(0, selectedIndex)
          for (let offset = 1; offset <= options.length; offset++) {
            const index = (start + offset) % options.length
            if (options[index]?.label.toLowerCase().startsWith(char)) {
              if (!open) setOpen(true)
              setHighlight(index)
              break
            }
          }
        }
    }
  }

  return (
    <div ref={rootRef} className="relative max-w-full">
      <button
        ref={buttonRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? `${listId}-${highlight}` : undefined}
        aria-label={`${label}: ${selected?.label ?? ''}`}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={handleKeyDown}
        className={`flex h-11 max-w-full items-center gap-2 rounded-2xl pl-4 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-[#1F5E3B] ${
          active ? 'bg-[#E6F1EA] pr-11 ring-1 ring-[#1F5E3B]/25' : `bg-white pr-3 ring-1 ${open ? 'ring-slate-300' : 'ring-slate-200 hover:ring-slate-300'}`
        }`}
      >
        <span className={`shrink-0 ${active ? 'text-[#1F5E3B]/80' : 'text-slate-500'}`}>{label}</span>
        <span className={`min-w-0 max-w-48 truncate font-medium ${active ? 'text-[#1F5E3B]' : 'text-[#091413]'}`}>{selected?.label ?? '…'}</span>
        {!active && <ChevronDown size={12} className={`shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />}
      </button>

      {active && (
        <button
          type="button"
          onClick={() => {
            onChange(clearValue)
            setOpen(false)
            buttonRef.current?.focus()
          }}
          aria-label={`Clear ${label.toLowerCase()} filter`}
          title="Clear"
          className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-[#1F5E3B] hover:bg-[#1F5E3B]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B]"
        >
          <X size={12} />
        </button>
      )}

      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={label}
          className="absolute left-0 top-full z-40 mt-2 max-h-80 w-max min-w-full max-w-80 overflow-y-auto rounded-2xl bg-white p-1.5 shadow-[0_12px_32px_rgba(9,20,19,0.12)] ring-1 ring-slate-100"
        >
          {options.map((option, index) => {
            const isSelected = option.value === value
            return (
              <li
                key={option.value}
                id={`${listId}-${index}`}
                data-index={index}
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => setHighlight(index)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(index)}
                className={`flex h-11 cursor-pointer items-center gap-3 rounded-xl px-3 text-sm ${index === highlight ? 'bg-[#F3F5F4]' : ''}`}
              >
                <span className="flex w-4 shrink-0 justify-center text-[#1F5E3B]">
                  {isSelected && (
                    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  )}
                </span>
                <span
                  className={`min-w-0 flex-1 truncate ${isSelected ? 'font-semibold text-[#1F5E3B]' : option.muted ? 'text-slate-400' : 'text-[#091413]'}`}
                >
                  {option.label}
                </span>
                {option.meta && <span className="shrink-0 pl-4 text-xs tabular-nums text-slate-400">{option.meta}</span>}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/** "12 of 48 products · Clear filters" line shown under a toolbar while filters are applied. */
export function FilterSummary({ shown, total, noun, onClear }: { shown: number; total?: number; noun: string; onClear: () => void }) {
  return (
    <div className="mt-3 flex min-h-9 flex-wrap items-center gap-x-2 text-sm text-slate-500" aria-live="polite">
      <span>
        <span className="font-medium tabular-nums text-[#091413]">{shown}</span>
        {total !== undefined && ` of ${total}`} {noun}
      </span>
      <span aria-hidden="true">·</span>
      <button
        type="button"
        onClick={onClear}
        className="h-9 rounded-full px-2 font-medium text-[#1F5E3B] hover:bg-[#E6F1EA] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B]"
      >
        Clear filters
      </button>
    </div>
  )
}

export type PillOption<T extends string> ={ key: T; label: string; count?: number; attention?: boolean }

export function FilterPills<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: PillOption<T>[]
  value: T
  onChange: (value: T) => void
  label: string
}) {
  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap rounded-full bg-white p-1 ring-1 ring-slate-200">
      {options.map((option) => {
        const active = value === option.key
        return (
          <button
            key={option.key || 'all'}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.key)}
            className={`inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B] ${
              active ? 'bg-[#1F5E3B] text-white' : 'text-slate-600 hover:text-[#091413]'
            }`}
          >
            {option.label}
            {option.count !== undefined && (
              <span
                className={`tabular-nums ${
                  active ? 'text-white/70' : option.attention && option.count > 0 ? 'text-amber-600' : 'text-slate-400'
                }`}
              >
                {option.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

export function DataCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`overflow-hidden rounded-2xl bg-white ring-1 ring-slate-100 ${className}`}>{children}</div>
}

export function SectionCard({
  title,
  description,
  action,
  children,
  className = '',
}: {
  title: string
  description?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`rounded-2xl bg-white p-6 ring-1 ring-slate-100 ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
        </div>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  )
}

export function Th({
  children,
  align = 'left',
  className = '',
}: {
  children?: ReactNode
  align?: 'left' | 'right'
  className?: string
}) {
  return (
    <th scope="col" className={`px-3 py-3 font-medium ${align === 'right' ? 'text-right' : ''} ${className}`}>
      {children}
    </th>
  )
}

export function LoadingRow() {
  return (
    <div className="py-20">
      <Spinner />
    </div>
  )
}

export function ErrorRow({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="p-6">
      <ErrorState message={message} onRetry={onRetry} />
    </div>
  )
}

export function EmptyRow({
  title,
  hint,
  actionLabel,
  onAction,
  secondary = false,
}: {
  title: string
  hint?: string
  actionLabel?: string
  onAction?: () => void
  secondary?: boolean
}) {
  return (
    <div className="px-6 py-16 text-center">
      <EmptyState title={title} hint={hint} />
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className={`mt-4 h-11 rounded-full px-6 text-sm font-medium ${
            secondary ? 'bg-[#F3F5F4] text-[#091413] hover:bg-[#E9EEEB]' : 'bg-[#1F5E3B] text-white'
          }`}
        >
          {actionLabel}
        </button>
      )}
    </div>
  )
}

/** Row action revealed on hover / keyboard focus; never triggers the row click. */
export function HoverAction({ label, ariaLabel, onClick }: { label: string; ariaLabel: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      aria-label={ariaLabel}
      className="h-9 rounded-full px-3 text-sm font-medium text-[#1F5E3B] opacity-0 transition hover:bg-[#F2F8F4] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B] group-hover:opacity-100"
    >
      {label}
    </button>
  )
}

export function StatusCell({ active }: { active: boolean }) {
  return active ? <span className="text-sm text-[#1F5E3B]">Active</span> : <InactivePill />
}

/** Image that swaps to `fallback` when it can't load (e.g. a linked photo while offline). */
export function SafeImage({
  src,
  className,
  fallback,
}: {
  src: string
  className: string
  fallback: ReactNode
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  if (failedSrc === src) return <>{fallback}</>
  return <img src={src} alt="" loading="lazy" className={className} onError={() => setFailedSrc(src)} />
}
