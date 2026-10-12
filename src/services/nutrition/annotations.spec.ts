import { describe, expect, it } from 'vitest'
import { parseNutrition } from './parseNutrition'
import phone from './fixtures/annotation-phone.json'
import layout from './fixtures/single-basis-phone.json'
import type { OcrLine, OcrResult } from '../ocr/types'

const line = (text: string, x = 10, y = 100, width = 150, height = 30): OcrLine => ({ text, bbox: { x, y, width, height } })
const result = (lines: OcrLine[]): OcrResult => ({ text: lines.map((l) => l.text).join('\n'), lines, engine: 'test', sourceSize: { width: 1000, height: 1800 } })
const table = () => [line('Nutrition Facts', 10, 0), line('Calories 58', 10, 60), line('Total Fat 2g', 10, 120), line('Protein 6g', 10, 180)]
const claim = (text = '**Each serving contains 17 mg DHA of the 151 mg of Omega-3', y = 300) => line(text, 10, y, 900)

// Unmodified OCR text/boxes, no images or device metadata. Baseline data is
// frozen v4 at d7c2b96; every old non-null prediction must survive unchanged.
// All products were already exposed, including former holdouts: regression only.
describe('annotation-driven phone regressions', () => {
  for (const [id, { ocr, baselineData }] of Object.entries(phone)) it(`${id}: preserves previous readings, raw OCR and evidence`, () => {
    const original = JSON.stringify(ocr)
    const parsed = parseNutrition(ocr)
    for (const [key, value] of Object.entries(baselineData.nutrients)) if (value !== null) expect(parsed.data.nutrients[key], key).toBe(value)
    for (const [key, value] of Object.entries(baselineData.serving)) if (value !== null) expect(parsed.data.serving[key as keyof typeof baselineData.serving], key).toBe(value)
    const scaled = { ...ocr, sourceSize: { width: ocr.sourceSize.width * .5, height: ocr.sourceSize.height * .5 },
      lines: [...ocr.lines].reverse().map((l) => ({ ...l, bbox: { x: l.bbox.x * .5, y: l.bbox.y * .5, width: l.bbox.width * .5, height: l.bbox.height * .5 } })) }
    expect(parseNutrition(scaled).data).toEqual(parsed.data)
    expect(JSON.stringify(ocr)).toBe(original)
    for (const evidence of Object.values(parsed.evidence)) expect(evidence.text).toBe(evidence.lineIndexes.map((i) => ocr.lines[i]!.text).join(' | '))
  })

  it('recovers yellow-snack fiber without inventing the lost leading energy digit', () => {
    const parsed = parseNutrition(phone['02_yellow_snack'].ocr)
    expect(parsed.data.nutrients).toMatchObject({ fiber: '1g', energy: '60kcal' })
    expect(parsed.evidence.fiber!.text).toBe('Dietayy Fiber 1g')
    expect(parsed.issues.some((i) => i.field === 'fiber' && i.message.includes('Normalized'))).toBe(true)
  })

  it('reads abbreviated Tang fat subrows, not damaged digits/units', () => {
    expect(parseNutrition(layout['03_tang_orange']).data.nutrients).toMatchObject({ saturated_fat: '0g', trans_fat: '0g', total_fat: null, carbohydrate: null, protein: null, vitamin_d: null })
  })

  it('reads 555 Calories, calcium, iodine and selenium while leaving ambiguous fiber/vitamin text unresolved', () => {
    const parsed = parseNutrition(phone['06_555_fried_sardines_tausi'].ocr)
    expect(parsed.data.nutrients).toMatchObject({ energy: '94kcal', energy_from_fat: '29kcal', calcium: '156mg', iodine: '37μg', selenium: '36μg', fiber: null })
    expect(parsed.data.nutrients.vitamin_d).toBeUndefined() // raw Vitamin b101U is not a legible D/IU label
    expect(parsed.data.nutrients.vitamin_b1).toBeUndefined()
    for (const key of ['energy', 'energy_from_fat', 'calcium', 'iodine', 'selenium']) expect(parsed.issues.some((i) => i.field === key && i.message.includes('Normalized')), key).toBe(true)
  })

  it('reads both explicit per-serving CDO statement amounts with the original sentence as evidence', () => {
    const parsed = parseNutrition(phone['07_cdo_sardines'].ocr)
    expect(parsed.data.nutrients).toMatchObject({ dha: '17mg', omega_3: '151mg', protein: '6g' })
    for (const key of ['dha', 'omega_3']) {
      expect(parsed.evidence[key]!.method).toBe('explicit-per-serving-statement')
      expect(parsed.evidence[key]!.lineIndexes).toEqual([31])
    }
  })

  it('reads the printed sugar g unit despite the lost opening parenthesis, not the truncated vitamin A unit', () => {
    const parsed = parseNutrition(phone['15_brown_cream_milk'].ocr)
    expect(parsed.data.nutrients).toMatchObject({ sugars: '10g', vitamin_a: null, trans_fat: null, vitamin_d: '102IU' })
    expect(parsed.evidence.sugars!.text).toContain('sugarg)')
    expect(parsed.issues.some((i) => i.field === 'sugars' && i.message.includes('Normalized'))).toBe(true)
  })

  it('continues abstaining on the real dual-basis Spam panel', () => {
    const parsed = parseNutrition(phone['05_spam'].ocr)
    expect(Object.values(parsed.data.nutrients).every((v) => v === null)).toBe(true)
    expect(parsed.issues.some((i) => i.message.includes('extraction is disabled'))).toBe(true)
  })
})

describe('name and unit safety boundaries', () => {
  for (const text of ['Calories 94 Cal', 'Calorles 94 cal', 'Calories 94Cal', 'Energy 94 Cal 4%']) it(`normalizes food energy only: ${text}`, () => {
    const parsed = parseNutrition(result([line(text)]))
    expect(parsed.data.nutrients.energy).toBe('94kcal')
    expect(parsed.issues.some((i) => i.field === 'energy' && i.message.includes('Normalized'))).toBe(true)
  })
  it('does not accept cal on mass nutrients, convert kJ, or repair a damaged energy digit', () => {
    const parsed = parseNutrition(result([line('Protein 94 cal'), line('Calories 94 kJ', 10, 160), line('Calories from Fat 9l Cal', 10, 220)]))
    expect(parsed.data.nutrients).toMatchObject({ protein: null, energy: '94kJ', energy_from_fat: null })
  })
  it('supports a detached Cal value only for its energy row', () => {
    const parsed = parseNutrition(result([line('Calories'), line('94 Cal', 300), line('Protein', 10, 160), line('6 Cal', 300, 160)]))
    expect(parsed.data.nutrients).toMatchObject({ energy: '94kcal', protein: null })
  })
  it('requires the printed microgram unit, keeping numbers and raw text unchanged', () => {
    const input = result([line('Iodine 37ug'), line('Selenium 36ug', 10, 160), line('Vitamin A 307U', 10, 220), line('Vitamin D O0mcg', 10, 280)])
    const original = JSON.stringify(input)
    expect(parseNutrition(input).data.nutrients).toMatchObject({ iodine: '37μg', selenium: '36μg', vitamin_a: null, vitamin_d: null })
    expect(JSON.stringify(input)).toBe(original)
  })
  it('does not expand similar nutrient words or repair alphabetic digits', () => {
    const parsed = parseNutrition(result([line('Calcumlator 156mg'), line('Selenlumate 36ug', 10, 160), line('DiotaryFiberlg', 10, 220), line('Sugarg) l0', 10, 280)]))
    expect(parsed.data.nutrients.calcium).toBeUndefined()
    expect(parsed.data.nutrients.selenium).toBeUndefined()
    expect(parsed.data.nutrients.fiber).toBeNull()
    expect(parsed.data.nutrients.sugars).toBeNull()
  })
  it('does not interpret unitless or free-standing abbreviated fat labels', () => {
    expect(parseNutrition(result([line('- Trans'), line('0g', 300)])).data.nutrients.trans_fat).toBeNull()
    expect(parseNutrition(result([line('Total Fat 3g'), line('- Saturated', 10, 160), line('2', 300, 160)])).data.nutrients.saturated_fat).toBeNull()
  })
  it('preserves duplicate, footer and multi-basis blockers for abbreviated fat labels', () => {
    for (const extra of [line('Trans Fat 1g', 10, 300), line('Per 100g', 300, 0), line('Ingredients:', 10, 150)]) {
      expect(parseNutrition(result([line('Total Fat 3g'), line('- Trans', 10, 220), line('0g', 300, 220), extra])).data.nutrients.trans_fat).toBeNull()
    }
  })
})

describe('outside-table statement boundaries', () => {
  it('accepts an explicit serving statement after a daily-value footer', () => {
    expect(parseNutrition(result([...table(), line('Percent daily values are based on a 2,000 calorie diet', 10, 240, 900), claim()])).data.nutrients).toMatchObject({ dha: '17mg', omega_3: '151mg' })
  })
  for (const text of [
    'Each 100g contains 17 mg DHA of the 151 mg of Omega-3',
    'Each serving may contain 17 mg DHA of the 151 mg of Omega-3',
    'Each serving contains 17 DHA of the 151 of Omega-3',
    'Each serving contains 17% DHA of the 151% of Omega-3',
    'Each serving contains 1? mg DHA of the 151 mg of Omega-3',
    'Each serving contains 17 mg DHA of the 15l mg of Omega-3',
    'Each serving contains <17 mg DHA of the 151 mg of Omega-3',
    'Each serving contains 17-19 mg DHA of the 151 mg of Omega-3',
    'Each serving contains 17 mg DHA of the 151 mg of Omega-3 and more',
  ]) it(`rejects an incomplete, qualified or non-serving statement: ${text}`, () => {
    const parsed = parseNutrition(result([...table(), claim(text)]))
    expect(parsed.data.nutrients.dha).toBeUndefined()
    expect(parsed.data.nutrients.omega_3).toBeUndefined()
  })
  it('requires one panel and refuses multiple competing statements', () => {
    for (const input of [[claim()], [...table(), claim(), claim(undefined, 360)],
      [...table(), claim(), claim('Each serving contains 1? mg DHA of the 151 mg of Omega-3', 360)],
      [...table(), line('Nutrition Facts', 10, 240), claim()], [...table(), line('Per 100g', 500, 0), claim()]]) {
      const parsed = parseNutrition(result(input))
      expect(parsed.data.nutrients.dha).toBeUndefined()
      expect(parsed.data.nutrients.omega_3).toBeUndefined()
    }
  })
  it('does not use statements before the table or inside ingredients/reference tables', () => {
    for (const blocker of [line('Ingredients:', 10, 240), line('INGREDIENTS', 10, 240), line('Calories:', 10, 240)]) {
      const parsed = parseNutrition(result([...table(), blocker, line('2,000', 300, 240), claim()]))
      expect(parsed.data.nutrients.dha).toBeUndefined()
    }
    expect(parseNutrition(result([...table(), claim(undefined, 30)])).data.nutrients.dha).toBeUndefined()
  })
  it('does not overwrite table amounts or fill a damaged nutrient row from a claim', () => {
    for (const [text, expected] of [['DHA 10mg', '10mg'], ['DHA 1?mg', null]] as const) {
      const parsed = parseNutrition(result([...table(), line(text, 10, 240), claim()]))
      expect(parsed.data.nutrients.dha).toBe(expected)
      expect(parsed.data.nutrients.omega_3).toBe('151mg')
    }
  })
})
