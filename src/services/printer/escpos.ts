import type { PrinterPaperWidth } from './types'

export type Alignment = 'left' | 'center' | 'right'

const ESC = 0x1b
const GS = 0x1d
const LF = 0x0a

// Printable character columns for common thermal paper widths at the printer's
// default font (12x24 "Font A") - 32 columns on 58mm (POS-5890 series), 48 on 80mm.
const COLUMNS_BY_WIDTH: Record<PrinterPaperWidth, number> = {
  58: 32,
  80: 48,
}

// Thermal printers speak a single-byte codepage, and which one (CP437, CP850, 1252...)
// varies by model and is never selected by this app. Only 7-bit ASCII prints the same
// on all of them, so everything is reduced to ASCII: known symbols get an ASCII
// equivalent (e.g. the peso sign), accented letters lose their accent (ñ -> n),
// any Unicode space (including the U+202F that toLocaleString puts before AM/PM)
// becomes a plain space, and anything else falls back to '?'.
const CHAR_REPLACEMENTS: Record<string, string> = {
  '₱': 'P',
  '–': '-',
  '—': '-',
  '−': '-',
  '’': "'",
  '‘': "'",
  '“': '"',
  '”': '"',
  '…': '...',
  '×': 'x',
  '•': '*',
}

function toPrintableAscii(ch: string): string {
  const replacement = CHAR_REPLACEMENTS[ch]
  if (replacement !== undefined) return replacement

  const code = ch.codePointAt(0) ?? 0
  if (code >= 0x20 && code < 0x7f) return ch
  if (code < 0x20 || code === 0x7f || /\s/u.test(ch)) return ' '

  const stripped = ch.normalize('NFD').replace(/[̀-ͯ]/g, '')
  return /^[\x20-\x7e]+$/.test(stripped) ? stripped : '?'
}

export function sanitizeForPrinter(text: string): string {
  return Array.from(text).map(toPrintableAscii).join('')
}

/** Word-wraps already-sanitized text to `width` columns, hard-breaking words longer than a line. */
export function wrapText(text: string, width: number): string[] {
  const safeWidth = Math.max(1, width)
  const lines: string[] = []
  let current = ''

  for (const word of text.split(' ').filter(Boolean)) {
    let rest = word
    while (rest.length > safeWidth) {
      if (current) {
        lines.push(current)
        current = ''
      }
      lines.push(rest.slice(0, safeWidth))
      rest = rest.slice(safeWidth)
    }
    if (!rest) continue
    if (!current) current = rest
    else if (current.length + 1 + rest.length <= safeWidth) current = `${current} ${rest}`
    else {
      lines.push(current)
      current = rest
    }
  }

  if (current) lines.push(current)
  return lines.length > 0 ? lines : ['']
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

/** One printed line as it will look on paper - used for the on-screen receipt preview. */
export type PreviewLine = { text: string; align: Alignment; bold: boolean; tall: boolean }

/**
 * Accumulates an ESC/POS byte stream while tracking a parallel rendering, so a single
 * formatting pass produces both the bytes to send and an accurate on-screen preview.
 *
 * Only the most widely supported ESC/POS commands are used - ESC @ (reset), ESC a
 * (align), ESC E (bold), GS ! (character size), LF (feed) - which every generic
 * 58mm/80mm printer, including the POS-5890 series, understands. The cut command is
 * opt-in because printers without a cutter (like the POS-5890U-L) should never get it.
 */
export class ReceiptBuilder {
  private bytes: number[] = []
  private previewLines: PreviewLine[] = []
  private state: { align: Alignment; bold: boolean; tall: boolean } = { align: 'left', bold: false, tall: false }
  readonly columns: number

  constructor(paperWidth: PrinterPaperWidth = 58) {
    this.columns = COLUMNS_BY_WIDTH[paperWidth]
  }

  /** ESC @ - resets the printer so no formatting from a previous (possibly partial) job carries over. */
  init(): this {
    this.bytes.push(ESC, 0x40)
    this.state = { align: 'left', bold: false, tall: false }
    return this
  }

  align(mode: Alignment): this {
    const value = mode === 'center' ? 0x01 : mode === 'right' ? 0x02 : 0x00
    this.bytes.push(ESC, 0x61, value)
    this.state.align = mode
    return this
  }

  bold(on: boolean): this {
    this.bytes.push(ESC, 0x45, on ? 1 : 0)
    this.state.bold = on
    return this
  }

  /** Double height only - keeps the full column count, so it is safe for totals and names on 58mm. */
  tall(on: boolean): this {
    this.bytes.push(GS, 0x21, on ? 0x01 : 0x00)
    this.state.tall = on
    return this
  }

  /** Double width + height. Halves the columns per line - only use for very short text. */
  doubleSize(on: boolean): this {
    this.bytes.push(GS, 0x21, on ? 0x11 : 0x00)
    this.state.tall = on
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
    this.bytes.push(...textToBytes(safe), LF)
    this.previewLines.push({ text: safe, ...this.state })
    return this
  }

  feed(lines = 1): this {
    for (let i = 0; i < lines; i += 1) {
      this.bytes.push(LF)
      this.previewLines.push({ text: '', ...this.state })
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

  /**
   * Ends the receipt: resets formatting, feeds the paper past the tear bar, and sends
   * GS V (partial cut) only when `cut` is true - printers without a cutter never receive it.
   */
  finish(cut = false): this {
    this.tall(false).bold(false).align('left')
    this.feed(4)
    if (cut) this.bytes.push(GS, 0x56, 0x01)
    return this
  }

  /** @deprecated Use finish(cut). Kept for existing callers. */
  cutPaper(): this {
    return this.finish(true)
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
    return this.previewLines.map((line) => line.text).join('\n')
  }

  toPreview(): PreviewLine[] {
    return this.previewLines.map((line) => ({ ...line }))
  }
}
