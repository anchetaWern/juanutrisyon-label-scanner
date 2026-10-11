// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { importOwnerFields, loadPilotDataset } from './dataset'
import { calibration, ownerOnlyCases, pilotCases } from './report'
import { evaluateCase } from '../metrics'
import { VARIANTS, type PilotDataset, type PilotResult, type PilotRun } from './types'

const dataset: PilotDataset = { version: 1, fingerprint: 'test-fingerprint', sources: [], notes: [], reviewProvenance: 'test', cases: [{
  id: 'label', productId: 'product', split: 'development', tags: [], panel: [{ x: .1, y: .1 }, { x: .9, y: .1 }, { x: .9, y: .9 }, { x: .1, y: .9 }], panelNote: 'test',
  review: { glareOnPanel: false, smallText: false, blur: false, clippedNutrientFields: false }, supplementalFields: {},
  image: 'test.jpeg', imageSha256: 'hash', width: 300, height: 400,
  annotation: { id: 'label', productId: 'product', split: 'development', tags: [], cohort: 'pilot', provenance: 'human verified', fields: { protein: '2g' } },
}] }
function row(variant: PilotResult['variant']): PilotResult {
  return { id: 'label', variant, width: 300, height: 400, geometry: null, rectangle: null,
    quality: { metrics: null, warnings: [], error: 'analysis failed' }, suggestion: null, suggestionError: null,
    suggestionMs: 0, preparationMs: 1, ocr: { text: '', lines: [], engine: 'mock' }, processingMs: 2 }
}
const run = (): PilotRun => ({ version: 1, datasetFingerprint: dataset.fingerprint, startedAt: 'test', completedAt: 'test',
  environment: {}, initializationMs: 1, config: {}, sources: [], results: VARIANTS.map(row) })

describe('Phase 2 independent inputs and paired scoring', () => {
  it('enforces pair completeness, unique images, product splits and owner-truth protection on disk', async () => {
    const root = await mkdtemp(join(tmpdir(), 'label-pilot-test-'))
    try {
      await mkdir(join(root, 'evaluation/datasets'), { recursive: true })
      await mkdir(join(root, 'labels/nutrition_labels_json'), { recursive: true })
      const entry = dataset.cases[0]!
      const manifest = { version: 1, reviewedAt: 'test', reviewProvenance: 'test', entries: [entry] }
      const save = () => writeFile(join(root, 'evaluation/datasets/phase-2-pilot.json'), JSON.stringify(manifest))
      await save()
      const bytes = await sharp({ create: { width: 300, height: 400, channels: 3, background: '#ddd' } }).jpeg().toBuffer()
      const label = JSON.stringify({ serving: { serving_size: '1g', servings_per_container: '1' }, nutrients: { protein: '2g' } })
      await writeFile(join(root, 'labels/nutrition_labels_json/label.jpeg'), bytes)
      await expect(loadPilotDataset(root)).rejects.toThrow('paired')
      await writeFile(join(root, 'labels/nutrition_labels_json/label.json'), label)
      const valid = await loadPilotDataset(root)
      expect(valid.cases).toHaveLength(1)
      expect(valid.fingerprint).toMatch(/^[a-f0-9]{64}$/)
      manifest.entries[0] = { ...entry, supplementalFields: { protein: '3g' } }; await save()
      await expect(loadPilotDataset(root)).rejects.toThrow('overwrite owner truth')
      manifest.entries[0] = entry
      manifest.entries.push({ ...entry, id: 'other', split: 'holdout' }); await save()
      await writeFile(join(root, 'labels/nutrition_labels_json/other.jpeg'), bytes)
      await writeFile(join(root, 'labels/nutrition_labels_json/other.json'), label)
      await expect(loadPilotDataset(root)).rejects.toThrow('split leakage')
      manifest.entries[1] = { ...entry, id: 'other', productId: 'other' }; await save()
      await expect(loadPilotDataset(root)).rejects.toThrow('Duplicate image')
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  it('retains qualifiers, fractions and unsupported nutrient keys without inventing absent values', () => {
    const fields = importOwnerFields({ serving: { serving_size: '1/2 cup (28g)', servings_per_container: 'about 6' },
      nutrients: { protein: '<1g', vitamin_a: '190µg RE', vitamin_d3: '102IU', omega_3: '1135mg' } })
    expect(fields).toEqual({ 'serving.serving_size': '1/2 cup (28g)', 'serving.servings_per_container': 'about 6', protein: '<1g', vitamin_a: '190µg RE', vitamin_d3: '102IU', omega_3: '1135mg' })
    expect(fields).not.toHaveProperty('trans_fat')
  })
  it('rejects ambiguous null annotations and misspelled sections', () => {
    expect(() => importOwnerFields({ serving: { serving_size: '1g', servings_per_container: '1' }, nutrients: { protein: null } })).toThrow('Null is ambiguous')
    expect(() => importOwnerFields({ serving: {}, nutrients: {}, nutrient: {} })).toThrow('Unexpected label section')
  })
  it('requires every paired variant and rejects duplicate, unknown and mismatched inputs', () => {
    const valid = run()
    expect(pilotCases(dataset, valid).map((c) => c.annotation.id)).toEqual(['label/original', 'label/rectangle', 'label/perspective'])
    expect(() => pilotCases(dataset, { ...valid, results: valid.results.slice(1) })).toThrow('every variant')
    expect(() => pilotCases(dataset, { ...valid, results: [valid.results[0]!, valid.results[0]!, valid.results[2]!] })).toThrow('duplicate')
    expect(() => pilotCases(dataset, { ...valid, datasetFingerprint: 'wrong' })).toThrow('different dataset')
    expect(() => pilotCases(dataset, { ...valid, completedAt: null })).toThrow('incomplete')
    expect(() => pilotCases(dataset, { ...valid, results: [{ ...valid.results[0]!, id: 'unknown' }, ...valid.results.slice(1)] })).toThrow('Unexpected')
  })
  it('counts provider failures as missing targets instead of dropping the case', () => {
    const failed = run(); failed.results[0] = { ...row('original'), ocr: null, error: 'model failed' }
    const scored = evaluateCase(pilotCases(dataset, failed)[0]!)
    expect(scored.providerFailed).toBe(true)
    expect(scored.fields.find((f) => f.field === 'protein')).toMatchObject({ outcome: 'missing', triage: 'provider-failure' })
  })

  it('keeps supplemental transcriptions and unreviewed predictions out of primary owner-only metrics', () => {
    const expanded = { ...dataset, cases: [{ ...dataset.cases[0]!, supplementalFields: { energy_from_fat: '20kcal' },
      annotation: { ...dataset.cases[0]!.annotation, fields: { protein: '2g', energy_from_fat: '20kcal' } } }] }
    const scored = pilotCases(expanded, run()).map((c) => evaluateCase(c))
    expect(ownerOnlyCases(expanded, scored)[0]!.fields.map((f) => f.field)).toEqual(['protein'])
  })
  it('excludes failed quality checks from warning confusion and excludes validation from threshold selection', () => {
    const validation = { ...dataset.cases[0]!, id: 'validation', split: 'holdout' as const, review: { ...dataset.cases[0]!.review, smallText: true } }
    const result = row('rectangle')
    const validQuality = { metrics: { width: 300, height: 400, meanLuminance: 100, clippedDarkRatio: 0, clippedHighlightRatio: 0, laplacianVariance: 100, estimatedTextHeightPx: 2 }, warnings: [], error: null }
    const report = calibration({ ...dataset, cases: [...dataset.cases, validation] }, [result, { ...result, id: 'validation', quality: validQuality }])
    expect(report.groups['rectangle/development']!.qualityFailures).toBe(1)
    expect(report.groups['rectangle/development']!.smallText.samples).toBe(0)
    expect(report.groups['rectangle/holdout']!.smallText.falseNegative).toBe(1)
    expect(report.developmentOnlyThresholdExploration.smallText.every((r) => r.samples === 0)).toBe(true)
  })
})
