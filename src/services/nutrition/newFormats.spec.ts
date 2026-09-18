import { describe, expect, it } from 'vitest'
import fixtures from './fixtures/mobile-ocr-2026-09-18.json'
import { parseNutrition } from './parseNutrition'

// Independently checked against labels/new/new-{1,2,3}.JPG. These are frozen OCR
// replays, not recognition tests. Printed values with damaged OCR remain null.
const expected = {
  'new-1': {
    serving: { serving_size: null, servings_per_container: 'About 13' },
    nutrients: {
      energy: '150kcal', total_fat: '2.5g', saturated_fat: '0.5g', trans_fat: '0g', cholesterol: '0mg',
      sodium: '0mg', carbohydrate: '26g', fiber: '7g', sugars: '1g', protein: '7g', added_sugars: '0g',
      vitamin_d: '0mcg', calcium: '20mg', iron: '2mg', potassium: '201mg',
    },
  },
  'new-2': {
    serving: { serving_size: '(2 slices) 62g', servings_per_container: null },
    nutrients: {
      energy: '178kcal', energy_from_fat: '18kcal', total_fat: '2g', saturated_fat: '1g', trans_fat: '0g',
      cholesterol: '1mg', sodium: '225mg', carbohydrate: '31g', fiber: '3g', soluble_fiber: '1g',
      insoluble_fiber: '2g', sugars: '4g', protein: '9g', vitamin_a: '15%', vitamin_c: '0%',
      calcium: '14%', iron: '23%', vitamin_b1: '6%', vitamin_b2: '0%', vitamin_b3: '12%', folate: '0%',
    },
  },
  'new-3': {
    serving: { serving_size: '(34g)', servings_per_container: '10' },
    nutrients: {
      energy: '65kcal', total_fat: null, saturated_fat: '1.3g', trans_fat: '0g', cholesterol: '18mg',
      sodium: '250mg', carbohydrate: '3.8g', fiber: '0g', sugars: '1.1g', protein: '3g',
      vitamin_d: '0mg', calcium: '0mg', iron: '0mg', potassium: '50mg',
    },
  },
}

describe('September 18 mobile nutrition formats', () => {
  for (const id of Object.keys(fixtures) as Array<keyof typeof fixtures>) {
    it(`${id}: matches image-checked values and deliberate nulls without modifying OCR`, () => {
      const before = JSON.stringify(fixtures[id])
      const parsed = parseNutrition(fixtures[id])
      expect(parsed.data).toEqual(expected[id])
      expect(JSON.stringify(fixtures[id])).toBe(before)
      for (const [key, value] of Object.entries(parsed.data.nutrients)) {
        expect(key).not.toMatch(/_(?:g|mg|mcg|kcal|percent)$/)
        if (value === null) expect(parsed.issues.some((i) => i.field === key)).toBe(true)
        else expect(parsed.evidence[key]?.lineIndexes.length).toBeGreaterThan(0)
      }
      for (const evidence of Object.values(parsed.evidence)) {
        expect(evidence.text).toBe(evidence.lineIndexes.map((i) => fixtures[id].lines[i]!.text).join(' | '))
      }
    })

    it(`${id}: preserves results and evidence after reordering and scaling boxes`, () => {
      const input = fixtures[id]
      const scaled = {
        ...input, sourceSize: { width: input.sourceSize.width / 2, height: input.sourceSize.height / 2 },
        lines: [...input.lines].reverse().map((l) => ({ ...l, bbox: {
          x: l.bbox.x / 2, y: l.bbox.y / 2, width: l.bbox.width / 2, height: l.bbox.height / 2,
        } })),
      }
      const parsed = parseNutrition(scaled)
      expect(parsed.data).toEqual(expected[id])
      for (const evidence of Object.values(parsed.evidence)) {
        expect(evidence.text).toBe(evidence.lineIndexes.map((i) => scaled.lines[i]!.text).join(' | '))
      }
    })
  }

  it('warns about each newly supported OCR name normalization and retains its original evidence', () => {
    for (const [id, key, raw] of [
      ['new-1', 'fiber', 'Dletary Fiber 7g'], ['new-2', 'sodium', 'Sodiun 225mg'], ['new-2', 'iron', 'Irón'],
    ] as const) {
      const parsed = parseNutrition(fixtures[id])
      expect(parsed.evidence[key]?.text).toContain(raw)
      expect(parsed.issues.some((i) => i.field === key && i.message.includes('Normalized'))).toBe(true)
    }
  })

  it('selects only the explicitly headed per-serving micronutrient column and records its basis', () => {
    const parsed = parseNutrition(fixtures['new-2'])
    expect(parsed.data.nutrients.vitamin_a).toBe('15%') // not per-100g 24%
    expect(parsed.data.nutrients.iron).toBe('23%') // not per-100g 37%
    expect(parsed.evidence.vitamin_a?.lineIndexes).toEqual(expect.arrayContaining([26, 28, 29]))
    expect(parsed.issues.some((i) => i.field === 'panel' && /per.serving/i.test(i.message))).toBe(true)
  })

  it('does not substitute per-100g or neighboring percentages when a serving cell is missing or unreadable', () => {
    for (const replacement of [null, 'I5%']) {
      const input = fixtures['new-2']
      const lines = input.lines.flatMap((l, i) => i === 29 ? (replacement ? [{ ...l, text: replacement }] : []) : [l])
      const parsed = parseNutrition({ ...input, lines })
      expect(parsed.data.nutrients.vitamin_a).toBeNull()
      expect(parsed.data.nutrients.vitamin_c).toBe('0%')
    }
  })

  it('keeps rejecting multiple bases when the explicit serving heading is missing', () => {
    const input = fixtures['new-2']
    const parsed = parseNutrition({ ...input, lines: input.lines.filter((_, i) => i !== 26) })
    expect(Object.values(parsed.data.nutrients).every((v) => v === null)).toBe(true)
  })

  it('rejects reversed, overlapping, or vertically unrelated basis headings', () => {
    const input = fixtures['new-2']
    for (const bbox of [
      { ...input.lines[26]!.bbox, x: 900 },
      { ...input.lines[26]!.bbox, x: 700 },
      { ...input.lines[26]!.bbox, y: 1300 },
    ]) {
      const lines = input.lines.map((l, i) => i === 26 ? { ...l, bbox } : l)
      expect(Object.values(parseNutrition({ ...input, lines }).data.nutrients).every((v) => v === null)).toBe(true)
    }
  })

  it('prefers an explicit mass in the selected serving cell and abstains on a damaged mass', () => {
    const input = fixtures['new-2']
    for (const [text, expected] of [['2mg 15%', '2mg'], ['2Omg 15%', null]] as const) {
      const lines = input.lines.map((l, i) => i === 29 ? { ...l, text } : l)
      expect(parseNutrition({ ...input, lines }).data.nutrients.vitamin_a).toBe(expected)
    }
  })

  it('does not guess between competing per-serving cells or detached serving masses', () => {
    const input = fixtures['new-2']
    const extraPercent = { ...input.lines[29]!, text: '16%', bbox: { ...input.lines[29]!.bbox, x: 760, width: 70 } }
    expect(parseNutrition({ ...input, lines: [...input.lines, extraPercent] }).data.nutrients.vitamin_a).toBeNull()
    const sizeInput = fixtures['new-3']
    const extraMass = { ...sizeInput.lines[2]!, text: '(35g)', bbox: { ...sizeInput.lines[2]!.bbox, x: 900 } }
    expect(parseNutrition({ ...sizeInput, lines: [...sizeInput.lines, extraMass] }).data.serving.serving_size).toBeNull()
  })

  it('retains null and an explicit warning for repeated micronutrients in the selected table', () => {
    const input = fixtures['new-2']
    const parsed = parseNutrition({ ...input, lines: [...input.lines, { ...input.lines[28]! }] })
    expect(parsed.data.nutrients.vitamin_a).toBeNull()
    expect(parsed.issues.some((i) => i.field === 'vitamin_a' && /Repeated/.test(i.message))).toBe(true)
  })

  it('does not guess the damaged serving fraction, count, or total-fat unit', () => {
    expect(parseNutrition(fixtures['new-1']).data.serving.serving_size).toBeNull() // printed 1/3 cup (40g)
    expect(parseNutrition(fixtures['new-2']).data.serving.servings_per_container).toBeNull() // Arout6
    const parsed = parseNutrition(fixtures['new-3'])
    expect(parsed.data.nutrients.total_fat).toBeNull() // OCR 3.39, printed 3.3 g
    expect(parsed.data.nutrients.vitamin_d).toBe('0mg') // mg is also printed; do not substitute mcg
  })
})
