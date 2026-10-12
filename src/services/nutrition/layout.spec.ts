import { describe, expect, it } from 'vitest'
import { parseNutrition } from './parseNutrition'
import phone from './fixtures/single-basis-phone.json'
import type { OcrLine, OcrResult } from '../ocr/types'

const line = (text: string, x: number, y: number, width = 140, height = 30): OcrLine => ({ text, bbox: { x, y, width, height } })
const result = (lines: OcrLine[]): OcrResult => ({ text: lines.map((l) => l.text).join('\n'), lines, engine: 'test', sourceSize: { width: 1000, height: 1800 } })
const units = () => [
  line('%RE/RNI*', 700, 20),
  ...[['Total Fat', 'g', '9'], ['Saturated Fat', 'g', '4'], ['Cholesterol', 'mg', '2'], ['Sodium', 'mg', '93']].flatMap(([name, unit, amount], i) => [
    line(name!, 10, 100 + i * 60), line(unit!, 300, 120 + i * 60, 35), line(amount!, 450, 120 + i * 60, 60),
    line('5', 750, 120 + i * 60, 30), // bare daily value, never an amount
  ]),
]

// Sanitized, unmodified OCR from six already-exposed phone scans. These are
// regressions, including the former milk-can holdout, NOT new blind validation.
describe('frozen single-basis phone regressions', () => {
  for (const [id, input] of Object.entries(phone)) it(`${id}: preserves OCR, evidence, order and scale`, () => {
    const original = JSON.stringify(input)
    const parsed = parseNutrition(input)
    const reversed = { ...input, sourceSize: { width: input.sourceSize.width * .5, height: input.sourceSize.height * .5 },
      lines: [...input.lines].reverse().map((l) => ({ ...l, bbox: { x: l.bbox.x * .5, y: l.bbox.y * .5, width: l.bbox.width * .5, height: l.bbox.height * .5 } })) }
    expect(parseNutrition(reversed).data).toEqual(parsed.data)
    expect(JSON.stringify(input)).toBe(original)
    for (const evidence of Object.values(parsed.evidence)) expect(evidence.text).toBe(evidence.lineIndexes.map((i) => input.lines[i]!.text).join(' | '))
  })
  it('recovers printed left-section energy but not damaged Tang gram/microgram tokens', () => {
    expect(parseNutrition(phone['03_tang_orange']).data.nutrients).toMatchObject({ energy: '20kcal', sugars: '3g', fiber: '<1g', vitamin_d: null, carbohydrate: null, protein: null })
  })
  it('reads the detached tub serving size and bullet-prefixed minerals', () => {
    const parsed = parseNutrition(phone['04_blue_tub'])
    expect(parsed.data.serving.serving_size).toBe('1/2 cup (28g)')
    expect(parsed.data.nutrients).toMatchObject({ calcium: '0mg', potassium: '60mg', vitamin_d: null })
  })
  it('reads palm oil vocabulary and flags the narrow carbohydrate-name correction', () => {
    const parsed = parseNutrition(phone['09_golden_fiesta_palm_oil'])
    expect(parsed.data.nutrients).toMatchObject({ energy: '140kcal', energy_from_fat: '140kcal', total_fat: '15g', unsaturated_fat: '8g', omega_9: '6g', omega_6: '2g', carbohydrate: '0g' })
    expect(parsed.issues.some((i) => i.field === 'carbohydrate' && i.message.includes('Normalized'))).toBe(true)
  })
  it('reads the crackers three-section serving block and merged mineral line', () => {
    const parsed = parseNutrition(phone['10_sandwich_crackers'])
    expect(parsed.data.serving).toEqual({ serving_size: '1 Sandwich (13.5g)', servings_per_container: '14' })
    expect(parsed.data.nutrients).toMatchObject({ carbohydrate: '9g', vitamin_d: '0mcg', calcium: '6mg', iron: '0mg', potassium: '17mg' })
  })
  it('recovers narrowly misspelled potato-snack serving labels', () => {
    expect(parseNutrition(phone['12_green_potato_snack']).data.serving).toEqual({ serving_size: '1.06 oz (30g)', servings_per_container: 'about 2' })
  })
  it('reads milk-can explicit unit cells without inferring missing/damaged units or values', () => {
    const parsed = parseNutrition(phone['14_yellow_milk_can'])
    expect(parsed.data.nutrients).toMatchObject({ energy: '121kcal', energy_from_fat: '81kcal', total_fat: '9g', cholesterol: '2mg', sodium: '93mg', carbohydrate: '8g', fiber: '0g', saturated_fat: null, trans_fat: null, sugars: null, protein: null })
    expect(parsed.data.serving.servings_per_container).toBe('About 3')
    const missing = { ...phone['14_yellow_milk_can'], lines: phone['14_yellow_milk_can'].lines.filter((b) => b.text !== '93') }
    expect(parseNutrition(missing).data.nutrients.sodium).toBeNull()
  })
})

describe('single-basis layout interpretation', () => {
  it('splits merged inline micronutrients and calories while preserving original evidence', () => {
    const input = result([line('Vitamin D 0mcg 0% · Calcium 6mg 0%· Iron Omg 0% · Potassium 17mg 0%', 10, 100, 900),
      line('Calories 140 Calories from Fat 140', 10, 160, 700)])
    const original = JSON.stringify(input)
    const parsed = parseNutrition(input)
    expect(parsed.data.nutrients).toMatchObject({ vitamin_d: '0mcg', calcium: '6mg', iron: '0mg', potassium: '17mg', energy: '140kcal', energy_from_fat: '140kcal' })
    expect(parsed.evidence.calcium!.text).toBe(input.lines[0]!.text)
    expect(parsed.evidence.calcium!.lineIndexes).toEqual([0])
    expect(JSON.stringify(input)).toBe(original)
  })

  it('never splits a damaged merged line into plausible replacement values', () => {
    const parsed = parseNutrition(result([line('Vitamin D 1.5唱 30% · Calcium 6mg 0%', 10, 100, 800)]))
    expect(parsed.data.nutrients.vitamin_d).toBeNull()
    expect(parsed.data.nutrients.calcium).toBeUndefined()
  })

  it('rejects duplicate fields even when the duplicate shares one OCR line', () => {
    expect(parseNutrition(result([line('Calcium 6mg 0% · Calcium 8mg 0%', 10, 100, 800)])).data.nutrients.calcium).toBeNull()
  })

  it('supports explicit vocabulary, bullet prefixes and joined label/amount boundaries', () => {
    const parsed = parseNutrition(result(['• Calcium 0mg 0%', '• Potassium 60mg 0%', 'Total Calories 110kcal',
      'Total Fats/Lipids 15g', 'Unsaturated Fat 8g', 'Omega 9 6g', 'Omega3 1135mg', 'DHA209mg', 'Cholesterol23mg', 'TransFat0g', 'Zinc1mg', 'Sugars 4g.']
      .map((t, i) => line(t, 10, 100 + i * 60, 500))))
    expect(parsed.data.nutrients).toMatchObject({ calcium: '0mg', potassium: '60mg', energy: '110kcal', total_fat: '15g',
      unsaturated_fat: '8g', omega_9: '6g', omega_3: '1135mg', dha: '209mg', cholesterol: '23mg', trans_fat: '0g', zinc: '1mg', sugars: '4g' })
    expect(parsed.issues.some((i) => i.field === 'cholesterol' && i.message.includes('Normalized'))).toBe(true)
  })

  it('does not reinterpret damaged numbers, truncated decimals or similar vitamin names', () => {
    const parsed = parseNutrition(result([line('Calories 60', 10, 100), line('Protein 3.', 10, 160), line('Vitamin B13 7mg', 10, 220)]))
    expect(parsed.data.nutrients.energy).toBe('60kcal') // cannot invent the missing leading 1
    expect(parsed.data.nutrients.protein).toBeNull()
    expect(parsed.data.nutrients.vitamin_b1).toBeUndefined()
  })

  it('keeps explicit amounts within their side-by-side section, including small box overlap', () => {
    const parsed = parseNutrition(result([line('Energy', 10, 100), line('20kcal', 200, 100, 70),
      line('Vitamin C', 400, 100), line('45mg', 600, 100, 70),
      line('Total Carbohydrate', 400, 160, 200), line('9g', 598, 160, 50)]))
    expect(parsed.data.nutrients).toMatchObject({ energy: '20kcal', vitamin_c: '45mg', carbohydrate: '9g' })
  })

  it('aligns a complete separate-unit column, excluding bare daily values', () => {
    expect(parseNutrition(result(units())).data.nutrients).toMatchObject({ total_fat: '9g', saturated_fat: '4g', cholesterol: '2mg', sodium: '93mg' })
  })

  it('supports a unit-first amount only inside a verified separate-unit column', () => {
    const input = units().filter((b) => b.text !== '9')
    input.find((b) => b.text === 'g')!.text = 'g 9'
    expect(parseNutrition(result(input)).data.nutrients.total_fat).toBe('9g')
    expect(parseNutrition(result([line('Protein', 10, 100), line('g 9', 300, 100)])).data.nutrients.protein).toBeNull()
  })

  it('does not infer a damaged unit or slide a missing amount from the next row', () => {
    const damaged = units()
    damaged.find((b) => b.text === 'g')!.text = 'a'
    expect(parseNutrition(result(damaged)).data.nutrients.total_fat).toBeNull()
    const missing = units().filter((b) => b.text !== '4')
    const parsed = parseNutrition(result(missing))
    expect(parsed.data.nutrients.saturated_fat).toBeNull()
    expect(parsed.data.nutrients.cholesterol).toBe('2mg')
    expect(parsed.data.nutrients.sodium).toBe('93mg')
  })

  it('abstains when the unit column is incomplete or its daily-value boundary is unknown', () => {
    const incomplete = units()
    incomplete.splice(incomplete.findIndex((b) => b.text === 'g'), 1)
    expect(parseNutrition(result(incomplete)).data.nutrients.total_fat).toBeNull()
    const noHeading = units().filter((b) => !b.text.includes('%'))
    expect(parseNutrition(result(noHeading)).data.nutrients.total_fat).toBeNull()
  })

  it('rejects ambiguous nearby amount cells and contradictory units', () => {
    expect(parseNutrition(result([...units(), line('7', 550, 120, 60)])).data.nutrients.total_fat).toBeNull()
    const contradictory = units()
    contradictory.find((b) => b.text === 'g')!.text = 'mg'
    expect(parseNutrition(result(contradictory)).data.nutrients.total_fat).toBeNull()
  })

  it('retains unit-column data and source indexes under reversal and scaling', () => {
    const input = result(units())
    const reversed = result([...input.lines].reverse().map((l) => ({ ...l, bbox: { x: l.bbox.x * .5, y: l.bbox.y * .5, width: l.bbox.width * .5, height: l.bbox.height * .5 } })))
    reversed.sourceSize = { width: 500, height: 900 }
    const parsed = parseNutrition(reversed)
    expect(parsed.data).toEqual(parseNutrition(input).data)
    for (const evidence of Object.values(parsed.evidence)) expect(evidence.text).toBe(evidence.lineIndexes.map((i) => reversed.lines[i]!.text).join(' | '))
  })
})

describe('serving blocks beside the table', () => {
  const table = () => [line('Nutrition Facts', 10, 0), line('Total Fat 2g', 500, 100), line('Protein 1g', 500, 160)]
  it('reads an inline block below the first nutrient row', () => {
    const parsed = parseNutrition(result([...table(), line('Serving Size: 6 pcs (20.5 g)', 10, 200, 400), line('Servings per Container: 2', 10, 250, 400)]))
    expect(parsed.data.serving).toEqual({ serving_size: '6 pcs (20.5 g)', servings_per_container: '2' })
  })
  it('joins vertically split size and container-count text in the same block', () => {
    const parsed = parseNutrition(result([...table(), line('14 servings', 10, 200), line('per container', 10, 230),
      line('Serving size', 10, 270), line('1 Sandwich (13.5g)', 10, 300, 250)]))
    expect(parsed.data.serving).toEqual({ serving_size: '1 Sandwich (13.5g)', servings_per_container: '14' })
    expect(parsed.evidence['serving.serving_size']!.lineIndexes).toHaveLength(2)
  })
  it('reads a detached household measure without requiring a readable container label', () => {
    const parsed = parseNutrition(result([line('Serving size', 10, 0), line('1/2 cup (28g)', 300, 0, 200), line('Calories 130', 10, 100)]))
    expect(parsed.data.serving.serving_size).toBe('1/2 cup (28g)')
    expect(parsed.data.serving.servings_per_container).toBeNull()
  })
  it('flags narrow serving spelling normalization without changing OCR', () => {
    const input = result([...table(), line('Seving Size 1.06 oz. (30g)', 10, 200, 400), line('Sevings Per Container about 2', 10, 250, 400)])
    const parsed = parseNutrition(input)
    expect(parsed.data.serving).toEqual({ serving_size: '1.06 oz (30g)', servings_per_container: 'about 2' })
    expect(parsed.issues.some((i) => i.message.includes('serving-label spelling'))).toBe(true)
    expect(input.lines[3]!.text).toContain('Seving')
  })
  it('does not return a partial size when it continues with makes/preparation text', () => {
    expect(parseNutrition(result([...table(), line('Serving size 3.0g', 10, 200), line('makes 1/2 cup (125mL)', 10, 230, 400)])).data.serving.serving_size).toBeNull()
  })
  it('rejects duplicate serving labels, multiple size candidates and cross-column nutrient amounts', () => {
    const label = line('Serving size', 10, 200)
    expect(parseNutrition(result([...table(), label, line('Serving size: 50g', 10, 300)])).data.serving.serving_size).toBeNull()
    expect(parseNutrition(result([...table(), label, line('30g', 300, 200), line('40g', 500, 200)])).data.serving.serving_size).toBeNull()
    expect(parseNutrition(result([...table(), label, line('Protein', 300, 200), line('3g', 500, 200)])).data.serving.serving_size).toBeNull()
  })
  it('does not widen serving scope across multiple bases, panels or ingredients', () => {
    for (const blocker of [line('Per 100g', 500, 50), line('Nutrition Facts', 10, 300), line('Ingredients:', 10, 180)]) {
      expect(parseNutrition(result([...table(), blocker, line('Serving size: 50g', 10, 200)])).data.serving.serving_size).toBeNull()
    }
  })
})
