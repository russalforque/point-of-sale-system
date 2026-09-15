import type { ReactNode } from 'react'

import {
  BluetoothIcon,
  ChevronIcon,
  DeviceList,
  MessageBanner,
  PrinterIcon,
  SpinnerIcon,
  StatusBadge,
  UsbIcon,
} from '../../components/printer/PrinterBits'
import { PageHeader, PrimaryButton, Segmented, SwitchRow } from '../../components/ui/MobileKit'
import {
  AVAILABILITY_MESSAGES,
  CONNECTION_TYPE_LABELS,
  sortPrinters,
  usePrinterSettings,
} from '../../hooks/usePrinterSettings'

const clampByte = (value: string) => Math.min(255, Math.max(0, Math.floor(Number(value) || 0)))

export function MobilePrinterSettings() {
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
    <div className="flex min-h-full flex-col bg-white text-[#091413] antialiased">
      <PageHeader title="Receipt printer" subtitle="Bluetooth or USB · 58 mm thermal" />

      <main className="flex-1 px-5 pb-8">
        {bluetoothBlocked && p.availability !== null && p.availability !== 'ready' && (
          <div role="alert" className="mb-4 flex items-center gap-3 rounded-2xl bg-amber-50 px-4 py-3">
            <p className="min-w-0 flex-1 text-sm text-amber-900">{AVAILABILITY_MESSAGES[p.availability]}</p>
            {p.availability !== 'unsupported' && (
              <button
                type="button"
                onClick={() => void (p.availability === 'bluetooth-off' ? p.enableBluetooth() : p.refreshBluetooth(true))}
                className="h-11 shrink-0 rounded-full bg-white px-4 text-sm font-medium text-amber-900 active:bg-amber-100"
              >
                {p.availability === 'bluetooth-off' ? 'Turn on' : 'Try again'}
              </button>
            )}
          </div>
        )}

        {/* STATUS */}
        <section aria-label="Printer status" aria-live="polite" className={`rounded-3xl p-5 ${isConnected ? 'bg-[#F2F8F4]' : 'bg-[#F6F8F7]'}`}>
          <div className="flex items-center gap-3">
            <span
              className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${
                isConnected ? 'bg-[#1F5E3B] text-white' : 'bg-white text-slate-400'
              }`}
            >
              <PrinterIcon />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-slate-500">Printer</p>
              <p className="truncate text-[17px] font-semibold">{printerName}</p>
            </div>
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-2">
            <div className="rounded-2xl bg-white px-4 py-3">
              <dt className="text-xs text-slate-500">Connection</dt>
              <dd className="mt-1">
                <StatusBadge status={status} />
              </dd>
            </div>
            <div className="rounded-2xl bg-white px-4 py-3">
              <dt className="text-xs text-slate-500">Connection type</dt>
              <dd className="mt-1 text-[15px] font-medium">{CONNECTION_TYPE_LABELS[shownType]}</dd>
            </div>
          </dl>

          {p.canUseUsb && (
            <Segmented
              label="Connection type"
              value={mode}
              onChange={(next) => void p.changeMode(next)}
              options={[
                { key: 'bluetooth', label: 'Bluetooth' },
                { key: 'usb', label: 'USB' },
              ]}
            />
          )}

          <MessageBanner message={p.message} />

          <div className="mt-4 space-y-2">
            {!isConnected && (
              <PrimaryButton onClick={() => void p.connectPrinter()} disabled={isConnecting || p.scanning || p.busyDeviceId !== null} className="w-full">
                {isConnecting ? (
                  <>
                    <SpinnerIcon />
                    Connecting…
                  </>
                ) : (
                  'Connect Printer'
                )}
              </PrimaryButton>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => void p.testPrint()}
                disabled={!isConnected || p.testPrinting}
                className={`h-12 rounded-2xl text-[15px] font-semibold transition active:scale-[0.99] disabled:opacity-50 ${
                  isConnected ? 'bg-[#1F5E3B] text-white' : 'bg-white text-slate-500 ring-1 ring-slate-200'
                }`}
              >
                {p.testPrinting ? 'Printing…' : 'Test Print'}
              </button>
              <button
                type="button"
                onClick={() => void p.disconnect()}
                disabled={!isConnected || p.busyDeviceId !== null || p.testPrinting}
                className="h-12 rounded-2xl bg-white text-[15px] font-medium text-rose-600 ring-1 ring-slate-200 transition active:bg-rose-50 disabled:text-slate-400 disabled:opacity-50"
              >
                Disconnect
              </button>
            </div>
          </div>
        </section>

        {/* DEVICES */}
        {mode === 'bluetooth' ? (
          <>
            <Section
              title="Paired printers"
              action={
                <button
                  type="button"
                  onClick={() => void (p.scanning ? p.stopScan() : p.scan())}
                  disabled={isConnecting || bluetoothBlocked}
                  className="inline-flex h-11 items-center gap-2 rounded-full px-3 text-sm font-medium text-[#1F5E3B] active:bg-[#F2F8F4] disabled:opacity-50"
                >
                  {p.scanning ? (
                    <>
                      <SpinnerIcon />
                      Stop
                    </>
                  ) : (
                    <>
                      <BluetoothIcon />
                      Search nearby
                    </>
                  )}
                </button>
              }
            >
              <DeviceList
                printers={paired}
                savedId={config.deviceId}
                connectedId={connectedId}
                busyDeviceId={p.busyDeviceId}
                disabled={isConnecting}
                emptyText="No paired printers yet. Pair the POS-5890U-L in Android Settings › Bluetooth first, then come back here."
                onConnect={(printer) => void p.connect(printer)}
              />
            </Section>

            {(nearby.length > 0 || p.hasScanned) && (
              <Section title="Nearby devices">
                <DeviceList
                  printers={nearby}
                  savedId={config.deviceId}
                  connectedId={connectedId}
                  busyDeviceId={p.busyDeviceId}
                  disabled={isConnecting || p.scanning}
                  emptyText={p.scanning ? 'Searching…' : 'No other devices found nearby.'}
                  onConnect={(printer) => void p.connect(printer)}
                />
              </Section>
            )}

            <Tips
              items={[
                'Turn the printer on (the blue light blinks when it isn’t connected).',
                'Pair it once in Android Settings › Bluetooth. The PIN is usually 0000 or 1234.',
                'Keep it within a few meters and disconnect it from any other phone.',
              ]}
            />
          </>
        ) : (
          <>
            <Section
              title="USB printers"
              action={
                <button
                  type="button"
                  onClick={() => void p.refreshUsb()}
                  disabled={p.loadingUsb}
                  className="inline-flex h-11 items-center gap-2 rounded-full px-3 text-sm font-medium text-[#1F5E3B] active:bg-[#F2F8F4] disabled:opacity-50"
                >
                  {p.loadingUsb ? <SpinnerIcon /> : <UsbIcon />}
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
                emptyText="No USB printer detected. Connect the printer’s USB cable to this device with an OTG adapter and turn it on."
                onConnect={(printer) => void p.connect(printer)}
              />
            </Section>
            <Tips
              items={[
                'Use a USB OTG adapter/cable, and power the printer from its own DC adapter.',
                'When Android asks “Allow Sellix POS to access the USB device?”, tap OK. Tick “Always” so it isn’t asked again.',
              ]}
            />
          </>
        )}

        {/* PREFERENCES */}
        <Section
          title="Preferences"
          action={
            <span aria-live="polite" className={`text-sm text-[#1F5E3B] transition-opacity ${p.savedFlash ? 'opacity-100' : 'opacity-0'}`}>
              Saved
            </span>
          }
        >
          <div className="space-y-4">
            <div>
              <p className="text-sm font-medium">Paper width</p>
              <Segmented
                label="Paper width"
                value={String(config.paperWidth) as '58' | '80'}
                onChange={(value) => p.updateConfig({ paperWidth: Number(value) as 58 | 80 })}
                options={[
                  { key: '58', label: '58 mm' },
                  { key: '80', label: '80 mm' },
                ]}
              />
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
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-4 text-[15px] [&::-webkit-details-marker]:hidden">
                Drawer timing (advanced)
                <ChevronIcon />
              </summary>
              <div className="px-4 pb-4">
                <p className="text-xs text-slate-500">Only change these if your drawer doesn’t open. The standard is pin 0, 25 ms on, 250 ms off.</p>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <NumberBox label="Pin">
                    <select
                      value={config.drawerPin}
                      onChange={(e) => p.updateConfig({ drawerPin: Number(e.target.value) as 0 | 1 })}
                      className="h-12 w-full rounded-xl border-0 bg-[#F3F5F4] px-3 text-[15px] outline-none focus:ring-2 focus:ring-[#1F5E3B]"
                    >
                      <option value={0}>0</option>
                      <option value={1}>1</option>
                    </select>
                  </NumberBox>
                  <NumberBox label="On (ms)">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={255}
                      value={config.drawerOnMs}
                      onChange={(e) => p.updateConfig({ drawerOnMs: clampByte(e.target.value) })}
                      className="h-12 w-full rounded-xl border-0 bg-[#F3F5F4] px-3 text-[15px] tabular-nums outline-none focus:ring-2 focus:ring-[#1F5E3B]"
                    />
                  </NumberBox>
                  <NumberBox label="Off (ms)">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={255}
                      value={config.drawerOffMs}
                      onChange={(e) => p.updateConfig({ drawerOffMs: clampByte(e.target.value) })}
                      className="h-12 w-full rounded-xl border-0 bg-[#F3F5F4] px-3 text-[15px] tabular-nums outline-none focus:ring-2 focus:ring-[#1F5E3B]"
                    />
                  </NumberBox>
                </div>
                <button
                  type="button"
                  onClick={() => p.updateConfig({ drawerPin: 0, drawerOnMs: 25, drawerOffMs: 250 })}
                  className="mt-3 h-11 rounded-full px-3 text-sm font-medium text-[#1F5E3B] active:bg-[#F2F8F4]"
                >
                  Reset to standard
                </button>
              </div>
            </details>
          </div>
        </Section>
      </main>
    </div>
  )
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-8">
      <div className="mb-2 flex min-h-11 items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function Tips({ items }: { items: string[] }) {
  return (
    <ul className="mt-3 list-disc space-y-1 rounded-2xl bg-[#F6F8F7] py-3 pl-9 pr-4 text-sm text-slate-500">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
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

export default MobilePrinterSettings
