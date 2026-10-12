// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { OcrResult } from '../../src/services/ocr/types'
import { selectCandidates } from './candidates'
import { mapRectangle, paddedCrop } from './geometry'
import { localReading, normalizeExact, reading, scoreReading } from './scoring'
import { replayOcr } from './replay'
import { buildReport, pipelineMetrics, recognitionMetrics } from './report'
import { checkCheckpoint } from './runner'
import type { Candidate, CandidateResult, Plan, Run, Truth } from './types'

const truth: Truth = { status: 'readable', numeric: '5.5', unit: 'g', provenance: 'human' }
const ocr = (text: string): OcrResult => ({ engine: 'paddleocr.js', text, sourceSize: { width: 500, height: 500 }, lines: [{ text, bbox: { x: 10, y: 10, width: 100, height: 20 } }] })
const candidate = (overrides: Partial<Candidate> = {}): Candidate => ({ id: 'one', imageId: 'image', field: 'total_fat', parserField: 'total_fat', basis: 'per serving', selection: 'parser-evidence',
  lineIndexes: [0], baselineRaw: '55g', evidence: null, ocrBox: { x: 10, y: 10, width: 20, height: 10 }, sourceBox: { x: 10, y: 10, width: 20, height: 10 },
  cropBox: { x: 6, y: 8, width: 28, height: 14 }, padding: .2, clipped: false, review: 'verified', reviewNote: 'visually reviewed', truth,
  failureBefore: 'recognition', replacement: { lineIndex: 0, start: 10, end: 13 }, ...overrides })
const result = (text: string, overrides: Partial<CandidateResult> = {}): CandidateResult => ({ candidateId: 'one', imageId: 'image', scale: 1,
  ocr: { ...ocr(text), sourceSize: { width: 28, height: 14 }, lines: [{ text, bbox: { x: 4, y: 2, width: 20, height: 10 } }] }, error: null,
  crop: null, timing: { extractionMs: 1, resizeMs: 1, recognitionMs: 8, totalMs: 10 }, ...overrides })
const plan = (candidates = [candidate()]): Plan => ({ version: 1, parserVersion: 'spatial-review-v5', padding: .2, scales: [1, 2], baselineDirectory: 'baseline', baselineSources: [], sources: [],
  policy: { minimumFailureRecovery: .1, maximumReservedRegressions: 0, maximumWrongIncrease: 0, phoneMedianLabelMs: null, phoneP95LabelMs: null, referenceDevice: null, mode: 'detection-and-recognition' },
  images: [{ id: 'image', productId: 'product', split: 'development', historicalSplit: 'holdout', image: 'image.png', imageSha256: 'hash', width: 500, height: 500,
    tags: [], annotation: { id: 'image', productId: 'product', split: 'development', cohort: 'test', provenance: 'owner', tags: [], fields: { total_fat: '5.5g' } },
    baseline: ocr('Total Fat 55g'), supplementalFields: [], candidates, unresolvedFields: [] }] })

describe('original source coordinates', () => {
  it('maps rounded prepared dimensions, including an additional OCR resize', () => {
    const mapped = mapRectangle({ x: 25, y: 30, width: 50, height: 60 }, { variant: 'rectangle', geometry: null,
      rectangle: { x: 100, y: 200, width: 1001, height: 2001 }, width: 501, height: 1001, ocr: { ...ocr(''), sourceSize: { width: 250, height: 500 } } })
    expect(mapped.x).toBeCloseTo(200.1); expect(mapped.y).toBeCloseTo(320.06)
    expect(mapped.width).toBeCloseTo(200.2); expect(mapped.height).toBeCloseTo(240.12)
  })
  it('rounds outward and clamps padding, defining padding per side', () => {
    expect(paddedCrop({ x: 2.5, y: 3.5, width: 10, height: 10 }, 20, 20)).toEqual({ box: { x: 0, y: 1, width: 15, height: 15 }, clipped: false })
    expect(paddedCrop({ x: 0, y: 0, width: 10, height: 10 }, 10, 10)).toEqual({ box: { x: 0, y: 0, width: 10, height: 10 }, clipped: true })
  })
  it('rejects unsupported transforms and invalid bounds rather than silently using OCR pixels', () => {
    expect(() => mapRectangle({ x: 0, y: 0, width: 1, height: 1 }, { variant: 'perspective', geometry: null, rectangle: null, width: 10, height: 10, ocr: ocr('') })).toThrow(/mapping/)
    expect(() => paddedCrop({ x: 20, y: 0, width: 1, height: 1 }, 20, 20)).toThrow()
  })
})
describe('recognition scoring independent of parser repairs', () => {
  it('does not repair digits, units, decimals or convert microgram spellings', () => {
    expect(scoreReading('55g', truth)).toMatchObject({ numeric: false, unit: true, combined: false })
    expect(scoreReading('5.5 q', truth)).toMatchObject({ numeric: true, unit: false, combined: false })
    expect(scoreReading('5.O g', truth)).toMatchObject({ numeric: false, unit: true, combined: false })
    expect(reading('18O mq')).toMatchObject({ numeric: null, unit: 'mq' })
    expect(reading('101IU')).toMatchObject({ numeric: '101', unit: 'iu' })
    expect(normalizeExact('  35  μg  ')).toBe('35 µg')
    expect(scoreReading('35 mcg', { ...truth, numeric: '35', unit: 'µg' }).combined).toBe(false)
  })
  it('excludes unitless truths from unit/combined accuracy and unreviewed from all denominators', () => {
    expect(scoreReading('120', { ...truth, numeric: '120', unit: null })).toMatchObject({ numeric: true, unit: null, combined: null })
    expect(scoreReading('5.5g', { status: 'unreviewed', numeric: null, unit: null, provenance: 'unknown' })).toMatchObject({ numeric: null, unit: null, combined: null })
  })
  it('keeps qualifiers and rejects multiple numbers/rows', () => {
    expect(reading('<1g')).toMatchObject({ numeric: '<1', unit: 'g' })
    expect(reading('230 mg 10%').ambiguous).toBe(true)
    const fragmented = ocr('230 mg'); fragmented.lines = [{ text: '230', bbox: { x: 0, y: 0, width: 30, height: 10 } }, { text: 'mg', bbox: { x: 35, y: 0, width: 20, height: 10 } }]
    expect(localReading(fragmented)).toBe('230 mg')
    fragmented.lines[1]!.bbox.y = 20
    expect(localReading(fragmented)).toBeNull()
  })
  it('counts paired recoveries and regressions even when net gain hides losses', () => {
    const m = recognitionMetrics([{ candidate: candidate(), raw: '5.5g', error: null, cropFailed: false },
      { candidate: candidate({ baselineRaw: '5.5g', failureBefore: 'none' }), raw: null, error: 'provider failed', cropFailed: true }])
    expect(m).toMatchObject({ recovered: 1, regressed: 1, numericRegressed: 1, failureCandidates: 1, failureRecovered: 1, failures: 1, cropFailures: 1 })
  })
  it('selects by frozen target geometry, retaining raw neighboring padding text for diagnostics', () => {
    const prediction = result('5.5g').ocr!
    prediction.lines.push({ text: '88g', bbox: { x: 4, y: 13, width: 20, height: 1 } })
    expect(localReading(prediction)).toBeNull()
    expect(localReading(prediction, candidate())).toBe('5.5g')
    expect(prediction.lines).toHaveLength(2)
  })
})
describe('candidate isolation and secondary replay', () => {
  it('preserves raw inline evidence and requires visual review; selection has no ground truth argument', () => {
    const candidates = selectCandidates('image', ocr('Total Fat 55g'))
    expect(candidates[0]).toMatchObject({ field: 'total_fat', baselineRaw: 'Total Fat 55g', review: 'pending', replacement: null, truth: { status: 'unreviewed' } })
  })
  it('replaces only the reviewed value span and leaves baseline, names, other columns and geometry unchanged', () => {
    const baseline = ocr('Total Fat 55g 10%'), original = structuredClone(baseline)
    const replay = replayOcr(baseline, [candidate()], [result('5.5g')])
    expect(replay.ocr.lines[0]!.text).toBe('Total Fat 5.5g 10%')
    expect(baseline).toEqual(original); expect(replay.ocr.lines[0]!.bbox).toEqual(baseline.lines[0]!.bbox)
    expect(replay.applied).toEqual(['one'])
  })
  it('removes only a reviewed amount on ambiguous recognition, skips provider failures, and rejects overlapping edits', () => {
    const baseline = ocr('Total Fat 55g 10%')
    expect(replayOcr(baseline, [candidate()], [result('5g 10%')]).ocr.text).toBe('Total Fat  10%')
    expect(replayOcr(baseline, [candidate()], [result('', { ocr: null, error: 'failed' })]).ocr).toEqual(baseline)
    expect(() => replayOcr(baseline, [candidate(), candidate({ id: 'two' })], [result('5g'), result('5g', { candidateId: 'two' })])).toThrow(/Overlapping/)
  })
})
describe('immutable checkpoints and adoption gates', () => {
  it('accepts a valid completed checkpoint and rejects changed local crop dimensions', () => {
    const prediction = result('5.5g')
    prediction.ocr!.engineVersion = '0.4.2'; prediction.ocr!.preprocessing = 'experiment-a-original-local-v1'
    prediction.crop = { width: 28, height: 14, path: 'actual/one-1.png', sha256: 'a'.repeat(64) }
    const run: Run = { version: 1, planSha256: 'a', split: 'development', completedAt: 'done', sessions: [],
      labels: [{ imageId: 'image', scale: 1, totalMs: 11, sourceLoadMs: 1, candidates: 1 }], results: [prediction] }
    const single = { ...plan(), scales: [1] as const }
    expect(() => checkCheckpoint(run, single, 'a', 'development')).not.toThrow()
    prediction.ocr!.sourceSize!.width = 27
    expect(() => checkCheckpoint(run, single, 'a', 'development')).toThrow(/dimensions/)
  })
  it('rejects identity changes, extra results and incomplete completed runs', () => {
    const run: Run = { version: 1, planSha256: 'a', split: 'development', completedAt: null, sessions: [], labels: [], results: [] }
    expect(() => checkCheckpoint(run, plan(), 'a', 'development')).not.toThrow()
    expect(() => checkCheckpoint(run, plan(), 'b', 'development')).toThrow(/identity/)
    expect(() => checkCheckpoint({ ...run, completedAt: 'done' }, plan(), 'a', 'development')).toThrow(/Incomplete/)
    expect(() => checkCheckpoint({ ...run, results: [result('5g')] }, plan(), 'a', 'development')).toThrow(/extra/)
  })
  it('never declares success without fresh reserved data and reference phone measurements', () => {
    const report = buildReport(plan(), null, null)
    expect(report.gates.every((g) => !g.passed)).toBe(true)
    expect(report.gates[0]!.reasons.join(' ')).toMatch(/Fresh reserved/)
    expect(report.gates[0]!.reasons.join(' ')).toMatch(/phone latency/)
  })
  it('counts wrong-to-different-wrong substitutions even with unchanged wrong totals', () => {
    const run: Run = { version: 1, planSha256: 'a', split: 'development', completedAt: 'done', sessions: [], labels: [], results: [result('56g')] }
    expect(pipelineMetrics(plan(), null, 'development', null)).toMatchObject({ wrong: 1, newWrong: 0 })
    expect(pipelineMetrics(plan(), run, 'development', 1)).toMatchObject({ wrong: 1, newWrong: 1 })
  })
})
