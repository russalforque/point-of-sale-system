import { saveFile, type FileExportResult } from '../../utils/fileExport'
import { buildCsv, buildXlsx, type Cell } from './spreadsheet'
import { FIELD_ORDER, STATUS_LABELS, TEMPLATE_COLUMNS, TEMPLATE_EXAMPLE, type PlannedRow } from './importModel'

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/** Template with the expected columns and one example row. */
export async function downloadTemplate(format: 'xlsx' | 'csv'): Promise<FileExportResult> {
  const rows: Cell[][] = [[...TEMPLATE_COLUMNS], TEMPLATE_EXAMPLE]
  if (format === 'csv') {
    return saveFile({ filename: 'Sellix_Product_Import_Template.csv', mimeType: 'text/csv', content: buildCsv(rows), dialogTitle: 'Save template' })
  }
  const bytes = await buildXlsx(rows, {
    sheetName: 'Products',
    columnWidths: [12, 16, 28, 16, 11, 12, 12, 8, 26],
    // Prices and stock as numbers; SKU and barcode stay text so leading zeros survive.
    numericColumns: [4, 5, 6],
  })
  return saveFile({ filename: 'Sellix_Product_Import_Template.xlsx', mimeType: XLSX_MIME, content: bytes, dialogTitle: 'Save template' })
}

/**
 * The rows that were not imported, with the reason, in the template's column order so the
 * file can be fixed and imported again.
 */
export async function downloadErrorReport(rows: PlannedRow[], batch: string): Promise<FileExportResult> {
  const header: Cell[] = ['Row', 'Status', 'Reason', ...TEMPLATE_COLUMNS]
  const body: Cell[][] = rows.map((row) => [
    row.rowNumber,
    STATUS_LABELS[row.status],
    row.issues
      .filter((issue) => issue.level !== 'info' || row.status === 'skip')
      .map((issue) => issue.message)
      .join(' '),
    ...FIELD_ORDER.map((field) => row.values[field]),
  ])
  return saveFile({
    filename: `Sellix_Import_Issues_${batch}.csv`,
    mimeType: 'text/csv',
    content: buildCsv([header, ...body]),
    dialogTitle: 'Save error report',
  })
}
