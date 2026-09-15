import { Capacitor } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'

/**
 * Delivers a generated file to the user.
 *
 * - Browser: a normal download.
 * - Android app: `<a download>` does nothing inside the WebView, so the file is written to the
 *   app cache and handed to the system share sheet (Save to Files / Drive, Gmail, Messenger…).
 */
export type FileExportResult = 'downloaded' | 'shared' | 'cancelled'

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return btoa(binary)
}

function isShareCancelled(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return /cancel/i.test(message)
}

export function safeFilename(name: string): string {
  return name.replace(/[^\w.-]+/g, '_').replace(/_+/g, '_')
}

export async function saveFile({
  filename,
  mimeType,
  content,
  dialogTitle,
}: {
  filename: string
  mimeType: string
  content: string | Uint8Array
  dialogTitle?: string
}): Promise<FileExportResult> {
  const name = safeFilename(filename)
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content

  if (Capacitor.isNativePlatform()) {
    const { uri } = await Filesystem.writeFile({
      path: `exports/${name}`,
      data: toBase64(bytes),
      directory: Directory.Cache,
      recursive: true,
    })

    try {
      await Share.share({ title: name, files: [uri], dialogTitle: dialogTitle ?? `Share ${name}` })
      return 'shared'
    } catch (error) {
      if (isShareCancelled(error)) return 'cancelled'
      throw error
    }
  }

  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mimeType }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Revoking immediately can abort the download in some browsers.
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
  return 'downloaded'
}
