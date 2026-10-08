import { quadArea, validateQuad, type Point, type Quad } from './perspective'

export const PANEL_DETECTOR_VERSION = 'border-lines-v1'
interface Line { slope: number; intercept: number; votes: number }
export interface PanelSuggestion { corners: Quad; score: number; version: string }

/** Border heuristic on a <=640px analysis image. It does not identify nutrition
 * semantics; a user must inspect/adjust any suggestion before applying it. */
export function detectPanel(pixels: Uint8ClampedArray, width: number, height: number): PanelSuggestion | null {
  if (Math.max(width, height) > 640 || width < 40 || height < 40 || pixels.length !== width * height * 4) return null
  const gray = new Float32Array(width * height), edges = new Uint8Array(width * height)
  for (let i = 0; i < gray.length; i++) gray[i] = .2126 * pixels[i * 4]! + .7152 * pixels[i * 4 + 1]! + .0722 * pixels[i * 4 + 2]!
  const horizontal: Point[] = [], vertical: Point[] = []
  for (let y = 2; y < height - 2; y++) for (let x = 2; x < width - 2; x++) {
    const i = y * width + x
    const gx = gray[i + 1]! - gray[i - 1]!, gy = gray[i + width]! - gray[i - width]!
    if (Math.hypot(gx, gy) < 45) continue
    edges[i] = 1
    if (Math.abs(gy) > Math.abs(gx) * 1.2) horizontal.push({ x, y })
    if (Math.abs(gx) > Math.abs(gy) * 1.2) vertical.push({ x, y })
  }
  function candidates(points: Point[], verticalAxis: boolean): Line[] {
    const lines: Line[] = [], offset = 640
    for (let angle = -30; angle <= 30; angle += 3) {
      const slope = Math.tan(angle * Math.PI / 180), votes = new Uint16Array(1921)
      for (const p of points) {
        const b = Math.round((verticalAxis ? p.x - slope * p.y : p.y - slope * p.x)) + offset
        votes[b] = (votes[b] ?? 0) + 1
      }
      for (let b = 1; b < votes.length - 1; b++) {
        const count = votes[b - 1]! + votes[b]! + votes[b + 1]!
        if (count > (verticalAxis ? height : width) * .23) lines.push({ slope, intercept: b - offset, votes: count })
      }
    }
    const chosen: Line[] = []
    for (const line of lines.sort((a, b) => b.votes - a.votes)) {
      const middle = (verticalAxis ? height : width) / 2
      if (chosen.some((other) => Math.abs(line.intercept + line.slope * middle - other.intercept - other.slope * middle) < 10
        && Math.abs(line.slope - other.slope) < .16)) continue
      chosen.push(line)
      if (chosen.length === 10) break
    }
    return chosen
  }
  const hs = candidates(horizontal, false), vs = candidates(vertical, true)
  function intersection(h: Line, v: Line): Point {
    const y = (h.slope * v.intercept + h.intercept) / (1 - h.slope * v.slope)
    return { x: v.slope * y + v.intercept, y }
  }
  function support(a: Point, b: Point): number {
    let matches = 0
    for (let i = 0; i < 60; i++) {
      const x = Math.round(a.x + (b.x - a.x) * i / 59), y = Math.round(a.y + (b.y - a.y) * i / 59)
      let found = false
      for (let dy = -2; dy <= 2 && !found; dy++) for (let dx = -2; dx <= 2; dx++) {
        if (x + dx >= 0 && x + dx < width && y + dy >= 0 && y + dy < height && edges[(y + dy) * width + x + dx]) { found = true; break }
      }
      if (found) matches++
    }
    return matches / 60
  }
  let best: PanelSuggestion | null = null
  for (let a = 0; a < hs.length; a++) for (let b = a + 1; b < hs.length; b++) {
    const [top, bottom] = [hs[a]!, hs[b]!].sort((l, r) => l.intercept + l.slope * width / 2 - r.intercept - r.slope * width / 2)
    if (bottom!.intercept - top!.intercept + (bottom!.slope - top!.slope) * width / 2 < height * .25) continue
    for (let c = 0; c < vs.length; c++) for (let d = c + 1; d < vs.length; d++) {
      const [left, right] = [vs[c]!, vs[d]!].sort((l, r) => l.intercept + l.slope * height / 2 - r.intercept - r.slope * height / 2)
      if (right!.intercept - left!.intercept + (right!.slope - left!.slope) * height / 2 < width * .25) continue
      const corners: Quad = [intersection(top!, left!), intersection(top!, right!), intersection(bottom!, right!), intersection(bottom!, left!)]
      if (validateQuad(corners, width, height)) continue
      const area = quadArea(corners) / (width * height)
      // The user has already made a rectangular crop. Be conservative about
      // internal table cells: a proposed panel must cover most of its height.
      if (area < .35 || area > .96 || Math.max(corners[2].y, corners[3].y) < height * .8
        || Math.min(corners[0].y, corners[1].y) > height * .25) continue
      const midX = corners.reduce((sum, p) => sum + p.x, 0) / 4
      const midY = corners.reduce((sum, p) => sum + p.y, 0) / 4
      const hasOuterHorizontal = hs.some((line) => {
        const y = line.slope * midX + line.intercept
        if (y >= top!.slope * midX + top!.intercept - height * .04 && y <= bottom!.slope * midX + bottom!.intercept + height * .04) return false
        return support(intersection(line, left!), intersection(line, right!)) >= .7
      })
      const hasOuterVertical = vs.some((line) => {
        const x = line.slope * midY + line.intercept
        if (x >= left!.slope * midY + left!.intercept - width * .04 && x <= right!.slope * midY + right!.intercept + width * .04) return false
        return support(intersection(top!, line), intersection(bottom!, line)) >= .7
      })
      if (hasOuterHorizontal || hasOuterVertical) continue
      const supports = corners.map((p, i) => support(p, corners[(i + 1) % 4]!))
      if (Math.min(...supports) < .55) continue
      const score = supports.reduce((sum, s) => sum + s, 0) / 4 * .65 + Math.sqrt(area) * .35
      if (!best || score > best.score) best = { corners, score, version: PANEL_DETECTOR_VERSION }
    }
  }
  return best && best.score >= .65 ? best : null
}
