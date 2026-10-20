import { useMemo, useRef, useState, type DragEvent } from 'react'

import { productImportApi, type ImportResult } from '../../api/productImportApi'
import { useSettings } from '../../context/SettingsContext'
import { useToast } from '../../context/ToastContext'
import { downloadErrorReport, downloadTemplate } from '../../services/productImport/importFiles'
import {
  DEFAULT_OPTIONS,
  FIELD_LABELS,
  FIELD_ORDER,
  planImport,
  readRows,
  rowReason,
  STATUS_LABELS,
  TEMPLATE_COLUMNS,
  type FieldKey,
  type ImportContext,
  type ImportOptions,
  type PlannedRow,
  type RawRow,
  type RowStatus,
} from '../../services/productImport/importModel'
import { readSpreadsheetFile } from '../../services/productImport/spreadsheet'
import { getErrorMessage } from '../../utils/errors'
import { formatMoney } from '../../utils/format'
import { SwitchRow, TextField } from '../ui/MobileKit'
import { ConfirmDialog, Modal } from '../ui/Modal'
import { Spinner } from '../ui/States'

type Step = 'upload' | 'review' | 'importing' | 'done'
type Filter = 'all' | 'ready' | 'warning' | 'problem' | 'existing'

const PAGE_SIZE = 50

const STATUS_TONES: Record<RowStatus, string> = {
  ready: 'bg-[#E6F1EA] text-[#1F5E3B]',
  warning: 'bg-amber-50 text-amber-800',
  error: 'bg-rose-50 text-rose-700',
  duplicate: 'bg-rose-50 text-rose-700',
  update: 'bg-blue-50 text-blue-700',
  skip: 'bg-slate-100 text-slate-600',
}

const numberFormat = (value: number) => value.toLocaleString('en-PH')

type Loaded = { fileName: string; rows: RawRow[]; blankRows: number; ignoredColumns: string[]; context: ImportContext }

/**
 * Bulk product import. Nothing is saved until the final confirmation; rows with blocking
 * problems are left out (or fixed in place), and existing products are only updated when the
 * store owner explicitly chooses to.
 */
export function ProductImportDialog({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const { notify } = useToast()
  const { settings } = useSettings()
  const money = (value: number) => formatMoney(value, settings.currencySymbol)

  const [step, setStep] = useState<Step>('upload')
  const [reading, setReading] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [options, setOptions] = useState<ImportOptions>(DEFAULT_OPTIONS)
  const [filter, setFilter] = useState<Filter>('all')
  const [visible, setVisible] = useState(PAGE_SIZE)
  const [editing, setEditing] = useState<PlannedRow | null>(null)
  const [confirmUpdate, setConfirmUpdate] = useState(false)
  const [confirmImport, setConfirmImport] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [importError, setImportError] = useState<string | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [downloading, setDownloading] = useState(false)

  const plan = useMemo(() => (loaded ? planImport(loaded.rows, loaded.context, options) : null), [loaded, options])

  // Names the file refers to that the store doesn't have yet (whatever the toggles say).
  const missing = useMemo(() => {
    if (!loaded) return { categories: 0, suppliers: 0 }
    const all = planImport(loaded.rows, loaded.context, { ...options, createCategories: true, createSuppliers: true })
    return { categories: all.summary.newCategories.length, suppliers: all.summary.newSuppliers.length }
  }, [loaded, options])

  async function handleFile(file: File | undefined) {
    if (!file || reading) return
    setReading(true)
    setFileError(null)
    try {
      const [sheet, context] = await Promise.all([readSpreadsheetFile(file), productImportApi.loadContext()])
      const read = readRows(sheet)
      if (!read.ok) {
        setFileError(read.message)
        return
      }
      if (read.rows.length === 0) {
        setFileError('No products found under the header row.')
        return
      }
      setLoaded({ fileName: file.name, rows: read.rows, blankRows: read.blankRows, ignoredColumns: read.ignoredColumns, context })
      setOptions(DEFAULT_OPTIONS)
      setFilter('all')
      setVisible(PAGE_SIZE)
      setStep('review')
    } catch (err) {
      setFileError(err instanceof Error && err.message ? err.message : getErrorMessage(err))
    } finally {
      setReading(false)
    }
  }

  async function runImport() {
    if (!loaded || !plan) return
    setConfirmImport(false)
    setImportError(null)
    setProgress({ done: 0, total: plan.summary.importable })
    setStep('importing')
    try {
      const done = await productImportApi.commit(loaded.rows, options, (doneRows, total) => setProgress({ done: doneRows, total }))
      setResult(done)
      setStep('done')
      onImported()
    } catch (err) {
      // Nothing was written; stay on the review so the owner can adjust and retry.
      setImportError(getErrorMessage(err))
      setStep('review')
    }
  }

  async function download(action: () => Promise<unknown>) {
    if (downloading) return
    setDownloading(true)
    try {
      await action()
    } catch (err) {
      notify(`Couldn’t create the file. ${getErrorMessage(err)}`, 'error')
    } finally {
      setDownloading(false)
    }
  }

  function saveEdit(rowNumber: number, values: Record<FieldKey, string>) {
    if (!loaded) return
    setLoaded({ ...loaded, rows: loaded.rows.map((row) => (row.rowNumber === rowNumber ? { ...row, values } : row)) })
    setEditing(null)
  }

  function removeRow(rowNumber: number) {
    if (!loaded) return
    setLoaded({ ...loaded, rows: loaded.rows.filter((row) => row.rowNumber !== rowNumber) })
    setEditing(null)
  }

  const busy = step === 'importing'
  const title =
    step === 'done' ? 'Import complete' : step === 'importing' ? 'Importing products' : step === 'review' ? 'Review import' : 'Import products'

  return (
    <>
      <Modal
        title={title}
        description={loaded && step !== 'upload' ? loaded.fileName : 'Add many products at once from a spreadsheet.'}
        onClose={onClose}
        preventClose={busy}
        size="2xl"
        mobileFullScreen
        footer={
          step === 'review' && plan ? (
            <div className="flex w-full items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setLoaded(null)
                  setImportError(null)
                  setStep('upload')
                }}
                className="h-12 shrink-0 rounded-2xl px-4 text-[15px] font-medium text-slate-600 active:bg-slate-100"
              >
                Change file
              </button>
              <button
                type="button"
                onClick={() => setConfirmImport(true)}
                disabled={plan.summary.importable === 0}
                className="h-12 flex-1 rounded-2xl bg-[#1F5E3B] px-5 text-[15px] font-semibold text-white transition active:scale-[0.99] disabled:bg-slate-200 disabled:text-slate-500"
              >
                {plan.summary.importable === 0 ? 'Nothing to import yet' : `Import ${numberFormat(plan.summary.importable)} ${plan.summary.importable === 1 ? 'product' : 'products'}`}
              </button>
            </div>
          ) : step === 'done' ? (
            <div className="flex w-full items-center gap-2">
              {result && result.skipped + result.failed > 0 && (
                <button
                  type="button"
                  disabled={downloading}
                  onClick={() => void download(() => downloadErrorReport(result.rows.filter((row) => row.status === 'skip' || row.status === 'error' || row.status === 'duplicate'), result.batch))}
                  className="h-12 shrink-0 rounded-2xl px-4 text-[15px] font-medium text-[#1F5E3B] active:bg-[#F2F8F4] disabled:opacity-50"
                >
                  {downloading ? 'Preparing…' : 'Download error report'}
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="h-12 flex-1 rounded-2xl bg-[#1F5E3B] px-5 text-[15px] font-semibold text-white transition active:scale-[0.99]"
              >
                Done
              </button>
            </div>
          ) : undefined
        }
      >
        {step === 'upload' && (
          <UploadStep
            reading={reading}
            error={fileError}
            downloading={downloading}
            onFile={(file) => void handleFile(file)}
            onTemplate={(format) => void download(() => downloadTemplate(format))}
          />
        )}

        {step === 'review' && plan && loaded && (
          <ReviewStep
            loaded={loaded}
            rows={plan.rows}
            summary={plan.summary}
            options={options}
            missing={missing}
            filter={filter}
            visible={visible}
            importError={importError}
            money={money}
            onFilter={(next) => {
              setFilter(next)
              setVisible(PAGE_SIZE)
            }}
            onShowMore={() => setVisible((count) => count + PAGE_SIZE)}
            onOptions={(next) => {
              if (next.existing === 'update' && options.existing !== 'update') {
                setConfirmUpdate(true)
                return
              }
              setOptions(next)
            }}
            onEdit={setEditing}
          />
        )}

        {step === 'importing' && <ImportingStep done={progress.done} total={progress.total} />}

        {step === 'done' && result && <ResultStep result={result} />}
      </Modal>

      {editing && (
        <EditRowDialog
          row={editing}
          onCancel={() => setEditing(null)}
          onSave={(values) => saveEdit(editing.rowNumber, values)}
          onRemove={() => removeRow(editing.rowNumber)}
        />
      )}

      {confirmUpdate && plan && (
        <ConfirmDialog
          title="Update existing products?"
          message={`Products already in your store will get the file’s name, barcode, category, supplier, unit, cost and selling price. Their SKU and stock stay the same. You’ll see the rows marked “Will Update” before anything is saved.`}
          confirmLabel="Yes, update them"
          onCancel={() => setConfirmUpdate(false)}
          onConfirm={() => {
            setConfirmUpdate(false)
            setOptions({ ...options, existing: 'update' })
          }}
        />
      )}

      {confirmImport && plan && (
        <ConfirmDialog
          title={`Import ${numberFormat(plan.summary.importable)} ${plan.summary.importable === 1 ? 'product' : 'products'}?`}
          message={confirmMessage(plan.summary, plan.rows)}
          confirmLabel={`Import ${numberFormat(plan.summary.importable)} ${plan.summary.importable === 1 ? 'product' : 'products'}`}
          onCancel={() => setConfirmImport(false)}
          onConfirm={() => void runImport()}
        />
      )}
    </>
  )
}

function confirmMessage(summary: ReturnType<typeof planImport>['summary'], rows: PlannedRow[]): string {
  const added = summary.ready + summary.warning
  const units = rows
    .filter((row) => row.status === 'ready' || row.status === 'warning')
    .reduce((sum, row) => sum + row.parsed.stock, 0)
  const parts = [`${numberFormat(added)} new ${added === 1 ? 'product' : 'products'}${units ? ` with ${numberFormat(units)} units of opening stock` : ''}`]
  if (summary.update) parts.push(`${numberFormat(summary.update)} existing ${summary.update === 1 ? 'product' : 'products'} updated`)
  if (summary.newCategories.length) parts.push(`${summary.newCategories.length} new ${summary.newCategories.length === 1 ? 'category' : 'categories'}`)
  if (summary.newSuppliers.length) parts.push(`${summary.newSuppliers.length} new ${summary.newSuppliers.length === 1 ? 'supplier' : 'suppliers'}`)
  const left = summary.skip + summary.error + summary.duplicate
  return `${parts.join(', ')}.${left ? ` ${numberFormat(left)} ${left === 1 ? 'row is' : 'rows are'} left out.` : ''} Everything is saved together — if anything fails, nothing is changed.`
}

/* ------------------------------------------------------------------
   UPLOAD
------------------------------------------------------------------ */

function UploadStep({
  reading,
  error,
  downloading,
  onFile,
  onTemplate,
}: {
  reading: boolean
  error: string | null
  downloading: boolean
  onFile: (file: File | undefined) => void
  onTemplate: (format: 'xlsx' | 'csv') => void
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [dragging, setDragging] = useState(false)

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    onFile(event.dataTransfer.files?.[0])
  }

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <div
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`rounded-3xl border-2 border-dashed px-5 py-8 text-center transition ${
          dragging ? 'border-[#1F5E3B] bg-[#F2F8F4]' : 'border-slate-200 bg-[#F6F8F7]'
        }`}
      >
        {reading ? (
          <div className="py-4">
            <Spinner label="Reading file…" />
            <p className="mt-3 text-sm text-slate-500">Reading and checking your products…</p>
          </div>
        ) : (
          <>
            <p className="text-base font-semibold">Choose your product file</p>
            <p className="mt-1 text-sm text-slate-500">Excel (.xlsx) or CSV. Nothing is saved until you confirm.</p>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="mt-4 h-12 rounded-2xl bg-[#1F5E3B] px-6 text-[15px] font-semibold text-white transition active:scale-[0.99]"
            >
              Choose file
            </button>
            <p className="mt-2 hidden text-xs text-slate-400 md:block">or drop it here</p>
            <input
              ref={inputRef}
              type="file"
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={(event) => {
                onFile(event.target.files?.[0])
                event.target.value = ''
              }}
            />
          </>
        )}
      </div>

      {error && (
        <p role="alert" className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </p>
      )}

      <div className="rounded-2xl ring-1 ring-slate-100 p-4">
        <p className="text-sm font-medium">Start from the template</p>
        <p className="mt-1 text-sm text-slate-500">
          Columns: {TEMPLATE_COLUMNS.join(', ')}. Only <span className="font-medium text-[#091413]">Product Name</span> and{' '}
          <span className="font-medium text-[#091413]">Selling Price</span> are required.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={downloading}
            onClick={() => onTemplate('xlsx')}
            className="h-11 rounded-full bg-[#E6F1EA] px-4 text-sm font-semibold text-[#1F5E3B] active:scale-95 disabled:opacity-50"
          >
            Download template (.xlsx)
          </button>
          <button
            type="button"
            disabled={downloading}
            onClick={() => onTemplate('csv')}
            className="h-11 rounded-full px-4 text-sm font-medium text-[#1F5E3B] ring-1 ring-[#1F5E3B]/20 active:scale-95 disabled:opacity-50"
          >
            CSV template
          </button>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------
   REVIEW
------------------------------------------------------------------ */

function matchesFilter(row: PlannedRow, filter: Filter): boolean {
  switch (filter) {
    case 'ready':
      return row.status === 'ready'
    case 'warning':
      return row.status === 'warning'
    case 'problem':
      return row.status === 'error' || row.status === 'duplicate'
    case 'existing':
      return row.status === 'update' || row.status === 'skip'
    default:
      return true
  }
}

function ReviewStep({
  loaded,
  rows,
  summary,
  options,
  missing,
  filter,
  visible,
  importError,
  money,
  onFilter,
  onShowMore,
  onOptions,
  onEdit,
}: {
  loaded: Loaded
  rows: PlannedRow[]
  summary: ReturnType<typeof planImport>['summary']
  options: ImportOptions
  missing: { categories: number; suppliers: number }
  filter: Filter
  visible: number
  importError: string | null
  money: (value: number) => string
  onFilter: (filter: Filter) => void
  onShowMore: () => void
  onOptions: (options: ImportOptions) => void
  onEdit: (row: PlannedRow) => void
}) {
  const problems = summary.error + summary.duplicate
  const existing = summary.update + summary.skip
  const filtered = useMemo(() => rows.filter((row) => matchesFilter(row, filter)), [rows, filter])
  const shown = filtered.slice(0, visible)

  const filters: { key: Filter; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: summary.total },
    { key: 'ready', label: 'Ready', count: summary.ready },
    { key: 'warning', label: 'Warnings', count: summary.warning },
    { key: 'problem', label: 'Errors', count: problems },
    { key: 'existing', label: 'Existing', count: existing },
  ]

  return (
    <div className="space-y-4">
      {/* SUMMARY */}
      <div className="rounded-3xl bg-[#F2F8F4] px-5 py-4">
        <p className="text-2xl font-bold tracking-tight">
          {numberFormat(summary.total)} {summary.total === 1 ? 'product' : 'products'} detected
        </p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <span className="text-[#1F5E3B]">{numberFormat(summary.ready)} ready</span>
          {summary.warning > 0 && <span className="text-amber-700">{numberFormat(summary.warning)} with warnings</span>}
          {problems > 0 && <span className="text-rose-700">{numberFormat(problems)} with errors</span>}
          {existing > 0 && <span className="text-slate-600">{numberFormat(existing)} already exist</span>}
        </div>
        {(loaded.blankRows > 0 || loaded.ignoredColumns.length > 0) && (
          <p className="mt-2 text-xs text-slate-500">
            {loaded.blankRows > 0 && `${loaded.blankRows} empty ${loaded.blankRows === 1 ? 'row' : 'rows'} ignored. `}
            {loaded.ignoredColumns.length > 0 && `Columns not used: ${loaded.ignoredColumns.join(', ')}.`}
          </p>
        )}
      </div>

      {importError && (
        <p role="alert" className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {importError}
        </p>
      )}

      {problems > 0 && (
        <p className="rounded-2xl bg-rose-50/60 px-4 py-3 text-sm text-rose-800">
          Rows with errors won’t be imported. Tap a row to fix it here, or fix the file and choose it again.
        </p>
      )}

      {/* OPTIONS */}
      {(existing > 0 || missing.categories > 0 || missing.suppliers > 0) && (
        <div className="space-y-2">
          {existing > 0 && (
            <div className="rounded-2xl bg-[#F6F8F7] p-4">
              <p className="text-[15px]">
                {numberFormat(existing)} {existing === 1 ? 'product is' : 'products are'} already in your store
              </p>
              <div role="radiogroup" aria-label="Existing products" className="mt-2 grid grid-cols-2 gap-1 rounded-2xl bg-white p-1 ring-1 ring-slate-100">
                {(['skip', 'update'] as const).map((choice) => (
                  <button
                    key={choice}
                    type="button"
                    role="radio"
                    aria-checked={options.existing === choice}
                    onClick={() => onOptions({ ...options, existing: choice })}
                    className={`h-11 rounded-xl text-sm transition ${
                      options.existing === choice ? 'bg-[#1F5E3B] font-semibold text-white' : 'font-medium text-slate-600'
                    }`}
                  >
                    {choice === 'skip' ? 'Skip them' : 'Update them'}
                  </button>
                ))}
              </div>
            </div>
          )}
          {missing.categories > 0 && (
            <SwitchRow
              label={`Create ${missing.categories} missing ${missing.categories === 1 ? 'category' : 'categories'}`}
              description={options.createCategories ? summary.newCategories.slice(0, 4).join(', ') + (summary.newCategories.length > 4 ? '…' : '') : 'Rows with an unknown category will be errors.'}
              checked={options.createCategories}
              onChange={(createCategories) => onOptions({ ...options, createCategories })}
            />
          )}
          {missing.suppliers > 0 && (
            <SwitchRow
              label={`Create ${missing.suppliers} missing ${missing.suppliers === 1 ? 'supplier' : 'suppliers'}`}
              description={options.createSuppliers ? 'Add their contact details later in Suppliers.' : 'Rows with an unknown supplier will be errors.'}
              checked={options.createSuppliers}
              onChange={(createSuppliers) => onOptions({ ...options, createSuppliers })}
            />
          )}
        </div>
      )}

      {/* FILTERS */}
      <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 scrollbar-none">
        {filters.map((option) => (
          <button
            key={option.key}
            type="button"
            onClick={() => onFilter(option.key)}
            aria-pressed={filter === option.key}
            className={`h-10 shrink-0 rounded-full px-4 text-sm font-medium transition ${
              filter === option.key ? 'bg-[#1F5E3B] text-white' : 'bg-[#F3F5F4] text-slate-600'
            }`}
          >
            {option.label} {numberFormat(option.count)}
          </button>
        ))}
      </div>

      {/* ROWS — cards on phones, a table on wider screens */}
      {filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500">No rows here.</p>
      ) : (
        <>
          <ul className="space-y-2 lg:hidden">
            {shown.map((row) => (
              <li key={row.rowNumber}>
                <button
                  type="button"
                  onClick={() => onEdit(row)}
                  className="w-full rounded-2xl p-3 text-left ring-1 ring-slate-100 active:bg-slate-50"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[15px] font-medium">{row.parsed.name || <span className="text-slate-400">No name</span>}</p>
                      <p className="truncate text-xs text-slate-500">
                        Row {row.rowNumber} · {row.parsed.sku || '—'}
                        {row.parsed.barcode && ` · ${row.parsed.barcode}`} · {row.parsed.categoryName}
                      </p>
                    </div>
                    <StatusPill status={row.status} />
                  </div>
                  <p className="mt-1.5 text-sm tabular-nums text-slate-600">
                    {money(row.parsed.price)} · cost {money(row.parsed.cost)} · stock {row.parsed.stock}
                    {row.parsed.supplierName && ` · ${row.parsed.supplierName}`}
                  </p>
                  {row.status !== 'ready' && <RowReason row={row} />}
                </button>
              </li>
            ))}
          </ul>

          <div className="hidden overflow-x-auto rounded-2xl ring-1 ring-slate-100 lg:block">
            <table className="w-full text-left text-sm">
              <thead className="bg-[#F6F8F7] text-xs text-slate-500">
                <tr>
                  <th className="px-3 py-2.5 font-medium">Row</th>
                  <th className="px-3 py-2.5 font-medium">Product</th>
                  <th className="px-3 py-2.5 font-medium">SKU</th>
                  <th className="px-3 py-2.5 font-medium">Barcode</th>
                  <th className="px-3 py-2.5 font-medium">Category</th>
                  <th className="px-3 py-2.5 text-right font-medium">Cost</th>
                  <th className="px-3 py-2.5 text-right font-medium">Price</th>
                  <th className="px-3 py-2.5 text-right font-medium">Stock</th>
                  <th className="px-3 py-2.5 font-medium">Supplier</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => (
                  <tr key={row.rowNumber} onClick={() => onEdit(row)} className="cursor-pointer border-t border-slate-100 align-top hover:bg-slate-50">
                    <td className="px-3 py-2.5 tabular-nums text-slate-400">{row.rowNumber}</td>
                    <td className="max-w-[16rem] px-3 py-2.5">
                      <p className="truncate font-medium">{row.parsed.name || <span className="text-slate-400">No name</span>}</p>
                      {row.status !== 'ready' && <RowReason row={row} />}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">{row.parsed.sku || '—'}</td>
                    <td className="px-3 py-2.5 text-slate-600">{row.parsed.barcode ?? '—'}</td>
                    <td className="px-3 py-2.5 text-slate-600">{row.parsed.categoryName}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{money(row.parsed.cost)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{money(row.parsed.price)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{row.parsed.stock}</td>
                    <td className="max-w-[12rem] truncate px-3 py-2.5 text-slate-600">{row.parsed.supplierName ?? '—'}</td>
                    <td className="px-3 py-2.5">
                      <StatusPill status={row.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filtered.length > shown.length && (
            <button
              type="button"
              onClick={onShowMore}
              className="h-11 w-full rounded-2xl bg-[#F3F5F4] text-sm font-medium text-slate-600 active:bg-[#E9EEEB]"
            >
              Show more ({numberFormat(filtered.length - shown.length)} left)
            </button>
          )}
        </>
      )}
    </div>
  )
}

function StatusPill({ status }: { status: RowStatus }) {
  return (
    <span className={`inline-flex shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_TONES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  )
}

function RowReason({ row }: { row: PlannedRow }) {
  const reason = rowReason(row)
  if (!reason) return null
  const tone = row.status === 'error' || row.status === 'duplicate' ? 'text-rose-700' : row.status === 'warning' ? 'text-amber-700' : 'text-slate-500'
  return <p className={`mt-1 text-xs ${tone}`}>{reason}</p>
}

/** Fix one row in place; it's re-checked immediately. */
function EditRowDialog({
  row,
  onCancel,
  onSave,
  onRemove,
}: {
  row: PlannedRow
  onCancel: () => void
  onSave: (values: Record<FieldKey, string>) => void
  onRemove: () => void
}) {
  const [values, setValues] = useState<Record<FieldKey, string>>({ ...row.values })
  const problems = row.issues.filter((issue) => issue.level !== 'info' || row.status === 'skip' || row.status === 'update')

  return (
    <Modal
      title={`Row ${row.rowNumber}`}
      description={STATUS_LABELS[row.status]}
      onClose={onCancel}
      size="lg"
      mobileFullScreen
      footer={
        <div className="flex w-full items-center gap-2">
          <button type="button" onClick={onRemove} className="h-12 shrink-0 rounded-2xl px-4 text-[15px] font-medium text-rose-600 active:bg-rose-50">
            Leave out
          </button>
          <div className="flex-1" />
          <button type="button" onClick={onCancel} className="h-12 rounded-2xl px-4 text-[15px] font-medium text-slate-600 active:bg-slate-100">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSave(values)}
            className="h-12 rounded-2xl bg-[#1F5E3B] px-6 text-[15px] font-semibold text-white transition active:scale-[0.99]"
          >
            Save row
          </button>
        </div>
      }
    >
      {problems.length > 0 && (
        <ul className="mb-4 space-y-1 rounded-2xl bg-[#F6F8F7] px-4 py-3 text-sm">
          {problems.map((issue, index) => (
            <li key={index} className={issue.level === 'error' ? 'text-rose-700' : issue.level === 'warning' ? 'text-amber-700' : 'text-slate-600'}>
              {issue.message}
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {FIELD_ORDER.map((field) => (
          <TextField
            key={field}
            label={FIELD_LABELS[field]}
            optional={field !== 'name' && field !== 'price'}
            value={values[field]}
            inputMode={field === 'cost' || field === 'price' ? 'decimal' : field === 'stock' || field === 'barcode' ? 'numeric' : undefined}
            onChange={(value) => setValues((prev) => ({ ...prev, [field]: value }))}
            autoComplete="off"
          />
        ))}
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------
   IMPORTING / RESULTS
------------------------------------------------------------------ */

function ImportingStep({ done, total }: { done: number; total: number }) {
  const percent = total > 0 ? Math.round((done / total) * 100) : 0
  return (
    <div className="mx-auto max-w-md py-10 text-center" aria-live="polite">
      <p className="text-base font-semibold">
        Importing products… {numberFormat(done)} / {numberFormat(total)}
      </p>
      <div className="mt-4 h-3 overflow-hidden rounded-full bg-[#F3F5F4]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <div className="h-full rounded-full bg-[#1F5E3B] transition-[width] duration-200" style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-3 text-sm text-slate-500">Keep the app open. If anything goes wrong, nothing is saved.</p>
    </div>
  )
}

function ResultStep({ result }: { result: ImportResult }) {
  const [visible, setVisible] = useState(PAGE_SIZE)
  const leftOut = result.rows.filter((row) => row.status === 'skip' || row.status === 'error' || row.status === 'duplicate')

  const stats = [
    { label: 'added', value: result.added, tone: 'text-[#1F5E3B]' },
    { label: 'updated', value: result.updated, tone: 'text-blue-700' },
    { label: 'skipped', value: result.skipped, tone: 'text-slate-600' },
    { label: 'failed', value: result.failed, tone: 'text-rose-700' },
  ]

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-2xl bg-[#F6F8F7] px-4 py-3">
            <p className={`text-2xl font-bold tabular-nums ${stat.tone}`}>{numberFormat(stat.value)}</p>
            <p className="text-sm text-slate-500">products {stat.label}</p>
          </div>
        ))}
      </div>

      {(result.categoriesCreated.length > 0 || result.suppliersCreated.length > 0) && (
        <p className="text-sm text-slate-600">
          {result.categoriesCreated.length > 0 && `New categories: ${result.categoriesCreated.join(', ')}. `}
          {result.suppliersCreated.length > 0 && `New suppliers: ${result.suppliersCreated.join(', ')} — add their contact details in Suppliers.`}
        </p>
      )}

      {leftOut.length > 0 && (
        <section>
          <h3 className="text-sm font-medium text-slate-500">Skipped and failed rows</h3>
          <ul className="mt-2 divide-y divide-slate-100 rounded-2xl ring-1 ring-slate-100">
            {leftOut.slice(0, visible).map((row) => (
              <li key={row.rowNumber} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    Row {row.rowNumber} · {row.parsed.name || 'No name'}
                  </p>
                  <RowReason row={row} />
                </div>
                <StatusPill status={row.status} />
              </li>
            ))}
          </ul>
          {leftOut.length > visible && (
            <button
              type="button"
              onClick={() => setVisible((count) => count + PAGE_SIZE)}
              className="mt-2 h-11 w-full rounded-2xl bg-[#F3F5F4] text-sm font-medium text-slate-600"
            >
              Show more ({numberFormat(leftOut.length - visible)} left)
            </button>
          )}
        </section>
      )}
    </div>
  )
}

export default ProductImportDialog
