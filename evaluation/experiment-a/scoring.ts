import type { OcrResult } from '../../src/services/ocr/types'
import type { Candidate, Truth } from './types'

export function normalizeExact(text: string): string {
  return text.trim().replace(/μ/g, 'µ').replace(/\s+/g, ' ').toLowerCase()
}
/** Strict lexical extraction. Unknown units survive; confusable digits are NEVER repaired. */
export function reading(raw: string): { numeric: string | null; unit: string | null; ambiguous: boolean } {
  const normalized = normalizeExact(raw)
  // Prefer an explicitly spelled known suffix so I in IU is not consumed as a
  // confusable digit. Unknown suffixes still survive in the fallback.
  const match = normalized.match(/^([<>]?\s*[\doil]+(?:\.[\doil]+)?)\s*(kcal|kj|mcg|mg|µg(?:\s+re)?|g|iu|%)$/)
    ?? normalized.match(/^([<>]?\s*[\doil]+(?:\.[\doil]+)?)\s*([a-zµ]+(?:\s+re)?|%)?$/)
  if (!match) return { numeric: null, unit: null, ambiguous: Boolean(raw.trim()) }
  const numeric = match[1]!.replace(/\s+/g, '')
  return { numeric: /^[<>]?\d+(?:\.\d+)?$/.test(numeric) ? numeric : null, unit: match[2] ?? null, ambiguous: false }
}
/** One row, left to right, with limited fragmentation; multiple rows/amounts abstain. */
export function localReading(ocr: OcrResult | null, region?: Pick<Candidate, 'sourceBox' | 'cropBox'>): string | null {
  if (!ocr || !ocr.lines.length) return null
  const target = region && ocr.sourceSize ? {
    x: (region.sourceBox.x - region.cropBox.x) * ocr.sourceSize.width / region.cropBox.width,
    y: (region.sourceBox.y - region.cropBox.y) * ocr.sourceSize.height / region.cropBox.height,
    width: region.sourceBox.width * ocr.sourceSize.width / region.cropBox.width,
    height: region.sourceBox.height * ocr.sourceSize.height / region.cropBox.height,
  } : null
  // Padding provides visual context, not additional candidate rows. Selection uses
  // frozen geometry alone, never confidence, baseline spelling or expected truth.
  const lines = ocr.lines.filter((l) => !target || (l.bbox.x + l.bbox.width / 2 >= target.x && l.bbox.x + l.bbox.width / 2 <= target.x + target.width
    && l.bbox.y + l.bbox.height / 2 >= target.y && l.bbox.y + l.bbox.height / 2 <= target.y + target.height)).sort((a, b) => a.bbox.x - b.bbox.x)
  if (!lines.length || lines.length > 3) return null
  const first = lines[0]!
  if (lines.some((l) => Math.abs(l.bbox.y + l.bbox.height / 2 - first.bbox.y - first.bbox.height / 2)
    > Math.max(l.bbox.height, first.bbox.height) * .6)) return null
  const joined = lines.map((l) => l.text.trim()).join(' ')
  return reading(joined).ambiguous ? null : joined
}
export function scoreReading(raw: string | null, truth: Truth) {
  const parsed = reading(raw ?? '')
  const eligible = truth.status === 'readable' && truth.numeric !== null
  const numeric = eligible ? parsed.numeric === normalizeExact(truth.numeric!).replace(/\s+/g, '') : null
  const unit = eligible && truth.unit !== null ? parsed.unit === normalizeExact(truth.unit) : null
  return { numeric, unit, combined: unit === null ? null : numeric === true && unit === true,
    populated: parsed.numeric !== null, numericText: parsed.numeric, unitText: parsed.unit, ambiguous: parsed.ambiguous }
}
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null
  const ordered = [...values].sort((a, b) => a - b)
  return ordered[Math.max(0, Math.ceil(p * ordered.length) - 1)]!
}
