import type { OcrResult } from '../../src/services/ocr/types'
import type { Candidate, CandidateResult } from './types'
import { localReading } from './scoring'

/** Apply reviewed single-span substitutions to a COPY; geometry and other text survive. */
export function replayOcr(baseline: OcrResult, candidates: Candidate[], results: CandidateResult[]) {
  const copy = structuredClone(baseline)
  const applied: string[] = [], skipped: string[] = []
  const changes = new Map<number, Array<{ start: number; end: number; text: string; id: string }>>()
  for (const candidate of candidates.filter((c) => c.review === 'verified')) {
    const result = results.find((r) => r.candidateId === candidate.id)
    const span = candidate.replacement
    if (!span || !result || result.error) { skipped.push(candidate.id); continue }
    const text = localReading(result.ocr, candidate) ?? '' // Empty/ambiguous second pass removes only its reviewed value span.
    const line = baseline.lines[span.lineIndex]
    if (!line || span.start < 0 || span.end > line.text.length || span.start >= span.end) throw new Error(`Invalid replay span: ${candidate.id}`)
    const group = changes.get(span.lineIndex) ?? []
    if (group.some((c) => c.start < span.end && c.end > span.start)) throw new Error('Overlapping replay spans.')
    group.push({ ...span, text, id: candidate.id }); changes.set(span.lineIndex, group)
  }
  for (const [index, spans] of changes) {
    for (const span of spans.sort((a, b) => b.start - a.start)) {
      const line = copy.lines[index]!
      line.text = line.text.slice(0, span.start) + span.text + line.text.slice(span.end)
      applied.push(span.id)
    }
    delete copy.lines[index]!.tokens // Do not retain stale token text for replaced lines.
  }
  copy.text = copy.lines.map((l) => l.text).join('\n')
  return { ocr: copy, applied, skipped }
}
