export type SaveBlobResult = 'shared' | 'downloaded' | 'cancelled'

function asFile(blob: Blob, filename: string): File {
  return new File([blob], filename, { type: blob.type || 'application/octet-stream', lastModified: Date.now() })
}

export function canShareBlob(blob: Blob, filename: string): boolean {
  if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false

  try {
    return navigator.canShare({ files: [asFile(blob, filename)] })
  } catch {
    return false
  }
}

function triggerBrowserDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.target = '_blank'
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()

  // Mobile WebKit may consume blob URLs well after the synthetic click.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export async function saveBlob(blob: Blob, filename: string, title: string): Promise<SaveBlobResult> {
  const file = asFile(blob, filename)

  if (canShareBlob(blob, filename)) {
    try {
      await navigator.share({ files: [file], title })
      return 'shared'
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError') return 'cancelled'
      // If native sharing is blocked, retain the browser download/open fallback.
    }
  }

  triggerBrowserDownload(blob, filename)
  return 'downloaded'
}
