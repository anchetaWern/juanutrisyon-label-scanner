function copySelection(text: string): boolean {
  if (typeof document.execCommand !== 'function') return false
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const selection = document.getSelection()
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange()) : []
  const previousInput = previousFocus instanceof HTMLInputElement || previousFocus instanceof HTMLTextAreaElement ? previousFocus : null
  const inputSelection = previousInput ? [previousInput.selectionStart, previousInput.selectionEnd, previousInput.selectionDirection] as const : null
  const input = document.createElement('textarea')
  input.value = text
  input.setAttribute('readonly', '')
  input.style.position = 'fixed'
  input.style.left = '0'
  input.style.top = '0'
  input.style.fontSize = '16px'
  input.style.opacity = '0'
  input.tabIndex = -1

  let suppliedText = false
  // Write the requested payload explicitly rather than relying on WebKit's
  // interpretation of a hidden/readonly textarea selection.
  input.addEventListener('copy', (event) => {
    if (!event.clipboardData) return
    event.clipboardData.setData('text/plain', text)
    event.preventDefault()
    event.stopPropagation()
    suppliedText = true
  })
  try {
    document.body.appendChild(input)
    input.focus({ preventScroll: true })
    input.select()
    input.setSelectionRange(0, input.value.length)
    return document.execCommand('copy') && suppliedText
  } catch {
    return false
  } finally {
    input.remove()
    previousFocus?.focus({ preventScroll: true })
    if (selection) {
      selection.removeAllRanges()
      ranges.forEach((range) => selection.addRange(range))
    }
    if (previousInput && inputSelection && inputSelection[0] !== null && inputSelection[1] !== null) {
      previousInput.setSelectionRange(inputSelection[0], inputSelection[1], inputSelection[2] ?? undefined)
    }
  }
}

export async function copyText(text: string): Promise<void> {
  // Keep the selection-based copy in the original tap. Awaiting a rejected
  // Clipboard API request first can exhaust mobile browsers' user activation.
  if (copySelection(text)) return
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // Let the caller expose the payload for manual copying or file export.
    }
  }
  throw new Error('Clipboard access is unavailable.')
}
