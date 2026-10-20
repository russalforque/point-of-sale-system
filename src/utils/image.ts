/** Longest side, in pixels, for product photos stored in the database. */
const MAX_IMAGE_SIZE = 600

/** JPEG quality for stored product photos: visually clean, typically 30–80 KB at 600px. */
const IMAGE_QUALITY = 0.82

/** Photos from phone cameras can be several MB; store a small JPEG instead. */
export function resizeImage(file: File, maxSize = MAX_IMAGE_SIZE): Promise<string> {
  return compressImage(file, maxSize)
}

/**
 * Decodes any browser-supported image (JPEG, PNG, WebP…) and re-encodes it as a JPEG data URL
 * no larger than `maxSize` on its longest side. Transparent areas become white. Product photos
 * are stored in the local database in this form, so they work offline and are included in backups.
 */
export function compressImage(blob: Blob, maxSize = MAX_IMAGE_SIZE): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    const done = () => URL.revokeObjectURL(url)
    img.onerror = () => {
      done()
      reject(new Error('This file is not a supported image.'))
    }
    img.onload = () => {
      try {
        if (!img.naturalWidth || !img.naturalHeight) throw new Error('This file is not a supported image.')
        const scale = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('Could not process this image.')
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        const dataUrl = canvas.toDataURL('image/jpeg', IMAGE_QUALITY)
        // Free the canvas memory right away; bulk imports process hundreds in a row.
        canvas.width = 0
        canvas.height = 0
        resolve(dataUrl)
      } catch (err) {
        reject(err instanceof Error ? err : new Error('Could not process this image.'))
      } finally {
        done()
      }
    }
    img.src = url
  })
}

export type ImageKind = 'jpeg' | 'png' | 'webp'

/** Identifies an image by its first bytes (not its file name), or null if it isn't one we accept. */
export async function sniffImageType(blob: Blob): Promise<ImageKind | null> {
  const bytes = new Uint8Array(await blob.slice(0, 12).arrayBuffer())
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg'
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png'
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  ) {
    return 'webp'
  }
  return null
}

/** Resolves once the URL has loaded as a real image; rejects with a user-facing message otherwise. */
export function loadImage(url: string, timeoutMs = 10000): Promise<void> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const timer = window.setTimeout(() => {
      img.onload = null
      img.onerror = null
      img.src = ''
      reject(new Error('That link took too long to load. Check your connection and try again.'))
    }, timeoutMs)

    img.onload = () => {
      window.clearTimeout(timer)
      if (img.naturalWidth > 0) resolve()
      else reject(new Error('That link doesn’t point to an image.'))
    }
    img.onerror = () => {
      window.clearTimeout(timer)
      reject(new Error('Couldn’t load an image from that link. Make sure the link opens a picture directly.'))
    }
    img.src = url
  })
}
