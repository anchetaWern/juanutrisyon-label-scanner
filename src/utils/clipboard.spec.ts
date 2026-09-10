import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyText } from './clipboard'

describe('copyText', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('copies the supplied OCR output through the Clipboard API', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    await copyText('Nutrition Facts')
    expect(writeText).toHaveBeenCalledWith('Nutrition Facts')
  })

  it('falls back when a browser exposes but rejects the Clipboard API', async () => {
    const writeText = vi.fn().mockRejectedValue(new DOMException('Not allowed', 'NotAllowedError'))
    const execCommand = vi.fn().mockReturnValue(true)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand,
    })

    await copyText('OCR diagnostics')

    expect(execCommand).toHaveBeenCalledWith('copy')
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('reports failure when neither clipboard method succeeds', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('blocked')) },
    })
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn().mockReturnValue(false),
    })

    await expect(copyText('OCR diagnostics')).rejects.toThrow('Clipboard access is unavailable.')
    expect(document.querySelector('textarea')).toBeNull()
  })
})
