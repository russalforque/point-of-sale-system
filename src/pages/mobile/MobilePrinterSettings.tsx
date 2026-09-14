import { useEffect, useRef, useState } from 'react'

import { connectSavedPrinter, getPrinterService, printerErrorMessage } from '../../services/printer'
import type { DiscoveredPrinter, PrinterConfig, PrinterConnectionStatus } from '../../services/printer'
import { getPrinterConfig, updatePrinterConfig } from '../../utils/printerConfig'

import { Button } from '../../components/ui/Button'
import { MobileEmpty } from '../../components/ui/MobileStates'
import { useSettings } from '../../context/SettingsContext'
import { useToast } from '../../context/ToastContext'

const printerService = getPrinterService()

export function MobilePrinterSettings() {
  const { notify } = useToast()
  const { settings } = useSettings()

  const [config, setConfig] = useState<PrinterConfig>(() => getPrinterConfig())
  const [status, setStatus] = useState<PrinterConnectionStatus>(printerService.getStatus())
  const [connectedPrinter, setConnectedPrinter] = useState<DiscoveredPrinter | null>(
    printerService.getConnectedPrinter(),
  )
  const [printers, setPrinters] = useState<DiscoveredPrinter[]>(() => {
    const saved = getPrinterConfig()
    return saved.deviceId ? [{ id: saved.deviceId, name: saved.deviceName ?? 'Saved printer' }] : []
  })

  const [bluetoothEnabled, setBluetoothEnabled] = useState<boolean | null>(null)
  const [scanning, setScanning] = useState(false)
  const [busyDeviceId, setBusyDeviceId] = useState<string | null>(null)
  const [testPrintingId, setTestPrintingId] = useState<string | null>(null)
  const [savingConfig, setSavingConfig] = useState(false)
  const scanningRef = useRef(false)

  useEffect(() => {
    const unsubscribe = printerService.onStatusChange((nextStatus, printer) => {
      setStatus(nextStatus)
      setConnectedPrinter(printer)
      if (printer) {
        setPrinters((prev) => (prev.some((p) => p.id === printer.id) ? prev : [printer, ...prev]))
      }
    })

    void printerService.isBluetoothEnabled().then(setBluetoothEnabled)
    void connectSavedPrinter()

    return () => {
      unsubscribe()
      if (scanningRef.current) void printerService.stopScan()
    }
  }, [])

  async function handleScan() {
    setScanning(true)
    scanningRef.current = true
    try {
      const enabled = await printerService.isBluetoothEnabled()
      setBluetoothEnabled(enabled)
      if (!enabled) {
        notify('Please enable Bluetooth to connect to a printer.', 'error')
        return
      }

      await printerService.scanPrinters((found) => {
        setPrinters((prev) => {
          if (prev.some((p) => p.id === found.id)) return prev
          return [...prev, found]
        })
      }, 8000)
    } catch (err) {
      notify(printerErrorMessage(err), 'error')
    } finally {
      setScanning(false)
      scanningRef.current = false
    }
  }

  async function handleConnect(printer: DiscoveredPrinter) {
    setBusyDeviceId(printer.id)
    try {
      await printerService.connect(printer)
      const next = updatePrinterConfig({ deviceId: printer.id, deviceName: printer.name })
      setConfig(next)
      notify(`Connected to ${printer.name}.`)
    } catch (err) {
      notify(printerErrorMessage(err), 'error')
    } finally {
      setBusyDeviceId(null)
    }
  }

  async function handleDisconnect() {
    if (!connectedPrinter) return
    setBusyDeviceId(connectedPrinter.id)
    try {
      await printerService.disconnect()
      notify('Printer disconnected.')
    } catch (err) {
      notify(printerErrorMessage(err), 'error')
    } finally {
      setBusyDeviceId(null)
    }
  }

  async function handleTestPrint(printer: DiscoveredPrinter) {
    setTestPrintingId(printer.id)
    try {
      await printerService.testPrint(settings, config)
      notify('Test receipt sent to printer.')
    } catch (err) {
      notify(printerErrorMessage(err), 'error')
    } finally {
      setTestPrintingId(null)
    }
  }

  async function handleSaveConfig() {
    setSavingConfig(true)
    try {
      updatePrinterConfig(config)
      notify('Printer settings saved.')
    } finally {
      setSavingConfig(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#F6F8F7] pb-28 pt-[max(0.75rem,env(safe-area-inset-top,0px))] text-[#091413] antialiased">
      <main className="mx-auto w-full max-w-2xl px-4 sm:px-6">
        <header className="pb-3">
          <h1 className="text-2xl font-black tracking-tight text-[#091413]">Printer Settings</h1>
          <p className="mt-0.5 text-xs text-slate-500">Bluetooth receipt printer &amp; cash drawer</p>
        </header>

        {bluetoothEnabled === false && (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-3.5">
            <p className="text-xs font-semibold text-amber-800">Please enable Bluetooth to connect to a printer.</p>
            <button
              type="button"
              onClick={() => void printerService.isBluetoothEnabled().then(setBluetoothEnabled)}
              className="shrink-0 rounded-xl bg-white px-3 py-1.5 text-xs font-bold text-amber-800 shadow-2xs active:scale-95 touch-manipulation"
            >
              Retry
            </button>
          </div>
        )}

        {/* Bluetooth printer section */}
        <section className="rounded-3xl border border-[#E5EBE7] bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">Bluetooth Printer</h2>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold ${
                status === 'connected'
                  ? 'bg-[#EAF1EE] text-[#285A48]'
                  : status === 'connecting'
                    ? 'bg-amber-50 text-amber-700'
                    : 'bg-slate-100 text-slate-500'
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  status === 'connected' ? 'bg-emerald-500' : status === 'connecting' ? 'bg-amber-500' : 'bg-slate-400'
                }`}
              />
              {status === 'connected' ? 'Connected' : status === 'connecting' ? 'Connecting…' : 'Disconnected'}
            </span>
          </div>

          <button
            type="button"
            onClick={() => void handleScan()}
            disabled={scanning}
            className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#285A48] text-sm font-bold text-white shadow-md shadow-[#285A48]/20 active:scale-95 touch-manipulation disabled:opacity-60"
          >
            {scanning ? (
              <>
                <SpinnerIcon size={16} />
                Scanning…
              </>
            ) : (
              <>
                <BluetoothIcon size={16} />
                Scan for Printers
              </>
            )}
          </button>

          <div className="mt-4">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">Available Printers</p>

            {printers.length === 0 ? (
              <MobileEmpty
                icon={<PrinterIcon size={22} />}
                title="No printers found yet"
                hint='Tap "Scan for Printers" with your printer powered on and nearby.'
              />
            ) : (
              <div className="space-y-2.5">
                {printers.map((printer) => {
                  const isConnected = status === 'connected' && connectedPrinter?.id === printer.id
                  const isBusy = busyDeviceId === printer.id
                  return (
                    <article key={printer.id} className="rounded-2xl border border-[#E5EBE7] bg-[#F6F8F7] p-3.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-[#091413]">{printer.name}</p>
                          {printer.address && (
                            <p className="truncate font-mono text-[11px] text-slate-400">{printer.address}</p>
                          )}
                        </div>
                        {isConnected && (
                          <span className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-[#EAF1EE] px-2.5 py-1 text-[10px] font-bold text-[#285A48]">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                            Connected
                          </span>
                        )}
                      </div>

                      <div className="mt-2.5 flex items-center gap-2">
                        {isConnected ? (
                          <>
                            <button
                              type="button"
                              onClick={() => void handleTestPrint(printer)}
                              disabled={testPrintingId === printer.id}
                              className="flex h-10 flex-1 items-center justify-center rounded-xl border border-[#E5EBE7] bg-white text-xs font-bold text-[#285A48] active:scale-95 touch-manipulation disabled:opacity-60"
                            >
                              {testPrintingId === printer.id ? 'Printing…' : 'Test Print'}
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDisconnect()}
                              disabled={isBusy}
                              className="flex h-10 flex-1 items-center justify-center rounded-xl border border-rose-200 bg-white text-xs font-bold text-rose-600 active:scale-95 touch-manipulation disabled:opacity-60"
                            >
                              {isBusy ? 'Disconnecting…' : 'Disconnect'}
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void handleConnect(printer)}
                            disabled={isBusy || status === 'connecting'}
                            className="flex h-10 w-full items-center justify-center rounded-xl bg-[#285A48] text-xs font-bold text-white active:scale-95 touch-manipulation disabled:opacity-60"
                          >
                            {isBusy ? 'Connecting…' : 'Connect'}
                          </button>
                        )}
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </div>
        </section>

        {/* Print & drawer preferences */}
        <section className="mt-4 rounded-3xl border border-[#E5EBE7] bg-white p-4 shadow-xs">
          <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-500">Print Preferences</h2>

          <div className="space-y-4 text-sm">
            <div>
              <label className="mb-1.5 block text-xs font-bold text-slate-700">Paper Width</label>
              <div className="grid grid-cols-2 gap-2">
                {([58, 80] as const).map((width) => (
                  <button
                    key={width}
                    type="button"
                    onClick={() => setConfig((prev) => ({ ...prev, paperWidth: width }))}
                    className={`flex h-12 items-center justify-center rounded-2xl text-sm font-bold transition-all active:scale-95 touch-manipulation ${
                      config.paperWidth === width
                        ? 'bg-[#285A48] text-white shadow-sm'
                        : 'border border-[#E5EBE7] bg-white text-slate-600'
                    }`}
                  >
                    {width}mm
                  </button>
                ))}
              </div>
            </div>

            <label className="flex min-h-14 items-center justify-between gap-3 rounded-2xl border border-[#E5EBE7] bg-[#F6F8F7] px-3.5">
              <span>
                <span className="block text-sm font-bold text-slate-700">Auto-open cash drawer</span>
                <span className="block text-[11px] text-slate-500">Opens automatically after a cash payment</span>
              </span>
              <input
                type="checkbox"
                checked={config.autoOpenDrawerOnCash}
                onChange={(e) => setConfig((prev) => ({ ...prev, autoOpenDrawerOnCash: e.target.checked }))}
                className="h-6 w-11 shrink-0 appearance-none rounded-full bg-slate-300 transition-colors checked:bg-[#285A48] relative before:absolute before:left-0.5 before:top-0.5 before:h-5 before:w-5 before:rounded-full before:bg-white before:shadow before:transition-transform checked:before:translate-x-5"
              />
            </label>

            <details className="rounded-2xl border border-[#E5EBE7] bg-[#F6F8F7] p-3.5">
              <summary className="cursor-pointer text-xs font-bold text-slate-700">Advanced: drawer kick command</summary>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <Field label="Pin">
                  <select
                    value={config.drawerPin}
                    onChange={(e) => setConfig((prev) => ({ ...prev, drawerPin: Number(e.target.value) as 0 | 1 }))}
                    className="h-11 w-full rounded-xl border border-[#E5EBE7] bg-white px-2 text-sm"
                  >
                    <option value={0}>0</option>
                    <option value={1}>1</option>
                  </select>
                </Field>
                <Field label="On (ms)">
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={255}
                    value={config.drawerOnMs}
                    onChange={(e) => setConfig((prev) => ({ ...prev, drawerOnMs: Number(e.target.value) }))}
                    className="h-11 w-full rounded-xl border border-[#E5EBE7] bg-white px-2 text-sm"
                  />
                </Field>
                <Field label="Off (ms)">
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={255}
                    value={config.drawerOffMs}
                    onChange={(e) => setConfig((prev) => ({ ...prev, drawerOffMs: Number(e.target.value) }))}
                    className="h-11 w-full rounded-xl border border-[#E5EBE7] bg-white px-2 text-sm"
                  />
                </Field>
              </div>
              <p className="mt-2 text-[11px] leading-4 text-slate-500">
                Standard ESC/POS drawer kick is pin 0, 25ms on, 250ms off. Only change these if your printer's drawer
                jack needs different timing.
              </p>
            </details>

            <Button onClick={() => void handleSaveConfig()} disabled={savingConfig} className="min-h-12 w-full text-sm">
              {savingConfig ? 'Saving…' : 'Save Preferences'}
            </Button>
          </div>
        </section>
      </main>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</span>
      {children}
    </label>
  )
}

function BluetoothIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6.5 6.5 11 11L12 23V1l5.5 5.5-11 11" />
    </svg>
  )
}

function PrinterIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 6 2 18 2 18 9" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" />
    </svg>
  )
}

function SpinnerIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="animate-spin">
      <path d="M21 12a9 9 0 1 1-9-9" />
    </svg>
  )
}

export default MobilePrinterSettings
