import { Capacitor } from '@capacitor/core'
import { useEffect, useRef, useState } from 'react'

import { connectSavedPrinter, getPrinterService, printerErrorMessage } from '../services/printer'
import type {
  DiscoveredPrinter,
  PrinterAvailability,
  PrinterConfig,
  PrinterConnectionStatus,
  PrinterConnectionType,
} from '../services/printer'
import { useSettings } from '../context/SettingsContext'
import { getPrinterConfig, updatePrinterConfig } from '../utils/printerConfig'

export type PrinterMessage = { tone: 'error' | 'success' | 'info'; text: string }

const SCAN_MS = 12000

export const CONNECTION_STATUS_LABELS: Record<PrinterConnectionStatus, string> = {
  connected: 'Connected',
  connecting: 'Connecting',
  disconnected: 'Disconnected',
  error: 'Error',
}

export const CONNECTION_TYPE_LABELS: Record<PrinterConnectionType, string> = {
  bluetooth: 'Bluetooth',
  usb: 'USB',
}

export const AVAILABILITY_MESSAGES: Record<Exclude<PrinterAvailability, 'ready'>, string> = {
  'bluetooth-off': 'Bluetooth is off. Turn it on to connect your printer.',
  'permission-denied': 'Bluetooth permission is off. Allow “Nearby devices” for Sellix POS in Android Settings, then try again.',
  unsupported: 'Bluetooth printing isn’t available on this device.',
}

/** Adds a printer, or refreshes its details when it's reported again. */
function upsertPrinter(list: DiscoveredPrinter[], printer: DiscoveredPrinter): DiscoveredPrinter[] {
  return list.some((p) => p.id === printer.id)
    ? list.map((p) => (p.id === printer.id ? { ...p, ...printer, paired: printer.paired ?? p.paired } : p))
    : [...list, printer]
}

/** Likely printers first, then alphabetical. */
export function sortPrinters(list: DiscoveredPrinter[]): DiscoveredPrinter[] {
  return [...list].sort(
    (a, b) => Number(Boolean(b.likelyPrinter)) - Number(Boolean(a.likelyPrinter)) || a.name.localeCompare(b.name),
  )
}

/**
 * State and actions for the Printer settings screens (phone and tablet/desktop share it).
 * `mode` is the connection type being set up; the saved printer's type only changes once a
 * printer of the other type actually connects, so browsing tabs never loses the saved printer.
 */
export function usePrinterSettings() {
  const { settings } = useSettings()
  const service = getPrinterService()
  const canUseUsb = Capacitor.getPlatform() === 'android'

  const [config, setConfig] = useState<PrinterConfig>(() => getPrinterConfig())
  const [mode, setMode] = useState<PrinterConnectionType>(() => (canUseUsb ? getPrinterConfig().connectionType : 'bluetooth'))
  const [status, setStatus] = useState<PrinterConnectionStatus>(service.getStatus())
  const [connectedPrinter, setConnectedPrinter] = useState<DiscoveredPrinter | null>(service.getConnectedPrinter())
  const [bluetoothPrinters, setBluetoothPrinters] = useState<DiscoveredPrinter[]>(() => {
    const saved = getPrinterConfig()
    return saved.deviceId && saved.connectionType === 'bluetooth'
      ? [{ id: saved.deviceId, name: saved.deviceName ?? 'Saved printer', address: saved.deviceId, type: 'bluetooth' }]
      : []
  })
  const [usbPrinters, setUsbPrinters] = useState<DiscoveredPrinter[]>([])
  const [availability, setAvailability] = useState<PrinterAvailability | null>(null)
  const [scanning, setScanning] = useState(false)
  const [hasScanned, setHasScanned] = useState(false)
  const [loadingUsb, setLoadingUsb] = useState(false)
  const [busyDeviceId, setBusyDeviceId] = useState<string | null>(null)
  const [testPrinting, setTestPrinting] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [message, setMessage] = useState<PrinterMessage | null>(null)

  const scanningRef = useRef(false)
  const modeRef = useRef(mode)

  useEffect(() => {
    modeRef.current = mode
  }, [mode])

  useEffect(() => {
    const unsubscribeStatus = service.onStatusChange((nextStatus, printer) => {
      setStatus(nextStatus)
      setConnectedPrinter(printer)
      if (printer && printer.type !== 'usb') setBluetoothPrinters((prev) => upsertPrinter(prev, printer))
    })
    const unsubscribeUsb = service.onUsbDevicesChanged(() => {
      if (modeRef.current === 'usb') void refreshUsb()
    })

    if (modeRef.current === 'usb') void refreshUsb(true)
    else void refreshBluetooth(true)

    return () => {
      unsubscribeStatus()
      unsubscribeUsb()
      if (scanningRef.current) void service.stopScan()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!savedFlash) return
    const id = window.setTimeout(() => setSavedFlash(false), 1500)
    return () => window.clearTimeout(id)
  }, [savedFlash])

  /** Preferences persist immediately — there is no separate save step to forget. */
  function updateConfig(patch: Partial<PrinterConfig>) {
    setConfig(updatePrinterConfig(patch))
    setSavedFlash(true)
  }

  /** Asks for Bluetooth permission if needed, lists paired printers and silently reconnects the saved one. */
  async function refreshBluetooth(reconnect = false): Promise<PrinterAvailability> {
    const next = await service.getAvailability()
    setAvailability(next)
    if (next !== 'ready') return next

    try {
      const paired = await service.listPairedPrinters()
      setBluetoothPrinters((prev) => paired.reduce(upsertPrinter, prev))
    } catch (err) {
      setMessage({ tone: 'error', text: printerErrorMessage(err) })
    }

    const saved = getPrinterConfig()
    if (reconnect && saved.deviceId && saved.connectionType === 'bluetooth') void connectSavedPrinter()
    return next
  }

  async function refreshUsb(reconnect = false): Promise<DiscoveredPrinter[]> {
    if (!canUseUsb) return []
    setLoadingUsb(true)
    try {
      const list = await service.listUsbPrinters()
      setUsbPrinters(list)
      const saved = getPrinterConfig()
      if (reconnect && saved.connectionType === 'usb' && list.some((p) => p.id === saved.deviceId)) void connectSavedPrinter()
      return list
    } catch (err) {
      setMessage({ tone: 'error', text: printerErrorMessage(err) })
      return []
    } finally {
      setLoadingUsb(false)
    }
  }

  async function changeMode(next: PrinterConnectionType) {
    if (next === modeRef.current) return
    if (scanningRef.current) await stopScan()
    setMode(next)
    setMessage(null)
    if (next === 'usb') void refreshUsb()
    else void refreshBluetooth()
  }

  async function enableBluetooth() {
    try {
      const enabled = await service.requestEnableBluetooth()
      setAvailability(enabled ? 'ready' : 'bluetooth-off')
      if (enabled) void refreshBluetooth(true)
    } catch (err) {
      setMessage({ tone: 'error', text: printerErrorMessage(err) })
      void refreshBluetooth()
    }
  }

  async function scan() {
    setScanning(true)
    setMessage(null)
    scanningRef.current = true
    let found = 0
    try {
      const next = await service.getAvailability()
      setAvailability(next)
      if (next !== 'ready') return

      await service.scanPrinters((printer) => {
        found += 1
        setBluetoothPrinters((prev) => upsertPrinter(prev, printer))
      }, SCAN_MS)

      if (found === 0) {
        setMessage({
          tone: 'info',
          text: 'No printers found. Turn the printer on, then pair it in Android Settings › Bluetooth (PIN 0000 or 1234) and search again.',
        })
      }
    } catch (err) {
      setMessage({ tone: 'error', text: printerErrorMessage(err) })
    } finally {
      setScanning(false)
      setHasScanned(true)
      scanningRef.current = false
    }
  }

  async function stopScan() {
    await service.stopScan()
    setScanning(false)
    setHasScanned(true)
    scanningRef.current = false
  }

  async function connect(printer: DiscoveredPrinter) {
    if (scanningRef.current) await stopScan()
    setBusyDeviceId(printer.id)
    setMessage(null)
    try {
      await service.connect(printer)
      setConfig(
        updatePrinterConfig({ deviceId: printer.id, deviceName: printer.name, connectionType: printer.type ?? 'bluetooth' }),
      )
      setMessage({ tone: 'success', text: `Connected to ${printer.name}. It will reconnect automatically for each sale.` })
    } catch (err) {
      setMessage({ tone: 'error', text: printerErrorMessage(err) })
    } finally {
      setBusyDeviceId(null)
    }
  }

  /** "Connect Printer": reconnects the saved printer for this connection type, otherwise looks for one. */
  async function connectPrinter() {
    const saved = getPrinterConfig()

    if (mode === 'usb') {
      const list = await refreshUsb()
      const target = list.find((p) => p.id === saved.deviceId) ?? (list.length === 1 ? list[0] : undefined)
      if (target) await connect(target)
      else {
        setMessage({
          tone: 'info',
          text:
            list.length === 0
              ? 'No USB printer detected. Connect the printer with a USB OTG cable, turn it on, then tap Connect Printer again.'
              : 'Choose your printer from the USB list below.',
        })
      }
      return
    }

    if (saved.deviceId && saved.connectionType === 'bluetooth') {
      await connect({ id: saved.deviceId, name: saved.deviceName ?? 'Saved printer', type: 'bluetooth' })
      return
    }

    const next = await refreshBluetooth()
    if (next !== 'ready') return
    setMessage({ tone: 'info', text: 'Choose your printer from the list below, or search for nearby printers.' })
  }

  async function disconnect() {
    setBusyDeviceId(connectedPrinter?.id ?? 'disconnect')
    try {
      await service.disconnect()
      setMessage({ tone: 'info', text: 'Printer disconnected. Receipts won’t print until it is connected again.' })
    } catch (err) {
      setMessage({ tone: 'error', text: printerErrorMessage(err) })
    } finally {
      setBusyDeviceId(null)
    }
  }

  async function testPrint() {
    if (testPrinting) return
    setTestPrinting(true)
    setMessage(null)
    try {
      await service.testPrint(settings, getPrinterConfig())
      setMessage({ tone: 'success', text: 'Test print sent. Check that every line on the slip is complete and readable.' })
    } catch (err) {
      setMessage({ tone: 'error', text: printerErrorMessage(err) })
    } finally {
      setTestPrinting(false)
    }
  }

  const isConnected = status === 'connected' && connectedPrinter !== null

  return {
    canUseUsb,
    config,
    mode,
    status,
    isConnected,
    connectedPrinter,
    bluetoothPrinters,
    usbPrinters,
    availability,
    scanning,
    hasScanned,
    loadingUsb,
    busyDeviceId,
    testPrinting,
    savedFlash,
    message,
    updateConfig,
    changeMode,
    enableBluetooth,
    refreshBluetooth,
    refreshUsb,
    scan,
    stopScan,
    connect,
    connectPrinter,
    disconnect,
    testPrint,
  }
}
