import type { NutritionExtraction } from './parseNutrition'
import type { OcrResult } from '../ocr/types'
import { calculateWarnings, classifyHighlights, normalizeNutrient, referencePercentage, type ReferenceSet } from './calculations'

export type LabelBasis = 'unknown' | 'serving' | '100g' | '100ml'
export type Portion = 'source' | 'serving' | '100' | 'container' | 'custom'
export interface Reading { key: string; name: string; amount: string; unit: string; original: string | null }
export interface AssessmentDraft {
  basis: LabelBasis
  servingSize: string
  servingsPerContainer: string
  readings: Reading[]
}

const names: Record<string, string> = {
  energy: 'calories', energy_from_fat: 'calories from fat', total_fat: 'total fat', saturated_fat: 'saturated fat',
  trans_fat: 'trans fat', carbohydrate: 'total carbohydrates', fiber: 'dietary fiber', sugars: 'sugar', added_sugars: 'added sugar',
  thiamine: 'vitamin b1', riboflavin: 'vitamin b2', pantothenic_acid: 'vitamin b5', vitamin_b7: 'biotin',
  omega_3: 'omega-3', omega_6: 'omega-6', omega_9: 'omega-9',
}
const labels: Record<string, string> = {
  calories: 'Calories', 'calories from fat': 'Calories from fat', 'total carbohydrates': 'Total carbohydrates',
  sugar: 'Total sugar', 'added sugar': 'Added sugar', 'vitamin b1': 'Vitamin B1 (thiamine)',
  'vitamin b2': 'Vitamin B2 (riboflavin)', 'vitamin b3': 'Vitamin B3 (niacin equivalents)',
  'vitamin b5': 'Vitamin B5', 'vitamin b6': 'Vitamin B6', 'vitamin b9': 'Vitamin B9 (folate)', 'vitamin b12': 'Vitamin B12',
}
const minerals = new Set(['calcium', 'iron', 'potassium', 'sodium', 'magnesium', 'zinc', 'phosphorus', 'iodine', 'selenium', 'copper', 'manganese', 'chloride', 'chromium', 'molybdenum', 'fluoride'])
const macros = new Set(['total fat', 'saturated fat', 'trans fat', 'unsaturated fat', 'monounsaturated fat', 'polyunsaturated fat', 'cholesterol', 'total carbohydrates', 'dietary fiber', 'soluble fiber', 'insoluble fiber', 'sugar', 'added sugar', 'protein'])
export function nutrientLabel(name: string): string { return labels[name] ?? name.replace(/\b\w/g, (letter) => letter.toUpperCase()) }
export function nutrientGroup(name: string): string {
  return name.startsWith('calories') ? 'Energy' : macros.has(name) ? 'Macronutrients'
    : name.startsWith('vitamin ') || ['niacin', 'biotin', 'folate', 'folic acid'].includes(name) ? 'Vitamins'
      : minerals.has(name) ? 'Minerals' : 'Other nutrients'
}
export function defaultUnit(key: string): string {
  return key.startsWith('energy') ? 'kcal' : ['sodium', 'cholesterol', 'calcium', 'iron', 'potassium'].includes(key) ? 'mg'
    : key.startsWith('vitamin') ? 'mcg' : 'g'
}
export function inferLabelBasis(result: OcrResult, extraction: NutritionExtraction): LabelBasis {
  if (extraction.issues.some((issue) => /nutrition bases|multiple.*columns/i.test(issue.message))) return 'unknown'
  const bases = new Set<LabelBasis>()
  for (const line of result.lines) {
    if (/daily|reference|calorie diet/i.test(line.text)) continue
    if (/\bper\s*100\s*g\b/i.test(line.text)) bases.add('100g')
    if (/\bper\s*100\s*ml\b/i.test(line.text)) bases.add('100ml')
    if (/\b(?:amount\s+per\s+serving|per\s+serving)\b/i.test(line.text)) bases.add('serving')
  }
  return bases.size === 1 ? [...bases][0]! : 'unknown'
}
export function createAssessmentDraft(extraction: NutritionExtraction, result: OcrResult): AssessmentDraft {
  return {
    basis: inferLabelBasis(result, extraction),
    servingSize: extraction.data.serving.serving_size ?? '',
    servingsPerContainer: extraction.data.serving.servings_per_container ?? '',
    readings: Object.entries(extraction.data.nutrients).map(([key, original]) => {
      const match = original?.match(/^(.*?)\s*(kcal|kj|mcg(?:\s+RE)?|mg|[μµ]g(?:\s+RE)?|g|IU|%)$/i)
      return { key, name: names[key] ?? key.replace(/_/g, ' '), amount: match?.[1]?.trim() ?? original ?? '',
        unit: match?.[2] ?? defaultUnit(key), original }
    }),
  }
}

function positive(value: string): number | null {
  if (!/^\d+(?:\.\d+)?$/.test(value.trim())) return null
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}
export function servingMeasure(size: string): { amount: number; unit: 'g' | 'mL' } | null {
  const measures = [...size.matchAll(/(?:^|[\s(])(\d+(?:\.\d+)?)\s*(g|ml)\b/gi)]
  if (measures.length !== 1) return null
  const amount = positive(measures[0]![1]!)
  return amount === null ? null : { amount, unit: measures[0]![2]!.toLowerCase() === 'g' ? 'g' : 'mL' }
}
export function portionOptions(draft: AssessmentDraft): Array<{ value: Portion; title: string; factor: number }> {
  const sourceTitle = draft.basis === 'serving' ? 'Per serving' : draft.basis === '100g' ? 'Per 100 g'
    : draft.basis === '100ml' ? 'Per 100 mL' : 'As read on label'
  const options: Array<{ value: Portion; title: string; factor: number }> = [{ value: 'source', title: sourceTitle, factor: 1 }]
  if (draft.basis === 'unknown') return options
  const measure = servingMeasure(draft.servingSize)
  const sameDimension = measure && (draft.basis === 'serving' || (draft.basis === '100g' ? measure.unit === 'g' : measure.unit === 'mL'))
  const servingFactor = draft.basis === 'serving' ? 1 : sameDimension ? measure.amount / 100 : null
  if (draft.basis !== 'serving' && servingFactor !== null) options.push({ value: 'serving', title: 'Per serving', factor: servingFactor })
  if (draft.basis === 'serving' && measure) options.push({ value: '100', title: `Per 100 ${measure.unit}`, factor: 100 / measure.amount })
  const count = positive(draft.servingsPerContainer)
  if (count !== null && servingFactor !== null) options.push({ value: 'container', title: 'Per container', factor: servingFactor * count })
  options.push({ value: 'custom', title: 'Explore', factor: 1 })
  return options
}

export function assessNutrition(draft: AssessmentDraft, references: ReferenceSet | null, portion: Portion = 'source', customMultiplier = '1') {
  const option = portionOptions(draft).find((item) => item.value === portion) ?? portionOptions(draft)[0]!
  const factor = option.value === 'custom' ? positive(customMultiplier) : option.factor
  const basisKnown = draft.basis !== 'unknown'
  const rows = draft.readings.map((reading) => {
    const node = normalizeNutrient({ name: reading.name, amount: reading.amount, unit: reading.unit })
    const exact = ['known', 'explicit_zero'].includes(node.state) && node.value !== null && factor !== null
    const value = exact ? node.value! * factor! : null
    const safeValue = value !== null && Number.isFinite(value) ? value : null
    const scaled = { ...node, value: safeValue, state: safeValue === null ? node.state === 'known' ? 'invalid' : node.state : node.state }
    return { ...reading, node: scaled, value: safeValue, label: nutrientLabel(reading.name), group: nutrientGroup(reading.name),
      percentage: basisKnown && references && safeValue !== null ? referencePercentage(scaled, references.records[node.nutrient_id]).percentage : null,
      edited: `${reading.amount}${reading.unit}` !== (reading.original ?? '') && reading.amount !== '',
    }
  })
  const amount = (name: string): number | null => {
    const matches = rows.filter((row) => row.node.nutrient_id === name)
    return matches.length === 1 ? matches[0]!.value : null
  }
  const warningResults = calculateWarnings({
    energyKcal: basisKnown ? amount('calories') : null,
    totalFatG: amount('total fat'), saturatedFatG: amount('saturated fat'), totalSugarG: amount('sugar'), sodiumMg: amount('sodium'),
  })
  const warnings = ['totalFat', 'saturatedFat', 'sugar', 'sodium'].map(key => warningResults[key]!)
  const highWarnings = warnings.filter((warning) => warning.status === 'high')
  const unknownWarnings = warnings.filter((warning) => warning.status === 'unknown')
  const macroAmounts = [{ name: 'total carbohydrates', label: 'Carbs', factor: 4, key: 'carbs' },
    { name: 'total fat', label: 'Fat', factor: 9, key: 'fat' }, { name: 'protein', label: 'Protein', factor: 4, key: 'protein' }]
    .map((macro) => ({ ...macro, amount: amount(macro.name), kcal: amount(macro.name) === null ? null : amount(macro.name)! * macro.factor }))
  const completeMacros = macroAmounts.every((macro) => macro.kcal !== null && Number.isFinite(macro.kcal))
  const macroEnergy = completeMacros ? macroAmounts.reduce((sum, macro) => sum + macro.kcal!, 0) : null
  const highlights = basisKnown && references ? classifyHighlights(rows.map((row) => row.node), references) : null
  return { rows, calories: amount('calories'), factor, basisKnown, portionTitle: option.value === 'custom' ? `${customMultiplier} × label amount` : option.title,
    warnings, highWarnings, unknownWarnings, highlights, macroEnergy,
    macros: macroAmounts.map((macro) => ({ ...macro, percentage: macroEnergy && macro.kcal !== null ? macro.kcal / macroEnergy * 100 : null })) }
}
