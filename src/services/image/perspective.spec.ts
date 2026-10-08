import { describe, expect, it } from 'vitest'
import { homography, mapPoint, perspectiveSize, validateQuad, warpPerspective, type Quad } from './perspective'
import { detectPanel } from './detectPanel'

const rect = (w: number, h: number): Quad => [{ x: 0, y: 0 }, { x: w - 1, y: 0 }, { x: w - 1, y: h - 1 }, { x: 0, y: h - 1 }]
function pixels(w: number, h: number, value = 255) {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < data.length; i += 4) { data[i] = data[i + 1] = data[i + 2] = value; data[i + 3] = 255 }
  return data
}

describe('projective crop geometry', () => {
  it('preserves every pixel and orientation for an identity selection', () => {
    const data = pixels(64, 48)
    for (let y = 0; y < 48; y++) for (let x = 0; x < 64; x++) { data[(y * 64 + x) * 4] = x * 3; data[(y * 64 + x) * 4 + 1] = y * 4 }
    const before = data.slice()
    const result = warpPerspective(data, 64, 48, rect(64, 48))
    expect(result.width).toBe(64); expect(result.height).toBe(48)
    expect(result.pixels).toEqual(data); expect(data).toEqual(before)
  })

  it('maps a trapezoid and its independent midpoint correctly, without mirroring', () => {
    const corners: Quad = [{ x: 20, y: 10 }, { x: 100, y: 10 }, { x: 120, y: 90 }, { x: 0, y: 90 }]
    const matrix = homography(corners)
    for (const [index, [u, v]] of [[0, 0], [1, 0], [1, 1], [0, 1]].entries()) {
      const mapped = mapPoint(matrix, u!, v!)
      expect(mapped.x).toBeCloseTo(corners[index]!.x); expect(mapped.y).toBeCloseTo(corners[index]!.y)
    }
    const middle = mapPoint(matrix, .5, .5)
    expect(middle.x).toBeCloseTo(60); expect(middle.y).toBeCloseTo(42)
    const data = pixels(121, 100)
    for (let y = 0; y < 100; y++) for (let x = 0; x < 121; x++) { data[(y * 121 + x) * 4] = x; data[(y * 121 + x) * 4 + 1] = y }
    const result = warpPerspective(data, 121, 100, corners)
    const sample = (x: number, y: number) => [...result.pixels.slice((y * result.width + x) * 4, (y * result.width + x) * 4 + 2)]
    expect(sample(0, 0)).toEqual([20, 10])
    expect(sample(result.width - 1, 0)).toEqual([100, 10])
    expect(sample(result.width - 1, result.height - 1)).toEqual([120, 90])
    expect(sample(0, result.height - 1)).toEqual([0, 90])
  })

  it('rejects crossed, concave, nonfinite, collapsed and out-of-image selections', () => {
    const normal = rect(100, 100)
    const invalid: Quad[] = [
      [normal[0], normal[2], normal[1], normal[3]],
      [normal[0], normal[1], { x: 20, y: 20 }, normal[3]],
      [{ x: NaN, y: 0 }, ...normal.slice(1)] as Quad,
      [{ x: -1, y: 0 }, ...normal.slice(1)] as Quad,
      rect(5, 5),
    ]
    for (const q of invalid) { expect(validateQuad(q, 100, 100)).not.toBeNull(); expect(() => warpPerspective(pixels(100, 100), 100, 100, q)).toThrow() }
  })

  it('bounds output memory/resolution and composites transparency onto white', () => {
    const size = perspectiveSize(rect(6000, 5000))
    expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(2400)
    expect(size.width * size.height).toBeLessThanOrEqual(4_000_000)
    const data = pixels(32, 32, 0); data.fill(0)
    const result = warpPerspective(data, 32, 32, rect(32, 32))
    expect(result.pixels.every((v) => v === 255)).toBe(true)
    expect(() => warpPerspective(new Uint8ClampedArray(3), 32, 32, rect(32, 32))).toThrow('incomplete')
    expect(() => perspectiveSize(rect(32, 32), Infinity)).toThrow('limits')
  })
})

describe('conservative panel border suggestions', () => {
  it('does not suggest corners for a blank or tiny image', () => {
    expect(detectPanel(pixels(240, 300), 240, 300)).toBeNull()
    expect(detectPanel(pixels(20, 20), 20, 20)).toBeNull()
  })

  it('selects the outer frame rather than an internal row or value column', () => {
    const w = 240, h = 300, data = pixels(w, h)
    const dot = (x: number, y: number) => { const i = (y * w + x) * 4; data[i] = data[i + 1] = data[i + 2] = 0 }
    for (const y of [25, 70, 120, 170, 220, 275]) for (let x = 25; x <= 215; x++) dot(x, y)
    for (const x of [25, 160, 215]) for (let y = 25; y <= 275; y++) dot(x, y)
    const suggested = detectPanel(data, w, h)
    expect(suggested).not.toBeNull()
    expect(suggested!.corners[0].x).toBeCloseTo(25, -1)
    expect(suggested!.corners[0].y).toBeCloseTo(25, -1)
    expect(suggested!.corners[2].x).toBeCloseTo(215, -1)
    expect(suggested!.corners[2].y).toBeCloseTo(275, -1)
  })

  it('declines an isolated internal table occupying only the upper half of a crop', () => {
    const w = 240, h = 300, data = pixels(w, h)
    for (let y = 25; y <= 150; y++) for (let x = 25; x <= 215; x++) {
      if (x !== 25 && x !== 215 && y !== 25 && y !== 150) continue
      const i = (y * w + x) * 4; data[i] = data[i + 1] = data[i + 2] = 0
    }
    expect(detectPanel(data, w, h)).toBeNull()
  })
})
