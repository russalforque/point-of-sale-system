import type { ReactNode } from 'react'

import {
  BluetoothIcon,
  DeviceList,
  MessageBanner,
  PrinterIcon,
  SpinnerIcon,
  StatusBadge,
  UsbIcon,
} from '../components/printer/PrinterBits'
import { DesktopPage, SectionCard } from '../components/ui/DesktopKit'
import { SwitchRow } from '../components/ui/MobileKit'
import { useIsMobile } from '../hooks/useIsMobile'
import {
  AVAILABILITY_MESSAGES,
  CONNECTION_TYPE_LABELS,
  sortPrinters,
  usePrinterSettings,
} from '../hooks/usePrinterSettings'
import type { PrinterConnectionType } from '../services/printer'
import { MobilePrinterSettings } from './mobile/MobilePrinterSettings'

const clampByte = (value: string) => Math.min(255, Math.max(0, Math.floor(Number(value) || 0)))

export function PrinterSettingsPage() {
  const isMobile = useIsMobile()
  if (isMobile) return <MobilePrinterSettings />
  return <DesktopPrinterSettingsPage />
}

function DesktopPrinterSettingsPage() {
  const p = usePrinterSettings()
  const { config, mode, status, isConnected, connectedPrinter } = p

  const isConnecting = status === 'connecting'
  const printerName = isConnected ? connectedPrinter?.name : config.deviceName ?? 'No printer selected'
  const shownType = isConnected ? connectedPrinter?.type ?? 'bluetooth' : config.deviceId ? config.connectionType : mode
  const connectedId = isConnected ? connectedPrinter?.id ?? null : null

  const paired = sortPrinters(p.bluetoothPrinters.filter((printer) => printer.paired || printer.id === config.deviceId))
  const nearby = sortPrinters(p.bluetoothPrinters.filter((printer) => !printer.paired && printer.id !== config.deviceId))
  const bluetoothBlocked = mode === 'bluetooth' && p.availability !== null && p.availability !== 'ready'

  return (
    <DesktopPage title="Receipt printer" subtitle="Bluetooth or USB · 58 mm thermal" maxWidth="max-w-5xl">
      {bluetoothBlocked && p.availability !== null && p.availability !== 'ready' && (
        <div role="alert" className="mt-6 flex items-center gap-3 rounded-2xl bg-amber-50 px-5 py-3">
          <p className="min-w-0 flex-1 text-sm text-amber-900">{AVAILABILITY_MESSAGES[p.availability]}</p>
          {p.availability !== 'unsupported' && (
            <button
              type="button"
              onClick={() => void (p.availability === 'bluetooth-off' ? p.enableBluetooth() : p.refreshBluetooth(true))}
              className="h-10 shrink-0 rounded-full bg-white px-4 text-sm font-medium text-amber-900 hover:bg-amber-100"
            >
              {p.availability === 'bluetooth-off' ? 'Turn on' : 'Try again'}
            </button>
          )}
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          {/* STATUS */}
          <section
            aria-label="Printer status"
            aria-live="polite"
            className={`rounded-2xl p-6 ring-1 ring-slate-100 ${isConnected ? 'bg-[#F2F8F4]' : 'bg-white'}`}
          >
            <div className="flex items-center gap-4">
              <span
                className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${
                  isConnected ? 'bg-[#1F5E3B] text-white' : 'bg-[#F3F5F4] text-slate-400'
                }`}
              >
                <PrinterIcon />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-slate-500">Printer</p>
                <p className="truncate text-lg font-semibold">{printerName}</p>
              </div>
            </div>

            <dl className="mt-5 grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-[#F6F8F7] px-4 py-3">
                <dt className="text-xs text-slate-500">Connection</dt>
                <dd className="mt-1">
                  <StatusBadge status={status} />
                </dd>
              </div>
              <div className="rounded-2xl bg-[#F6F8F7] px-4 py-3">
                <dt className="text-xs text-slate-500">Connection type</dt>
                <dd className="mt-1 text-[15px] font-medium">{CONNECTION_TYPE_LABELS[shownType]}</dd>
              </div>
            </dl>

            {p.canUseUsb ? (
              <div role="radiogroup" aria-label="Connection type" className="mt-4 grid grid-cols-2 rounded-full bg-[#F1F4F3] p-1">
                {(['bluetooth', 'usb'] as PrinterConnectionType[]).map((type) => {
                  const selected = mode === type
                  return (
                    <button
                      key={type}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => void p.changeMode(type)}
                      className={`inline-flex h-10 items-center justify-center gap-2 rounded-full text-sm font-medium transition ${
                        selected ? 'bg-[#1F5E3B] text-white shadow-sm' : 'text-slate-600 hover:text-[#091413]'
                      }`}
                    >
                      {type === 'usb' ? <UsbIcon size={14} /> : <BluetoothIcon size={14} />}
                      {CONNECTION_TYPE_LABELS[type]}
                    </button>
                  )
                })}
              </div>
            ) : (
              <p className="mt-4 text-xs text-slate-500">USB printing is available in the Sellix Android app.</p>
            )}

            <MessageBanner message={p.message} />

            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void p.connectPrinter()}
                disabled={isConnected || isConnecting || p.scanning || p.busyDeviceId !== null}
                className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-full bg-[#1F5E3B] px-5 text-sm font-semibold text-white transition active:scale-[0.99] disabled:bg-slate-200 disabled:text-slate-400"
              >
                {isConnecting ? (
                  <>
                    <SpinnerIcon />
                    Connecting…
                  </>
                ) : isConnected ? (
                  'Connected'
                ) : (
                  'Connect Printer'
                )}
              </button>
              <button
                type="button"
                onClick={() => void p.testPrint()}
                disabled={!isConnected || p.testPrinting}
                className="h-11 rounded-full bg-white px-5 text-sm font-medium text-[#091413] ring-1 ring-slate-200 transition hover:bg-slate-50 disabled:opacity-50"
              >
                {p.testPrinting ? 'Printing…' : 'Test Print'}
              </button>
              <button
                type="button"
                onClick={() => void p.disconnect()}
                disabled={!isConnected || p.busyDeviceId !== null || p.testPrinting}
                className="h-11 rounded-full px-5 text-sm font-medium text-rose-600 transition hover:bg-rose-50 disabled:text-slate-400 disabled:opacity-50"
              >
                Disconnect
              </button>
            </div>
          </section>

          {/* DEVICES */}
          {mode === 'bluetooth' ? (
            <>
              <SectionCard
                title="Paired printers"
                description="Pair the POS-5890U-L in Android Settings › Bluetooth first (PIN 0000 or 1234)."
                action={
                  <button
                    type="button"
                    onClick={() => void (p.scanning ? p.stopScan() : p.scan())}
                    disabled={isConnecting || bluetoothBlocked}
                    className="inline-flex h-9 items-center gap-2 rounded-full px-3 text-sm font-medium text-[#1F5E3B] hover:bg-[#F2F8F4] disabled:opacity-50"
                  >
                    {p.scanning ? <SpinnerIcon size={14} /> : <BluetoothIcon size={14} />}
                    {p.scanning ? 'Stop' : 'Search nearby'}
                  </button>
                }
              >
                <DeviceList
                  printers={paired}
                  savedId={config.deviceId}
                  connectedId={connectedId}
                  busyDeviceId={p.busyDeviceId}
                  disabled={isConnecting}
                  emptyText="No paired printers yet."
                  onConnect={(printer) => void p.connect(printer)}
                />
              </SectionCard>

              {(nearby.length > 0 || p.hasScanned) && (
                <SectionCard title="Nearby devices">
                  <DeviceList
                    printers={nearby}
                    savedId={config.deviceId}
                    connectedId={connectedId}
                    busyDeviceId={p.busyDeviceId}
                    disabled={isConnecting || p.scanning}
                    emptyText={p.scanning ? 'Searching…' : 'No other devices found nearby.'}
                    onConnect={(printer) => void p.connect(printer)}
                  />
                </SectionCard>
              )}
            </>
          ) : (
            <SectionCard
              title="USB printers"
              description="Connect with a USB OTG cable. Tap OK when Android asks to allow access."
              action={
                <button
                  type="button"
                  onClick={() => void p.refreshUsb()}
                  disabled={p.loadingUsb}
                  className="inline-flex h-9 items-center gap-2 rounded-full px-3 text-sm font-medium text-[#1F5E3B] hover:bg-[#F2F8F4] disabled:opacity-50"
                >
                  {p.loadingUsb ? <SpinnerIcon size={14} /> : <UsbIcon size={14} />}
                  Refresh
                </button>
              }
            >
              <DeviceList
                printers={sortPrinters(p.usbPrinters)}
                savedId={config.deviceId}
                connectedId={connectedId}
                busyDeviceId={p.busyDeviceId}
                disabled={isConnecting}
                emptyText="No USB printer detected. Plug the printer in, turn it on and click Refresh."
                onConnect={(printer) => void p.connect(printer)}
              />
            </SectionCard>
          )}
        </div>

        {/* PREFERENCES */}
        <SectionCard
          title="Preferences"
          description="Changes save automatically."
          action={
            <span aria-live="polite" className={`text-sm text-[#1F5E3B] transition-opacity ${p.savedFlash ? 'opacity-100' : 'opacity-0'}`}>
              Saved
            </span>
          }
        >
          <div className="space-y-5">
            <div>
              <p className="text-sm font-medium">Paper width</p>
              <div role="radiogroup" aria-label="Paper width" className="mt-1.5 grid grid-cols-2 rounded-full bg-[#F1F4F3] p-1">
                {([58, 80] as const).map((width) => {
                  const selected = config.paperWidth === width
                  return (
                    <button
                      key={width}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => p.updateConfig({ paperWidth: width })}
                      className={`h-10 rounded-full text-sm font-medium transition ${selected ? 'bg-[#1F5E3B] text-white shadow-sm' : 'text-slate-600'}`}
                    >
                      {width} mm
                    </button>
                  )
                })}
              </div>
              <p className="mt-1.5 text-xs text-slate-500">The POS-5890U-L uses 58 mm paper (32 characters per line).</p>
            </div>

            <SwitchRow
              label="Cut paper after printing"
              description="Only for printers with a cutter. Leave off for the POS-5890U-L."
              checked={config.autoCut}
              onChange={(autoCut) => p.updateConfig({ autoCut })}
            />

            <SwitchRow
              label="Open cash drawer after cash sales"
              description="Needs a drawer plugged into the printer"
              checked={config.autoOpenDrawerOnCash}
              onChange={(autoOpenDrawerOnCash) => p.updateConfig({ autoOpenDrawerOnCash })}
            />

            <details className="group rounded-2xl ring-1 ring-slate-100">
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-4 text-sm font-medium [&::-webkit-details-marker]:hidden">
                Drawer timing (advanced)
                <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-400 transition-transform group-open:rotate-180" aria-hidden="true">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </summary>
              <div className="px-4 pb-4">
                <p className="text-xs text-slate-500">Only change these if your drawer doesn’t open. The standard is pin 0, 25 ms on, 250 ms off.</p>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <NumberBox label="Pin">
                    <select
                      value={config.drawerPin}
                      onChange={(e) => p.updateConfig({ drawerPin: Number(e.target.value) as 0 | 1 })}
                      className="h-11 w-full rounded-xl border-0 bg-[#F3F5F4] px-3 text-sm outline-none focus:ring-2 focus:ring-[#1F5E3B]"
                    >
                      <option value={0}>0</option>
                      <option value={1}>1</option>
                    </select>
                  </NumberBox>
                  <NumberBox label="On (ms)">
                    <input
                      type="number"
                      min={0}
                      max={255}
                      value={config.drawerOnMs}
                      onChange={(e) => p.updateConfig({ drawerOnMs: clampByte(e.target.value) })}
                      className="h-11 w-full rounded-xl border-0 bg-[#F3F5F4] px-3 text-sm tabular-nums outline-none focus:ring-2 focus:ring-[#1F5E3B]"
                    />
                  </NumberBox>
                  <NumberBox label="Off (ms)">
                    <input
                      type="number"
                      min={0}
                      max={255}
                      value={config.drawerOffMs}
                      onChange={(e) => p.updateConfig({ drawerOffMs: clampByte(e.target.value) })}
                      className="h-11 w-full rounded-xl border-0 bg-[#F3F5F4] px-3 text-sm tabular-nums outline-none focus:ring-2 focus:ring-[#1F5E3B]"
                    />
                  </NumberBox>
                </div>
                <button
                  type="button"
                  onClick={() => p.updateConfig({ drawerPin: 0, drawerOnMs: 25, drawerOffMs: 250 })}
                  className="mt-3 h-9 rounded-full px-3 text-sm font-medium text-[#1F5E3B] hover:bg-[#F2F8F4]"
                >
                  Reset to standard
                </button>
              </div>
            </details>
          </div>
        </SectionCard>
      </div>
    </DesktopPage>
  )
}

function NumberBox({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-slate-500">{label}</span>
      {children}
    </label>
  )
}

export default PrinterSettingsPage
