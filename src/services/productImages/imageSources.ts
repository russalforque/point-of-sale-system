import JSZip from 'jszip'

import { sniffImageType, type ImageKind } from '../../utils/image'

/**
 * Turns picked files (images and/or .zip archives) into a flat list of image sources.
 * ZIP entries stay compressed inside the archive until their bytes are needed (thumbnail or
 * import), so a 1,000-image ZIP doesn't sit fully expanded in memory.
 */

export type ImageSource = {
  id: number
  /** File name without folders, e.g. "BEV-001.jpg". */
  name: string
  /** Where it came from, e.g. "photos.zip › drinks/BEV-001.jpg". */
  origin: string
  size: number
  /** null = not a JPEG/PNG/WebP, or too large. */
  kind: ImageKind | null
  /** Whether `kind` came from the file's bytes (loose files) or only its extension (ZIP entries). */
  verified: boolean
  getBlob: () => Promise<Blob>
}

export const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp']
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024
export const MAX_ZIP_BYTES = 300 * 1024 * 1024

const MIME: Record<ImageKind, string> = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }

export class ImageSourceError extends Error {}

function extension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase()
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

/** macOS/Windows clutter that ZIP tools add. */
function isJunk(path: string): boolean {
  const name = baseName(path)
  return path.includes('__MACOSX/') || name.startsWith('._') || name.startsWith('.') || /^thumbs\.db$/i.test(name)
}

export function isZipFile(file: File): boolean {
  return extension(file.name) === 'zip' || /zip/.test(file.type)
}

/**
 * Expands the selection. Files that aren't images (by extension) are still listed so the owner
 * can see why they were left out; their `kind` is null.
 */
export async function collectImageSources(files: File[], onScan?: (found: number) => void): Promise<{ sources: ImageSource[]; ignored: number }> {
  const sources: ImageSource[] = []
  let ignored = 0
  let nextId = 1

  for (const file of files) {
    if (isZipFile(file)) {
      if (file.size > MAX_ZIP_BYTES) throw new ImageSourceError(`${file.name} is larger than 300 MB. Split it into smaller ZIP files.`)
      let zip: JSZip
      try {
        zip = await JSZip.loadAsync(file)
      } catch {
        throw new ImageSourceError(`${file.name} isn’t a valid ZIP file.`)
      }
      const entries = Object.values(zip.files).filter((entry) => !entry.dir && !isJunk(entry.name))
      for (const entry of entries) {
        if (!IMAGE_EXTENSIONS.includes(extension(entry.name))) {
          ignored += 1
          continue
        }
        // Inflating every entry just to check its format would make scanning a big ZIP slow, so
        // the extension is trusted here; the real bytes are checked when the image is decoded
        // (thumbnail or import), and a bad one then shows as invalid / failed.
        const size = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0
        const ext = extension(entry.name)
        const kind: ImageKind = ext === 'png' ? 'png' : ext === 'webp' ? 'webp' : 'jpeg'
        sources.push({
          id: nextId++,
          name: baseName(entry.name),
          origin: `${file.name} › ${entry.name}`,
          size,
          kind: size > MAX_IMAGE_BYTES ? null : kind,
          verified: false,
          getBlob: async () => {
            const blob = new Blob([await entry.async('arraybuffer')], { type: MIME[kind] })
            if (!(await sniffImageType(blob))) throw new Error('This file isn’t a valid JPG, PNG or WebP image.')
            return blob
          },
        })
        if (sources.length % 50 === 0) onScan?.(sources.length)
      }
      continue
    }

    if (!IMAGE_EXTENSIONS.includes(extension(file.name)) && !/^image\//.test(file.type)) {
      ignored += 1
      continue
    }
    const kind = file.size > MAX_IMAGE_BYTES ? null : await sniffImageType(file).catch(() => null)
    sources.push({ id: nextId++, name: baseName(file.name), origin: file.name, size: file.size, kind, verified: true, getBlob: async () => file })
    if (sources.length % 50 === 0) onScan?.(sources.length)
  }

  onScan?.(sources.length)
  return { sources, ignored }
}
