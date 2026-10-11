// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { evaluateCase } from '../metrics'
import { comparisonGate, fieldChanges } from './report'
import type { FieldTruth } from '../types'

function scored(predicted: string | null, id = 'test', truth: FieldTruth = '2g') {
  return evaluateCase({ annotation: { id, productId: id, split: 'development', cohort: 'pilot', tags: [], provenance: 'test', fields: { protein: truth } }, ocr: null },
    { parserVersion: 'test', data: { serving: { serving_size: null, servings_per_container: null }, nutrients: { protein: predicted } }, issues: [], evidence: {} })
}

describe('Phase 5 paired comparison safeguards', () => {
  it('accepts recovery gains and unchanged existing errors', () => {
    expect(comparisonGate([scored(null)], [scored('2g')]).passed).toBe(true)
    expect(comparisonGate([scored('3g')], [scored('3g')]).passed).toBe(true)
  })
  it('rejects new wrong values and changed existing wrong values', () => {
    expect(comparisonGate([scored(null)], [scored('3g')]).newlyWrong).toHaveLength(1)
    expect(comparisonGate([scored('3g')], [scored('4g')]).passed).toBe(false)
  })
  it('rejects new predictions on annotated absent fields', () => {
    expect(comparisonGate([scored(null, 'test', { status: 'absent', note: 'verified' })], [scored('0g', 'test', { status: 'absent', note: 'verified' })]).passed).toBe(false)
  })
  it('rejects lost correct fields even if another case compensates in aggregate', () => {
    const gate = comparisonGate([scored('2g', 'a'), scored(null, 'b')], [scored(null, 'a'), scored('2g', 'b')])
    expect(gate.passed).toBe(false)
    expect(gate.lostCorrectFields).toHaveLength(1)
    expect(gate.cohortsWithRecoveryLoss).toHaveLength(0)
  })
  it('pairs by case ID rather than array order', () => {
    expect(fieldChanges([scored('2g', 'a'), scored(null, 'b')], [scored(null, 'b'), scored('2g', 'a')])).toEqual([])
  })
  it('rejects duplicate, missing or mismatched comparison cases', () => {
    expect(() => fieldChanges([scored(null)], [])).toThrow('paired')
    expect(() => fieldChanges([scored(null)], [scored(null, 'other')])).toThrow('Unpaired')
    expect(() => fieldChanges([scored(null), scored(null)], [scored(null), scored(null)])).toThrow('unique')
  })
  it('audits disappearing and newly recognized unannotated keys as unscored', () => {
    const before = scored(null), after = scored(null)
    after.fields.push({ ...after.fields[0]!, field: 'vitamin_a', truth: { status: 'unreviewed', note: 'not annotated' }, predicted: '10IU', outcome: 'unscored' })
    expect(fieldChanges([before], [after])[0]).toMatchObject({ field: 'vitamin_a', before: { predicted: null, outcome: 'unscored' }, after: { predicted: '10IU', outcome: 'unscored' } })
    expect(fieldChanges([after], [before])[0]!.after.predicted).toBeNull()
  })
})
