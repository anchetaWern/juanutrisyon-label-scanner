// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { aggregate } from '../metrics'
import { VARIANTS, type PilotDataset, type PilotRun } from '../pilot/types'
import { developmentGate, scoreRun, validationGate, type ExperimentSummary } from './report'
import { experiments } from './experiments'

function summary(correct = 10): ExperimentSummary {
  return Object.fromEntries(VARIANTS.map((v) => {
    const empty = aggregate([])
    return [v, { ...empty, nutrients: { ...empty.nutrients, correct },
      storedProcessingMs: { samples: 10, mean: 1000, p95: 1200 } }]
  }))
}
describe('Phase 4 selection safeguards', () => {
  it('requires a meaningful improvement and rejects increased wrong values on another variant', () => {
    const control = summary(), better = summary(13)
    expect(developmentGate(better, control).eligible).toBe(true)
    better.original!.nutrients.wrong = 1
    expect(developmentGate(better, control).failures).toContain('original: more wrong nutrients')
    expect(developmentGate(summary(12), control).eligible).toBe(false)
  })
  it('rejects provider failures, excessive runtime and aggregate recovery regressions', () => {
    const control = summary(), candidate = summary(13)
    candidate.perspective!.providerFailures = 1
    candidate.rectangle!.storedProcessingMs.mean = 2600
    candidate.original!.nutrients.correct = 0
    const gate = developmentGate(candidate, control)
    expect(gate.eligible).toBe(false)
    expect(gate.failures).toContain('Fewer nutrients across paired variants')
    expect(gate.failures).toContain('Rectangle mean runtime exceeds budget')
    expect(gate.failures).toContain('perspective: provider failure')
  })
  it('rejects validation regressions independently of development improvements', () => {
    const control = summary(), candidate = summary(9)
    expect(validationGate(candidate, control).accepted).toBe(false)
    candidate.rectangle!.nutrients.correct = 13
    candidate.rectangle!.serving.wrong = 1
    expect(validationGate(candidate, control).accepted).toBe(false)
    candidate.rectangle!.serving.wrong = 0
    expect(validationGate(candidate, control).accepted).toBe(true)
  })
  it('keeps control preprocessing frozen independently from production defaults', () => {
    expect(experiments[0]!.config.preprocessing).toMatchObject({ scale: 1, mode: 'grayscale-contrast-sharpen', maxDimension: 2400 })
    expect(experiments.filter((e) => e.config.preprocessing!.scale === 2)).toHaveLength(3)
  })
  it('rejects missing or cross-split results and retains provider failures in scored targets', () => {
    const entry = { id: 'dev', productId: 'dev', split: 'development' as const,
      supplementalFields: {}, annotation: { id: 'dev', productId: 'dev', split: 'development' as const,
        cohort: 'pilot', tags: [], provenance: 'verified', fields: { protein: '2g' } } }
    const dataset = { version: 1, fingerprint: 'test', cases: [entry], sources: [], notes: [], reviewProvenance: 'test' } as unknown as PilotDataset
    const run = { version: 1, datasetFingerprint: 'test', completedAt: 'done', request: { split: 'development', config: experiments[0]!.config },
      results: VARIANTS.map((variant) => ({ id: 'dev', variant, ocr: null, error: 'failed', processingMs: 1 })) } as PilotRun
    const scored = scoreRun(dataset, run, 'development')
    expect(scored.byVariant.rectangle!.nutrients).toMatchObject({ readable: 1, correct: 0, missing: 1 })
    expect(scored.byVariant.rectangle!.providerFailures).toBe(1)
    expect(() => scoreRun(dataset, { ...run, results: run.results.slice(1) }, 'development')).toThrow('Missing experiment cases')
    expect(() => scoreRun(dataset, { ...run, results: [{ ...run.results[0]!, id: 'holdout' }, ...run.results.slice(1)] }, 'development')).toThrow('Unexpected')
  })
})
