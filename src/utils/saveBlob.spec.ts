import { afterEach, describe, expect, it, vi } from 'vitest'
import { canShareBlob, saveBlob } from './saveBlob'

describe('saveBlob', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('uses native file sharing when the browser supports it', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    const canShare = vi.fn().mockReturnValue(true)
    Object.defineProperties(navigator, {
      canShare: { configurable: true, value: canShare },
      share: { configurable: true, value: share },
    })
    const blob = new Blob(['crop'], { type: 'image/jpeg' })

    expect(canShareBlob(blob, 'label.jpg')).toBe(true)
    await expect(saveBlob(blob, 'label.jpg', 'Nutrition label crop')).resolves.toBe('shared')
    expect(share).toHaveBeenCalledWith({
      files: [expect.objectContaining({ name: 'label.jpg', type: 'image/jpeg' })],
      title: 'Nutrition label crop',
    })
  })

  it('uses an open-or-download link when file sharing is unavailable', async () => {
    Object.defineProperties(navigator, {
      canShare: { configurable: true, value: undefined },
      share: { configurable: true, value: undefined },
    })
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test-crop')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    vi.spyOn(window, 'setTimeout').mockImplementation((() => 1) as typeof window.setTimeout)
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

    await expect(saveBlob(new Blob(['crop']), 'label.jpg', 'Nutrition label crop')).resolves.toBe('downloaded')
    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(click).toHaveBeenCalledOnce()
    expect(document.querySelector('a')).toBeNull()
  })

  it('does not start a download when the native share sheet is cancelled', async () => {
    Object.defineProperties(navigator, {
      canShare: { configurable: true, value: vi.fn().mockReturnValue(true) },
      share: { configurable: true, value: vi.fn().mockRejectedValue(new DOMException('Cancelled', 'AbortError')) },
    })
    const createObjectURL = vi.spyOn(URL, 'createObjectURL')
    createObjectURL.mockClear()

    await expect(saveBlob(new Blob(['crop']), 'label.jpg', 'Nutrition label crop')).resolves.toBe('cancelled')
    expect(createObjectURL).not.toHaveBeenCalled()
  })
})
