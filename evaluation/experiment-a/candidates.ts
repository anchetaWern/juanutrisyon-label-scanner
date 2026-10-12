import { parseNutrition } from '../../src/services/nutrition/parseNutrition'
import type { OcrResult } from '../../src/services/ocr/types'
import { nameInOcr } from '../metrics'
import { unionBoxes } from './geometry'
import type { Candidate } from './types'

// Selecting damaged readings is allowed; scoring them never repairs characters.
const valueLike = (text: string) => /^[<>]?\s*[\dOoIl]+(?:[.,][\dOoIl]+)?\s*(?:[a-zµμ]{1,4}(?:\s+RE)?|%)?$/i.test(text.trim())
export function selectCandidates(imageId: string, ocr: OcrResult): Array<Omit<Candidate, 'sourceBox' | 'cropBox' | 'padding' | 'clipped'>> {
  const extraction = parseNutrition(ocr)
  const output: ReturnType<typeof selectCandidates> = []
  const used = new Set<number>()
  const add = (field: string | null, indexes: number[], selection: Candidate['selection'], evidence: Candidate['evidence']) => {
    indexes = [...new Set(indexes)].sort((a, b) => a - b)
    if (!indexes.length || indexes.some((i) => used.has(i))) return
    const lines = indexes.map((i) => ocr.lines[i]!)
    indexes.forEach((i) => used.add(i))
    const baselineRaw = lines.slice().sort((a, b) => a.bbox.x - b.bbox.x).map((l) => l.text).join(' ')
    const wholeValue = lines.length === 1 && valueLike(baselineRaw)
    output.push({ id: `${imageId}--${indexes.join('-')}`, imageId, field, parserField: selection === 'parser-evidence' ? field : null, basis: null, selection, lineIndexes: indexes,
      baselineRaw, evidence, ocrBox: unionBoxes(lines.map((l) => l.bbox)), review: 'pending',
      reviewNote: wholeValue ? 'Verify nutrient/basis, printed unit and source readability.' : 'Inline/fragmented/ambiguous region: annotate value bounds and exact replacement span before replay.',
      truth: { status: 'unreviewed', numeric: null, unit: null, provenance: 'No region transcription yet; nutrient JSON is not printed-region truth.' },
      failureBefore: 'unknown', replacement: wholeValue ? { lineIndex: indexes[0]!, start: 0, end: lines[0]!.text.length } : null })
  }
  for (const [field, evidence] of Object.entries(extraction.evidence)) {
    if (field.startsWith('serving.')) continue
    const indexes = [...new Set(evidence.lineIndexes)].filter((i) => Boolean(ocr.lines[i]))
    const values = indexes.filter((i) => valueLike(ocr.lines[i]!.text) && !nameInOcr(field, [ocr.lines[i]!.text]))
    if (values.length === 1) add(field, values, 'parser-evidence', evidence)
    else if (indexes.length === 1 && /[\dOo]\s*(?:g|mg|mcg|[µμ]g|kcal|%|mq)\b/i.test(ocr.lines[indexes[0]!]!.text)) add(field, indexes, 'parser-evidence', evidence)
    else if (values.length > 1) add(field, values, 'parser-evidence', evidence)
    else if (indexes.length === 1) {
      const anchor = ocr.lines[indexes[0]!]!
      const adjacent = ocr.lines.flatMap((l, i) => valueLike(l.text) && l.bbox.x >= anchor.bbox.x + anchor.bbox.width
        && Math.abs(l.bbox.y + l.bbox.height / 2 - anchor.bbox.y - anchor.bbox.height / 2) < Math.max(l.bbox.height, anchor.bbox.height) * .5 ? [i] : [])
      if (adjacent.length === 1) add(field, adjacent, 'adjacent', evidence)
    }
  }
  ocr.lines.forEach((l, i) => { if (valueLike(l.text)) add(null, [i], 'value-like', null) })
  return output
}
