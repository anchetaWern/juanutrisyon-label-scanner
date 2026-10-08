import { afterEach, describe, expect, it, vi } from 'vitest'
import { calculateImageQuality, useImageQuality, warningsFromMetrics } from './useImageQuality'
import * as imageUtils from '@/utils/image'

afterEach(() => vi.restoreAllMocks())

function solidPixels(width: number, height: number, value: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4)
  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index] = value
    pixels[index + 1] = value
    pixels[index + 2] = value
    pixels[index + 3] = 255
  }
  return pixels
}

describe('image quality utilities', () => {
  it('flags a small, dark, low-detail image without blocking it', () => {
    const metrics = calculateImageQuality(solidPixels(10, 10, 4), 10, 10, 640, 480)
    const codes = warningsFromMetrics(metrics).map((warning) => warning.code)

    expect(metrics.meanLuminance).toBeCloseTo(4)
    expect(codes).toContain('too_small')
    expect(codes).toContain('too_dark')
    expect(codes).toContain('blurry')
  })

  it('measures high edge variance on crisp alternating pixels', () => {
    const width = 12
    const height = 12
    const pixels = solidPixels(width, height, 0)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const value = (x + y) % 2 === 0 ? 0 : 255
        const offset = (y * width + x) * 4
        pixels[offset] = value
        pixels[offset + 1] = value
        pixels[offset + 2] = value
      }
    }

    const metrics = calculateImageQuality(pixels, width, height, 1200, 1200)
    expect(metrics.laplacianVariance).toBeGreaterThan(55)
    expect(warningsFromMetrics(metrics).map(({ code }) => code)).not.toContain('blurry')
  })

  it('rejects incomplete pixel data', () => {
    expect(() => calculateImageQuality(new Uint8ClampedArray(3), 2, 2)).toThrow('incomplete')
  })

  function textPixels(w: number, h: number, glyphHeight: number, left = 12, lineCount = 8) {
    const pixels = solidPixels(w, h, 255)
    for (let row = 0; row < lineCount; row++) for (let column = 0; column < 16; column++) {
      for (let y = 0; y < glyphHeight; y++) for (let x = 0; x < 6; x++) {
        if (x !== 0 && x !== 5 && y !== Math.floor(glyphHeight / 2)) continue
        const offset = ((12 + row * (glyphHeight + 10) + y) * w + left + column * 12 + x) * 4
        pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 0
      }
    }
    return pixels
  }

  it('does not label a bright white page with distinct text as glare or overexposure', () => {
    const metrics = calculateImageQuality(textPixels(240, 320, 16), 240, 320, 1200, 1600)
    expect(metrics.clippedHighlightRatio).toBeGreaterThan(.8)
    expect(metrics.textCandidateCount).toBeGreaterThan(50)
    const codes = warningsFromMetrics(metrics).map((w) => w.code)
    expect(codes).not.toContain('glare'); expect(codes).not.toContain('too_bright')
  })

  it('flags small text, sparse framing and text touching crop edges', () => {
    const small = calculateImageQuality(textPixels(240, 320, 7), 240, 320)
    expect(small.estimatedTextHeightPx).toBe(7)
    expect(warningsFromMetrics(small).map((w) => w.code)).toContain('small_text')
    const loose = calculateImageQuality(textPixels(240, 320, 16, 12, 1), 240, 320)
    expect(warningsFromMetrics(loose).map((w) => w.code)).toContain('loose_crop')
    const clipped = calculateImageQuality(textPixels(240, 320, 16, 0), 240, 320)
    expect(warningsFromMetrics(clipped).map((w) => w.code)).toContain('tight_crop')
  })

  it('recognizes a localized blank highlight surrounded by darker detailed tiles', () => {
    const w = 224, h = 224, pixels = solidPixels(w, h, 0)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const white = x >= 96 && x < 128 && y >= 96 && y < 128
      const value = white ? 255 : (x + y) % 2 ? 150 : 70, offset = (y * w + x) * 4
      pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = value
    }
    const metrics = calculateImageQuality(pixels, w, h, 1200, 1200)
    expect(warningsFromMetrics(metrics).map((w) => w.code)).toContain('glare')
  })

  it('cannot present a blank image as verified readable text', () => {
    const metrics = calculateImageQuality(solidPixels(200, 200, 255), 200, 200, 1400, 1400)
    expect(metrics.estimatedTextHeightPx).toBeNull()
    expect(warningsFromMetrics(metrics).map((w) => w.code)).toContain('text_uncertain')
  })

  it('discards results from an older image after reset and replacement', async () => {
    let resolveOld!: (image: HTMLImageElement) => void
    const load = vi.spyOn(imageUtils, 'loadImage')
    load.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve }))
      .mockResolvedValueOnce({ naturalWidth: 10, naturalHeight: 10 } as HTMLImageElement)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn(),
      getImageData: () => ({ data: solidPixels(10, 10, 150) }) } as unknown as CanvasRenderingContext2D)
    const quality = useImageQuality()
    const old = quality.analyze(new Blob(['old']))
    quality.reset()
    await quality.analyze(new Blob(['new']))
    const current = quality.metrics.value
    resolveOld({ naturalWidth: 10, naturalHeight: 10 } as HTMLImageElement)
    await old
    expect(quality.metrics.value).toBe(current)
    expect(quality.isAnalyzing.value).toBe(false)
  })
})
