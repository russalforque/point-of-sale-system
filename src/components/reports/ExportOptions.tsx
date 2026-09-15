import type { ReactNode } from 'react'

import type { ExportFormat } from '../../utils/reportExport'

const OPTIONS: { format: ExportFormat; label: string; hint: string }[] = [
  { format: 'pdf', label: 'PDF', hint: 'Clean, printable report' },
  { format: 'csv', label: 'CSV', hint: 'For Excel or Google Sheets' },
]

/** The two export choices, shared by the mobile sheet and the desktop menu. */
export function ExportOptions({
  busyFormat,
  disabled = false,
  asMenu = false,
  onSelect,
}: {
  busyFormat: ExportFormat | null
  disabled?: boolean
  /** Render as menu items (desktop dropdown) instead of plain buttons. */
  asMenu?: boolean
  onSelect: (format: ExportFormat) => void
}) {
  return (
    <ul className="space-y-1" role={asMenu ? 'none' : undefined}>
      {OPTIONS.map((option) => {
        const busy = busyFormat === option.format
        return (
          <li key={option.format} role={asMenu ? 'none' : undefined}>
            <button
              type="button"
              role={asMenu ? 'menuitem' : undefined}
              onClick={() => onSelect(option.format)}
              disabled={disabled || busyFormat !== null}
              aria-busy={busy}
              className="flex min-h-14 w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-[#F6F8F7] active:bg-[#F3F5F4] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#1F5E3B]"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#F2F8F4] text-[#1F5E3B]">
                {option.format === 'pdf' ? <DocumentIcon /> : <TableIcon />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium text-[#091413]">{option.label}</span>
                <span className="block truncate text-xs text-slate-500">{busy ? 'Preparing file…' : option.hint}</span>
              </span>
              {busy && <SpinnerIcon />}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function Svg({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
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
      className={className}
    >
      {children}
    </svg>
  )
}

function DocumentIcon() {
  return (
    <Svg>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h4" />
    </Svg>
  )
}

function TableIcon() {
  return (
    <Svg>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 10h18M3 15h18M9 4v16" />
    </Svg>
  )
}

function SpinnerIcon() {
  return (
    <Svg className="shrink-0 animate-spin text-[#1F5E3B]">
      <path d="M21 12a9 9 0 1 1-6.2-8.56" />
    </Svg>
  )
}
