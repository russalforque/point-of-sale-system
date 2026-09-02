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

export function formatDate(value: string | null | undefined): string {
  return formatDateInTimeZone(value, {
    dateStyle: 'medium',
  })
}
