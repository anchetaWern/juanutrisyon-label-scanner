import { describe, expect, it } from 'vitest'
import { enhancePixelsForOcr } from './preprocessForOcr'

function rgba(values: number[]): Uint8ClampedArray {
  return new Uint8ClampedArray(values.flatMap((value) => [value, value, value, 255]))
}

describe('OCR image preprocessing', () => {
  it('stretches a narrow grayscale range to improve text contrast', () => {
    const result = enhancePixelsForOcr(rgba([100, 110, 120, 130]), 2, 2)
    const outputValues = [result[0], result[4], result[8], result[12]]

    expect(Math.min(...outputValues)).toBe(0)
    expect(Math.max(...outputValues)).toBe(255)
  })

  it('produces opaque grayscale pixels', () => {
    const result = enhancePixelsForOcr(
      new Uint8ClampedArray([
        255, 0, 0, 90,
        0, 255, 0, 90,
        0, 0, 255, 90,
        255, 255, 255, 90,
      ]),
      2,
      2,
    )

    for (let offset = 0; offset < result.length; offset += 4) {
      expect(result[offset]).toBe(result[offset + 1])
      expect(result[offset + 1]).toBe(result[offset + 2])
      expect(result[offset + 3]).toBe(255)
    }
  })
})
