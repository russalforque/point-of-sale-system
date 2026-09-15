import type { Sale } from '../types'
import { saveFile, type FileExportResult } from './fileExport'

/**
 * Report export (PDF / CSV).
 *
 * Screens pass in numbers they have already calculated, so exports always match what is on
 * screen and no report logic is duplicated here. The PDF is written directly (standard
 * Helvetica, no library) so it works the same in the browser and the Android app.
 */

export type ExportFormat = 'pdf' | 'csv'

export type ReportTransactionRow = {
  date: Date | null
  invoice: string
  customer: string
  cashier: string
  payment: string
  status: string
  items: number
  subtotal: number
  discount: number
  tax: number
  total: number
}

export type ReportExportData = {
  storeName: string
  /** e.g. "7 days · Sep 9 – Sep 15" */
  periodLabel: string
  /** e.g. "Payment: Cash · Search: “INV-12”" */
  filtersLabel?: string
  generatedAt: Date
  /** Currency code (PHP). Used in the PDF, whose standard font has no ₱ glyph. */
  currency: string
  summary: { label: string; value: number; kind: 'money' | 'count' }[]
  paymentMethods: { label: string; count: number; amount: number }[]
  topProducts: { name: string; quantity: number; revenue: number }[]
  transactions: ReportTransactionRow[]
}

export function toTransactionRow(sale: Sale, paymentLabel: string): ReportTransactionRow {
  const date = new Date(sale.createdAt)
  return {
    date: Number.isNaN(date.getTime()) ? null : date,
    invoice: sale.invoiceNumber || '',
    customer: sale.customerName || 'Walk-in customer',
    cashier: sale.cashierName || '',
    payment: paymentLabel,
    status: sale.status || '',
    items: sale.items?.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0) ?? 0,
    subtotal: Number(sale.subtotal) || 0,
    discount: Number(sale.discount) || 0,
    tax: Number(sale.tax) || 0,
    total: Number(sale.total) || 0,
  }
}

const pad = (value: number) => String(value).padStart(2, '0')

/** Local "2026-09-15 14:05" — sorts correctly and is recognised as a date by spreadsheets. */
function formatDateTimeCell(date: Date | null): string {
  if (!date) return ''
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const amount = (value: number) => value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const shareOf = (value: number, total: number) => (total > 0 ? (value / total) * 100 : 0)

/* =============================================================
   CSV
============================================================= */

function csvText(value: string): string {
  // Neutralise spreadsheet formulas (=, +, -, @) in free text such as customer names.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return `"${safe.replace(/"/g, '""')}"`
}

export function buildReportCsv(data: ReportExportData): string {
  const rows: (string | number)[][] = []
  const text = (value: string) => csvText(value)
  const money = (value: number) => value.toFixed(2)

  rows.push([text('Sales report')])
  rows.push([text('Store'), text(data.storeName)])
  rows.push([text('Period'), text(data.periodLabel)])
  if (data.filtersLabel) rows.push([text('Filters'), text(data.filtersLabel)])
  rows.push([text('Generated'), text(formatDateTimeCell(data.generatedAt))])
  rows.push([text('Currency'), text(data.currency)])
  rows.push([])

  rows.push([text('Summary')])
  rows.push([text('Metric'), text('Value')])
  data.summary.forEach((item) => rows.push([text(item.label), item.kind === 'money' ? money(item.value) : item.value]))
  rows.push([])

  const methodTotal = data.paymentMethods.reduce((sum, entry) => sum + entry.amount, 0)
  rows.push([text('Payment methods')])
  rows.push([text('Method'), text('Sales'), text('Amount'), text('Share %')])
  data.paymentMethods.forEach((entry) =>
    rows.push([text(entry.label), entry.count, money(entry.amount), shareOf(entry.amount, methodTotal).toFixed(1)]),
  )
  rows.push([])

  rows.push([text('Top products')])
  rows.push([text('Product'), text('Quantity sold'), text('Revenue')])
  data.topProducts.forEach((product) => rows.push([text(product.name), product.quantity, money(product.revenue)]))
  rows.push([])

  rows.push([text('Transactions')])
  rows.push(
    ['Date', 'Invoice Number', 'Customer', 'Cashier', 'Payment Method', 'Status', 'Items Count', 'Subtotal', 'Discount', 'Tax', 'Total'].map(text),
  )
  data.transactions.forEach((row) =>
    rows.push([
      text(formatDateTimeCell(row.date)),
      text(row.invoice),
      text(row.customer),
      text(row.cashier),
      text(row.payment),
      text(row.status),
      row.items,
      money(row.subtotal),
      money(row.discount),
      money(row.tax),
      money(row.total),
    ]),
  )

  // BOM so Excel opens UTF-8 names (ñ, ₱) correctly; CRLF per RFC 4180.
  return `﻿${rows.map((row) => row.join(',')).join('\r\n')}\r\n`
}

/* =============================================================
   PDF (A4, standard Helvetica, WinAnsi encoding)
============================================================= */

const PAGE_W = 595.28
const PAGE_H = 841.89
const MARGIN = 40
const CONTENT_W = PAGE_W - MARGIN * 2
const FOOTER_SPACE = 36

type Font = 'regular' | 'bold'
type Rgb = [number, number, number]

const INK: Rgb = [0.035, 0.078, 0.075]
const MUTED: Rgb = [0.39, 0.45, 0.52]
const FAINT: Rgb = [0.6, 0.64, 0.69]
const GREEN: Rgb = [0.122, 0.369, 0.231]
const RULE: Rgb = [0.9, 0.92, 0.91]
const TINT: Rgb = [0.949, 0.973, 0.957]

// Helvetica glyph widths (1/1000 em) for ASCII 32–126, from the standard AFM metrics.
const HELVETICA_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556,
  556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
]

const WIN_ANSI_REPLACEMENTS: Record<string, string> = {
  '–': '-',
  '—': '-',
  '−': '-',
  '‘': "'",
  '’': "'",
  '“': '"',
  '”': '"',
  '…': '...',
  ' ': ' ',
  '₱': 'PHP ',
}

/** Keep only characters the standard PDF fonts can draw (Latin-1); replace the rest. */
function toWinAnsi(value: string): string {
  let out = ''
  for (const char of value) {
    const replacement = WIN_ANSI_REPLACEMENTS[char]
    if (replacement !== undefined) {
      out += replacement
      continue
    }
    const code = char.codePointAt(0) ?? 63
    out += (code >= 32 && code <= 126) || (code >= 160 && code <= 255) ? char : '?'
  }
  return out
}

function textWidth(value: string, size: number, font: Font): number {
  let units = 0
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    units += code >= 32 && code <= 126 ? HELVETICA_WIDTHS[code - 32] ?? 556 : 556
  }
  // Helvetica-Bold is ~5% wider on average; close enough for alignment and truncation.
  return (units / 1000) * size * (font === 'bold' ? 1.05 : 1)
}

function fitText(value: string, size: number, font: Font, maxWidth: number): string {
  if (textWidth(value, size, font) <= maxWidth) return value
  let trimmed = value
  while (trimmed.length > 0 && textWidth(`${trimmed}...`, size, font) > maxWidth) trimmed = trimmed.slice(0, -1)
  return `${trimmed.trimEnd()}...`
}

const escapePdfText = (value: string) => value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
const num = (value: number) => (Math.round(value * 100) / 100).toString()
const rgb = ([r, g, b]: Rgb) => `${num(r)} ${num(g)} ${num(b)}`

type Column = { header: string; width: number; align?: 'left' | 'right' }

class PdfLayout {
  pages: string[][] = []
  private ops: string[] = []
  y = 0

  constructor() {
    this.addPage()
  }

  addPage() {
    this.ops = []
    this.pages.push(this.ops)
    this.y = PAGE_H - MARGIN
  }

  /** Point drawing at an existing page (used to add footers once the page count is known). */
  usePage(index: number) {
    const ops = this.pages[index]
    if (ops) this.ops = ops
  }

  /** Start a new page when `height` no longer fits above the footer. Returns true if it did. */
  ensure(height: number): boolean {
    if (this.y - height < MARGIN + FOOTER_SPACE) {
      this.addPage()
      return true
    }
    return false
  }

  text(
    x: number,
    y: number,
    value: string,
    { size = 9, font = 'regular', color = INK, align = 'left', maxWidth }: {
      size?: number
      font?: Font
      color?: Rgb
      align?: 'left' | 'right'
      maxWidth?: number
    } = {},
  ) {
    let content = toWinAnsi(value)
    if (maxWidth !== undefined) content = fitText(content, size, font, maxWidth)
    const left = align === 'right' ? x - textWidth(content, size, font) : x
    this.ops.push(
      `BT /${font === 'bold' ? 'F2' : 'F1'} ${size} Tf ${rgb(color)} rg ${num(left)} ${num(y)} Td (${escapePdfText(content)}) Tj ET`,
    )
  }

  line(x1: number, y1: number, x2: number, y2: number, color = RULE, width = 0.6) {
    this.ops.push(`${rgb(color)} RG ${width} w ${num(x1)} ${num(y1)} m ${num(x2)} ${num(y2)} l S`)
  }

  rect(x: number, y: number, width: number, height: number, color: Rgb) {
    this.ops.push(`${rgb(color)} rg ${num(x)} ${num(y)} ${num(width)} ${num(height)} re f`)
  }

  sectionTitle(title: string) {
    this.ensure(48)
    this.y -= 22
    this.text(MARGIN, this.y, title, { size: 12, font: 'bold' })
    this.y -= 10
  }

  table(columns: Column[], rows: { cells: string[]; muted?: boolean }[], emptyText: string) {
    const rowHeight = 17
    const drawHeader = () => {
      let x = MARGIN
      this.y -= 14
      columns.forEach((column) => {
        const anchor = column.align === 'right' ? x + column.width - 4 : x
        this.text(anchor, this.y, column.header, { size: 8, font: 'bold', color: MUTED, align: column.align, maxWidth: column.width - 8 })
        x += column.width
      })
      this.y -= 6
      this.line(MARGIN, this.y, MARGIN + CONTENT_W, this.y, RULE, 0.8)
    }

    drawHeader()

    if (rows.length === 0) {
      this.y -= rowHeight
      this.text(MARGIN, this.y + 5, emptyText, { size: 9, color: FAINT })
      return
    }

    rows.forEach((row) => {
      if (this.ensure(rowHeight)) drawHeader()
      this.y -= rowHeight
      let x = MARGIN
      columns.forEach((column, index) => {
        const anchor = column.align === 'right' ? x + column.width - 4 : x
        this.text(anchor, this.y + 5, row.cells[index] ?? '', {
          size: 9,
          color: row.muted ? FAINT : INK,
          align: column.align,
          maxWidth: column.width - 8,
        })
        x += column.width
      })
      this.line(MARGIN, this.y, MARGIN + CONTENT_W, this.y)
    })
  }
}

function serializePdf(pages: string[][]): Uint8Array {
  const objects: string[] = []
  const pageCount = pages.length
  const pageObjectId = (index: number) => 5 + index * 2

  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objects[2] = `<< /Type /Pages /Kids [${pages.map((_, index) => `${pageObjectId(index)} 0 R`).join(' ')}] /Count ${pageCount} >>`
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'

  pages.forEach((ops, index) => {
    const stream = ops.join('\n')
    objects[pageObjectId(index)] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageObjectId(index) + 1} 0 R >>`
    objects[pageObjectId(index) + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
  })

  // Every character is a single byte (WinAnsi), so string length equals byte offset.
  let output = '%PDF-1.4\n%âãÏÓ\n'
  const offsets: number[] = []
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = output.length
    output += `${id} 0 obj\n${objects[id]}\nendobj\n`
  }

  const xrefOffset = output.length
  output += `xref\n0 ${objects.length}\n0000000000 65535 f \n`
  for (let id = 1; id < objects.length; id++) {
    output += `${String(offsets[id] ?? 0).padStart(10, '0')} 00000 n \n`
  }
  output += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`

  const bytes = new Uint8Array(output.length)
  for (let index = 0; index < output.length; index++) bytes[index] = output.charCodeAt(index) & 0xff
  return bytes
}

export function buildReportPdf(data: ReportExportData): Uint8Array {
  const pdf = new PdfLayout()
  const currencyAmount = (value: number) => `${data.currency} ${amount(value)}`

  /* Header */
  pdf.y -= 4
  pdf.text(MARGIN, pdf.y, data.storeName || 'Store', { size: 10, font: 'bold', color: GREEN, maxWidth: CONTENT_W })
  pdf.y -= 24
  pdf.text(MARGIN, pdf.y, 'Sales report', { size: 22, font: 'bold' })
  pdf.y -= 18
  pdf.text(MARGIN, pdf.y, data.periodLabel, { size: 10, color: MUTED, maxWidth: CONTENT_W })
  if (data.filtersLabel) {
    pdf.y -= 14
    pdf.text(MARGIN, pdf.y, data.filtersLabel, { size: 9, color: MUTED, maxWidth: CONTENT_W })
  }
  pdf.y -= 14
  pdf.text(MARGIN, pdf.y, `Generated ${formatDateTimeCell(data.generatedAt)}`, { size: 9, color: FAINT })
  pdf.y -= 16
  pdf.line(MARGIN, pdf.y, MARGIN + CONTENT_W, pdf.y, RULE, 1)

  /* Summary — 4 per row on a light tint */
  const perRow = 4
  const cellWidth = CONTENT_W / perRow
  const cellHeight = 44
  const summaryRows = Math.ceil(data.summary.length / perRow)
  pdf.y -= 14
  pdf.ensure(summaryRows * cellHeight + 8)
  pdf.rect(MARGIN, pdf.y - summaryRows * cellHeight - 4, CONTENT_W, summaryRows * cellHeight + 4, TINT)
  data.summary.forEach((item, index) => {
    const column = index % perRow
    const row = Math.floor(index / perRow)
    const x = MARGIN + column * cellWidth + 12
    const top = pdf.y - row * cellHeight
    pdf.text(x, top - 16, item.label, { size: 8, color: MUTED, maxWidth: cellWidth - 20 })
    pdf.text(x, top - 32, item.kind === 'money' ? currencyAmount(item.value) : item.value.toLocaleString('en-US'), {
      size: 12,
      font: 'bold',
      color: index === 0 ? GREEN : INK,
      maxWidth: cellWidth - 20,
    })
  })
  pdf.y -= summaryRows * cellHeight + 4

  /* Payment methods */
  const methodTotal = data.paymentMethods.reduce((sum, entry) => sum + entry.amount, 0)
  pdf.sectionTitle('Payment methods')
  pdf.table(
    [
      { header: 'Method', width: 215 },
      { header: 'Sales', width: 100, align: 'right' },
      { header: 'Share', width: 100, align: 'right' },
      { header: `Amount (${data.currency})`, width: 100.28, align: 'right' },
    ],
    data.paymentMethods.map((entry) => ({
      cells: [entry.label, String(entry.count), `${shareOf(entry.amount, methodTotal).toFixed(0)}%`, amount(entry.amount)],
    })),
    'No completed sales in this period.',
  )

  /* Top products */
  pdf.sectionTitle('Top products')
  pdf.table(
    [
      { header: '#', width: 25 },
      { header: 'Product', width: 290 },
      { header: 'Qty sold', width: 100, align: 'right' },
      { header: `Revenue (${data.currency})`, width: 100.28, align: 'right' },
    ],
    data.topProducts.map((product, index) => ({
      cells: [String(index + 1), product.name, product.quantity.toLocaleString('en-US'), amount(product.revenue)],
    })),
    'No products sold in this period.',
  )

  /* Transactions */
  pdf.sectionTitle(`Transactions (${data.transactions.length})`)
  pdf.table(
    [
      { header: 'Date', width: 92 },
      { header: 'Invoice', width: 88 },
      { header: 'Customer', width: 120 },
      { header: 'Payment', width: 70 },
      { header: 'Status', width: 55 },
      { header: `Total (${data.currency})`, width: 90.28, align: 'right' },
    ],
    data.transactions.map((row) => {
      const voided = row.status.toLowerCase() === 'voided'
      return {
        muted: voided,
        cells: [formatDateTimeCell(row.date), row.invoice, row.customer, row.payment, row.status, amount(row.total)],
      }
    }),
    'No transactions in this period.',
  )

  /* Footer on every page */
  const total = pdf.pages.length
  const footerLeft = `${data.storeName || 'Store'} · Sales report · ${data.periodLabel}`
  for (let index = 0; index < total; index++) {
    pdf.usePage(index)
    pdf.line(MARGIN, MARGIN + 14, MARGIN + CONTENT_W, MARGIN + 14, RULE, 0.6)
    pdf.text(MARGIN, MARGIN, footerLeft, { size: 8, color: FAINT, maxWidth: CONTENT_W - 80 })
    pdf.text(MARGIN + CONTENT_W, MARGIN, `Page ${index + 1} of ${total}`, { size: 8, color: FAINT, align: 'right' })
  }

  return serializePdf(pdf.pages)
}

/* =============================================================
   ENTRY POINT
============================================================= */

export async function exportReport(format: ExportFormat, data: ReportExportData, rangeKey: string): Promise<FileExportResult> {
  const day = `${data.generatedAt.getFullYear()}-${pad(data.generatedAt.getMonth() + 1)}-${pad(data.generatedAt.getDate())}`
  const base = `sales-report_${rangeKey}_${day}`

  if (format === 'csv') {
    return saveFile({ filename: `${base}.csv`, mimeType: 'text/csv;charset=utf-8', content: buildReportCsv(data), dialogTitle: 'Share CSV report' })
  }
  return saveFile({ filename: `${base}.pdf`, mimeType: 'application/pdf', content: buildReportPdf(data), dialogTitle: 'Share PDF report' })
}
