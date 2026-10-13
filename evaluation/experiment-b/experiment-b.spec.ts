import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import type { OcrResult } from '../../src/services/ocr/types'
import { parseNutrition } from '../../src/services/nutrition/parseNutrition'
import { associate } from './association'
import { autoSelect, detectBases } from './columns'
import { headerCategory, headerCandidates } from './headers'
import { auditValueSources, matchBases, replay } from './replay'
import { developmentInputs, frozenBaseline, validateTruth } from './dataset'
import { DEFAULT_CONFIG, type Basis, type Input, type Structure } from './types'

const line = (text: string, x: number, y: number) => ({ text, bbox: { x, y, width: 80, height: 20 } })
const ocr = (lines: OcrResult['lines']): OcrResult => ({ text: lines.map((l) => l.text).join('\n'), lines, engine: 'fixture', sourceSize: { width: 900, height: 600 } })
const basis = (id: string, valueIndexes: number[], category: Basis['category'] = 'per_serving'): Basis => ({ id, valueIndexes, category, kind: 'quantity', headerIndexes: [], rawHeader: id, context: category, preparation: null, section: 'table', support: valueIndexes.length, reasons: ['fixture'] })
const scope = (...bases: Basis[]): Structure => ({ bases, blockers: [], unassigned: [] })
const two = () => ocr([line('Per Serving', 220, 0), line('Per 100 g', 420, 0),
  line('Protein', 0, 40), line('3g', 220, 40), line('6g', 420, 40),
  line('Sodium', 0, 80), line('210mg', 220, 80), line('420mg', 420, 80),
  line('Total Fat', 0, 120), line('7g', 220, 120), line('14g', 420, 120)])

describe('basis headers and column detection', () => {
  it('matches formatting without speculative spelling correction', () => {
    expect(headerCategory('PER 100g:')?.category).toBe('per_100g')
    expect(headerCategory('per 100 mL (as prepared)')).toMatchObject({ category: 'per_100ml', preparation: 'as_prepared' })
    expect(headerCategory('Pcr Serying')).toBeNull()
    expect(headerCategory('Servings Per Container 6')).toBeNull()
  })
  it('joins actual header fragments', () => {
    const headers = headerCandidates([line('Per', 200, 0), { ...line('100 g', 285, 0), bbox: { x: 285, y: 0, width: 70, height: 20 } }])
    expect(headers.some((h) => h.category === 'per_100g' && h.indexes.length === 2)).toBe(true)
  })
  it('detects two quantity contexts and abstains', () => {
    const s = detectBases(two())
    expect(s.bases.filter((b) => b.kind === 'quantity')).toHaveLength(2)
    expect(autoSelect(s)).toBeNull()
  })
  it('does not treat a 100g nutrient cell as a basis header', () => {
    const input = two(); input.lines[3]!.text = '100g'
    const structure = detectBases(input)
    expect(structure.bases.some((b) => b.valueIndexes.includes(3))).toBe(true)
  })
  it('uses maximum one-to-one geometric correspondence', () => {
    const e = [basis('a', [1,2,3,4]), basis('b', [1,2])], d = [basis('x', [1,2,3]), basis('y', [3,4])]
    expect(matchBases(e, d, .5)).toHaveLength(2)
  })
  it('preserves two columns with the same canonical category', () => {
    const input = two(); input.lines[1]!.text = 'Per Serving'
    expect(detectBases(input).bases.filter((b) => b.kind === 'quantity')).toHaveLength(2)
  })
  it('uses unknown columns without inventing semantic labels', () => {
    const input = two(); input.lines = input.lines.slice(2)
    const bases = detectBases(input).bases
    expect(bases).toHaveLength(2); expect(bases.every((b) => b.category === 'unknown')).toBe(true)
  })
  it('does not create an unheaded basis from an isolated value', () => {
    expect(detectBases(ocr([line('Protein', 0, 40), line('3g', 220, 40)])).bases).toHaveLength(0)
  })
  it('does not make a separate quantity basis from daily values', () => {
    const input = two(); input.lines[1]!.text = '% Daily Value'
    for (const i of [4, 7, 10]) input.lines[i]!.text = '10%'
    const s = detectBases(input)
    expect(s.bases.filter((b) => b.kind === 'quantity')).toHaveLength(1)
    expect(autoSelect(s)).not.toBeNull()
  })
  it('is invariant to coordinate scaling and input order', () => {
    const input = two(), s = detectBases(input)
    const changed = { ...input, sourceSize: { width: 450, height: 300 }, lines: [...input.lines].reverse().map((l) => ({ ...l, bbox: { x: l.bbox.x / 2, y: l.bbox.y / 2, width: l.bbox.width / 2, height: l.bbox.height / 2 } })) }
    const signatures = (v: Structure, source: OcrResult) => v.bases.map((b) => [b.category, b.valueIndexes.map((i) => source.lines[i]!.text).sort()])
    expect(signatures(detectBases(changed), changed)).toEqual(signatures(s, input))
  })
})
describe('selected-basis safety', () => {
  it('selects only the requested column', () => {
    const r = associate(two(), scope(basis('left', [3, 6, 9]), basis('right', [4, 7, 10])), 'left')
    expect(r.extraction.data.nutrients).toMatchObject({ protein: '3g', sodium: '210mg', total_fat: '7g' })
    expect(Object.values(r.sources).every((s) => s.valueIndexes.every((i) => [3, 6, 9].includes(i)))).toBe(true)
  })
  it('does not borrow a readable foreign cell when the selected cell is damaged', () => {
    const input = two(); input.lines[3]!.text = '3?'
    const r = associate(input, scope(basis('left', [3, 6, 9]), basis('right', [4, 7, 10])), 'left')
    expect(r.extraction.data.nutrients.protein).toBeNull()
    expect(r.extraction.data.nutrients.sodium).toBe('210mg')
  })
  it('does not slide an incomplete selected column into neighboring rows', () => {
    const input = two(); input.lines[6]!.text = ''
    const r = associate(input, scope(basis('left', [3, 9]), basis('right', [4, 7, 10])), 'left')
    expect(r.extraction.data.nutrients.sodium).toBeNull()
  })
  it('requires an explicit valid quantity selection', () => {
    const s = scope(basis('left', [3, 6, 9]))
    expect(Object.values(associate(two(), s, 'missing').extraction.data.nutrients).every((v) => v === null)).toBe(true)
    s.bases[0]!.kind = 'percent_reference'
    expect(associate(two(), s, 'left').extraction.data.nutrients.protein).toBeNull()
  })
  it('preserves a genuine context-linked percent-only micronutrient', () => {
    const input = ocr([line('Per Serving', 220, 0), line('Calcium', 0, 40), line('20%', 220, 40)])
    const b = basis('serving', [2])
    const r = associate(input, scope(b), b.id)
    expect(r.extraction.data.nutrients.calcium).toBe('20%')
    expect(r.sources.calcium?.contextLinkedPercent).toBe(true)
  })
  it('does not replace a damaged quantity with its linked daily value', () => {
    const input = ocr([line('Calcium', 0, 40), line('12Omg', 220, 40), line('20%', 420, 40)])
    const b = basis('serving', [1]), percent = { ...basis('dv', [2], 'percent_dv'), kind: 'percent_reference' as const, context: 'serving' }
    expect(associate(input, scope(b, percent), b.id).extraction.data.nutrients.calcium).toBeNull()
  })
  it('does not accept an unlinked percent reference', () => {
    const input = ocr([line('Calcium', 0, 40), line('20%', 420, 40)])
    const b = basis('serving', []), percent = { ...basis('dv', [1], 'percent_dv'), kind: 'percent_reference' as const, context: null }
    expect(associate(input, scope(b, percent), b.id).extraction.data.nutrients.calcium).toBeNull()
  })
  it('does not fabricate sub-boxes for merged multi-value text', () => {
    const input = ocr([line('Protein 3g 6g', 0, 40)])
    expect(associate(input, scope(basis('serving', [0])), 'serving').extraction.data.nutrients.protein).toBeNull()
  })
  it('reads a verified shared unit column without borrowing a foreign amount', () => {
    const lines = [line('Per Serving', 300, 0), line('Per 100g', 500, 0), line('%DV', 700, 0)]
    const left: number[] = [], right: number[] = []
    for (const [i, name] of ['Protein', 'Total Fat', 'Sugars', 'Carbohydrate'].entries()) {
      lines.push(line(name, 0, 40+i*40), { ...line('g', 160, 40+i*40), bbox: { x: 160, y: 40+i*40, width: 30, height: 20 } })
      left.push(lines.length); lines.push(line('3', 300, 40+i*40)); right.push(lines.length); lines.push(line('6', 500, 40+i*40))
    }
    const r = associate(ocr(lines), scope(basis('left', left), basis('right', right)), 'left')
    expect(r.extraction.data.nutrients.protein).toBe('3g')
    expect(r.sources.protein!.valueIndexes).toEqual([5])
    const damaged = structuredClone(lines); damaged[4]!.text = '?'
    expect(associate(ocr(damaged), scope(basis('left', left), basis('right', right)), 'left').extraction.data.nutrients.protein).toBeNull()
  })
  it('keeps repeated-panel blockers active', () => {
    const s = scope(basis('serving', [3, 6, 9])); s.blockers = ['multiple-panels']
    expect(associate(two(), s, 'serving').extraction.data.nutrients.protein).toBeNull()
  })
})
describe('independent replay and provenance', () => {
  it('matches columns by membership, not semantic label or expected value', () => {
    const expected = [basis('truth', [3, 6, 9])], detected = [basis('detected', [3, 6, 9], 'per_100g')]
    expect(matchBases(expected, detected, .6)).toEqual([{ expected: 'truth', detected: 'detected', overlap: 1, labeledCorrectly: false }])
  })
  it('counts cross-column sources even when the numeric answer matches', () => {
    const left = basis('left', [3, 6, 9]), right = basis('right', [4, 7, 10])
    const audit = auditValueSources({ status: 'reviewed', provenance: 'synthetic', layout: 'multi-basis', intended: 'left', bases: [left, right], fields: {} }, 'left', { protein: { basisId: 'left', valueIndexes: [4], contextLinkedPercent: false } })
    expect(audit.violations).toEqual(['protein'])
    const input = two(); input.lines[4]!.text = '3g'
    const c: Input = { annotation: { id: 'fixture', productId: 'fixture', cohort: 'test', split: 'regression', tags: [], provenance: 'synthetic', fields: { protein: '3g' } }, ocr: input, split: 'development',
      truth: { status: 'reviewed', provenance: 'synthetic', layout: 'multi-basis', intended: 'left', bases: [basis('left', [3, 6, 9]), basis('right', [4, 7, 10], 'per_100g')], fields: { protein: { basis: 'left', valueIndexes: [3] } } } }
    const record = replay(c)
    expect(record.modes.find((m) => m.mode === 'D')?.crossColumn).toBe(0)
    expect(record.modes.find((m) => m.mode === 'C')?.requiresSelection).toBe(true)
  })
  it('rejects overlapping ground-truth ownership', () => {
    expect(() => validateTruth({ status: 'reviewed', provenance: 'test', layout: 'multi-basis', intended: 'a', bases: [basis('a', [3]), basis('b', [3])], fields: {} }, two())).toThrow('ownership')
  })
  it('keeps default production output exactly equal to frozen v5 on every portable fixture', async () => {
    const { inputs } = await developmentInputs(process.cwd()), baseline = await frozenBaseline(process.cwd())
    for (const input of inputs) expect(parseNutrition(input.ocr), input.annotation.id).toEqual(baseline.parse(input.ocr))
  })
  it('oracle input is unaffected by expected numeric truth changes', async () => {
    const { inputs } = await developmentInputs(process.cwd()), input = inputs.find((c) => c.annotation.id.endsWith('/05_spam'))!
    const before = replay(input).modes.find((m) => m.mode === 'B')!
    const changed = structuredClone(input); changed.annotation.fields.protein = '999g'
    const after = replay(changed).modes.find((m) => m.mode === 'B')!
    expect(before.sources).toEqual(after.sources)
    expect(before.result.fields.map((f) => f.predicted)).toEqual(after.result.fields.map((f) => f.predicted))
  })
  it('keeps all bread percent-only targets within the selected serving context', async () => {
    const { inputs } = await developmentInputs(process.cwd()), input = inputs.find((c) => c.annotation.id.endsWith('/new-2'))!
    const r = replay(input)
    expect(r.modes.find((m) => m.mode === 'B')!.result.fields.filter((f) => f.outcome === 'correct')).toHaveLength(22)
    expect(r.modes.find((m) => m.mode === 'B')!.crossColumn).toBe(0)
  })
  it('ships immutable portable fixture digests', async () => {
    const manifest = JSON.parse(await readFile('evaluation/datasets/experiment-b-development.json', 'utf8')) as { cases: unknown[] }
    expect(manifest.cases).toHaveLength(26)
    expect(DEFAULT_CONFIG.minimumImprovedProducts).toBe(2)
  })
})
