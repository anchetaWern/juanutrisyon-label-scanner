export const CAPTURE_QUALITY_VERSION = 'local-text-and-highlights-v1'
export interface CaptureDetailMetrics {
  qualityVersion: string
  textCandidateCount: number
  estimatedTextHeightPx: number | null
  textAreaRatio: number | null
  edgeTextCandidateCount: number
  localizedHighlightRatio: number
}

/** Small connected components approximate text detail, not OCR readability.
 * All thresholds are advisory and await calibration on the Phase 2 corpus. */
export function measureCaptureDetail(gray: Float32Array, width: number, height: number, sourceHeight: number): CaptureDetailMetrics {
  const tileSize = 32, cols = Math.ceil(width / tileSize), rows = Math.ceil(height / tileSize)
  const tiles = Array.from({ length: cols * rows }, () => ({ sum: 0, sum2: 0, clipped: 0, count: 0, mean: 0, deviation: 0 }))
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const value = gray[y * width + x]!, tile = tiles[Math.floor(y / tileSize) * cols + Math.floor(x / tileSize)]!
    tile.sum += value; tile.sum2 += value * value; tile.count++
    if (value >= 248) tile.clipped++
  }
  for (const tile of tiles) {
    tile.mean = tile.sum / tile.count
    tile.deviation = Math.sqrt(Math.max(0, tile.sum2 / tile.count - tile.mean ** 2))
  }
  let localizedHighlights = 0
  for (let y = 1; y < rows - 1; y++) for (let x = 1; x < cols - 1; x++) {
    const tile = tiles[y * cols + x]!
    if (tile.clipped / tile.count < .7 || tile.deviation > 16) continue
    const neighbors = [tiles[(y - 1) * cols + x]!, tiles[(y + 1) * cols + x]!, tiles[y * cols + x - 1]!, tiles[y * cols + x + 1]!]
    if (neighbors.filter((t) => tile.mean - t.mean > 45 && t.deviation > 20).length >= 2) localizedHighlights += tile.count
  }

  const mask = new Uint8Array(gray.length), queue = new Int32Array(gray.length)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const mean = tiles[Math.floor(y / tileSize) * cols + Math.floor(x / tileSize)]!.mean
    const value = gray[y * width + x]!
    mask[y * width + x] = Number(mean < 100 ? value > Math.max(70, mean + 35) : value < Math.min(200, mean - 28))
  }
  const glyphs: Array<{ height: number; left: number; top: number; right: number; bottom: number }> = []
  for (let start = 0; start < mask.length; start++) {
    if (mask[start] !== 1) continue
    let head = 0, tail = 1, left = start % width, right = left, top = Math.floor(start / width), bottom = top
    queue[0] = start; mask[start] = 2
    while (head < tail) {
      const index = queue[head++]!, x = index % width, y = Math.floor(index / width)
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y)
      for (const next of [x > 0 ? index - 1 : -1, x < width - 1 ? index + 1 : -1, y > 0 ? index - width : -1, y < height - 1 ? index + width : -1]) {
        if (next >= 0 && mask[next] === 1) { mask[next] = 2; queue[tail++] = next }
      }
    }
    const w = right - left + 1, h = bottom - top + 1
    if (tail >= 4 && h >= 3 && h <= Math.min(45, height * .15) && w <= h * 3 && h <= w * 8 && tail / (w * h) >= .12) glyphs.push({ height: h, left, top, right, bottom })
  }
  const enough = glyphs.length >= 12
  const heights = glyphs.map((g) => g.height).sort((a, b) => a - b)
  const area = enough ? (Math.max(...glyphs.map((g) => g.right)) - Math.min(...glyphs.map((g) => g.left)) + 1)
    * (Math.max(...glyphs.map((g) => g.bottom)) - Math.min(...glyphs.map((g) => g.top)) + 1) / (width * height) : null
  return { qualityVersion: CAPTURE_QUALITY_VERSION, textCandidateCount: glyphs.length,
    estimatedTextHeightPx: enough ? heights[Math.floor(heights.length * .25)]! * sourceHeight / height : null,
    textAreaRatio: area, edgeTextCandidateCount: glyphs.filter((g) => Math.min(g.left, g.top, width - 1 - g.right, height - 1 - g.bottom) <= 1).length,
    localizedHighlightRatio: localizedHighlights / (width * height) }
}
