export type PrinterErrorCode =
  | 'not-connected'
  | 'no-printer-selected'
  | 'bluetooth-disabled'
  | 'bluetooth-permission-denied'
  | 'location-permission-denied'
  | 'bluetooth-unsupported'
  | 'scan-failed'
  | 'printer-unavailable'
  | 'incompatible-printer'
  | 'printer-disconnected'
  | 'printer-busy'
  | 'print-failed'
  | 'drawer-unavailable'
  | 'usb-unsupported'
  | 'usb-not-found'
  | 'usb-permission-denied'
  | 'usb-open-failed'

// Cashier-facing wording - PrinterError.message is safe to show directly in a toast.
// The underlying technical error is kept on `cause` and logged, never shown.
const MESSAGES: Record<PrinterErrorCode, string> = {
  'not-connected': 'Printer is not connected. Connect it in Printer settings.',
  'no-printer-selected': 'No printer selected. Choose your printer in Printer settings.',
  'bluetooth-disabled': 'Bluetooth is off. Turn on Bluetooth and try again.',
  'bluetooth-permission-denied':
    'Bluetooth permission is needed. Allow “Nearby devices” for Sellix POS in Android Settings, then try again.',
  'location-permission-denied':
    'Location permission is needed to search for new Bluetooth devices on this Android version. Printers already paired in Android Bluetooth settings can still be used.',
  'bluetooth-unsupported': 'Bluetooth printing is not available on this device.',
  'scan-failed': 'Unable to search for printers. Please try again.',
  'printer-unavailable':
    'Unable to connect to the printer. Make sure it is turned on, paired in Android Bluetooth settings, and not connected to another phone.',
  'incompatible-printer': 'This device doesn’t accept print data. Choose your receipt printer.',
  'printer-disconnected': 'Printer disconnected. Check that it is on and nearby, then try again.',
  'printer-busy': 'The printer is still busy with another job. Please wait and try again.',
  'print-failed': 'Unable to print. Check that the printer is powered on and connected.',
  'drawer-unavailable': 'Cash drawer could not be opened.',
  'usb-unsupported': 'USB printing isn’t supported on this device (USB host / OTG not available).',
  'usb-not-found': 'USB printer not found. Check the cable, the OTG adapter and that the printer is on.',
  'usb-permission-denied': 'USB permission was denied. Unplug the printer, plug it back in and tap “Allow”.',
  'usb-open-failed': 'Couldn’t open the USB printer. Unplug it, plug it back in and try again.',
}

export class PrinterError extends Error {
  code: PrinterErrorCode

  constructor(code: PrinterErrorCode, cause?: unknown) {
    super(MESSAGES[code], cause === undefined ? undefined : { cause })
    this.name = 'PrinterError'
    this.code = code
  }
}

/** Keeps the raw plugin/Android error available for debugging (logcat / devtools). */
export function logPrinterError(context: string, error: unknown): void {
  console.error(`[PRINTER] ${context}:`, error)
}

export function printerErrorMessage(error: unknown): string {
  if (error instanceof PrinterError) return error.message
  logPrinterError('unexpected error', error)
  return MESSAGES['print-failed']
}
