import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { copyText } from './clipboard'

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
const originalCommand = Object.getOwnPropertyDescriptor(document, 'execCommand')
const clipboard = (writeText?: (text: string) => Promise<void>) => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: writeText ? { writeText } : undefined })
const command = (value?: () => boolean) => Object.defineProperty(document, 'execCommand', { configurable: true, value })

// Simulate the browser's copy event; execCommand returning true alone does not
// prove that the payload was supplied to the clipboard.
function copyCommand(setData = vi.fn()) {
  return vi.fn(() => {
    const event = new Event('copy', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', { value: { setData } })
    document.activeElement!.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    return true
  })
}

describe('copyText', () => {
  beforeEach(() => { clipboard(); command() })
  afterEach(() => {
    vi.restoreAllMocks()
    if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard)
    else Reflect.deleteProperty(navigator, 'clipboard')
    if (originalCommand) Object.defineProperty(document, 'execCommand', originalCommand)
    else Reflect.deleteProperty(document, 'execCommand')
    document.body.replaceChildren()
  })

  it('copies exact JSON through the selection event synchronously in the tap', async () => {
    const text = '{"text":"Vitamin D₃ 0µg\\nProtein 6g"}'
    const setData = vi.fn(), execCommand = copyCommand(setData)
    command(execCommand)
    const writeText = vi.fn().mockRejectedValue(new Error('blocked'))
    clipboard(writeText)
    const pending = copyText(text)
    // No await is allowed before the mobile selection path has run.
    expect(execCommand).toHaveBeenCalledWith('copy')
    expect(setData).toHaveBeenCalledWith('text/plain', text)
    expect(writeText).not.toHaveBeenCalled()
    await pending
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('copies through the Clipboard API when the selection command is unavailable', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    clipboard(writeText)
    await copyText('Nutrition Facts')
    expect(writeText).toHaveBeenCalledWith('Nutrition Facts')
  })

  it('does not report selection success when no copy event received the text', async () => {
    command(vi.fn().mockReturnValue(true))
    await expect(copyText('OCR diagnostics')).rejects.toThrow('Clipboard access is unavailable.')
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('uses the Clipboard API after a failed selection command, still without awaiting first', async () => {
    command(vi.fn().mockReturnValue(false))
    const writeText = vi.fn().mockResolvedValue(undefined)
    clipboard(writeText)
    const pending = copyText('OCR JSON')
    expect(writeText).toHaveBeenCalledWith('OCR JSON')
    await pending
  })

  it('reports failure when neither clipboard method succeeds', async () => {
    clipboard(vi.fn().mockRejectedValue(new DOMException('Not allowed', 'NotAllowedError')))
    command(vi.fn().mockReturnValue(false))
    await expect(copyText('OCR diagnostics')).rejects.toThrow('Clipboard access is unavailable.')
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('cleans up and tries the Clipboard API if selection copying throws', async () => {
    command(() => { throw new Error('unsupported') })
    const writeText = vi.fn().mockResolvedValue(undefined)
    clipboard(writeText)
    await copyText('diagnostics')
    expect(writeText).toHaveBeenCalledWith('diagnostics')
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('restores focus and an existing input selection after copying', async () => {
    const input = document.createElement('input')
    input.value = 'existing selection'
    document.body.appendChild(input)
    input.focus()
    input.setSelectionRange(1, 5, 'backward')
    command(copyCommand())
    await copyText('OCR JSON')
    expect(document.activeElement).toBe(input)
    expect([input.selectionStart, input.selectionEnd, input.selectionDirection]).toEqual([1, 5, 'backward'])
  })
})
