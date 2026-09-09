import { describe, expect, it } from 'vitest'
import { normalizeCropCoordinates } from './useImageCrop'

describe('normalizeCropCoordinates', () => {
  it('rounds pixel coordinates while retaining rotation', () => {
    expect(
      normalizeCropCoordinates({ x: 10.4, y: 20.7, width: 300.2, height: 499.8, rotate: 90 }),
    ).toEqual({ x: 10, y: 21, width: 300, height: 500, rotate: 90, scaleX: 1, scaleY: 1 })
  })

  it('prevents invalid negative crop dimensions', () => {
    expect(normalizeCropCoordinates({ x: -2, y: -4, width: 0, height: -5 })).toMatchObject({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    })
  })
})
