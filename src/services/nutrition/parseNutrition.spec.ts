import { describe, expect, it } from 'vitest'
import fixtures from './fixtures/mobile-ocr.json'
import { parseNutrition } from './parseNutrition'
import type { OcrLine, OcrResult } from '../ocr/types'

const line = (text: string, x: number, y: number, width = 140, height = 30): OcrLine => ({ text, bbox: { x, y, width, height } })
const result = (lines: OcrLine[]): OcrResult => ({ text: lines.map((l) => l.text).join('\n'), lines, engine: 'test', sourceSize: { width: 1000, height: 1800 } })

// Values independently read from the supplied label images. Nulls are deliberate abstentions,
// not the actual printed value. These tests measure parsing frozen OCR, not OCR recognition quality.
const expectedNutrients = {
  IMG_3584: {
    energy: '80kcal', total_fat: '1.5g', saturated_fat: '1g', trans_fat: '0g', cholesterol: '20mg',
    sodium: '440mg', carbohydrate: '10g', fiber: '1g', sugars: '4g', protein: '7g', added_sugars: '2g',
    vitamin_d: '0mcg', calcium: '120mg', iron: '0.3mg', potassium: '10mg',
  },
  IMG_3585: {
    energy: '170kcal', energy_from_fat: null, total_fat: '8g', saturated_fat: null, trans_fat: null,
    cholesterol: '15mg', sodium: '870mg', carbohydrate: null, fiber: 'Less than 1g', sugars: '5g', protein: '8g',
    vitamin_a: '0%', vitamin_b1: '0%', vitamin_b2: '0%', calcium: '25%', iron: '2%', vitamin_d: '20%',
  },
  IMG_3586: {
    energy: '180kcal', total_fat: '0g', saturated_fat: '0g', trans_fat: '0g', cholesterol: '0mg', sodium: '0mg',
    carbohydrate: '40g', fiber: '2g', sugars: '0g', added_sugars: '0g', protein: '5g', vitamin_d: '0mcg',
    calcium: '4mg', iron: '3mg', potassium: '65mg', vitamin_a: '54mcg',
  },
  IMG_3587: {
    energy: '133kcal', energy_from_fat: '93kcal', total_fat: '10g', saturated_fat: '5g', trans_fat: '0g',
    cholesterol: '7mg', sodium: '77mg', carbohydrate: '8g', fiber: '2g', sugars: '7g', protein: '2g',
  },
  IMG_3588: {
    energy: '6kcal', total_fat: '0g', saturated_fat: '0g', trans_fat: '0g', cholesterol: '0mg', sodium: '194mg',
    carbohydrate: '3g', fiber: '0g', sugars: '0g', protein: '0g', vitamin_b3: '20mg', vitamin_b5: '4.8mg',
    vitamin_b6: '1mg', vitamin_b12: '1.8μg', taurine: '1015mg', l_carnitine_l_tartrate: '36mg', caffeine: '70mg',
  },
}

describe('mobile nutrition regression cases', () => {
  for (const id of Object.keys(fixtures) as Array<keyof typeof fixtures>) {
    it(`${id}: matches supported values without modifying OCR`, () => {
      const before = JSON.stringify(fixtures[id])
      const parsed = parseNutrition(fixtures[id])
      expect(parsed.data.nutrients).toEqual(expectedNutrients[id])
      expect(JSON.stringify(fixtures[id])).toBe(before)
      for (const [key, value] of Object.entries(parsed.data.nutrients)) {
        expect(key).not.toMatch(/_(?:g|mg|mcg|kcal|percent)$/)
        if (value !== null) {
          expect(typeof value).toBe('string')
          expect(parsed.evidence[key]?.lineIndexes.length).toBeGreaterThan(0)
        }
      }
    })

    it(`${id}: is independent of OCR array order and image scale`, () => {
      const input = fixtures[id]
      const scaled = {
        ...input,
        sourceSize: { width: input.sourceSize.width * 0.5, height: input.sourceSize.height * 0.5 },
        lines: [...input.lines].reverse().map((l) => ({ ...l, bbox: { x: l.bbox.x * 0.5, y: l.bbox.y * 0.5, width: l.bbox.width * 0.5, height: l.bbox.height * 0.5 } })),
      }
      expect(parseNutrition(scaled).data).toEqual(parseNutrition(input).data)
    })
  }

  it('preserves readable serving strings and leaves garbled/missing serving text unresolved', () => {
    expect(parseNutrition(fixtures.IMG_3587).data.serving).toEqual({ serving_size: '125 mL', servings_per_container: '2.8' })
    expect(parseNutrition(fixtures.IMG_3585).data.serving).toEqual({ serving_size: '1/5 bag (100 g)', servings_per_container: '5' })
    for (const id of ['IMG_3584', 'IMG_3586', 'IMG_3588'] as const) {
      expect(parseNutrition(fixtures[id]).data.serving).toEqual({ serving_size: null, servings_per_container: null })
    }
  })

  it('does not replace the unreadable 16 g / 2 g with guesses or daily percentages', () => {
    const parsed = parseNutrition(fixtures.IMG_3585)
    expect(parsed.data.nutrients.carbohydrate).toBeNull()
    expect(parsed.data.nutrients.saturated_fat).toBeNull()
    expect(parsed.data.nutrients.energy_from_fat).toBeNull()
    expect(parsed.issues.some((i) => i.field === 'panel')).toBe(true)
    expect(parsed.data.nutrients.sodium).not.toBe('2400mg')
    expect(parsed.data.nutrients.total_fat).not.toBe('65g')
  })

  it('records normalization without rewriting the source or hiding the correction', () => {
    const parsed = parseNutrition(fixtures.IMG_3588)
    expect(parsed.evidence.taurine?.text).toContain('1015mmg')
    expect(parsed.issues.some((i) => i.field === 'taurine' && i.message.includes('Normalized'))).toBe(true)
    expect(parsed.data.nutrients.vitamin_b3).toBe('20mg') // not 125%
  })

  it('does not shift bare-number rows when a value is missing', () => {
    const ocr = fixtures.IMG_3587
    const incomplete = { ...ocr, lines: ocr.lines.filter((l) => l.text !== '77') }
    const parsed = parseNutrition(incomplete)
    expect(parsed.data.nutrients.sodium).toBeNull()
    expect(parsed.data.nutrients.cholesterol).toBeNull()
    expect(parsed.data.nutrients.carbohydrate).toBeNull()
  })
})

describe('conservative extraction rules', () => {
  it('does not parse the flattened text without geometry', () => {
    expect(parseNutrition({ ...result([]), text: 'Protein 7g' }).data.nutrients.protein).toBeNull()
  })

  it('uses explicit units and percentages, retaining qualifiers', () => {
    const parsed = parseNutrition(result([
      line('Serving Size: 30 g', 0, 0), line('About 9 servings per container', 0, 40, 400),
      line('Total Fat 6g 8%', 0, 100), line('Dietary Fiber Less than 1 g', 0, 160, 400),
      line('Niacin 4%', 0, 220), line('Vitamin B12 2.4mcg', 0, 280), line('Protein 2g', 0, 340),
    ]))
    expect(parsed.data.serving).toEqual({ serving_size: '30 g', servings_per_container: 'About 9' })
    expect(parsed.data.nutrients).toMatchObject({ total_fat: '6g', fiber: 'Less than 1g', niacin: '4%', vitamin_b12: '2.4mcg', protein: '2g' })
  })

  it('does not infer missing mass units', () => {
    expect(parseNutrition(result([line('Protein 8', 0, 100)])).data.nutrients.protein).toBeNull()
  })

  it('rejects ambiguous multiple amount columns', () => {
    const parsed = parseNutrition(result([
      line('Per 100g', 500, 0), line('Per serving', 750, 0), line('Total Fat 8g', 0, 100), line('Protein 3g', 0, 150),
    ]))
    expect(Object.values(parsed.data.nutrients).every((v) => v === null)).toBe(true)
    expect(parsed.issues.some((i) => i.message.includes('nutrition bases'))).toBe(true)
  })

  it('rejects duplicate nutrients instead of taking the last panel', () => {
    const parsed = parseNutrition(result([line('Protein 3g', 0, 100), line('Protein 9g', 0, 400)]))
    expect(parsed.data.nutrients.protein).toBeNull()
    expect(parsed.issues.some((i) => i.message.includes('Repeated'))).toBe(true)
  })

  it('does not assign the same value to two nearby labels', () => {
    const parsed = parseNutrition(result([line('Protein', 0, 100), line('Sugars', 0, 130), line('3g', 500, 115)]))
    const assigned = [parsed.data.nutrients.protein, parsed.data.nutrients.sugars].filter((v) => v !== null)
    expect(assigned.length).toBeLessThanOrEqual(1)
  })

  it('does not replace an unreadable mass with a percent-only value', () => {
    const parsed = parseNutrition(result([line('Calcium 12Omg', 0, 100), line('10%', 600, 100)]))
    expect(parsed.data.nutrients.calcium).toBeNull()
  })

  it('does not borrow a percentage from a preceding unrecognized vitamin row', () => {
    const parsed = parseNutrition(result([
      line('Vitamin Bl', 100, 100, 300, 80), line('0%', 800, 110, 70, 60),
      line('Vitamin B2', 100, 160, 300, 80), line('19X', 800, 180, 80, 60),
    ]))
    expect(parsed.data.nutrients.vitamin_b2).toBeNull()
  })

  it('ignores invalid/zero-size geometry', () => {
    const parsed = parseNutrition(result([line('Protein 3g', NaN, 100), line('Sodium 9mg', 0, 200, 0)]))
    expect(parsed.data.nutrients.protein).toBeNull()
    expect(parsed.data.nutrients.sodium).toBeNull()
  })
})
