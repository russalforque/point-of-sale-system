import { useEffect, useRef, useState } from 'react'

import { connectSavedPrinter, getPrinterService, printerErrorMessage } from '../services/printer'
import type { DiscoveredPrinter, PrinterConfig, PrinterConnectionStatus } from '../services/printer'
import { getPrinterConfig, updatePrinterConfig } from '../utils/printerConfig'

import { Button } from '../components/ui/Button'
import { Card, PageHeader } from '../components/ui/Page'
import { EmptyState } from '../components/ui/States'
import { useIsMobile } from '../hooks/useIsMobile'
import { useSettings } from '../context/SettingsContext'
import { useToast } from '../context/ToastContext'
import { MobilePrinterSettings } from './mobile/MobilePrinterSettings'

const printerService = getPrinterService()

export function PrinterSettingsPage() {
  const isMobile = useIsMobile()
  if (isMobile) return <MobilePrinterSettings />
  return <DesktopPrinterSettingsPage />
}

function DesktopPrinterSettingsPage() {
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
        setPrinters((prev) => (prev.some((p) => p.id === found.id) ? prev : [...prev, found]))
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
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 md:px-8">
      <PageHeader title="Printer Settings" subtitle="Bluetooth receipt printer and cash drawer configuration" />

      {bluetoothEnabled === false && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm font-medium text-amber-800">Please enable Bluetooth to connect to a printer.</p>
          <button
            type="button"
            onClick={() => void printerService.isBluetoothEnabled().then(setBluetoothEnabled)}
            className="min-h-9 rounded-xl bg-white px-3.5 text-xs font-bold text-amber-800 shadow-xs hover:bg-amber-100"
          >
            Retry
          </button>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-bold text-[#091413]">Bluetooth Printer</h2>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${
                status === 'connected'
                  ? 'bg-[#EAF1EE] text-[#285A48]'
                  : status === 'connecting'
                    ? 'bg-amber-50 text-amber-700'
                    : 'bg-[#F6F8F7] text-[#091413]/50'
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  status === 'connected' ? 'bg-[#285A48]' : status === 'connecting' ? 'bg-amber-500' : 'bg-[#091413]/30'
                }`}
              />
              {status === 'connected' ? 'Connected' : status === 'connecting' ? 'Connecting…' : 'Disconnected'}
            </span>
          </div>

          <Button onClick={() => void handleScan()} disabled={scanning} className="w-full">
            {scanning ? 'Scanning…' : 'Scan for Printers'}
          </Button>

          <div className="mt-4 space-y-2">
            {printers.length === 0 ? (
              <EmptyState
                title="No printers found yet"
                hint='Tap "Scan for Printers" with your printer powered on and nearby.'
              />
            ) : (
              printers.map((printer) => {
                const isConnected = status === 'connected' && connectedPrinter?.id === printer.id
                const isBusy = busyDeviceId === printer.id
                return (
                  <div key={printer.id} className="flex items-center justify-between gap-3 rounded-xl border border-[#091413]/10 bg-[#091413]/[0.02] px-3.5 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-[#091413]">{printer.name}</p>
                      {printer.address && <p className="truncate font-mono text-xs text-[#091413]/40">{printer.address}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {isConnected ? (
                        <>
                          <span className="hidden items-center gap-1 text-xs font-bold text-[#285A48] sm:inline-flex">
                            <span className="h-1.5 w-1.5 rounded-full bg-[#285A48]" /> Connected
                          </span>
                          <button
                            type="button"
                            onClick={() => void handleTestPrint(printer)}
                            disabled={testPrintingId === printer.id}
                            className="min-h-9 rounded-lg border border-[#091413]/15 bg-white px-3 text-xs font-bold text-[#091413]/70 transition-colors hover:border-[#285A48]/40 hover:text-[#285A48] disabled:opacity-50"
                          >
                            {testPrintingId === printer.id ? 'Printing…' : 'Test Print'}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDisconnect()}
                            disabled={isBusy}
                            className="min-h-9 rounded-lg border border-rose-200 bg-white px-3 text-xs font-bold text-rose-600 transition-colors hover:bg-rose-50 disabled:opacity-50"
                          >
                            {isBusy ? 'Disconnecting…' : 'Disconnect'}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void handleConnect(printer)}
                          disabled={isBusy || status === 'connecting'}
                          className="min-h-9 rounded-lg bg-[#285A48] px-3.5 text-xs font-bold text-white shadow-xs transition-colors hover:bg-[#1f483a] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isBusy ? 'Connecting…' : 'Connect'}
                        </button>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="mb-4 text-sm font-bold text-[#091413]">Print Preferences</h2>
          <div className="space-y-4 text-sm">
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-[#091413]/60">
                Paper width
              </label>
              <div className="grid grid-cols-2 gap-2">
                {([58, 80] as const).map((width) => (
                  <button
                    key={width}
                    type="button"
                    onClick={() => setConfig((prev) => ({ ...prev, paperWidth: width }))}
                    className={`min-h-11 rounded-xl border text-sm font-bold transition-colors ${
                      config.paperWidth === width
                        ? 'border-[#285A48] bg-[#285A48] text-white shadow-xs'
                        : 'border-[#091413]/15 bg-white text-[#091413]/70 hover:border-[#285A48]/40 hover:text-[#285A48]'
                    }`}
                  >
                    {width}mm
                  </button>
                ))}
              </div>
            </div>

            <label className="flex items-center justify-between gap-3 rounded-xl border border-[#091413]/10 bg-[#091413]/[0.02] px-3.5 py-3">
              <span>
                <span className="block text-sm font-bold text-[#091413]">Auto-open cash drawer</span>
                <span className="block text-xs text-[#091413]/50">Opens automatically after a cash payment</span>
              </span>
              <input
                type="checkbox"
                checked={config.autoOpenDrawerOnCash}
                onChange={(e) => setConfig((prev) => ({ ...prev, autoOpenDrawerOnCash: e.target.checked }))}
                className="h-5 w-5 shrink-0 accent-[#285A48]"
              />
            </label>

            <details className="group rounded-xl border border-[#091413]/10 bg-[#091413]/[0.02] p-3.5">
              <summary className="cursor-pointer text-xs font-bold text-[#091413]/70 marker:content-none group-hover:text-[#285A48]">
                Advanced: drawer kick command
              </summary>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <label className="block text-xs">
                  <span className="mb-1 block font-bold text-[#091413]/50">Pin</span>
                  <select
                    value={config.drawerPin}
                    onChange={(e) => setConfig((prev) => ({ ...prev, drawerPin: Number(e.target.value) as 0 | 1 }))}
                    className="h-9 w-full rounded-lg border border-[#091413]/15 bg-white px-2 text-sm text-[#091413] outline-none focus:border-[#285A48] focus:ring-2 focus:ring-[#285A48]/15"
                  >
                    <option value={0}>0</option>
                    <option value={1}>1</option>
                  </select>
                </label>
                <label className="block text-xs">
                  <span className="mb-1 block font-bold text-[#091413]/50">On (ms)</span>
                  <input
                    type="number"
                    min={0}
                    max={255}
                    value={config.drawerOnMs}
                    onChange={(e) => setConfig((prev) => ({ ...prev, drawerOnMs: Number(e.target.value) }))}
                    className="h-9 w-full rounded-lg border border-[#091413]/15 bg-white px-2 text-sm text-[#091413] outline-none focus:border-[#285A48] focus:ring-2 focus:ring-[#285A48]/15"
                  />
                </label>
                <label className="block text-xs">
                  <span className="mb-1 block font-bold text-[#091413]/50">Off (ms)</span>
                  <input
                    type="number"
                    min={0}
                    max={255}
                    value={config.drawerOffMs}
                    onChange={(e) => setConfig((prev) => ({ ...prev, drawerOffMs: Number(e.target.value) }))}
                    className="h-9 w-full rounded-lg border border-[#091413]/15 bg-white px-2 text-sm text-[#091413] outline-none focus:border-[#285A48] focus:ring-2 focus:ring-[#285A48]/15"
                  />
                </label>
              </div>
              <p className="mt-2.5 text-xs text-[#091413]/50">
                Standard ESC/POS drawer kick is pin 0, 25ms on, 250ms off. Only change these if your printer's drawer
                jack needs different timing.
              </p>
            </details>

            <Button onClick={() => void handleSaveConfig()} disabled={savingConfig} className="w-full">
              {savingConfig ? 'Saving…' : 'Save Preferences'}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  )
}

export default PrinterSettingsPage
