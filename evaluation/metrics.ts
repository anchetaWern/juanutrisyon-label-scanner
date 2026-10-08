import { parseNutrition, type NutritionExtraction } from '../src/services/nutrition/parseNutrition'
import type { CaseResult, EvaluationCase, FieldResult, FieldTruth, Outcome } from './types'

export const METRIC_VERSION = 'field-exact-v1'

// Formatting normalization only: preserve fractions, parentheses, qualifiers,
// digits and units. No OCR spelling repair, rounding or unit conversion.
export function normalize(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[μµ]g/g, 'mcg')
    .replace(/\bless\s+than\s*/g, '<').replace(/\s+/g, '')
}

const names: Record<string, string[]> = {
  energy: ['calories', 'energy'], energy_from_fat: ['calories from fat'],
  total_fat: ['total fat'], saturated_fat: ['saturated fat', 'saturates'], trans_fat: ['trans fat'],
  cholesterol: ['cholesterol', 'cholestrol'], sodium: ['sodium'],
  carbohydrate: ['total carbohydrate', 'total carbohydrates', 'carbohydrate', 'carbohydrates', 'carbs'],
  fiber: ['dietary fiber', 'dietary fibre', 'fiber', 'fibre'], sugars: ['total sugars', 'sugars', 'sugar'],
  added_sugars: ['added sugars', 'added sugar'], protein: ['protein'],
  'serving.serving_size': ['serving size'],
  'serving.servings_per_container': ['servings per container', 'serving per container'],
}
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function nameInOcr(field: string, lines: string[]): boolean {
  const aliases = names[field] ?? (field.startsWith('vitamin_')
    ? [`vitamin ${field.slice(8)}`, `vit. ${field.slice(8)}`] : [field.replaceAll('_', ' ')])
  return lines.some((line) => aliases.some((alias) =>
    new RegExp(`(?<![a-z0-9])${escape(alias).replaceAll(' ', '\\s+')}(?![a-z0-9])`, 'i').test(line)))
}

// Whole-panel presence is a diagnostic proxy, NOT row association or detection
// recall. Amount tokens are bounded: 0g cannot match 10g, 0.0g or <0g.
export function valueInOcr(field: string, expected: string, lines: string[]): boolean {
  if (field.startsWith('serving.')) {
    const target = escape(expected.normalize('NFKC').toLowerCase().trim())
      .replace(/\s+/g, '\\s*').replace(/(\d)(?=ml|g\b)/g, '$1\\s*')
    return lines.some((line) => new RegExp(`(?<![a-z0-9.,/<>+\\-])${target}(?![a-z0-9.,/%])`)
      .test(line.normalize('NFKC').toLowerCase()))
  }
  const amounts = lines.flatMap((line) => {
    const prepared = line.normalize('NFKC').toLowerCase().replace(/[μµ]g/g, 'mcg').replace(/\bless\s+than\s*/g, '<')
    return [...prepared.matchAll(/(?<![a-z0-9.,/<>+\-])(?:[<>]\s*)?\d+(?:\.\d+)?\s*(?:kcal|kj|mcg|mg|g|%)(?![a-z0-9.,/%])/g)]
      .map((match) => normalize(match[0]))
  })
  if (amounts.includes(normalize(expected))) return true
  if (field === 'energy' || field === 'energy_from_fat') {
    const kcal = expected.match(/^(\d+(?:\.\d+)?)\s*kcal$/i)
    // Calories often omits its unit. Keep numeric boundaries and do not match a
    // number attached to a different unit; this still cannot establish its row.
    if (kcal) return lines.some((line) => new RegExp(`(?<![a-z0-9.,/<>+\\-])${escape(kcal[1]!)}(?![a-z0-9.,/%]|\\s*(?:g|mg|mcg|%))`, 'i').test(line))
  }
  return false
}

export function scoreField(truth: FieldTruth, predicted: string | null): Outcome {
  if (typeof truth === 'string') return predicted === null ? 'missing'
    : normalize(truth) === normalize(predicted) ? 'correct' : 'wrong'
  if (truth.status === 'unreviewed') return 'unscored'
  return predicted === null ? 'correct-abstention' : 'false-positive'
}

export function evaluateCase(input: EvaluationCase, parsed?: NutritionExtraction): CaseResult {
  const extraction = parsed ?? parseNutrition(input.ocr ?? { text: '', lines: [], engine: 'failed' })
  const predictions: Record<string, string | null> = {
    ...extraction.data.nutrients,
    ...Object.fromEntries(Object.entries(extraction.data.serving).map(([key, value]) => [`serving.${key}`, value])),
  }
  const rawLines = input.ocr?.lines.map((line) => line.text) ?? []
  const fields = [...new Set([...Object.keys(input.annotation.fields), ...Object.keys(predictions)])].sort().map((field): FieldResult => {
    const truth = input.annotation.fields[field] ?? { status: 'unreviewed', note: 'No ground-truth annotation for this field.' }
    const predicted = predictions[field] ?? null
    const outcome = scoreField(truth, predicted)
    const namePresent = typeof truth === 'string' ? nameInOcr(field, rawLines) : null
    const valuePresent = typeof truth === 'string' ? valueInOcr(field, truth, rawLines) : null
    const warnings = extraction.issues.filter((issue) => issue.field === field || issue.field === 'panel').map((issue) => issue.message)
    let triage: string | null = null
    if (outcome === 'wrong') triage = 'wrong-value-or-association'
    if (outcome === 'false-positive') triage = typeof truth !== 'string' && truth.status === 'unreadable'
      ? 'value-on-unreadable-field' : 'value-on-absent-field'
    if (outcome === 'missing') {
      if (!input.ocr) triage = 'provider-failure'
      else if (warnings.some((w) => w.includes('extraction is disabled'))) triage = 'unsupported-nutrition-basis'
      else if (warnings.some((w) => w.includes('Repeated nutrient'))) triage = 'duplicate-row-abstention'
      else if (namePresent && valuePresent) triage = 'abstention-with-name-and-value-somewhere-in-ocr'
      else if (namePresent) triage = 'expected-value-not-found-in-ocr'
      else if (valuePresent) triage = 'expected-name-not-found-in-ocr'
      else triage = 'expected-name-and-value-not-found-in-ocr'
    }
    return { caseId: input.annotation.id, field, truth, predicted, outcome, namePresent, valuePresent, triage,
      evidence: extraction.evidence[field] ?? null, warnings }
  })
  return { annotation: input.annotation, parserVersion: extraction.parserVersion, providerFailed: input.ocr === null,
    error: input.error ?? null, recordedProcessingMs: input.recordedProcessingMs ?? null, fields }
}

const ratio = (n: number, d: number) => d ? n / d : null
export function summarize(fields: FieldResult[]) {
  const count = (outcome: Outcome) => fields.filter((f) => f.outcome === outcome).length
  const correct = count('correct'), wrong = count('wrong'), missing = count('missing')
  const falsePositive = count('false-positive'), correctAbstention = count('correct-abstention')
  const readable = correct + wrong + missing
  const unscored = count('unscored')
  const nameScored = fields.filter((f) => f.namePresent !== null)
  const valueScored = fields.filter((f) => f.valuePresent !== null)
  return {
    readable, correct, wrong, missing, falsePositive, correctAbstention, unscored,
    unscoredPredictions: fields.filter((f) => f.outcome === 'unscored' && f.predicted !== null).length,
    exactRecall: ratio(correct, readable),
    precision: ratio(correct, correct + wrong + falsePositive),
    coverage: ratio(correct + wrong, readable), abstentionRate: ratio(missing, readable),
    falsePositiveRate: ratio(falsePositive, falsePositive + correctAbstention),
    namePresence: { matched: nameScored.filter((f) => f.namePresent).length, total: nameScored.length },
    valuePresence: { matched: valueScored.filter((f) => f.valuePresent).length, total: valueScored.length },
  }
}

export function aggregate(cases: CaseResult[]) {
  const all = cases.flatMap((c) => c.fields)
  const timings = cases.flatMap((c) => c.recordedProcessingMs === null ? [] : [c.recordedProcessingMs]).sort((a, b) => a - b)
  return {
    cases: cases.length, providerFailures: cases.filter((c) => c.providerFailed).length,
    all: summarize(all), nutrients: summarize(all.filter((f) => !f.field.startsWith('serving.'))),
    serving: summarize(all.filter((f) => f.field.startsWith('serving.'))),
    storedProcessingMs: { samples: timings.length, mean: timings.length ? timings.reduce((a, b) => a + b, 0) / timings.length : null,
      p95: timings.length ? timings[Math.ceil(timings.length * 0.95) - 1]! : null },
  }
}

export function buildReport(cases: CaseResult[]) {
  const groups = (key: (c: CaseResult) => string[]) => Object.fromEntries(
    [...new Set(cases.flatMap(key))].sort().map((value) => [value, aggregate(cases.filter((c) => key(c).includes(value)))]))
  const failures = cases.flatMap((c) => c.fields).filter((f) => f.triage !== null)
  const rankedErrors = [...new Set(failures.map((f) => f.triage!))].map((category) => ({
    category, count: failures.filter((f) => f.triage === category).length,
    examples: failures.filter((f) => f.triage === category).slice(0, 5).map((f) => `${f.caseId}:${f.field}`),
  })).sort((a, b) => b.count - a.count || a.category.localeCompare(b.category))
  return {
    metricVersion: METRIC_VERSION, mode: 'frozen-ocr-replay',
    parserVersions: [...new Set(cases.map((c) => c.parserVersion))],
    detectionRecall: { value: null, reason: 'No independently annotated text regions; presence proxies do not measure detector recall.' },
    crossCohortSplitOverlaps: [...new Set(cases.map((c) => c.annotation.productId))].flatMap((productId) => {
      const related = cases.filter((c) => c.annotation.productId === productId)
      return new Set(related.map((c) => c.annotation.split)).size > 1 ? [{ productId,
        cases: related.map((c) => ({ id: c.annotation.id, cohort: c.annotation.cohort, split: c.annotation.split })),
        note: 'Historical holdout product is exposed in another cohort. Do not treat this as a blind holdout.',
      }] : []
    }),
    byCohort: groups((c) => [c.annotation.cohort]),
    bySplit: groups((c) => [`${c.annotation.cohort}/${c.annotation.split}`]),
    byTag: groups((c) => c.annotation.tags.map((tag) => `${c.annotation.cohort}/${tag}`)),
    byField: Object.fromEntries([...new Set(cases.flatMap((c) => c.fields.map((f) => f.field)))].sort()
      .map((field) => [field, summarize(cases.flatMap((c) => c.fields.filter((f) => f.field === field)))])),
    rankedErrors, cases,
  }
}
