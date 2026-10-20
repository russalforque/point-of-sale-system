import { querySQL } from '../database/sqlite'
import { runTransaction, type SqlStatement } from '../database/tx'
import { auditStatement } from '../services/audit'
import type { ImageSource } from '../services/productImages/imageSources'
import { matchImages, type ExistingImages, type ImageMatch, type ImageProduct } from '../services/productImages/matchImages'
import { ApiError } from '../utils/errors'
import { compressImage } from '../utils/image'
import { requirePermission } from '../services/authz'

export type ImageImportResult = {
  added: number
  replaced: number
  skipped: number
  failed: number
  /** Every file with its final outcome and reason, for the results list. */
  outcomes: (ImageMatch & { outcome: 'added' | 'replaced' | 'skipped' | 'failed' })[]
}

/** Images saved per database write. Each is ~30–80 KB after compression. */
const WRITE_BATCH = 20
const YIELD_EVERY_MS = 50

export const productImageImportApi = {
  /** Product codes and whether each already has a photo — never the photo data itself. */
  loadProducts: async (): Promise<ImageProduct[]> => {
    const result = await querySQL(
      `SELECT id, sku, barcode, name, CASE WHEN image_url IS NOT NULL AND image_url <> '' THEN 1 ELSE 0 END AS hasImage FROM products`,
    )
    return ((result.values ?? []) as { id: number; sku: string | null; barcode: string | null; name: string; hasImage: number }[]).map((row) => ({
      id: row.id,
      sku: row.sku ?? '',
      barcode: row.barcode || null,
      name: row.name,
      hasImage: Boolean(row.hasImage),
    }))
  },

  /**
   * Compresses and saves matched images one at a time (so memory stays flat with thousands of
   * files) and writes them in small batches. A bad image only fails itself; everything already
   * saved stays saved. Matching is redone against current data first, so a product that got a
   * photo in the meantime is still respected.
   */
  commit: async (
    sources: ImageSource[],
    existing: ExistingImages,
    knownInvalid: ReadonlySet<number>,
    onProgress?: (done: number, total: number) => void,
  ): Promise<ImageImportResult> => {
    await requirePermission('products.manage')

    const { matches } = matchImages(sources, await productImageImportApi.loadProducts(), existing, knownInvalid)
    const toWrite = matches.filter((match) => match.status === 'matched' || match.status === 'replace')
    if (toWrite.length === 0) throw new ApiError('There are no matched images to import.', 400)

    const sourceById = new Map(sources.map((source) => [source.id, source]))
    const outcomes = new Map<number, ImageImportResult['outcomes'][number]>()
    for (const match of matches) {
      if (match.status !== 'matched' && match.status !== 'replace') {
        // Nothing wrong with the file itself (no match, duplicate, photo kept) = skipped;
        // an unreadable image = failed.
        outcomes.set(match.sourceId, { ...match, outcome: match.status === 'invalid' ? 'failed' : 'skipped' })
      }
    }

    let batch: { match: ImageMatch; statement: SqlStatement }[] = []
    let done = 0
    let lastYield = performance.now()
    const now = () => new Date().toISOString()

    const flush = async () => {
      if (batch.length === 0) return
      const current = batch
      batch = []
      try {
        await runTransaction(current.map((entry) => entry.statement))
        for (const entry of current) {
          outcomes.set(entry.match.sourceId, { ...entry.match, outcome: entry.match.status === 'replace' ? 'replaced' : 'added' })
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Could not save.'
        for (const entry of current) outcomes.set(entry.match.sourceId, { ...entry.match, outcome: 'failed', reason: `Couldn’t save: ${message}` })
      }
    }

    for (const match of toWrite) {
      const source = sourceById.get(match.sourceId)!
      try {
        const dataUrl = await compressImage(await source.getBlob())
        batch.push({
          match,
          statement: {
            // "Skip" is re-checked in SQL: never overwrite a photo that appeared since the preview.
            statement:
              match.status === 'replace'
                ? `UPDATE products SET image_url = ?, updated_at = ? WHERE id = ?`
                : `UPDATE products SET image_url = ?, updated_at = ? WHERE id = ? AND (image_url IS NULL OR image_url = '')`,
            values: [dataUrl, now(), match.product!.id],
          },
        })
      } catch (err) {
        outcomes.set(match.sourceId, {
          ...match,
          status: 'invalid',
          outcome: 'failed',
          reason: err instanceof Error && err.message ? err.message : 'This file is not a supported image.',
        })
      }
      if (batch.length >= WRITE_BATCH) await flush()
      done += 1
      onProgress?.(done, toWrite.length)
      // Decoding already yields between images; an explicit pause every ~50 ms lets the progress
      // bar repaint without paying the timer's minimum delay (4–16 ms) on every single image.
      if (performance.now() - lastYield > YIELD_EVERY_MS) {
        await new Promise((resolve) => setTimeout(resolve, 0))
        lastYield = performance.now()
      }
    }
    await flush()

    const list = matches.map((match) => outcomes.get(match.sourceId)!)
    const tally = (outcome: ImageImportResult['outcomes'][number]['outcome']) => list.filter((entry) => entry.outcome === outcome).length
    const result: ImageImportResult = {
      added: tally('added'),
      replaced: tally('replaced'),
      skipped: tally('skipped'),
      failed: tally('failed'),
      outcomes: list,
    }

    await runTransaction([
      auditStatement(
        'product',
        `Bulk image import: ${result.added} added, ${result.replaced} replaced, ${result.skipped} skipped, ${result.failed} failed`,
        { type: 'image_import', id: new Date().toISOString() },
      ),
    ]).catch(() => undefined)

    return result
  },
}
