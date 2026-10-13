import assert from 'node:assert/strict'
import { parseNutrition, nutritionPrimitives as p } from '../../src/services/nutrition/parseNutrition'
import { evaluateCase, valueInOcr } from '../metrics'
import { associate } from './association'
import { autoSelect, detectBases, rowsAndBoxes } from './columns'
import { DEFAULT_CONFIG, type Association, type Basis, type BasisTruth, type Config, type Input, type Mode, type ModeResult, type RecordResult } from './types'

export function matchBases(expected: Basis[], detected: Basis[], threshold: number) {
  const pairs = expected.flatMap((e) => detected.map((d) => {
    const intersection = e.valueIndexes.filter((i) => d.valueIndexes.includes(i)).length
    return { expected: e.id, detected: d.id, overlap: intersection / Math.max(e.valueIndexes.length, d.valueIndexes.length, 1), labeledCorrectly: e.category === d.category }
  })).filter((p) => p.overlap >= threshold).sort((a, b) => b.overlap - a.overlap || a.expected.localeCompare(b.expected) || a.detected.localeCompare(b.detected))
  // Augmenting paths maximize one-to-one correspondence before labeling.
  const assigned = new Map<string, typeof pairs[number]>()
  const visit = (id: string, seen: Set<string>): boolean => {
    for (const pair of pairs.filter((p) => p.expected === id)) {
      if (seen.has(pair.detected)) continue
      seen.add(pair.detected)
      const previous = assigned.get(pair.detected)
      if (!previous || visit(previous.expected, seen)) { assigned.set(pair.detected, pair); return true }
    }
    return false
  }
  expected.forEach((e) => visit(e.id, new Set()))
  return [...assigned.values()].sort((a, b) => a.expected.localeCompare(b.expected))
}
export function auditValueSources(truth: BasisTruth, selectedId: string | null, sources: Association['sources']) {
  const selected = truth.bases.find((b) => b.id === selectedId)
  const violations: string[] = [], unverified: string[] = []
  for (const [field, source] of Object.entries(sources)) {
    if (!selected || !source.valueIndexes.length) { unverified.push(field); continue }
    const allowed = new Set([...selected.valueIndexes, ...truth.bases.filter((b) => b.kind === 'percent_reference' && b.context === selected.id && source.contextLinkedPercent).flatMap((b) => b.valueIndexes)])
    if (source.valueIndexes.some((i) => !allowed.has(i))) violations.push(field)
  }
  return { violations, unverified }
}

export function replay(input: Input, config: Config = DEFAULT_CONFIG): RecordResult {
  const original = JSON.stringify(input.ocr), baselineStarted = performance.now(), baseline = parseNutrition(input.ocr)
  const baselineElapsedMs = performance.now() - baselineStarted, detectionStarted = performance.now(), structure = detectBases(input.ocr, config)
  const detectionElapsedMs = performance.now() - detectionStarted
  const truth = input.truth?.status === 'reviewed' ? input.truth : null
  const matches = truth ? matchBases(truth.bases, structure.bases, config.matchOverlap) : []
  const explicit = matches.find((m) => m.expected === truth?.intended)?.detected ?? null
  const { rows } = rowsAndBoxes(input.ocr)
  const modes: ModeResult[] = []
  for (const mode of ['A', 'B', 'C', 'D'] as Mode[]) {
    // Unannotated oracle/manual targets are unavailable, never silently supplied by detection.
    if ((mode === 'B' || mode === 'D') && (!truth || !truth.intended)) continue
    const scope = mode === 'B' ? { bases: structuredClone(truth!.bases), unassigned: [], blockers: truth!.layout === 'multiple-panels' ? ['multiple-panels'] : structure.blockers.filter((b) => b === 'multiple-panels') } : structure
    const selected = mode === 'B' ? truth!.intended : mode === 'D' ? explicit : mode === 'C' ? autoSelect(structure) : truth?.intended ?? null
    const started = performance.now()
    const associated = mode === 'A' ? null : associate(input.ocr, scope, selected, config)
    const extraction = associated?.extraction ?? baseline
    const elapsedMs = mode === 'A' ? baselineElapsedMs : performance.now() - started + (mode === 'B' ? 0 : detectionElapsedMs)
    const sources = associated?.sources ?? Object.fromEntries(Object.entries(baseline.evidence).filter(([key]) => !key.startsWith('serving.') && baseline.data.nutrients[key] !== null).map(([key, e]) => {
      const ids = e.lineIndexes.filter((i) => (!rows.some((a) => a.box.index === i) && /^(?:less than\s+)?[<>\dOo.]/i.test(input.ocr.lines[i]!.text.trim())) || rows.some((a) => a.box.index === i && Boolean(p.readAmount(a.tail, a.unit ?? (a.key.startsWith('energy') ? 'kcal' : undefined), a.key.startsWith('energy')))))
      return [key, { basisId: 'baseline-unscoped', valueIndexes: ids, contextLinkedPercent: baseline.data.nutrients[key]!.endsWith('%') }]
    }))
    let crossColumn: number | null = truth ? 0 : null
    const attribution: Record<string, string> = {}
    const result = evaluateCase({ annotation: input.annotation, ocr: input.ocr }, extraction)
    const selectedExpected = mode === 'A' || mode === 'B' ? truth?.intended : matches.find((m) => m.detected === selected)?.expected
    const audit = truth ? auditValueSources(truth, selectedExpected ?? null, sources) : null
    for (const field of result.fields.filter((f) => !f.field.startsWith('serving.'))) {
      const source = sources[field.field], target = truth?.fields[field.field]
      if (field.predicted !== null && audit?.violations.includes(field.field)) {
        crossColumn!++; attribution[field.field] = 'cross-column-association'; continue
      }
      if (source?.valueIndexes.length && target && source.valueIndexes.some((i) => !target.valueIndexes.includes(i))) {
        attribution[field.field] = 'within-basis-association-error'; continue
      }
      if (field.outcome === 'correct' || field.outcome === 'correct-abstention' || field.outcome === 'unscored') continue
      if (mode === 'D' && !explicit) attribution[field.field] = 'basis-not-detected'
      else if (mode === 'C' && !selected) attribution[field.field] = 'selection-abstained'
      else if (truth && selectedExpected !== truth.intended && selected) attribution[field.field] = 'wrong-auto-selection'
      else if (target && typeof field.truth === 'string' && !valueInOcr(field.field, field.truth, target.valueIndexes.map((i) => input.ocr.lines[i]!.text))) attribution[field.field] = 'ocr-recognition-error'
      else if (source && target && target.valueIndexes.length && source.valueIndexes.length && source.valueIndexes.every((i) => target.valueIndexes.includes(i))) attribution[field.field] = 'ocr-recognition-error'
      else if (field.predicted !== null && target && source?.valueIndexes.length) attribution[field.field] = 'within-basis-association-error'
      else attribution[field.field] = field.predicted === null ? 'missing-safe-value' : 'unverified-attribution'
    }
    modes.push({ mode, selected, requiresSelection: mode !== 'A' && !selected, result,
      supplemental: input.supplementalFields ? evaluateCase({ annotation: { ...input.annotation, fields: input.supplementalFields }, ocr: input.ocr }, extraction) : null,
      sources, rejected: associated?.rejected ?? [], nullReasons: associated?.nullReasons ?? {}, crossColumn, attribution, elapsedMs })
  }
  assert.equal(JSON.stringify(input.ocr), original, 'Replay mutated frozen OCR.')
  for (const mode of modes) assert.deepEqual(mode.result.fields.filter((f) => f.field.startsWith('serving.')).map((f) => [f.field, f.predicted, f.evidence]), modes[0]!.result.fields.filter((f) => f.field.startsWith('serving.')).map((f) => [f.field, f.predicted, f.evidence]), 'Serving output/evidence changed.')
  return { id: input.annotation.id, productId: input.annotation.productId, layout: truth?.layout ?? (input.annotation.tags.includes('multiple-bases') ? 'multi-basis-unreviewed' : 'control-unreviewed'),
    image: input.image ?? null, imageSha256: input.imageSha256, ocr: input.ocr, truth, structure, detectionElapsedMs, matches, modes,
    alternatives: Object.fromEntries(structure.bases.filter((b) => b.kind === 'quantity').map((b) => [b.id, associate(input.ocr, structure, b.id, config)])) }
}
