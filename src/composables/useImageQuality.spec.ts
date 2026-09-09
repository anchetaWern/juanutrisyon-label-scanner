import { describe, expect, it } from 'vitest'
import { calculateImageQuality, warningsFromMetrics } from './useImageQuality'

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
})
