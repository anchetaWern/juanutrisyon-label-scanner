export interface Point { x: number; y: number }
/** Clockwise in image coordinates: top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Point, Point, Point, Point]
export const PERSPECTIVE_VERSION = 'four-corner-v1'
export interface PerspectiveGeometry {
  version: string
  coordinateSpace: 'rendered-rectangular-crop'
  sourceSize: { width: number; height: number }
  corners: Quad
  outputSize: { width: number; height: number }
  /** Maps normalized output coordinates [0,1] to source-crop pixels. */
  outputToSource: number[]
  selection: 'manual' | 'suggested' | 'adjusted-suggestion'
  suggestionScore: number | null
}

export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
export function quadArea(points: Quad): number {
  return points.reduce((sum, p, i) => {
    const q = points[(i + 1) % 4]!
    return sum + p.x * q.y - q.x * p.y
  }, 0) / 2
}

export function validateQuad(points: Quad, width: number, height: number): string | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 2 || height < 2 || points.length !== 4) return 'The image dimensions are invalid.'
  if (points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.y < 0 || p.x > width - 1 || p.y > height - 1)) return 'Keep all four corners inside the image.'
  for (let i = 0; i < 4; i++) {
    const a = points[i]!, b = points[(i + 1) % 4]!, c = points[(i + 2) % 4]!
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
    if (distance(a, b) < 12) return 'Move the corners farther apart to include the whole panel.'
    if (cross <= 0 || cross / (distance(a, b) * distance(b, c)) < 0.08) return 'Keep the corners in order around the panel, without crossing edges.'
  }
  if (quadArea(points) < 256) return 'Select a larger area around the nutrition panel.'
  return null
}

/** Closed-form projective map from a unit square to a convex quadrilateral. */
export function homography([a, b, c, d]: Quad): number[] {
  const dx1 = b.x - c.x, dx2 = d.x - c.x, dx3 = a.x - b.x + c.x - d.x
  const dy1 = b.y - c.y, dy2 = d.y - c.y, dy3 = a.y - b.y + c.y - d.y
  const det = dx1 * dy2 - dx2 * dy1
  if (Math.abs(det) < 1e-8) throw new Error('These corners cannot be straightened. Adjust the selection.')
  const g = (dx3 * dy2 - dx2 * dy3) / det
  const h = (dx1 * dy3 - dx3 * dy1) / det
  return [b.x - a.x + g * b.x, d.x - a.x + h * d.x, a.x,
    b.y - a.y + g * b.y, d.y - a.y + h * d.y, a.y, g, h, 1]
}

export function mapPoint(matrix: number[], u: number, v: number): Point {
  const denominator = matrix[6]! * u + matrix[7]! * v + matrix[8]!
  return { x: (matrix[0]! * u + matrix[1]! * v + matrix[2]!) / denominator,
    y: (matrix[3]! * u + matrix[4]! * v + matrix[5]!) / denominator }
}

export function perspectiveSize(points: Quad, maxDimension = 2400, maxPixels = 4_000_000) {
  if (!Number.isFinite(maxDimension) || maxDimension < 2 || !Number.isFinite(maxPixels) || maxPixels < 4) throw new Error('Invalid output limits.')
  const width = Math.max(distance(points[0], points[1]), distance(points[3], points[2])) + 1
  const height = Math.max(distance(points[0], points[3]), distance(points[1], points[2])) + 1
  const scale = Math.min(1, maxDimension / Math.max(width, height), Math.sqrt(maxPixels / (width * height)))
  return { width: Math.max(2, Math.floor(width * scale)), height: Math.max(2, Math.floor(height * scale)) }
}

export function warpPerspective(pixels: Uint8ClampedArray, width: number, height: number, corners: Quad, maxDimension = 2400) {
  const invalid = validateQuad(corners, width, height)
  if (invalid) throw new Error(invalid)
  if (!Number.isInteger(width) || !Number.isInteger(height) || pixels.length !== width * height * 4) throw new Error('The source image pixels are incomplete.')
  const outputSize = perspectiveSize(corners, maxDimension)
  const matrix = homography(corners)
  const output = new Uint8ClampedArray(outputSize.width * outputSize.height * 4)
  for (let y = 0; y < outputSize.height; y++) {
    const v = y / (outputSize.height - 1)
    for (let x = 0; x < outputSize.width; x++) {
      const u = x / (outputSize.width - 1), denominator = matrix[6]! * u + matrix[7]! * v + 1
      const sx = Math.max(0, Math.min(width - 1, (matrix[0]! * u + matrix[1]! * v + matrix[2]!) / denominator))
      const sy = Math.max(0, Math.min(height - 1, (matrix[3]! * u + matrix[4]! * v + matrix[5]!) / denominator))
      const x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1)
      const fx = sx - x0, fy = sy - y0
      const a = (y0 * width + x0) * 4, b = (y0 * width + x1) * 4, c = (y1 * width + x0) * 4, d = (y1 * width + x1) * 4
      const wa = (1 - fx) * (1 - fy), wb = fx * (1 - fy), wc = (1 - fx) * fy, wd = fx * fy
      const aa = pixels[a + 3]! / 255, ab = pixels[b + 3]! / 255, ac = pixels[c + 3]! / 255, ad = pixels[d + 3]! / 255
      const target = (y * outputSize.width + x) * 4
      for (let channel = 0; channel < 3; channel++) {
        const value = (pixels[a + channel]! * aa + 255 * (1 - aa)) * wa + (pixels[b + channel]! * ab + 255 * (1 - ab)) * wb
          + (pixels[c + channel]! * ac + 255 * (1 - ac)) * wc + (pixels[d + channel]! * ad + 255 * (1 - ad)) * wd
        output[target + channel] = Math.round(value)
      }
      output[target + 3] = 255
    }
  }
  return { pixels: output, width: outputSize.width, height: outputSize.height, matrix }
}
