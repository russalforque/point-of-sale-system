import JSZip from 'jszip'

/**
 * Minimal, dependency-light spreadsheet I/O for product import/export:
 * - CSV (comma, semicolon or tab separated; quoted fields; UTF-8 with or without BOM)
 * - XLSX read (first worksheet, shared/inline strings, numbers) and write (one sheet)
 * Everything runs offline in the WebView.
 */

export type Cell = string | number | null

export class SpreadsheetError extends Error {}

/* ------------------------------------------------------------------
   CSV
------------------------------------------------------------------ */

function detectDelimiter(text: string): string {
  const firstLine = text.slice(0, text.search(/\r?\n/) === -1 ? text.length : text.search(/\r?\n/))
  const counts = [',', ';', '\t'].map((delimiter) => ({ delimiter, count: firstLine.split(delimiter).length }))
  counts.sort((a, b) => b.count - a.count)
  return counts[0]!.count > 1 ? counts[0]!.delimiter : ','
}

export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, '')
  const delimiter = detectDelimiter(text)
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"'
          index += 1
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
      continue
    }
    if (char === '"' && field === '') {
      inQuotes = true
    } else if (char === delimiter) {
      row.push(field)
      field = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

function csvCell(value: Cell): string {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /[",\r\n]/.test(text) || /^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** CSV with a BOM so Excel opens UTF-8 (₱, ñ) correctly. */
export function buildCsv(rows: Cell[][]): string {
  return `﻿${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`
}

/* ------------------------------------------------------------------
   XLSX READ
------------------------------------------------------------------ */

function decodeXml(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/** Concatenated text of every <t> run (rich text cells have several). */
function textRuns(xml: string): string {
  let text = ''
  const pattern = /<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>|<(?:\w+:)?t\s*\/>/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(xml))) text += decodeXml(match[1] ?? '')
  return text
}

function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/i.exec(ref)?.[0]?.toUpperCase() ?? ''
  let index = 0
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64)
  return index - 1
}

/**
 * Excel stores numbers as floating point, so 4800012345678 may come back as
 * "4.800012345678E+12" and 60 as "60.000000000000007". Give back what the user typed.
 */
export function cleanNumberText(raw: string): string {
  const value = Number(raw)
  if (!Number.isFinite(value)) return raw
  if (Number.isInteger(value) || Math.abs(value - Math.round(value)) < 1e-9) return String(Math.round(value))
  return String(Number(value.toPrecision(12)))
}

async function readZipText(zip: JSZip, path: string): Promise<string | null> {
  const file = zip.file(path) ?? zip.file(path.replace(/^\//, ''))
  return file ? file.async('string') : null
}

async function firstSheetPath(zip: JSZip): Promise<string> {
  const workbook = await readZipText(zip, 'xl/workbook.xml')
  const rels = await readZipText(zip, 'xl/_rels/workbook.xml.rels')
  const sheetRid = workbook ? /<(?:\w+:)?sheet\b[^>]*\br:id="([^"]+)"/.exec(workbook)?.[1] : undefined
  if (sheetRid && rels) {
    const relPattern = /<Relationship\b([^>]*)\/?>/g
    let match: RegExpExecArray | null
    while ((match = relPattern.exec(rels))) {
      const attrs = match[1] ?? ''
      if (new RegExp(`\\bId="${sheetRid}"`).test(attrs)) {
        const target = /\bTarget="([^"]+)"/.exec(attrs)?.[1]
        if (target) return target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`
      }
    }
  }
  return 'xl/worksheets/sheet1.xml'
}

export async function parseXlsx(data: ArrayBuffer | Uint8Array): Promise<string[][]> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(data)
  } catch {
    throw new SpreadsheetError('This file isn’t a valid Excel (.xlsx) file. Save it as .xlsx or CSV and try again.')
  }

  const sharedXml = await readZipText(zip, 'xl/sharedStrings.xml')
  const shared: string[] = []
  if (sharedXml) {
    const siPattern = /<(?:\w+:)?si>([\s\S]*?)<\/(?:\w+:)?si>|<(?:\w+:)?si\s*\/>/g
    let match: RegExpExecArray | null
    while ((match = siPattern.exec(sharedXml))) shared.push(textRuns(match[1] ?? ''))
  }

  const sheetXml = await readZipText(zip, await firstSheetPath(zip))
  if (!sheetXml) throw new SpreadsheetError('The workbook has no worksheet to import.')

  const rows: string[][] = []
  const rowPattern = /<(?:\w+:)?row\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?row>/g
  const cellPattern = /<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g
  let rowMatch: RegExpExecArray | null
  while ((rowMatch = rowPattern.exec(sheetXml))) {
    const rowNumber = Number(/\br="(\d+)"/.exec(rowMatch[1] ?? '')?.[1] ?? rows.length + 1)
    const cells: string[] = []
    let next = 0
    let cellMatch: RegExpExecArray | null
    cellPattern.lastIndex = 0
    const body = rowMatch[2] ?? ''
    while ((cellMatch = cellPattern.exec(body))) {
      const attrs = cellMatch[1] ?? ''
      const inner = cellMatch[2] ?? ''
      const ref = /\br="([A-Z]+\d+)"/i.exec(attrs)?.[1]
      const col = ref ? columnIndex(ref) : next
      next = col + 1
      const type = /\bt="(\w+)"/.exec(attrs)?.[1]
      const rawValue = /<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/.exec(inner)?.[1]
      let value = ''
      if (type === 's') value = shared[Number(rawValue)] ?? ''
      else if (type === 'inlineStr') value = textRuns(inner)
      else if (type === 'str' || type === 'e') value = decodeXml(rawValue ?? '')
      else if (type === 'b') value = rawValue === '1' ? 'TRUE' : 'FALSE'
      else if (rawValue !== undefined) value = cleanNumberText(decodeXml(rawValue))
      cells[col] = value
    }
    // Keep sheet row numbers so messages can say "row 12" like Excel does.
    while (rows.length < rowNumber - 1) rows.push([])
    rows[rowNumber - 1] = Array.from(cells, (cell) => cell ?? '')
  }
  return rows
}

/* ------------------------------------------------------------------
   XLSX WRITE
------------------------------------------------------------------ */

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // XML 1.0 forbids most control characters.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
}

function columnName(index: number): string {
  let name = ''
  let n = index + 1
  while (n > 0) {
    const rem = (n - 1) % 26
    name = String.fromCharCode(65 + rem) + name
    n = Math.floor((n - 1) / 26)
  }
  return name
}

/**
 * One-sheet workbook. The first row is bold. Strings are written as inline text so barcodes
 * keep their leading zeros; `numericColumns` are written as numbers.
 */
export async function buildXlsx(
  rows: Cell[][],
  options: { sheetName?: string; columnWidths?: number[]; numericColumns?: number[] } = {},
): Promise<Uint8Array> {
  const sheetName = escapeXml((options.sheetName ?? 'Sheet1').slice(0, 31))
  const numeric = new Set(options.numericColumns ?? [])

  const sheetRows = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((cell, colIndex) => {
          if (cell === null || cell === undefined || cell === '') return ''
          const ref = `${columnName(colIndex)}${rowIndex + 1}`
          const style = rowIndex === 0 ? ' s="1"' : ''
          if (typeof cell === 'number' || (rowIndex > 0 && numeric.has(colIndex) && cell !== '' && Number.isFinite(Number(cell)))) {
            return `<c r="${ref}"${style}><v>${Number(cell)}</v></c>`
          }
          return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(cell))}</t></is></c>`
        })
        .join('')
      return `<row r="${rowIndex + 1}">${cells}</row>`
    })
    .join('')

  const cols = options.columnWidths?.length
    ? `<cols>${options.columnWidths.map((width, i) => `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`).join('')}</cols>`
    : ''

  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
  )
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
  )
  zip.file(
    'xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  )
  zip.file(
    'xl/_rels/workbook.xml.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
  )
  zip.file(
    'xl/styles.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>',
  )
  zip.file(
    'xl/worksheets/sheet1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${cols}<sheetData>${sheetRows}</sheetData></worksheet>`,
  )
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

/* ------------------------------------------------------------------
   FILE ENTRY POINT
------------------------------------------------------------------ */

export const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024

/** Reads a picked .csv or .xlsx file into rows of text cells. */
export async function readSpreadsheetFile(file: File): Promise<string[][]> {
  const name = file.name.toLowerCase()
  if (file.size > MAX_IMPORT_FILE_BYTES) {
    throw new SpreadsheetError('This file is larger than 10 MB. Split it into smaller files and import them one by one.')
  }
  if (name.endsWith('.csv') || name.endsWith('.txt') || file.type === 'text/csv') {
    return parseCsv(await file.text())
  }
  if (name.endsWith('.xlsx')) {
    return parseXlsx(await file.arrayBuffer())
  }
  if (name.endsWith('.xls')) {
    throw new SpreadsheetError('Old Excel (.xls) files aren’t supported. In Excel, use Save As → Excel Workbook (.xlsx) or CSV.')
  }
  throw new SpreadsheetError('Choose a .csv or .xlsx file.')
}
