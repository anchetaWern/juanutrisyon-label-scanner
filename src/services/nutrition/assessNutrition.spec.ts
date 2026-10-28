import { describe, expect, it } from 'vitest'
import { assessNutrition, createAssessmentDraft, portionOptions, type AssessmentDraft } from './assessNutrition'
import { normalizeReferenceRows, referenceProvenance, type ReferenceSet } from './calculations'
import { parseNutrition, type NutritionExtraction } from './parseNutrition'
import fixtures from './fixtures/mobile-ocr.json'

function draft(nutrients: Record<string, string | null> = {}, heading = 'Amount Per Serving'): AssessmentDraft {
  const extraction: NutritionExtraction = { parserVersion: 'test', data: {
    serving: { serving_size: '30 g', servings_per_container: '4' }, nutrients: {
      energy: '160kcal', total_fat: '10g', saturated_fat: '5g', carbohydrate: '18g', protein: '2g', sugars: '1g', sodium: '220mg', ...nutrients,
    },
  }, issues: [], evidence: {} }
  return createAssessmentDraft(extraction, { text: heading, engine: 'test', lines: [{ text: heading, bbox: { x: 0, y: 0, width: 300, height: 30 } }] })
}
function references(): ReferenceSet {
  const records = normalizeReferenceRows([
    { nutrient: 'protein', daily_value: 71, unit: 'g' }, { nutrient: 'dietary fiber', daily_value: 20, unit: 'g' },
    { nutrient: 'sodium', daily_value: 1500, unit: 'mg' }, { nutrient: 'sugar', daily_value: 63, unit: 'g' },
    { nutrient: 'vitamin a', daily_value: 700, unit: 'µgRE' },
  ])
  for (const [id, record] of Object.entries(records)) record.reference_metadata = referenceProvenance(id)
  return { records, snapshot_id: 'test', fetchedAt: '2026-10-28T00:00:00Z', cached: false }
}
describe('scanned food assessment', () => {
  it('uses energy shares for Chippy while preserving declared calories and existing PNPM results', () => {
    const result = assessNutrition(draft(), references())
    expect(result.calories).toBe(160)
    expect(result.macroEnergy).toBe(170)
    expect(result.macros.map(macro => macro.percentage)).toEqual([72 / 170 * 100, 90 / 170 * 100, 8 / 170 * 100])
    expect(result.highWarnings.map(warning => warning.nutrient).sort()).toEqual(['saturated-fat', 'sodium', 'total-fat'])
    expect(result.unknownWarnings).toHaveLength(0)
  })
  it('does not turn unknown macros into zeros or a complete chart', () => {
    const result = assessNutrition(draft({ protein: null }), references())
    expect(result.macroEnergy).toBeNull()
    expect(result.macros.every(macro => macro.percentage === null)).toBe(true)
    expect(result.macros[0]?.amount).toBe(18)
    expect(result.rows.find(row => row.key === 'protein')?.value).toBeNull()
  })
  it('preserves explicit zeros and rejects negative, bounded, and percent-only amounts', () => {
    const result = assessNutrition(draft({ total_fat: '0g', saturated_fat: '-1g', sugars: '<1g', protein: '5%', calcium: '25%' }), references())
    expect(result.rows.find(row => row.key === 'total_fat')?.value).toBe(0)
    for (const key of ['saturated_fat', 'sugars', 'protein', 'calcium']) expect(result.rows.find(row => row.key === key)?.value).toBeNull()
    expect(result.unknownWarnings).toHaveLength(2)
  })
  it('does not invent a basis from serving size or choose between multiple columns', () => {
    for (const heading of ['Nutrition Facts', 'Per 100 g Per serving']) {
      const result = assessNutrition(draft({}, heading), references())
      expect(result.basisKnown).toBe(false)
      expect(result.unknownWarnings).toHaveLength(4)
      expect(result.highlights).toBeNull()
      expect(result.rows.every(row => row.percentage === null)).toBe(true)
    }
  })
  it('scales a serving to 100g/container and keeps PNPM ratios unchanged', () => {
    const input = draft()
    const serving = assessNutrition(input, references())
    const per100 = assessNutrition(input, references(), '100')
    expect(per100.calories).toBeCloseTo(160 / 30 * 100)
    expect(assessNutrition(input, references(), 'container').calories).toBe(640)
    expect(per100.warnings.map(w => w.status)).toEqual(serving.warnings.map(w => w.status))
    input.readings.find(row => row.key === 'sodium')!.amount = '0.22'
    input.readings.find(row => row.key === 'sodium')!.unit = 'g'
    expect(assessNutrition(input, references()).rows.find(row => row.key === 'sodium')?.value).toBe(220)
  })
  it('supports per-100mL but never assumes mL and g are interchangeable', () => {
    const input = draft({}, 'Per 100 mL')
    expect(portionOptions(input).some(option => option.value === 'serving')).toBe(false)
    input.servingSize = '125 mL'
    expect(assessNutrition(input, null, 'serving').calories).toBe(200)
    expect(assessNutrition(input, null, 'container').calories).toBe(800)
  })
  it('assesses same-basis ratios with missing serving weight but disables weight conversion', () => {
    const input = draft()
    input.servingSize = ''
    expect(portionOptions(input).some(option => option.value === '100')).toBe(false)
    expect(assessNutrition(input, null).highWarnings).toHaveLength(3)
    expect(assessNutrition(input, null).highlights).toBeNull()
  })
  it('uses the local 20% highlight policy and skips unverified sugar and vitamin forms', () => {
    const result = assessNutrition(draft({ protein: '14.2g', fiber: '4g', sodium: '300mg', sugars: '63g', vitamin_a: '700mcg RE' }), references())
    expect(result.highlights?.notable.items.map(row => row.name)).toEqual(['protein', 'dietary fiber'])
    expect(result.highlights?.monitor.items.map(row => row.name)).toEqual(['sodium'])
    expect(result.rows.find(row => row.key === 'vitamin_a')?.percentage).toBeNull()
  })
  it('handles zero totals, invalid energy, and invalid custom portions without division by zero', () => {
    const input = draft({ energy: '0kcal', total_fat: '0g', carbohydrate: '0g', protein: '0g' })
    expect(assessNutrition(input, null).macroEnergy).toBe(0)
    expect(assessNutrition(input, null).unknownWarnings).toHaveLength(4)
    const invalid = assessNutrition(input, references(), 'custom', '-1')
    expect(invalid.factor).toBeNull()
    expect(invalid.rows.every(row => row.value === null)).toBe(true)
  })
  it('applies PNPM thresholds inclusively and does not report incomplete data as clear', () => {
    const input = draft({ energy: '90kcal', total_fat: '3g', saturated_fat: '1g', sugars: '2.25g', sodium: '90mg' })
    expect(assessNutrition(input, null).highWarnings).toHaveLength(4)
    input.readings.forEach(row => { if (['total_fat', 'saturated_fat', 'sugars', 'sodium'].includes(row.key)) row.amount = '0' })
    expect(assessNutrition(input, null).highWarnings).toHaveLength(0)
    expect(assessNutrition(input, null).unknownWarnings).toHaveLength(0)
    input.readings.find(row => row.key === 'sugars')!.amount = ''
    expect(assessNutrition(input, null).unknownWarnings).toHaveLength(1)
  })
  it('integrates with existing frozen extraction without modifying the OCR or its evidence', () => {
    const ocr = fixtures.IMG_3587
    const before = JSON.stringify(ocr)
    const extraction = parseNutrition(ocr)
    const input = createAssessmentDraft(extraction, ocr)
    const result = assessNutrition(input, references())
    expect(result.calories).toBe(133)
    expect(result.rows.find(row => row.key === 'sodium')?.value).toBe(77)
    expect(JSON.stringify(ocr)).toBe(before)
    expect(extraction.evidence.sodium?.text).toBeTruthy()
  })
})
