/** Longest side, in pixels, for product photos stored in the database. */
const MAX_IMAGE_SIZE = 600

/** Photos from phone cameras can be several MB; store a small JPEG instead. */
export function resizeImage(file: File, maxSize = MAX_IMAGE_SIZE): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read this image.'))
    reader.onload = () => {
      const source = String(reader.result)
      const img = new Image()
      img.onerror = () => reject(new Error('This file is not a supported image.'))
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve(source)
          return
        }
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.82))
      }
      img.src = source
    }
    reader.readAsDataURL(file)
  })
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
