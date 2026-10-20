import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'

import { productImageImportApi, type ImageImportResult } from '../../api/productImageImportApi'
import { collectImageSources, type ImageSource } from '../../services/productImages/imageSources'
import {
  IMAGE_STATUS_LABELS,
  matchImages,
  type ExistingImages,
  type ImageMatch,
  type ImageProduct,
  type ImageStatus,
} from '../../services/productImages/matchImages'
import { getErrorMessage } from '../../utils/errors'
import { ConfirmDialog, Modal } from '../ui/Modal'
import { Spinner } from '../ui/States'

type Step = 'select' | 'review' | 'importing' | 'done'
type Filter = 'all' | 'matched' | 'has-image' | 'nomatch' | 'duplicate' | 'invalid'

const PAGE_SIZE = 40

const STATUS_TONES: Record<ImageStatus, string> = {
  matched: 'bg-[#E6F1EA] text-[#1F5E3B]',
  replace: 'bg-blue-50 text-blue-700',
  'has-image': 'bg-slate-100 text-slate-600',
  nomatch: 'bg-amber-50 text-amber-800',
  duplicate: 'bg-rose-50 text-rose-700',
  invalid: 'bg-rose-50 text-rose-700',
}

const n = (value: number) => value.toLocaleString('en-PH')
const plural = (value: number, one: string, many: string) => `${n(value)} ${value === 1 ? one : many}`

/**
 * Bulk product photos: pick images or a ZIP, match them to products by SKU/barcode file name,
 * review, then import. Existing photos are only replaced when the owner explicitly chooses to.
 * Photos are compressed and stored in the local database, like photos added one by one.
 */
export function ImageImportDialog({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [step, setStep] = useState<Step>('select')
  const [scanning, setScanning] = useState<number | null>(null)
  const [selectError, setSelectError] = useState<string | null>(null)
  const [sources, setSources] = useState<ImageSource[]>([])
  const [ignored, setIgnored] = useState(0)
  const [products, setProducts] = useState<ImageProduct[]>([])
  const [existing, setExisting] = useState<ExistingImages>('skip')
  const [knownInvalid, setKnownInvalid] = useState<Set<number>>(() => new Set())
  const [filter, setFilter] = useState<Filter>('all')
  const [visible, setVisible] = useState(PAGE_SIZE)
  const [confirmReplace, setConfirmReplace] = useState(false)
  const [confirmImport, setConfirmImport] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [importError, setImportError] = useState<string | null>(null)
  const [result, setResult] = useState<ImageImportResult | null>(null)

  const { matches, summary } = useMemo(
    () => matchImages(sources, products, existing, knownInvalid),
    [sources, products, existing, knownInvalid],
  )
  const sourceById = useMemo(() => new Map(sources.map((source) => [source.id, source])), [sources])

  async function handleFiles(files: File[]) {
    if (files.length === 0 || scanning !== null) return
    setScanning(0)
    setSelectError(null)
    try {
      const [collected, productList] = await Promise.all([collectImageSources(files, setScanning), productImageImportApi.loadProducts()])
      if (collected.sources.length === 0) {
        setSelectError('No JPG, PNG or WebP images were found in what you selected.')
        return
      }
      setSources(collected.sources)
      setIgnored(collected.ignored)
      setProducts(productList)
      setKnownInvalid(new Set())
      setExisting('skip')
      setFilter('all')
      setVisible(PAGE_SIZE)
      setStep('review')
    } catch (err) {
      setSelectError(err instanceof Error && err.message ? err.message : getErrorMessage(err))
    } finally {
      setScanning(null)
    }
  }

  // Stable, so thumbnails don't re-decode on every render.
  const markInvalid = useCallback((id: number) => {
    setKnownInvalid((prev) => (prev.has(id) ? prev : new Set(prev).add(id)))
  }, [])

  async function runImport() {
    setConfirmImport(false)
    setImportError(null)
    setProgress({ done: 0, total: summary.importable })
    setStep('importing')
    try {
      const done = await productImageImportApi.commit(sources, existing, knownInvalid, (doneCount, total) => setProgress({ done: doneCount, total }))
      setResult(done)
      setStep('done')
      onImported()
    } catch (err) {
      setImportError(getErrorMessage(err))
      setStep('review')
    }
  }

  const filtered = useMemo(
    () =>
      matches.filter((match) => {
        if (filter === 'all') return true
        if (filter === 'matched') return match.status === 'matched' || match.status === 'replace'
        return match.status === filter
      }),
    [matches, filter],
  )

  const title = step === 'done' ? 'Image Import Complete' : step === 'importing' ? 'Importing images' : step === 'review' ? 'Review images' : 'Import images'

  return (
    <>
      <Modal
        title={title}
        description={step === 'select' ? 'Add product photos in bulk. Name each file after the product’s SKU or barcode.' : undefined}
        onClose={onClose}
        preventClose={step === 'importing'}
        size="2xl"
        mobileFullScreen
        footer={
          step === 'review' ? (
            <div className="flex w-full items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setSources([])
                  setImportError(null)
                  setStep('select')
                }}
                className="h-12 shrink-0 rounded-2xl px-4 text-[15px] font-medium text-slate-600 active:bg-slate-100"
              >
                Change files
              </button>
              <button
                type="button"
                onClick={() => setConfirmImport(true)}
                disabled={summary.importable === 0}
                className="h-12 flex-1 rounded-2xl bg-[#1F5E3B] px-5 text-[15px] font-semibold text-white transition active:scale-[0.99] disabled:bg-slate-200 disabled:text-slate-500"
              >
                {summary.importable === 0 ? 'No images to import' : `Import ${plural(summary.importable, 'image', 'images')}`}
              </button>
            </div>
          ) : step === 'done' ? (
            <button
              type="button"
              onClick={onClose}
              className="h-12 w-full rounded-2xl bg-[#1F5E3B] px-5 text-[15px] font-semibold text-white transition active:scale-[0.99] sm:w-auto sm:px-10"
            >
              Done
            </button>
          ) : undefined
        }
      >
        {step === 'select' && <SelectStep scanning={scanning} error={selectError} onFiles={(files) => void handleFiles(files)} />}

        {step === 'review' && (
          <div className="space-y-4">
            <div className="rounded-3xl bg-[#F2F8F4] px-5 py-4">
              <p className="text-2xl font-bold tracking-tight">{plural(summary.total, 'image', 'images')} detected</p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                <span className="text-[#1F5E3B]">{n(summary.matched)} matched</span>
                {summary.hasImage + summary.replace > 0 && (
                  <span className="text-slate-600">{n(summary.hasImage + summary.replace)} already have images</span>
                )}
                {summary.nomatch > 0 && <span className="text-amber-700">{n(summary.nomatch)} unmatched</span>}
                {summary.duplicate > 0 && <span className="text-rose-700">{n(summary.duplicate)} duplicates</span>}
                {summary.invalid > 0 && <span className="text-rose-700">{n(summary.invalid)} invalid</span>}
              </div>
              {ignored > 0 && <p className="mt-2 text-xs text-slate-500">{plural(ignored, 'file that isn’t an image was', 'files that aren’t images were')} ignored.</p>}
            </div>

            {importError && (
              <p role="alert" className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {importError}
              </p>
            )}

            {summary.hasImage + summary.replace > 0 && (
              <div className="rounded-2xl bg-[#F6F8F7] p-4">
                <p className="text-[15px]">{plural(summary.hasImage + summary.replace, 'product already has a photo', 'products already have photos')}</p>
                <div role="radiogroup" aria-label="Products that already have a photo" className="mt-2 grid grid-cols-2 gap-1 rounded-2xl bg-white p-1 ring-1 ring-slate-100">
                  {(['skip', 'replace'] as const).map((choice) => (
                    <button
                      key={choice}
                      type="button"
                      role="radio"
                      aria-checked={existing === choice}
                      onClick={() => (choice === 'replace' && existing !== 'replace' ? setConfirmReplace(true) : setExisting(choice))}
                      className={`h-11 rounded-xl text-sm transition ${existing === choice ? 'bg-[#1F5E3B] font-semibold text-white' : 'font-medium text-slate-600'}`}
                    >
                      {choice === 'skip' ? 'Keep current photo' : 'Replace photo'}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <FilterChips
              value={filter}
              onChange={(next) => {
                setFilter(next)
                setVisible(PAGE_SIZE)
              }}
              options={[
                { key: 'all', label: 'All', count: summary.total },
                { key: 'matched', label: 'Will import', count: summary.importable },
                { key: 'has-image', label: 'Has image', count: summary.hasImage },
                { key: 'nomatch', label: 'No match', count: summary.nomatch },
                { key: 'duplicate', label: 'Duplicate', count: summary.duplicate },
                { key: 'invalid', label: 'Invalid', count: summary.invalid },
              ]}
            />

            {filtered.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-500">No images here.</p>
            ) : (
              <>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {filtered.slice(0, visible).map((match) => (
                    <MatchRow key={match.sourceId} match={match} source={sourceById.get(match.sourceId)!} onInvalid={markInvalid} />
                  ))}
                </ul>
                {filtered.length > visible && (
                  <button
                    type="button"
                    onClick={() => setVisible((count) => count + PAGE_SIZE)}
                    className="h-11 w-full rounded-2xl bg-[#F3F5F4] text-sm font-medium text-slate-600 active:bg-[#E9EEEB]"
                  >
                    Show more ({n(filtered.length - visible)} left)
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {step === 'importing' && <Progress done={progress.done} total={progress.total} />}

        {step === 'done' && result && <Results result={result} sourceById={sourceById} />}
      </Modal>

      {confirmReplace && (
        <ConfirmDialog
          title="Replace existing photos?"
          message={`${plural(summary.hasImage + summary.replace, 'product', 'products')} will get the new photo instead of their current one. The old photos can’t be recovered unless you have a backup.`}
          confirmLabel="Replace photos"
          danger
          onCancel={() => setConfirmReplace(false)}
          onConfirm={() => {
            setConfirmReplace(false)
            setExisting('replace')
          }}
        />
      )}

      {confirmImport && (
        <ConfirmDialog
          title={`Import ${plural(summary.importable, 'image', 'images')}?`}
          message={
            `${plural(summary.matched, 'product gets', 'products get')} a photo` +
            (summary.replace ? `, ${plural(summary.replace, 'photo is', 'photos are')} replaced` : '') +
            '. Photos are resized and stored on this device so they work offline.' +
            (summary.total - summary.importable > 0 ? ` ${plural(summary.total - summary.importable, 'file is', 'files are')} left out.` : '')
          }
          confirmLabel={`Import ${plural(summary.importable, 'image', 'images')}`}
          onCancel={() => setConfirmImport(false)}
          onConfirm={() => void runImport()}
        />
      )}
    </>
  )
}

/* ------------------------------------------------------------------
   PIECES
------------------------------------------------------------------ */

function SelectStep({ scanning, error, onFiles }: { scanning: number | null; error: string | null; onFiles: (files: File[]) => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [dragging, setDragging] = useState(false)

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    onFiles(Array.from(event.dataTransfer.files ?? []))
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
        className={`rounded-3xl border-2 border-dashed px-5 py-8 text-center transition ${dragging ? 'border-[#1F5E3B] bg-[#F2F8F4]' : 'border-slate-200 bg-[#F6F8F7]'}`}
      >
        {scanning !== null ? (
          <div className="py-4">
            <Spinner label="Reading files…" />
            <p className="mt-3 text-sm text-slate-500">Reading files… {scanning > 0 && `${n(scanning)} images found`}</p>
          </div>
        ) : (
          <>
            <p className="text-base font-semibold">Choose photos or a ZIP file</p>
            <p className="mt-1 text-sm text-slate-500">JPG, PNG or WebP. You can select many at once. Nothing is saved until you confirm.</p>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="mt-4 h-12 rounded-2xl bg-[#1F5E3B] px-6 text-[15px] font-semibold text-white transition active:scale-[0.99]"
            >
              Choose files
            </button>
            <p className="mt-2 hidden text-xs text-slate-400 md:block">or drop them here</p>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp,.zip,application/zip"
              className="hidden"
              onChange={(event) => {
                onFiles(Array.from(event.target.files ?? []))
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

      <div className="rounded-2xl p-4 ring-1 ring-slate-100">
        <p className="text-sm font-medium">How files are matched</p>
        <ul className="mt-2 space-y-1 text-sm text-slate-500">
          <li>
            <span className="font-medium text-[#091413]">BEV-001.jpg</span> → the product with SKU BEV-001
          </li>
          <li>
            <span className="font-medium text-[#091413]">4800012345672.png</span> → the product with that barcode
          </li>
          <li>Products without a photo keep showing the usual placeholder.</li>
        </ul>
      </div>
    </div>
  )
}

function FilterChips({ value, onChange, options }: { value: Filter; onChange: (value: Filter) => void; options: { key: Filter; label: string; count: number }[] }) {
  return (
    <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 scrollbar-none">
      {options
        .filter((option) => option.key === 'all' || option.count > 0)
        .map((option) => (
          <button
            key={option.key}
            type="button"
            onClick={() => onChange(option.key)}
            aria-pressed={value === option.key}
            className={`h-10 shrink-0 rounded-full px-4 text-sm font-medium transition ${value === option.key ? 'bg-[#1F5E3B] text-white' : 'bg-[#F3F5F4] text-slate-600'}`}
          >
            {option.label} {n(option.count)}
          </button>
        ))}
    </div>
  )
}

function StatusPill({ status }: { status: ImageStatus }) {
  return <span className={`inline-flex shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_TONES[status]}`}>{IMAGE_STATUS_LABELS[status]}</span>
}

function MatchRow({ match, source, onInvalid }: { match: ImageMatch; source: ImageSource; onInvalid: (id: number) => void }) {
  const code = match.product ? (match.product.matchedBy === 'barcode' ? `Barcode ${match.product.barcode}` : `SKU ${match.product.sku}`) : null
  return (
    <li className="flex items-center gap-3 rounded-2xl p-2 pr-3 ring-1 ring-slate-100">
      <Thumbnail source={source} invalid={match.status === 'invalid'} onInvalid={onInvalid} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium" title={source.origin}>
          {match.fileName}
        </p>
        <p className="truncate text-xs text-slate-500">{match.product ? `${match.product.name} · ${code}` : match.reason}</p>
        {match.product && match.reason && <p className="truncate text-xs text-slate-400">{match.reason}</p>}
      </div>
      <StatusPill status={match.status} />
    </li>
  )
}

/** Decodes only when shown; reports files that turn out not to be images. */
function Thumbnail({ source, invalid, onInvalid }: { source: ImageSource; invalid: boolean; onInvalid: (id: number) => void }) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (invalid) return
    let cancelled = false
    let objectUrl: string | null = null
    source
      .getBlob()
      .then((blob) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      })
      .catch(() => {
        if (!cancelled) onInvalid(source.id)
      })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [source, invalid, onInvalid])

  return (
    <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[#F3F5F4]">
      {url && !invalid ? (
        <img src={url} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" onError={() => onInvalid(source.id)} />
      ) : (
        <span className="text-[10px] font-medium uppercase text-slate-400">{invalid ? 'Invalid' : '…'}</span>
      )}
    </span>
  )
}

function Progress({ done, total }: { done: number; total: number }) {
  const percent = total > 0 ? Math.round((done / total) * 100) : 0
  return (
    <div className="mx-auto max-w-md py-10 text-center" aria-live="polite">
      <p className="text-base font-semibold">
        Importing images… {n(done)} / {n(total)}
      </p>
      <div className="mt-4 h-3 overflow-hidden rounded-full bg-[#F3F5F4]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <div className="h-full rounded-full bg-[#1F5E3B] transition-[width] duration-200" style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-3 text-sm text-slate-500">Keep the app open. Photos already saved stay saved if you’re interrupted.</p>
    </div>
  )
}

function Results({ result, sourceById }: { result: ImageImportResult; sourceById: Map<number, ImageSource> }) {
  const [visible, setVisible] = useState(PAGE_SIZE)
  const leftOut = result.outcomes.filter((entry) => entry.outcome === 'skipped' || entry.outcome === 'failed')

  return (
    <div className="space-y-4">
      <p className="text-center text-base font-medium sm:text-left">
        {n(result.added)} added • {n(result.replaced)} replaced • {n(result.skipped)} skipped • {n(result.failed)} failed
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: 'added', value: result.added, tone: 'text-[#1F5E3B]' },
          { label: 'replaced', value: result.replaced, tone: 'text-blue-700' },
          { label: 'skipped', value: result.skipped, tone: 'text-slate-600' },
          { label: 'failed', value: result.failed, tone: 'text-rose-700' },
        ].map((stat) => (
          <div key={stat.label} className="rounded-2xl bg-[#F6F8F7] px-4 py-3">
            <p className={`text-2xl font-bold tabular-nums ${stat.tone}`}>{n(stat.value)}</p>
            <p className="text-sm text-slate-500">{stat.label}</p>
          </div>
        ))}
      </div>

      {leftOut.length > 0 && (
        <section>
          <h3 className="text-sm font-medium text-slate-500">Skipped and failed files</h3>
          <ul className="mt-2 divide-y divide-slate-100 rounded-2xl ring-1 ring-slate-100">
            {leftOut.slice(0, visible).map((entry) => (
              <li key={entry.sourceId} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium" title={sourceById.get(entry.sourceId)?.origin}>
                    {entry.fileName}
                  </p>
                  <p className={`text-xs ${entry.outcome === 'failed' ? 'text-rose-700' : 'text-slate-500'}`}>{entry.reason}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${entry.outcome === 'failed' ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-600'}`}>
                  {entry.outcome === 'failed' ? 'Failed' : 'Skipped'}
                </span>
              </li>
            ))}
          </ul>
          {leftOut.length > visible && (
            <button type="button" onClick={() => setVisible((count) => count + PAGE_SIZE)} className="mt-2 h-11 w-full rounded-2xl bg-[#F3F5F4] text-sm font-medium text-slate-600">
              Show more ({n(leftOut.length - visible)} left)
            </button>
          )}
        </section>
      )}
    </div>
  )
}

export default ImageImportDialog
