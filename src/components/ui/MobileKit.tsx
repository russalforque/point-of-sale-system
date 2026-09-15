import { useEffect, useId } from 'react'
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'

import { ChevronRight, Plus, Search, X } from './Icons'
import { EmptyState, ErrorState, Spinner } from './States'

/**
 * Shared building blocks for the redesigned mobile pages: one visual language
 * (white canvas, soft grey fields, green primary), 44px+ touch targets, and
 * bottom sheets instead of centered modals.
 */

export const ABOVE_BOTTOM_NAV = 'calc(4.5rem + max(0.35rem, env(safe-area-inset-bottom, 0px)))'
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function getInitials(name: string): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase()
}

export function useEscapeKey(onEscape: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onEscape()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onEscape, enabled])
}

/* ------------------------------------------------------------------
   PAGE CHROME
------------------------------------------------------------------ */

export function PageHeader({
  title,
  subtitle,
  action,
  children,
}: {
  title: string
  subtitle?: ReactNode
  action?: ReactNode
  children?: ReactNode
}) {
  return (
    <header className="sticky top-0 z-30 bg-white/95 px-5 pb-3 pt-4 backdrop-blur-md">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-0.5 truncate text-sm text-slate-500">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </header>
  )
}

export function AddButton({ onClick, label = 'Add' }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full bg-[#1F5E3B] px-4 text-sm font-medium text-white transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B] focus-visible:ring-offset-2"
    >
      <Plus size={12} />
      {label}
    </button>
  )
}

export function SearchField({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
  label: string
}) {
  return (
    <div className="relative mt-4">
      <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
      <input
        type="search"
        inputMode="search"
        enterKeyHint="search"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-12 w-full rounded-2xl border-0 bg-[#F3F5F4] pl-11 pr-12 text-[15px] placeholder:text-slate-400 outline-none transition focus:bg-white focus:ring-2 focus:ring-[#1F5E3B] [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="absolute right-0.5 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 active:bg-slate-200"
        >
          <X size={14} />
        </button>
      )}
    </div>
  )
}

export type SegmentOption<T extends string> = { key: T; label: string; count?: number; attention?: boolean }

/** Pill filter. `scroll` renders a horizontally scrolling chip row for many/long options. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  scroll = false,
}: {
  options: SegmentOption<T>[]
  value: T
  onChange: (value: T) => void
  label: string
  scroll?: boolean
}) {
  const buttons = options.map((option) => {
    const isActive = value === option.key
    return (
      <button
        key={option.key || 'all'}
        type="button"
        aria-pressed={isActive}
        onClick={() => onChange(option.key)}
        className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B] ${
          scroll ? 'shrink-0 px-4' : ''
        } ${
          isActive
            ? 'bg-[#1F5E3B] text-white shadow-sm'
            : scroll
            ? 'bg-[#F3F5F4] text-slate-600 active:bg-[#E9EEEB]'
            : 'text-slate-600'
        }`}
      >
        {option.label}
        {option.count !== undefined && (
          <span
            className={`tabular-nums ${
              isActive ? 'text-white/70' : option.attention && option.count > 0 ? 'text-amber-600' : 'text-slate-400'
            }`}
          >
            {option.count}
          </span>
        )}
      </button>
    )
  })

  if (scroll) {
    return (
      <div
        role="group"
        aria-label={label}
        className="-mx-5 mt-3 flex gap-2 overflow-x-auto px-5 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {buttons}
      </div>
    )
  }

  return (
    <div
      role="tablist"
      aria-label={label}
      className="mt-3 grid rounded-full bg-[#F1F4F3] p-1"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {buttons}
    </div>
  )
}

/* ------------------------------------------------------------------
   LIST STATES & ROWS
------------------------------------------------------------------ */

export function LoadingBlock() {
  return (
    <div className="flex h-56 items-center justify-center">
      <Spinner />
    </div>
  )
}

export function ErrorBlock({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="py-8">
      <ErrorState message={message} onRetry={onRetry} />
    </div>
  )
}

export function EmptyBlock({
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
    <div className="py-16 text-center">
      <EmptyState title={title} hint={hint} />
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className={`mt-4 h-12 rounded-full px-6 text-[15px] font-medium ${
            secondary ? 'bg-[#F3F5F4] text-[#091413] active:bg-[#E9EEEB]' : 'bg-[#1F5E3B] text-white'
          }`}
        >
          {actionLabel}
        </button>
      )}
    </div>
  )
}

export function RowButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[72px] w-full items-center gap-3 py-3 text-left transition active:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#1F5E3B]"
    >
      {children}
      <ChevronRight size={12} className="shrink-0 text-slate-300" />
    </button>
  )
}

export function Avatar({
  name,
  inactive = false,
  large = false,
  square = false,
}: {
  name: string
  inactive?: boolean
  large?: boolean
  square?: boolean
}) {
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center font-semibold ${square ? 'rounded-2xl' : 'rounded-full'} ${
        large ? 'h-14 w-14 text-lg' : 'h-11 w-11 text-sm'
      } ${inactive ? 'bg-slate-100 text-slate-400' : 'bg-[#E6F1EA] text-[#1F5E3B]'}`}
    >
      {getInitials(name)}
    </span>
  )
}

export function InactivePill({ label = 'Inactive' }: { label?: string }) {
  return <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-500">{label}</span>
}

/* ------------------------------------------------------------------
   SHEETS
------------------------------------------------------------------ */

export function Sheet({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  return (
    <div role="dialog" aria-modal="true" aria-label={label} className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden="true" />
      <div className="relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-white animate-in slide-in-from-bottom duration-200">
        <div className="flex justify-center pb-2 pt-2.5">
          <span className="h-1 w-10 rounded-full bg-slate-200" />
        </div>
        {children}
      </div>
    </div>
  )
}

export function SheetHeader({
  title,
  subtitle,
  leading,
  onClose,
  closeDisabled,
}: {
  title: string
  subtitle?: ReactNode
  leading?: ReactNode
  onClose: () => void
  closeDisabled?: boolean
}) {
  return (
    <div className="flex items-start gap-3 px-5 pb-3">
      {leading}
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-lg font-semibold">{title}</h2>
        {subtitle && <div className="text-sm text-slate-500">{subtitle}</div>}
      </div>
      <button
        type="button"
        onClick={onClose}
        disabled={closeDisabled}
        aria-label="Close"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#F3F5F4] text-slate-500 active:bg-[#E9EEEB] disabled:opacity-40"
      >
        <X size={14} />
      </button>
    </div>
  )
}

export function SheetBody({ children }: { children: ReactNode }) {
  return <div className="flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 pb-4">{children}</div>
}

export function SheetFooter({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 border-t border-slate-100 px-5 pb-[max(1rem,env(safe-area-inset-bottom,0px))] pt-3">
      {children}
    </div>
  )
}

/* ------------------------------------------------------------------
   BUTTONS
------------------------------------------------------------------ */

export function PrimaryButton({ className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={`flex h-14 flex-1 items-center justify-center gap-2 rounded-2xl bg-[#1F5E3B] px-5 text-[15px] font-semibold text-white transition active:scale-[0.99] disabled:bg-slate-200 disabled:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B] focus-visible:ring-offset-2 ${className}`}
    />
  )
}

export function TextButton({
  tone = 'neutral',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'neutral' | 'danger' | 'accent' }) {
  const toneClass =
    tone === 'danger'
      ? 'text-rose-600 active:bg-rose-50'
      : tone === 'accent'
      ? 'text-[#1F5E3B] active:bg-[#F2F8F4]'
      : 'text-slate-600 active:bg-slate-100'
  return (
    <button
      type="button"
      {...props}
      className={`h-14 shrink-0 rounded-2xl px-4 text-[15px] font-medium transition disabled:opacity-40 ${toneClass} ${className}`}
    />
  )
}

/* ------------------------------------------------------------------
   FORM FIELDS
------------------------------------------------------------------ */

function FieldShell({
  id,
  label,
  optional,
  hint,
  error,
  children,
}: {
  id: string
  label: string
  optional?: boolean
  hint?: string
  error?: string
  children: ReactNode
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium">
        {label} {optional && <span className="font-normal text-slate-400">(optional)</span>}
      </label>
      {children}
      {error ? (
        <p id={`${id}-message`} className="mt-1.5 text-sm text-rose-600">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-message`} className="mt-1.5 text-xs text-slate-500">
            {hint}
          </p>
        )
      )}
    </div>
  )
}

const fieldClass = (error?: string) =>
  `mt-1.5 w-full rounded-2xl border-0 text-[15px] placeholder:text-slate-400 outline-none transition focus:bg-white focus:ring-2 disabled:text-slate-400 ${
    error ? 'bg-rose-50 ring-2 ring-rose-300 focus:ring-rose-500' : 'bg-[#F3F5F4] focus:ring-[#1F5E3B]'
  }`

export function TextField({
  label,
  value,
  onChange,
  optional,
  hint,
  error,
  prefix,
  trailing,
  ...inputProps
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'prefix'> & {
  label: string
  value: string | number
  onChange: (value: string) => void
  optional?: boolean
  hint?: string
  error?: string
  prefix?: string
  trailing?: ReactNode
}) {
  const id = useId()
  return (
    <FieldShell id={id} label={label} optional={optional} hint={hint} error={error}>
      <div className="relative">
        {prefix && (
          <span className="pointer-events-none absolute left-4 top-1/2 mt-[3px] -translate-y-1/2 text-[15px] text-slate-400">
            {prefix}
          </span>
        )}
        <input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={Boolean(error)}
          aria-describedby={error || hint ? `${id}-message` : undefined}
          {...inputProps}
          className={`${fieldClass(error)} h-12 ${prefix ? 'pl-9' : 'pl-4'} ${trailing ? 'pr-14' : 'pr-4'}`}
        />
        {trailing && <div className="absolute right-1 top-1/2 mt-[3px] -translate-y-1/2">{trailing}</div>}
      </div>
    </FieldShell>
  )
}

export function TextAreaField({
  label,
  value,
  onChange,
  optional,
  hint,
  error,
  ...props
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> & {
  label: string
  value: string
  onChange: (value: string) => void
  optional?: boolean
  hint?: string
  error?: string
}) {
  const id = useId()
  return (
    <FieldShell id={id} label={label} optional={optional} hint={hint} error={error}>
      <textarea
        id={id}
        rows={3}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        {...props}
        className={`${fieldClass(error)} resize-none px-4 py-3`}
      />
    </FieldShell>
  )
}

export function SelectField({
  label,
  value,
  onChange,
  optional,
  hint,
  error,
  children,
  ...props
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange'> & {
  label: string
  value: string | number
  onChange: (value: string) => void
  optional?: boolean
  hint?: string
  error?: string
  children: ReactNode
}) {
  const id = useId()
  return (
    <FieldShell id={id} label={label} optional={optional} hint={hint} error={error}>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={Boolean(error)}
        {...props}
        className={`${fieldClass(error)} h-12 appearance-none bg-[length:16px] bg-[right_1rem_center] bg-no-repeat px-4 pr-10`}
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2394A3B8' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
        }}
      >
        {children}
      </select>
    </FieldShell>
  )
}

export function SwitchRow({
  label,
  description,
  checked,
  onChange,
  disabled = false,
}: {
  label: string
  description?: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}) {
  return (
    <label
      className={`flex min-h-14 items-center justify-between gap-3 rounded-2xl bg-[#F6F8F7] px-4 py-2 ${
        disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
      }`}
    >
      <span className="min-w-0">
        <span className="block text-[15px]">{label}</span>
        {description && <span className="block text-xs text-slate-500">{description}</span>}
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className="relative h-7 w-12 shrink-0 rounded-full bg-slate-300 transition after:absolute after:left-0.5 after:top-0.5 after:h-6 after:w-6 after:rounded-full after:bg-white after:shadow after:transition peer-checked:bg-[#1F5E3B] peer-checked:after:translate-x-5 peer-focus-visible:ring-2 peer-focus-visible:ring-[#1F5E3B] peer-focus-visible:ring-offset-2"
      />
    </label>
  )
}

/* ------------------------------------------------------------------
   DETAILS
------------------------------------------------------------------ */

export function DetailList({ children }: { children: ReactNode }) {
  return <dl className="divide-y divide-slate-100">{children}</dl>
}

export function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  const empty = value === null || value === undefined || value === ''
  return (
    <div className="flex min-h-12 items-baseline justify-between gap-4 py-3">
      <dt className="shrink-0 text-sm text-slate-500">{label}</dt>
      <dd className={`min-w-0 break-words text-right text-[15px] ${empty ? 'text-slate-300' : ''}`}>
        {empty ? 'Not added' : value}
      </dd>
    </div>
  )
}

export function ContactActions({
  phone,
  email,
  onMissing,
}: {
  phone?: string | null
  email?: string | null
  /** When given, a missing phone/email becomes an "Add …" shortcut instead of a dead button. */
  onMissing?: (field: 'phone' | 'email') => void
}) {
  const actions: { label: string; href?: string; field: 'phone' | 'email'; icon: ReactNode }[] = [
    { label: 'Call', href: phone ? `tel:${phone}` : undefined, field: 'phone', icon: <PhoneIcon /> },
    { label: 'Text', href: phone ? `sms:${phone}` : undefined, field: 'phone', icon: <MessageIcon /> },
    { label: 'Email', href: email ? `mailto:${email}` : undefined, field: 'email', icon: <MailIcon /> },
  ]
  const base = 'flex h-16 flex-col items-center justify-center gap-1 rounded-2xl text-sm font-medium transition'
  return (
    <div className="grid grid-cols-3 gap-2">
      {actions.map((action) =>
        action.href ? (
          <a key={action.label} href={action.href} className={`${base} bg-[#E6F1EA] text-[#1F5E3B] active:bg-[#D3E6DB]`}>
            {action.icon}
            {action.label}
          </a>
        ) : onMissing ? (
          <button
            key={action.label}
            type="button"
            onClick={() => onMissing(action.field)}
            className={`${base} border border-dashed border-slate-200 text-slate-500 active:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5E3B]`}
          >
            {action.icon}
            {action.field === 'phone' ? 'Add phone' : 'Add email'}
          </button>
        ) : (
          <span key={action.label} aria-disabled="true" className={`${base} bg-[#F6F8F7] text-slate-300`}>
            {action.icon}
            {action.label}
          </span>
        ),
      )}
    </div>
  )
}

function IconSvg({ children }: { children: ReactNode }) {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}

function PhoneIcon() {
  return (
    <IconSvg>
      <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2Z" />
    </IconSvg>
  )
}

function MessageIcon() {
  return (
    <IconSvg>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" />
    </IconSvg>
  )
}

function MailIcon() {
  return (
    <IconSvg>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-10 6L2 7" />
    </IconSvg>
  )
}
