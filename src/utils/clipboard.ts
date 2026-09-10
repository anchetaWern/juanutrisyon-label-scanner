export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // Safari and embedded browsers may expose the Clipboard API while still
      // rejecting writes. Fall through to the selection-based implementation.
    }
  }

  const input = document.createElement('textarea')
  input.value = text
  input.setAttribute('readonly', '')
  input.style.position = 'fixed'
  input.style.left = '0'
  input.style.top = '0'
  input.style.fontSize = '16px'
  input.style.opacity = '0'
  document.body.appendChild(input)

  let copied = false
  try {
    input.focus()
    input.select()
    input.setSelectionRange(0, input.value.length)
    copied = typeof document.execCommand === 'function' && document.execCommand('copy')
  } finally {
    input.remove()
  }
  if (!copied) throw new Error('Clipboard access is unavailable.')
}
