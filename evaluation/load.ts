import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { OcrResult } from '../src/services/ocr/types'
import type { Annotation, EvaluationCase, FieldTruth } from './types'
import { normalize } from './metrics'

export interface SourceDigest { path: string; sha256: string }
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
function requireCondition(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

function validateTruth(truth: unknown): asserts truth is FieldTruth {
  requireCondition(typeof truth === 'string' ? truth.trim().length > 0
    : isObject(truth) && ['absent', 'unreadable', 'unreviewed'].includes(String(truth.status)) && typeof truth.note === 'string' && truth.note.trim(),
  'Invalid truth; null is ambiguous. Use an explicit status with a note.')
}

export function validateAnnotation(value: unknown): asserts value is Annotation {
  requireCondition(isObject(value), 'Annotation must be an object.')
  for (const key of ['id', 'productId', 'cohort', 'provenance']) {
    requireCondition(typeof value[key] === 'string' && value[key].trim(), `Annotation requires ${key}.`)
  }
  requireCondition(['development', 'holdout', 'regression'].includes(String(value.split)), `Invalid split: ${value.id}`)
  requireCondition(Array.isArray(value.tags) && value.tags.every((t) => typeof t === 'string'), `Invalid tags: ${value.id}`)
  requireCondition(isObject(value.fields) && Object.keys(value.fields).length, `Missing fields: ${value.id}`)
  for (const [field, truth] of Object.entries(value.fields)) {
    requireCondition(/^(?:serving\.(?:serving_size|servings_per_container)|[a-z][a-z0-9_]*)$/.test(field), `Invalid field: ${field}`)
    validateTruth(truth)
  }
}

export function validateOcr(value: unknown): asserts value is OcrResult {
  requireCondition(isObject(value) && typeof value.text === 'string' && typeof value.engine === 'string' && Array.isArray(value.lines), 'Invalid OCR result.')
  for (const line of value.lines) {
    requireCondition(isObject(line) && typeof line.text === 'string' && isObject(line.bbox), 'Invalid OCR line.')
    const bbox = line.bbox
    requireCondition(['x', 'y', 'width', 'height'].every((k) => typeof bbox[k] === 'number' && Number.isFinite(bbox[k]))
      && Number(bbox.width) > 0 && Number(bbox.height) > 0, 'Invalid OCR geometry.')
  }
}

export function validateCases(cases: EvaluationCase[]): void {
  requireCondition(cases.length > 0, 'No evaluation cases loaded.')
  const ids = new Set<string>(), splits = new Map<string, string>()
  for (const entry of cases) {
    validateAnnotation(entry.annotation)
    const a = entry.annotation
    requireCondition(!ids.has(a.id), `Duplicate case ID: ${a.id}`)
    ids.add(a.id)
    // Preserve historical splits. Cross-cohort overlaps are exposed in the
    // report, because legacy holdout products may now be mobile regressions.
    const product = `${a.cohort}/${a.productId}`
    requireCondition(!splits.has(product) || splits.get(product) === a.split, `Product split leakage: ${a.productId}`)
    splits.set(product, a.split)
    if (entry.ocr !== null) validateOcr(entry.ocr)
    else requireCondition(entry.error, `Null OCR requires an explicit provider failure: ${a.id}`)
    requireCondition(entry.recordedProcessingMs === undefined || (Number.isFinite(entry.recordedProcessingMs) && entry.recordedProcessingMs >= 0), `Invalid timing: ${a.id}`)
  }
}

export async function loadCases(root: string, legacyDirectory?: string, runFile?: string) {
  const sources: SourceDigest[] = []
  for (const path of ['src/services/nutrition/parseNutrition.ts', 'evaluation/metrics.ts', 'evaluation/load.ts', 'evaluation/types.ts', 'evaluation/report.ts', 'evaluation/cli.ts']) {
    sources.push({ path, sha256: createHash('sha256').update(await readFile(resolve(root, path))).digest('hex') })
  }
  const read = async (path: string) => {
    const bytes = await readFile(resolve(root, path))
    sources.push({ path, sha256: createHash('sha256').update(bytes).digest('hex') })
    return JSON.parse(bytes.toString()) as unknown
  }
  const annotations = await read('evaluation/annotations/mobile.json')
  requireCondition(Array.isArray(annotations), 'Mobile annotations must be an array.')
  const fixtures: Record<string, unknown> = {}
  for (const path of ['src/services/nutrition/fixtures/mobile-ocr.json', 'src/services/nutrition/fixtures/mobile-ocr-2026-09-18.json']) {
    const data = await read(path)
    requireCondition(isObject(data), `Invalid fixtures: ${path}`)
    for (const [id, value] of Object.entries(data)) {
      requireCondition(!(id in fixtures), `Duplicate fixture: ${id}`)
      fixtures[id] = value
    }
  }
  const cases: EvaluationCase[] = annotations.map((a) => {
    validateAnnotation(a)
    const ocr = fixtures[a.id]
    validateOcr(ocr)
    return { annotation: a, ocr }
  })
  requireCondition(Object.keys(fixtures).length === cases.length, 'Every mobile fixture needs an annotation.')
  const notes = [
    'Frozen OCR replay, not a fresh recognition run. No capture or preprocessing changes are evaluated.',
    'All mobile cases were used in parser development and are regression cases; their accuracy is not a generalization estimate.',
    'Missing annotations and legacy nulls are unreviewed, not absent or unreadable. Unscored outputs are reported separately.',
    'Five older mobile annotations inherit prior image review; three September 18 images were rechecked on 2026-10-08.',
    'Negative examples are sparse; false-positive counts must be read with their denominators. There is no representative unreadable-image negative set or independently annotated text-region boxes.',
    'OCR name/value presence is a whole-panel proxy: matches can come from another row or column. Error categories are triage hints, not proven causes.',
    'Serving matches preserve parentheses and household measures; semantically equivalent but differently formatted strings may need annotation review.',
  ]
  if (legacyDirectory) {
    const manifest = await read(`${legacyDirectory}/manifest.json`)
    const run = await read(runFile ?? `${legacyDirectory}/results/latest.json`)
    requireCondition(isObject(manifest) && Array.isArray(manifest.entries), 'Invalid legacy manifest.')
    requireCondition(isObject(run) && Array.isArray(run.images), 'Invalid legacy run.')
    const corrections = await read('evaluation/annotations/legacy-corrections.json')
    requireCondition(Array.isArray(corrections), 'Invalid corrections.')
    for (const correction of corrections) {
      requireCondition(isObject(correction) && typeof correction.image === 'string', 'Correction needs its reviewed image path.')
      const path = correction.image
      sources.push({ path, sha256: createHash('sha256').update(await readFile(resolve(root, path))).digest('hex') })
    }
    const results = new Map<string, Record<string, unknown>>()
    for (const image of run.images) {
      requireCondition(isObject(image) && typeof image.id === 'string' && !results.has(image.id), 'Invalid or duplicate legacy OCR ID.')
      results.set(image.id, image)
    }
    requireCondition(results.size === manifest.entries.length, 'Legacy result/manifest count mismatch.')
    const applied = new Set<string>()
    for (const entry of manifest.entries) {
      requireCondition(isObject(entry) && typeof entry.id === 'string' && typeof entry.annotation === 'string', 'Invalid manifest entry.')
      const a = await read(`${legacyDirectory}/${entry.annotation}`)
      const r = results.get(entry.id)
      requireCondition(isObject(a) && a.id === entry.id && isObject(a.nutrients) && isObject(a.serving) && r, `Missing/mismatched legacy case: ${entry.id}`)
      requireCondition(r.split === entry.split, `Legacy split mismatch: ${entry.id}`)
      const fields: Record<string, FieldTruth> = {}
      for (const [key, value] of Object.entries(a.nutrients)) {
        if (value === null) fields[key] = { status: 'unreviewed', note: 'Legacy null has no explicit absent/unreadable status.' }
        else {
          requireCondition(isObject(value) && typeof value.sourceText === 'string', `Invalid nutrient: ${entry.id}:${key}`)
          fields[key] = value.sourceText
        }
      }
      for (const [key, source] of [['serving_size', 'servingSizeText'], ['servings_per_container', 'servingsPerContainerText']]) {
        const value = a.serving[source!]
        requireCondition(value === null || typeof value === 'string', `Invalid serving truth: ${entry.id}`)
        fields[`serving.${key}`] = value === null ? { status: 'unreviewed', note: 'Legacy null.' } : value
      }
      for (const correction of corrections) {
        requireCondition(isObject(correction) && typeof correction.id === 'string' && typeof correction.field === 'string'
          && typeof correction.before === 'string', 'Invalid correction.')
        validateTruth(correction.after)
        if (correction.id !== entry.id) continue
        const before = fields[correction.field]
        requireCondition(typeof before === 'string' && normalize(before) === normalize(correction.before), `Stale correction: ${entry.id}:${correction.field}`)
        fields[correction.field] = correction.after
        applied.add(`${entry.id}:${correction.field}`)
      }
      const annotation = { id: entry.id, productId: entry.id, split: entry.split, cohort: 'legacy-desktop-replay',
        tags: entry.tags, provenance: 'Owner-verified legacy annotations plus the versioned Phase 1 correction overlay. Targeted review of disputed nutrients and five serving outputs; remaining fields have not received a full fresh visual audit.', fields }
      validateAnnotation(annotation)
      if (r.ocr !== null) validateOcr(r.ocr)
      const timing = isObject(r.metrics) && typeof r.metrics.processingTimeMs === 'number' ? r.metrics.processingTimeMs : undefined
      cases.push({ annotation, ocr: r.ocr, error: typeof r.error === 'string' ? r.error : undefined, recordedProcessingMs: timing })
    }
    requireCondition(applied.size === corrections.length, 'Not all legacy corrections applied.')
    notes.push('Legacy development/holdout/regression splits are preserved. The holdout was inspected in earlier work and is not a new blind test.',
      'Legacy metrics are provisional: targeted image review covers the correction overlay and five serving outputs; remaining inherited annotations still need a full image audit.',
      'Label 019 serving size is marked unreadable because glare obscures a digit; a populated partial string counts as an unsupported output. This single field does not establish performance on unreadable photos.',
      'Stored desktop processing times exclude initialization and are not current phone latency. Mobile fixtures contain no timing.',
      'The supplemental re-encoded label-030 desktop run is excluded to avoid counting the same product/crop repeatedly.')
  } else notes.push('Legacy local corpus not requested; this report covers the portable mobile regression fixtures only.')
  validateCases(cases)
  return { cases, sources, notes }
}
