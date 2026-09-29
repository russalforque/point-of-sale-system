export function formatMoney(amount: number, symbol = '₱'): string {
  return `${symbol}${amount.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function parseDateValue(value: string | null | undefined): Date | null {
  if (!value) return null

  const trimmed = value.trim()
  if (!trimmed) return null

  const normalized = trimmed.replace(' ', 'T')
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized)

  const parsed = hasTimezone
    ? new Date(normalized)
    : new Date(`${normalized}${/T\d{2}:\d{2}/.test(normalized) ? 'Z' : 'T00:00:00Z'}`)

  if (Number.isNaN(parsed.getTime())) {
    return null
  }

  return parsed
}

function formatDateInTimeZone(value: string | null | undefined, options: Intl.DateTimeFormatOptions): string {
  const date = parseDateValue(value)

  if (!date) {
    return '—'
  }

  return new Intl.DateTimeFormat('en-PH', {
    ...options,
    timeZone: 'Asia/Manila',
  }).format(date)
}

export function formatDateTime(value: string | null | undefined): string {
  return formatDateInTimeZone(value, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

/** e.g. "September 24, 2026 at 10:00 PM" */
export function formatLongDateTime(value: string | null | undefined): string {
  return formatDateInTimeZone(value, {
    dateStyle: 'long',
    timeStyle: 'short',
  })
}

export function formatDate(value: string | null | undefined): string {
  return formatDateInTimeZone(value, {
    dateStyle: 'medium',
  })
}

export function formatTime(value: string | null | undefined): string {
  return formatDateInTimeZone(value, {
    timeStyle: 'short',
  })
}

/** "Today", "Yesterday", "Mon, Sep 22" (year added when it isn't this year) — for grouping lists by day. */
export function formatDayLabel(value: string | null | undefined, now: Date = new Date()): string {
  const day = formatDate(value)
  if (day === '—') return day
  if (day === formatDate(now.toISOString())) return 'Today'
  if (day === formatDate(new Date(now.getTime() - 86_400_000).toISOString())) return 'Yesterday'

  const sameYear = formatDateInTimeZone(value, { year: 'numeric' }) === formatDateInTimeZone(now.toISOString(), { year: 'numeric' })
  return formatDateInTimeZone(value, { weekday: 'short', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })
}

/** Elapsed time between two timestamps, e.g. "8h 13m" or "45m". A missing end means "until now". */
export function formatDuration(start: string | null | undefined, end?: string | null): string {
  const from = parseDateValue(start)
  const to = end ? parseDateValue(end) : new Date()
  if (!from || !to) return '—'

  const minutes = Math.max(0, Math.round((to.getTime() - from.getTime()) / 60_000))
  const hours = Math.floor(minutes / 60)
  return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`
}
