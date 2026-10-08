// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { OcrResult } from '../src/services/ocr/types'
import type { NutritionExtraction } from '../src/services/nutrition/parseNutrition'
import { aggregate, buildReport, evaluateCase, nameInOcr, normalize, scoreField, summarize, valueInOcr } from './metrics'
import { loadCases, validateAnnotation, validateCases, validateOcr } from './load'
import { csv, markdown } from './report'
import type { Annotation, EvaluationCase, FieldTruth } from './types'

const root = fileURLToPath(new URL('../', import.meta.url))
const annotation = (fields: Record<string, FieldTruth>): Annotation => ({
  id: 'test', productId: 'test-product', cohort: 'synthetic-control', split: 'regression',
  provenance: 'Synthetic scorer control; not an image accuracy sample.', tags: [], fields,
})
const ocr = (...lines: string[]): OcrResult => ({ engine: 'synthetic', text: lines.join('\n'),
  lines: lines.map((text, i) => ({ text, bbox: { x: 0, y: i * 50, width: 200, height: 25 } })),
})
const extraction = (nutrients: Record<string, string | null>): NutritionExtraction => ({
  parserVersion: 'synthetic', data: { serving: { serving_size: null, servings_per_container: null }, nutrients }, issues: [], evidence: {},
})

describe('exact field metrics', () => {
  it('normalizes formatting but preserves quantities, qualifiers, fractions and units', () => {
    expect(normalize(' Less than 1 μg ')).toBe(normalize('<1mcg'))
    expect(scoreField('0g', '10g')).toBe('wrong')
    expect(scoreField('0g', 'Og')).toBe('wrong')
    expect(scoreField('1mg', '1g')).toBe('wrong')
    expect(scoreField('<1g', '1g')).toBe('wrong')
    expect(scoreField('1/3 cup (40g)', '3 cup (40g)')).toBe('wrong')
    expect(scoreField('About 6', '6')).toBe('wrong')
    expect(scoreField('1.0g', '1g')).toBe('wrong') // strict printed representation; no rounding
    expect(scoreField('125 mL', '125ml')).toBe('correct')
  })

  it('never counts a readable missed value as a correct abstention', () => {
    expect(scoreField('3.3g', null)).toBe('missing')
    expect(scoreField({ status: 'absent', note: 'Not printed.' }, null)).toBe('correct-abstention')
    expect(scoreField({ status: 'unreadable', note: 'Obscured in image.' }, '0g')).toBe('false-positive')
    expect(scoreField({ status: 'unreviewed', note: 'Not transcribed.' }, '0g')).toBe('unscored')
  })

  it('uses token boundaries for OCR amounts and never repairs OCR digits', () => {
    for (const text of ['10g', '0.0g', '0mg', 'Og', '<0g', '>0g', '0g5', '0g%']) {
      expect(valueInOcr('trans_fat', '0g', [text]), text).toBe(false)
    }
    expect(valueInOcr('trans_fat', '0g', ['Trans Fat 0 g 0%'])).toBe(true)
    expect(valueInOcr('fiber', '<1g', ['Less than 1 g'])).toBe(true)
    expect(valueInOcr('vitamin_b12', '1.8mcg', ['1.8 µg'])).toBe(true)
    expect(valueInOcr('protein', '3g', ['3', 'g'])).toBe(false) // no invented joins between rows
    expect(valueInOcr('energy', '80kcal', ['Calories 180'])).toBe(false)
    expect(valueInOcr('energy', '80kcal', ['Calories 80'])).toBe(true)
    expect(valueInOcr('energy', '80kcal', ['80 mg'])).toBe(false)
    expect(valueInOcr('energy', '80kcal', ['80mcg'])).toBe(false)
    expect(valueInOcr('energy', '80kcal', ['80%'])).toBe(false)
    expect(valueInOcr('energy', '80kcal', ['<80'])).toBe(false)
  })

  it('matches serving strings within lines without swallowing numeric boundaries', () => {
    expect(valueInOcr('serving.serving_size', '30g', ['Serving Size: 30 g'])).toBe(true)
    expect(valueInOcr('serving.servings_per_container', 'About 6', ['About 6 servings per container'])).toBe(true)
    expect(valueInOcr('serving.servings_per_container', '6', ['16 servings per container'])).toBe(false)
    expect(valueInOcr('serving.serving_size', '1/3 cup (40g)', ['Serving size 1/3 cup (40 g)'])).toBe(true)
    expect(valueInOcr('serving.serving_size', '1/3 cup (40g)', ['Serving sizen 3 cup (4og)'])).toBe(false)
  })

  it('does not silently repair names or match a name substring', () => {
    expect(nameInOcr('sodium', ['Sodiun 225mg'])).toBe(false)
    expect(nameInOcr('fiber', ['Insoluble Fiber 2g'])).toBe(true) // explicitly whole-panel proxy
    expect(nameInOcr('vitamin_b1', ['Vitamin B12'])).toBe(false)
  })

  it('scores row swaps as wrong even when both amounts occur somewhere in OCR', () => {
    const a = annotation({ protein: '3g', sugars: '7g' })
    const result = evaluateCase({ annotation: a, ocr: ocr('Protein 3g', 'Sugars 7g') }, extraction({ protein: '7g', sugars: '3g' }))
    expect(summarize(result.fields)).toMatchObject({ correct: 0, wrong: 2, missing: 0, precision: 0, exactRecall: 0 })
    expect(result.fields.filter((f) => f.outcome === 'wrong').every((f) => f.valuePresent)).toBe(true)
  })

  it('keeps all metric denominators explicit, including unscored outputs', () => {
    const a = annotation({ protein: '3g', sugars: '7g', sodium: '20mg',
      trans_fat: { status: 'absent', note: 'Not printed.' },
      fiber: { status: 'unreadable', note: 'Glare over this value.' },
      calcium: { status: 'unreviewed', note: 'Unknown.' } })
    const c = evaluateCase({ annotation: a, ocr: ocr() }, extraction({ protein: '3g', sugars: '9g', sodium: null,
      trans_fat: '0g', fiber: null, calcium: '0mg', iron: '1mg' }))
    expect(summarize(c.fields)).toMatchObject({ readable: 3, correct: 1, wrong: 1, missing: 1, falsePositive: 1,
      correctAbstention: 1, unscoredPredictions: 2, exactRecall: 1 / 3, precision: 1 / 3, coverage: 2 / 3,
      abstentionRate: 1 / 3, falsePositiveRate: 1 / 2 })
    expect(summarize([])).toMatchObject({ exactRecall: null, precision: null, falsePositiveRate: null })
  })

  it('includes provider failures in recall and latency uses only recorded samples', () => {
    const fail = evaluateCase({ annotation: annotation({ protein: '3g' }), ocr: null, error: 'Worker failed' })
    const good = evaluateCase({ annotation: annotation({ protein: '3g' }), ocr: ocr('Protein 3g'), recordedProcessingMs: 125 })
    expect(aggregate([fail, good])).toMatchObject({ providerFailures: 1, nutrients: { readable: 2, correct: 1, missing: 1 },
      storedProcessingMs: { samples: 1, mean: 125, p95: 125 } })
    expect(fail.fields.find((f) => f.field === 'protein')?.triage).toBe('provider-failure')
  })
})

describe('input validation and reproducible replay', () => {
  it('rejects ambiguous null truth, invalid OCR and product leakage within a cohort', () => {
    expect(() => validateAnnotation({ ...annotation({}), fields: { protein: null } })).toThrow('null is ambiguous')
    expect(() => validateOcr({ ...ocr('Protein 3g'), lines: [{ text: 'X', bbox: { x: 0, y: 0, width: NaN, height: 3 } }] })).toThrow('geometry')
    const c: EvaluationCase = { annotation: annotation({ protein: '3g' }), ocr: ocr('Protein 3g') }
    expect(() => validateCases([c, c])).toThrow('Duplicate')
    expect(() => validateCases([c, { ...c, annotation: { ...c.annotation, id: 'other', split: 'holdout' } }])).toThrow('split leakage')
    expect(() => validateCases([{ ...c, ocr: null }])).toThrow('explicit provider failure')
  })

  it('exposes historical cross-cohort holdout overlap instead of pooling samples', () => {
    const a = annotation({ protein: '3g' })
    const c1 = evaluateCase({ annotation: a, ocr: ocr('Protein 3g') })
    const c2 = evaluateCase({ annotation: { ...a, id: 'old', cohort: 'legacy', split: 'holdout' }, ocr: ocr('Protein 3g') })
    const report = buildReport([c1, c2])
    expect(report.crossCohortSplitOverlaps).toHaveLength(1)
    expect(Object.keys(report.byCohort)).toHaveLength(2)
    expect(report.detectionRecall.value).toBeNull()
  })

  it('runs all eight portable fixtures against independent printed truth without mutating OCR', async () => {
    const loaded = await loadCases(root)
    const before = JSON.stringify(loaded.cases)
    const report = { ...buildReport(loaded.cases.map((c) => evaluateCase(c))), sources: loaded.sources, notes: loaded.notes }
    expect(loaded.cases).toHaveLength(8)
    expect(JSON.stringify(loaded.cases)).toBe(before)
    expect(report.byCohort['mobile-replay']).toMatchObject({ nutrients: { readable: 124, correct: 121, missing: 3 },
      serving: { readable: 10, correct: 8, missing: 2 }, providerFailures: 0 })
    expect(report.cases.find((c) => c.annotation.id === 'new-3')?.fields.find((f) => f.field === 'total_fat'))
      .toMatchObject({ truth: '3.3g', predicted: null, outcome: 'missing' })
    expect(report.cases.find((c) => c.annotation.id === 'IMG_3585')?.fields.find((f) => f.field === 'trans_fat'))
      .toMatchObject({ outcome: 'correct-abstention' })
    expect(report.sources.every((s) => /^[a-f0-9]{64}$/.test(s.sha256))).toBe(true)
    expect(markdown(report)).toContain('Detection recall: **N/A**')
    expect(csv(report)).toContain('"new-3","mobile-replay","regression","total_fat","readable","3.3g","","missing"')
    expect(buildReport(loaded.cases.map((c) => evaluateCase(c)))).toEqual(buildReport(loaded.cases.map((c) => evaluateCase(c))))
  })

  it('fails explicitly when a requested local corpus is unavailable', async () => {
    await expect(loadCases(root, resolve(root, 'evaluation/nonexistent-corpus'))).rejects.toThrow()
  })

  it('quotes CSV and prevents a raw OCR formula from executing in a spreadsheet', () => {
    const c = evaluateCase({ annotation: annotation({ protein: '3g' }), ocr: ocr('Protein 3g') })
    c.fields[0]!.evidence = { lineIndexes: [0], text: '=1+1,"hello"', method: 'test' }
    expect(csv({ ...buildReport([c]), sources: [], notes: [] })).toContain('"\'=1+1,""hello"""')
  })
})
