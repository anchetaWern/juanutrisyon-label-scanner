import { describe, expect, it } from 'vitest'
import fixtures from './fixtures/phase5-development.json'
import { parseNutrition } from './parseNutrition'
import type { OcrLine, OcrResult } from '../ocr/types'

const line = (text: string, x: number, y: number, width = 140, height = 30): OcrLine => ({ text, bbox: { x, y, width, height } })
const result = (lines: OcrLine[]): OcrResult => ({ text: lines.map((l) => l.text).join('\n'), lines, engine: 'test', sourceSize: { width: 1000, height: 1800 } })
const without = (ocr: OcrResult, text: string): OcrResult => ({ ...ocr, lines: ocr.lines.filter((l) => l.text !== text) })

// Sanitized, unmodified Paddle text/boxes from the Phase 2 development split only.
// Primary expected values are owner-verified; calories-from-fat also uses the
// explicitly identified Phase 2 supplemental visual transcriptions.
// Holdout products 02/05/08/11/14 are intentionally excluded from these fixtures.
describe('Phase 5 development regressions', () => {
  for (const id of Object.keys(fixtures) as Array<keyof typeof fixtures>) {
    it(`${id}: preserves raw OCR, evidence and order/scale independence`, () => {
      const input = fixtures[id]
      const original = JSON.stringify(input)
      const parsed = parseNutrition(input)
      expect(parsed.parserVersion).toBe('spatial-review-v5')
      expect(JSON.stringify(input)).toBe(original)
      const scaled = { ...input, sourceSize: { width: input.sourceSize.width * .5, height: input.sourceSize.height * .5 },
        lines: [...input.lines].reverse().map((l) => ({ ...l, bbox: { x: l.bbox.x * .5, y: l.bbox.y * .5, width: l.bbox.width * .5, height: l.bbox.height * .5 } })) }
      const replay = parseNutrition(scaled)
      expect(replay.data).toEqual(parsed.data)
      for (const [key, evidence] of Object.entries(replay.evidence)) {
        expect(evidence.lineIndexes.length, key).toBeGreaterThan(0)
        expect(evidence.lineIndexes.map((i) => scaled.lines[i]!.text).join(' | ')).toBe(evidence.text)
      }
    })
  }

  for (const variant of ['rectangle', 'perspective'] as const) {
    it(`03 ${variant}: does not steal zinc or a neighboring macro's amount/DV`, () => {
      const parsed = parseNutrition(fixtures[`03_tang_orange_${variant}`])
      expect(parsed.data.nutrients).toMatchObject({ vitamin_d: null, zinc: '1.62mg', vitamin_c: '45mg', sodium: '45mg', sugars: null })
      expect(parsed.evidence.zinc!.text).toContain('1.62mg')
    })
    it(`07 ${variant}: keeps ordered bare values in the correct label column`, () => {
      const parsed = parseNutrition(fixtures[`07_cdo_sardines_${variant}`])
      expect(parsed.data.nutrients).toEqual({ energy: '58kcal', energy_from_fat: '20kcal', total_fat: '2g', saturated_fat: '1g',
        trans_fat: '0g', cholesterol: '6mg', sodium: '393mg', carbohydrate: '4g', fiber: '2g', sugars: '2g', protein: '6g',
        ...(variant === 'perspective' ? { dha: '17mg', omega_3: '151mg' } : {}) })
      expect(parsed.evidence.total_fat!.method).toBe('ordered-column')
    })
    it(`15 ${variant}: supports printed IU and joined names but not corrupted units`, () => {
      const parsed = parseNutrition(fixtures[`15_brown_cream_milk_${variant}`])
      expect(parsed.data.nutrients).toMatchObject({ carbohydrate: '11g', protein: '6g', vitamin_a: '307IU', vitamin_d: '102IU', sugars: null })
      expect(parsed.data.serving.servings_per_container).toBe('3.6')
    })
  }

  it('13: follows the complete curved column and joins explicit serving/added-sugar fragments', () => {
    const parsed = parseNutrition(fixtures['13_green_biscuit_rectangle'])
    expect(parsed.data.nutrients).toEqual({ energy: '19kcal', energy_from_fat: '6kcal', total_fat: '1g', saturated_fat: '0g',
      trans_fat: '0g', cholesterol: '0mg', sodium: '5mg', carbohydrate: '3g', fiber: '0g', sugars: '0g', protein: '0g',
      added_sugars: '0g', calcium: '10mg', iron: '0mg', vitamin_d3: '0μg', potassium: '9mg' })
    expect(parsed.data.serving).toEqual({ serving_size: '1 piece (4g)', servings_per_container: '20' })
    for (const field of ['serving.serving_size', 'serving.servings_per_container', 'added_sugars']) {
      expect(parsed.evidence[field]!.lineIndexes).toHaveLength(2)
    }
  })

  it('13: missing amounts cannot slide the remaining curved column into their place', () => {
    const input = fixtures['13_green_biscuit_rectangle']
    expect(parseNutrition(without(input, '6')).data.nutrients.energy_from_fat).toBeNull()
    expect(parseNutrition(without(input, '5')).data.nutrients.sodium).toBeNull()
    expect(parseNutrition(without(input, '10')).data.nutrients.calcium).toBeNull()
  })
})

describe('Phase 5 safety boundaries', () => {
  it('does not borrow grams/milligrams across parallel nutrient columns', () => {
    const parsed = parseNutrition(result([line('Sugars', 10, 100), line('Vitamin C', 300, 100), line('45mg', 500, 100)]))
    expect(parsed.data.nutrients.sugars).toBeNull()
    expect(parsed.data.nutrients.vitamin_c).toBe('45mg')
  })

  it('requires a printed unit for detached non-energy numbers', () => {
    const parsed = parseNutrition(result([line('Protein', 10, 100), line('6', 200, 100), line('Vitamin A', 10, 150), line('307', 200, 150)]))
    expect(parsed.data.nutrients.protein).toBeNull()
    expect(parsed.data.nutrients.vitamin_a).toBeNull()
  })

  it('accepts an open parenthesis only with a fully readable unit; never repairs a truncated unit', () => {
    const parsed = parseNutrition(result([line('Calories (kcal', 10, 100), line('142', 200, 100),
      line('Calories from Fat (kca)', 10, 150), line('73', 200, 150), line('Vitamin A (g RE)', 10, 200), line('54', 200, 200)]))
    expect(parsed.data.nutrients.energy).toBe('142kcal')
    expect(parsed.data.nutrients.energy_from_fat).toBeNull()
    expect(parsed.data.nutrients.vitamin_a).toBeNull()
  })

  it('rejects a detached amount that contradicts an explicit label unit', () => {
    expect(parseNutrition(result([line('Vitamin D (IU)', 10, 100), line('102mg', 200, 100)])).data.nutrients.vitamin_d).toBeNull()
  })

  it('preserves literal inline amounts and qualifiers without nutritional plausibility guesses', () => {
    const parsed = parseNutrition(result([line('Sodium 0g', 10, 100), line('Vitamin A < 54 mcg RE', 10, 150), line('Vitamin D (IU) 102', 10, 200)]))
    expect(parsed.data.nutrients).toMatchObject({ sodium: '0g', vitamin_a: '< 54mcg RE', vitamin_d: '102IU' })
  })

  it('does not use %DV when a damaged explicit mass precedes it', () => {
    const parsed = parseNutrition(result([line('Vitamin D', 10, 100), line('1.5唱', 200, 100, 70), line('30%', 300, 100, 70)]))
    expect(parsed.data.nutrients.vitamin_d).toBeNull()
  })

  it('still supports true percent-only micronutrients', () => {
    const parsed = parseNutrition(result([line('Vitamin D', 10, 100), line('30%', 200, 100, 70)]))
    expect(parsed.data.nutrients.vitamin_d).toBe('30%')
  })

  it('abstains from vertically stacked panels rather than using a unique field in the second panel', () => {
    const parsed = parseNutrition(result([line('Nutrition Facts', 10, 10), line('Calories 80', 10, 80), line('Total Fat 2g', 10, 120), line('Protein 1g', 10, 160),
      line('Nutrition Facts', 10, 300), line('Calories 200', 10, 370), line('Calories from Fat 90', 10, 410), line('Total Fat 10g', 10, 450), line('Protein 3g', 10, 490)]))
    expect(Object.values(parsed.data.nutrients).every((v) => v === null)).toBe(true)
    expect(parsed.issues.some((i) => i.message.includes('Multiple nutrition panels'))).toBe(true)
  })

  it('leaves an ambiguous or missing serving-size continuation unresolved', () => {
    const base = [line('Serving Size: 1', 10, 10), line('piece (4g)', 155, 10, 100), line('Calories 20', 10, 200)]
    expect(parseNutrition(result(base)).data.serving.serving_size).toBe('1 piece (4g)')
    expect(parseNutrition(result([base[0]!, base[2]!])).data.serving.serving_size).toBeNull()
    expect(parseNutrition(result([...base, line('piece (5g)', 155, 15, 100)])).data.serving.serving_size).toBeNull()
  })

  it('preserves fractions and decimal counts in joined serving fragments', () => {
    const parsed = parseNutrition(result([line('Serving Size: 1/2', 10, 10), line('cup (30g)', 155, 10, 100),
      line('No.of Serving', 10, 60), line('container/pack: 3.6', 155, 60, 200), line('Calories 20', 10, 200)]))
    expect(parsed.data.serving).toEqual({ serving_size: '1/2 cup (30g)', servings_per_container: '3.6' })
  })
})
