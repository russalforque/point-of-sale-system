export type PrinterErrorCode =
  | 'not-connected'
  | 'bluetooth-disabled'
  | 'printer-unavailable'
  | 'print-failed'
  | 'drawer-unavailable'

// Wording matches the app's required user-facing copy exactly - PrinterError.message
// is safe to show directly in a toast without any further mapping.
const MESSAGES: Record<PrinterErrorCode, string> = {
  'not-connected': 'Printer is not connected.',
  'bluetooth-disabled': 'Please enable Bluetooth to connect to a printer.',
  'printer-unavailable': 'Unable to connect to the selected printer.',
  'print-failed': 'Receipt could not be printed.',
  'drawer-unavailable': 'Cash drawer could not be opened.',
}

export class PrinterError extends Error {
  code: PrinterErrorCode

  constructor(code: PrinterErrorCode, message?: string) {
    super(message ?? MESSAGES[code])
    this.name = 'PrinterError'
    this.code = code
  }
}

export function printerErrorMessage(error: unknown): string {
  if (error instanceof PrinterError) return error.message
  if (error instanceof Error) return error.message
  return 'Receipt could not be printed.'
}
