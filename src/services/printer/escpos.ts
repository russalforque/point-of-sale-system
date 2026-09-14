import type { PrinterPaperWidth } from './types'

export type Alignment = 'left' | 'center' | 'right'

const ESC = 0x1b
const GS = 0x1d

// Printable character columns for common thermal paper widths at the printer's
// default font (12x24 "Font A") - the values thermal printer vendors publish.
const COLUMNS_BY_WIDTH: Record<PrinterPaperWidth, number> = {
  58: 32,
  80: 48,
}

// Thermal printers speak a single-byte codepage (commonly CP437/1252), not UTF-8,
// so characters outside Latin-1 are transliterated where there's an obvious ASCII
// equivalent (e.g. the peso sign) and otherwise fall back to '?' rather than
// silently corrupting the receipt.
const CHAR_REPLACEMENTS: Record<string, string> = {
  '₱': 'P',
  '–': '-',
  '—': '-',
  '’': "'",
  '‘': "'",
  '“': '"',
  '”': '"',
  '…': '...',
}

export function sanitizeForPrinter(text: string): string {
  return Array.from(text)
    .map((ch) => CHAR_REPLACEMENTS[ch] ?? ch)
    .join('')
}

function textToBytes(sanitized: string): number[] {
  const bytes: number[] = []
  for (const ch of sanitized) {
    const code = ch.codePointAt(0) ?? 0x3f
    bytes.push(code <= 0xff ? code : 0x3f)
  }
  return bytes
}

type ColumnCell = { text: string; width: number; align?: Alignment }

/**
 * Accumulates an ESC/POS byte stream while tracking a parallel plain-text
 * rendering, so a single formatting pass produces both the bytes to send to
 * the printer and a preview string usable for testing/on-screen review.
 */
export class ReceiptBuilder {
  private bytes: number[] = []
  private lines: string[] = []
  readonly columns: number

  constructor(paperWidth: PrinterPaperWidth = 58) {
    this.columns = COLUMNS_BY_WIDTH[paperWidth]
  }

  init(): this {
    this.bytes.push(ESC, 0x40)
    return this
  }

  align(mode: Alignment): this {
    const value = mode === 'center' ? 0x01 : mode === 'right' ? 0x02 : 0x00
    this.bytes.push(ESC, 0x61, value)
    return this
  }

  bold(on: boolean): this {
    this.bytes.push(ESC, 0x45, on ? 1 : 0)
    return this
  }

  doubleSize(on: boolean): this {
    this.bytes.push(GS, 0x21, on ? 0x11 : 0x00)
    return this
  }

  underline(on: boolean): this {
    this.bytes.push(ESC, 0x2d, on ? 1 : 0)
    return this
  }

  text(str: string): this {
    this.bytes.push(...textToBytes(sanitizeForPrinter(str)))
    return this
  }

  line(str = ''): this {
    const safe = sanitizeForPrinter(str)
    this.bytes.push(...textToBytes(safe), 0x0a)
    this.lines.push(safe)
    return this
  }

  feed(lines = 1): this {
    for (let i = 0; i < lines; i += 1) {
      this.bytes.push(0x0a)
      this.lines.push('')
    }
    return this
  }

  divider(char = '-'): this {
    return this.line(char.repeat(this.columns))
  }

  /** Left-aligned label, right-aligned value, padded/truncated to the full paper width. */
  row(left: string, right: string): this {
    const safeLeft = sanitizeForPrinter(left)
    const safeRight = sanitizeForPrinter(right).slice(0, this.columns)
    const maxLeft = Math.max(0, this.columns - safeRight.length - 1)
    const clippedLeft = safeLeft.length > maxLeft ? safeLeft.slice(0, maxLeft) : safeLeft
    const padding = Math.max(1, this.columns - clippedLeft.length - safeRight.length)
    return this.line(clippedLeft + ' '.repeat(padding) + safeRight)
  }

  /** Fixed-width columns (hard-truncated, never wrapped) joined with no extra spacing. */
  columnsRow(cells: ColumnCell[]): this {
    const parts = cells.map(({ text, width, align = 'left' }) => {
      const safe = sanitizeForPrinter(text)
      const clipped = safe.length > width ? safe.slice(0, width) : safe
      return align === 'right' ? clipped.padStart(width) : clipped.padEnd(width)
    })
    return this.line(parts.join(''))
  }

  cutPaper(): this {
    this.feed(3)
    this.bytes.push(GS, 0x56, 0x01)
    return this
  }

  /** Appends a raw command (e.g. the cash-drawer kick sequence) into the same byte stream. */
  raw(command: number[] | Uint8Array): this {
    this.bytes.push(...Array.from(command))
    return this
  }

  toBytes(): Uint8Array {
    return Uint8Array.from(this.bytes)
  }

  toText(): string {
    return this.lines.join('\n')
  }
}
