/**
 * Bulk image import: matches image files to products by file name (barcode or SKU).
 * Pure function over lightweight product info, so 1,000+ files match instantly and the preview
 * and the import always agree.
 */

export type ImageProduct = { id: number; sku: string; barcode: string | null; name: string; hasImage: boolean }

export type ImageMatchSource = { id: number; name: string; kind: string | null }

export type ImageStatus = 'matched' | 'replace' | 'has-image' | 'nomatch' | 'duplicate' | 'invalid'

export const IMAGE_STATUS_LABELS: Record<ImageStatus, string> = {
  matched: 'Matched',
  replace: 'Will Replace',
  'has-image': 'Has Image · Skip',
  nomatch: 'No Match',
  duplicate: 'Duplicate',
  invalid: 'Invalid Image',
}

export type ExistingImages = 'skip' | 'replace'

export type ImageMatch = {
  sourceId: number
  fileName: string
  /** File name without extension: the code that was looked up. */
  code: string
  status: ImageStatus
  product: { id: number; name: string; sku: string; barcode: string | null; matchedBy: 'barcode' | 'sku' } | null
  reason: string
}

export type ImageMatchSummary = {
  total: number
  matched: number
  replace: number
  hasImage: number
  nomatch: number
  duplicate: number
  invalid: number
  /** Images that will be written: matched + replace. */
  importable: number
}

/** "BEV-001.jpg" → "BEV-001". Also trims spaces that sneak in when files are renamed. */
export function codeFromFileName(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return (dot > 0 ? fileName.slice(0, dot) : fileName).trim()
}

export function matchImages(
  sources: ImageMatchSource[],
  products: ImageProduct[],
  existing: ExistingImages,
  /** Sources that failed to decode when previewed. */
  knownInvalid: ReadonlySet<number> = new Set(),
): { matches: ImageMatch[]; summary: ImageMatchSummary } {
  const bySku = new Map<string, ImageProduct>()
  const byBarcode = new Map<string, ImageProduct>()
  for (const product of products) {
    const sku = product.sku.trim().toUpperCase()
    if (sku && !bySku.has(sku)) bySku.set(sku, product)
    if (product.barcode) byBarcode.set(product.barcode.trim(), product)
  }

  // Sort so "which file wins" doesn't depend on the order the picker returned them.
  const ordered = [...sources].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }) || a.id - b.id)
  const claimedBy = new Map<number, string>()

  const matches = ordered.map((source): ImageMatch => {
    const code = codeFromFileName(source.name)
    const base = { sourceId: source.id, fileName: source.name, code }

    if (!source.kind || knownInvalid.has(source.id)) {
      return { ...base, status: 'invalid', product: null, reason: 'Not a readable JPG, PNG or WebP image (or larger than 15 MB).' }
    }

    const barcodeMatch = byBarcode.get(code)
    const skuMatch = bySku.get(code.toUpperCase())
    if (barcodeMatch && skuMatch && barcodeMatch.id !== skuMatch.id) {
      return {
        ...base,
        status: 'nomatch',
        product: null,
        reason: `“${code}” is the barcode of ${barcodeMatch.name} and the SKU of ${skuMatch.name}. Rename the file to the one you mean.`,
      }
    }
    const match = barcodeMatch ?? skuMatch
    if (!match) return { ...base, status: 'nomatch', product: null, reason: `No product has the SKU or barcode “${code}”.` }

    const product = { id: match.id, name: match.name, sku: match.sku, barcode: match.barcode, matchedBy: barcodeMatch ? ('barcode' as const) : ('sku' as const) }
    const earlier = claimedBy.get(match.id)
    if (earlier) {
      return { ...base, status: 'duplicate', product, reason: `${earlier} is already used for this product.` }
    }
    claimedBy.set(match.id, source.name)

    if (match.hasImage) {
      return existing === 'replace'
        ? { ...base, status: 'replace', product, reason: 'Replaces the current photo.' }
        : { ...base, status: 'has-image', product, reason: 'Already has a photo; it will be kept.' }
    }
    return { ...base, status: 'matched', product, reason: '' }
  })

  const count = (status: ImageStatus) => matches.filter((match) => match.status === status).length
  const summary: ImageMatchSummary = {
    total: matches.length,
    matched: count('matched'),
    replace: count('replace'),
    hasImage: count('has-image'),
    nomatch: count('nomatch'),
    duplicate: count('duplicate'),
    invalid: count('invalid'),
    importable: count('matched') + count('replace'),
  }
  return { matches, summary }
}
