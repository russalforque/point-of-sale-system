import type { DiscoveredPrinter, PrinterConnectionStatus } from '../../services/printer'
import { CONNECTION_STATUS_LABELS, type PrinterMessage } from '../../hooks/usePrinterSettings'

/** Shared pieces of the phone and tablet/desktop Printer settings screens. */

const STATUS_STYLES: Record<PrinterConnectionStatus, { dot: string; text: string }> = {
  connected: { dot: 'bg-[#1F5E3B]', text: 'text-[#1F5E3B]' },
  connecting: { dot: 'bg-amber-500 animate-pulse', text: 'text-amber-700' },
  disconnected: { dot: 'bg-slate-300', text: 'text-slate-600' },
  error: { dot: 'bg-rose-500', text: 'text-rose-600' },
}

export function StatusBadge({ status }: { status: PrinterConnectionStatus }) {
  const style = STATUS_STYLES[status]
  return (
    <span className={`inline-flex items-center gap-2 text-[15px] font-medium ${style.text}`}>
      <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${style.dot}`} />
      {CONNECTION_STATUS_LABELS[status]}
    </span>
  )
}

export function MessageBanner({ message }: { message: PrinterMessage | null }) {
  if (!message) return null
  const tone =
    message.tone === 'error'
      ? 'bg-rose-50 text-rose-700'
      : message.tone === 'success'
      ? 'bg-[#E6F1EA] text-[#1F5E3B]'
      : 'bg-white text-slate-600 ring-1 ring-slate-100'
  return (
    <p role={message.tone === 'error' ? 'alert' : 'status'} className={`mt-3 rounded-2xl px-4 py-3 text-sm ${tone}`}>
      {message.text}
    </p>
  )
}

export function DeviceList({
  printers,
  savedId,
  connectedId,
  busyDeviceId,
  disabled,
  emptyText,
  onConnect,
}: {
  printers: DiscoveredPrinter[]
  savedId: string | null
  connectedId: string | null
  busyDeviceId: string | null
  disabled: boolean
  emptyText: string
  onConnect: (printer: DiscoveredPrinter) => void
}) {
  if (printers.length === 0) {
    return <p className="rounded-2xl bg-[#F6F8F7] px-4 py-4 text-sm text-slate-500">{emptyText}</p>
  }

  return (
    <ul>
      {printers.map((printer) => {
        const isConnected = printer.id === connectedId
        const isBusy = printer.id === busyDeviceId
        return (
          <li key={`${printer.type ?? 'bluetooth'}-${printer.id}`} className="flex min-h-[68px] items-center gap-3 border-b border-slate-100 py-3 last:border-b-0">
            <span
              aria-hidden="true"
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                isConnected ? 'bg-[#1F5E3B] text-white' : 'bg-[#F3F5F4] text-slate-500'
              }`}
            >
              {printer.type === 'usb' ? <UsbIcon /> : <BluetoothIcon />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-medium">{printer.name}</p>
              <p className="truncate text-xs text-slate-400">
                {[
                  printer.address,
                  printer.paired ? 'Paired' : undefined,
                  printer.id === savedId && !isConnected ? 'Last used' : undefined,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
            {isConnected ? (
              <span className="shrink-0 text-sm font-medium text-[#1F5E3B]">Connected</span>
            ) : (
              <button
                type="button"
                onClick={() => onConnect(printer)}
                disabled={disabled || isBusy}
                className="h-11 shrink-0 rounded-full bg-[#E6F1EA] px-4 text-sm font-medium text-[#1F5E3B] transition active:bg-[#D3E6DB] hover:bg-[#D3E6DB] disabled:opacity-50"
              >
                {isBusy ? 'Connecting…' : 'Connect'}
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}

export function PrinterIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="6 9 6 2 18 2 18 9" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" />
    </svg>
  )
}

export function BluetoothIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6.5 6.5 11 11L12 23V1l5.5 5.5-11 11" />
    </svg>
  )
}

export function UsbIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="10" cy="7" r="1" />
      <circle cx="4" cy="20" r="1" />
      <path d="M4.7 19.3 19 5" />
      <path d="m21 3-3 1 2 2Z" />
      <path d="M9.26 7.68 5 12l2 5" />
      <path d="m10 14 5 2 3.5-3.5" />
      <path d="m18 12 1-1 1 1-1 1Z" />
    </svg>
  )
}

export function SpinnerIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="animate-spin" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-9-9" />
    </svg>
  )
}

export function ChevronIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400 transition-transform group-open:rotate-180" aria-hidden="true">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}
