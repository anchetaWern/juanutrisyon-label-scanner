import { readFile, readdir, realpath } from 'node:fs/promises'
import { resolve, relative, isAbsolute, join } from 'node:path'
import sharp from 'sharp'
import { parseNutrition } from '../../src/services/nutrition/parseNutrition'
import { PADDLE_OCR_CONFIGS, PADDLE_PREDICTION_DEFAULTS } from '../../src/services/ocr/PaddleOcrEngine'
import { PRODUCTION_PREPROCESSING_CONFIG } from '../../src/services/image/preprocessForOcr'
import { validateAnnotation, validateOcr } from '../load'
import { sha256 } from '../pilot/dataset'
import type { Prepared } from '../pilot/runner'
import type { PilotDataset, PilotRun } from '../pilot/types'
import { selectCandidates } from './candidates'
import { mapRectangle, paddedCrop, validBox } from './geometry'
import { scoreReading } from './scoring'
import { SCALES, type Candidate, type Plan, type ReviewManifest } from './types'

export const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n'
export async function contained(root: string, path: string): Promise<string> {
  const absolute = await realpath(resolve(root, path)), base = await realpath(root)
  const rel = relative(base, absolute)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Input must be a file/directory inside the repository.')
  return absolute
}
export async function sourceDigests(root: string) {
  const files = (await readdir(join(root, 'evaluation/experiment-a'))).filter((p) => /\.(ts|html)$/.test(p) && !p.endsWith('.spec.ts')).sort()
    .map((p) => `evaluation/experiment-a/${p}`)
  files.push('package.json', 'package-lock.json', 'vite.config.ts', 'src/services/nutrition/parseNutrition.ts', 'evaluation/metrics.ts',
    'evaluation/load.ts', 'evaluation/types.ts', 'src/services/ocr/PaddleOcrEngine.ts', 'src/services/ocr/types.ts',
    'src/services/image/preprocessForOcr.ts', 'src/utils/image.ts', 'evaluation/pilot/dataset.ts')
  return Promise.all(files.map(async (path) => ({ path, sha256: sha256(await readFile(resolve(root, path))) })))
}
async function exposedProducts(root: string) {
  const ids = new Set<string>()
  const pilot = JSON.parse(await readFile(join(root, 'evaluation/datasets/phase-2-pilot.json'), 'utf8')) as { entries: Array<{ productId: string }> }
  pilot.entries.forEach((e) => ids.add(e.productId))
  for (const file of ['evaluation/annotations/mobile.json']) {
    const entries = JSON.parse(await readFile(join(root, file), 'utf8')) as Array<{ productId: string }>
    entries.forEach((e) => ids.add(e.productId))
  }
  return ids
}
function validateReview(c: Candidate, baseline: Plan['images'][number]['baseline']) {
  if (!['pending', 'verified', 'excluded'].includes(c.review) || !['none', 'detection', 'recognition', 'association', 'basis', 'unreadable', 'unknown'].includes(c.failureBefore)
    || !c.truth || !['readable', 'unreadable', 'unreviewed'].includes(c.truth.status) || !c.truth.provenance?.trim()
    || !c.lineIndexes.length || new Set(c.lineIndexes).size !== c.lineIndexes.length || c.lineIndexes.some((i) => !Number.isInteger(i) || !baseline.lines[i])) throw new Error(`Invalid region review: ${c.id}`)
  if (c.field !== null && !/^[a-z][a-z0-9_]*$/.test(c.field)) throw new Error('Candidate fields must be nutrients; serving parsing is out of scope.')
  if (c.truth.status === 'readable') {
    if (typeof c.truth.numeric !== 'string' || !/^[<>]?\d+(?:\.\d+)?$/.test(c.truth.numeric)
      || (c.truth.unit !== null && (typeof c.truth.unit !== 'string' || !/^(?:g|mg|mcg|[µμ]g(?:\s+RE)?|kcal|kJ|%|IU)$/i.test(c.truth.unit)))) throw new Error(`Invalid printed truth: ${c.id}`)
  } else if (c.truth.numeric !== null || c.truth.unit !== null) throw new Error('Unreadable/unreviewed regions cannot have forced truth.')
  if (c.review === 'verified' && (!c.reviewNote.trim() || c.truth.status === 'unreviewed')) throw new Error('Verified regions require visual review and transcription/readability.')
  const score = scoreReading(c.baselineRaw, c.truth)
  if (c.review === 'verified' && c.failureBefore === 'none' && (score.numeric !== true || (score.unit !== null && score.unit !== true))) throw new Error('Baseline error cannot be classified as none.')
  if (c.review === 'verified' && c.failureBefore === 'recognition' && score.numeric === true && (score.unit === null || score.unit === true)) throw new Error('Correct baseline cannot be classified as a recognition failure.')
  const span = c.replacement
  if (span && (!Number.isInteger(span.lineIndex) || !c.lineIndexes.includes(span.lineIndex) || !Number.isInteger(span.start) || !Number.isInteger(span.end)
    || span.start < 0 || span.end <= span.start || span.end > baseline.lines[span.lineIndex]!.text.length)) throw new Error(`Invalid replacement span: ${c.id}`)
}

export async function preparePlan(root: string, baselineDirectory: string, manifestPath?: string): Promise<Plan> {
  const directory = await contained(root, baselineDirectory)
  const filenames = ['dataset.json', 'prepared.json', 'run.json']
  const bytes = await Promise.all(filenames.map((p) => readFile(join(directory, p))))
  const dataset = JSON.parse(bytes[0]!.toString()) as PilotDataset
  const prepared = JSON.parse(bytes[1]!.toString()) as Prepared
  const run = JSON.parse(bytes[2]!.toString()) as PilotRun
  if (dataset.version !== 1 || !dataset.cases?.length || !prepared.complete || !run.completedAt
    || dataset.fingerprint !== prepared.datasetFingerprint || dataset.fingerprint !== run.datasetFingerprint) throw new Error('Baseline dataset/preparation/run must be complete and agree.')
  const config = run.config as Record<string, unknown>
  if (config.detectionModel !== PADDLE_OCR_CONFIGS.v6Tiny.detectionModel || config.recognitionModel !== PADDLE_OCR_CONFIGS.v6Tiny.recognitionModel
    || JSON.stringify(config.preprocessing) !== JSON.stringify(PRODUCTION_PREPROCESSING_CONFIG)
    || JSON.stringify(config.prediction) !== JSON.stringify({ ...PADDLE_PREDICTION_DEFAULTS, ...PADDLE_OCR_CONFIGS.v6Tiny.prediction })) throw new Error('Baseline must use the unchanged production OCR configuration.')
  const manifestBytes = manifestPath ? await readFile(await contained(root, manifestPath)) : null
  const manifest = manifestBytes ? JSON.parse(manifestBytes.toString()) as ReviewManifest : null
  if (manifest && (manifest.version !== 1 || manifest.baselineRunSha256 !== sha256(bytes[2]!) || !Array.isArray(manifest.candidates)
    || !Array.isArray(manifest.reservedImageIds) || !Array.isArray(manifest.exposedProductIds))) throw new Error('Invalid review manifest or baseline identity.')
  const exposed = await exposedProducts(root)
  manifest?.exposedProductIds.forEach((p) => exposed.add(p))
  const plan: Plan = { version: 1, parserVersion: parseNutrition({ text: '', lines: [], engine: 'empty' }).parserVersion,
    padding: .2, scales: SCALES, baselineDirectory: relative(root, directory),
    baselineSources: filenames.map((p, i) => ({ path: relative(root, join(directory, p)), sha256: sha256(bytes[i]!) })),
    sources: await sourceDigests(root), images: [],
    policy: { minimumFailureRecovery: .1, maximumReservedRegressions: 0, maximumWrongIncrease: 0,
      phoneMedianLabelMs: manifest?.phone?.medianLabelMs ?? null, phoneP95LabelMs: manifest?.phone?.p95LabelMs ?? null,
      referenceDevice: manifest?.phone?.device ?? null, mode: 'detection-and-recognition' } }
  // Split/exposure inputs are part of the immutable provenance, too.
  for (const path of ['evaluation/datasets/phase-2-pilot.json', 'evaluation/annotations/mobile.json', ...(manifestPath ? [relative(root, await contained(root, manifestPath))] : [])]) {
    plan.baselineSources.push({ path, sha256: sha256(await readFile(resolve(root, path))) })
  }
  if (manifest?.phone && (!manifest.phone.device?.trim() || !Number.isFinite(manifest.phone.medianLabelMs) || !Number.isFinite(manifest.phone.p95LabelMs)
    || manifest.phone.medianLabelMs <= 0 || manifest.phone.p95LabelMs < manifest.phone.medianLabelMs)) throw new Error('Invalid phone latency policy.')
  const imageIds = new Set<string>(), digests = new Set<string>(), products = new Map<string, string>(), overlayIds = new Set<string>()
  for (const entry of dataset.cases) {
    if (!/^[a-z0-9_]+$/.test(entry.id) || imageIds.has(entry.id) || !entry.productId?.trim()) throw new Error('Invalid/duplicate image ID.')
    imageIds.add(entry.id)
    validateAnnotation(entry.annotation)
    if (entry.annotation.id !== entry.id || entry.annotation.productId !== entry.productId) throw new Error('Annotation identity mismatch.')
    const imagePath = await contained(root, entry.image)
    const imageBytes = await readFile(imagePath)
    if (sha256(imageBytes) !== entry.imageSha256 || digests.has(entry.imageSha256)) throw new Error('Changed/duplicate source image.')
    digests.add(entry.imageSha256)
    const meta = await sharp(imageBytes).metadata()
    if (meta.width !== entry.width || meta.height !== entry.height || (meta.orientation && meta.orientation !== 1)
      || entry.width * entry.height > 60_000_000) throw new Error('Source orientation/dimensions need coordinate review or exceed the memory limit.')
    const rows = run.results.filter((r) => r.id === entry.id && r.variant === 'rectangle')
    const captures = prepared.captures.filter((r) => r.capture.id === entry.id && r.capture.variant === 'rectangle')
    if (rows.length !== 1 || captures.length !== 1 || !rows[0]!.ocr) throw new Error(`Missing/duplicate baseline rectangle OCR: ${entry.id}`)
    const row = rows[0]!, capture = captures[0]!
    validateOcr(row.ocr)
    if (row.ocr!.engine !== 'paddleocr.js' || row.ocr!.engineVersion !== '0.4.2' || row.ocr!.preprocessing !== PRODUCTION_PREPROCESSING_CONFIG.id
      || row.width !== capture.capture.width || row.height !== capture.capture.height || JSON.stringify(row.rectangle) !== JSON.stringify(capture.capture.rectangle)
      || row.geometry !== null || !row.rectangle || row.rectangle.x + row.rectangle.width > entry.width || row.rectangle.y + row.rectangle.height > entry.height) throw new Error('Baseline capture mismatch.')
    const png = await readFile(join(directory, 'crops', `${entry.id}-rectangle.png`))
    if (sha256(png) !== capture.pngSha256) throw new Error('Baseline prepared PNG changed.')
    const preprocessingScale = Math.min(1, 2400 / Math.max(row.width, row.height))
    if (row.ocr!.sourceSize?.width !== Math.round(row.width * preprocessingScale) || row.ocr!.sourceSize?.height !== Math.round(row.height * preprocessingScale)) throw new Error('Unverified baseline preprocessing dimensions.')
    const reserved = manifest?.reservedImageIds.includes(entry.id) ?? false
    if (reserved && (exposed.has(entry.productId) || !manifest?.reservedProvenance?.trim())) throw new Error(`Reserved product is exposed or has no provenance: ${entry.productId}`)
    const split = reserved ? 'reserved' : 'development'
    if (products.has(entry.productId) && products.get(entry.productId) !== split) throw new Error('Product split leakage.')
    products.set(entry.productId, split)
    const selected = selectCandidates(entry.id, row.ocr!)
    const overlays = manifest?.candidates.filter((c) => c.imageId === entry.id) ?? []
    const candidates: Candidate[] = []
    for (const draft of [...selected, ...overlays.filter((c) => !selected.some((s) => s.id === c.id)).map((c) => ({ ...c,
      selection: 'manual' as const, parserField: null, baselineRaw: '', ocrBox: c.ocrBox!, evidence: null }))]) {
      const overlay = overlays.find((c) => c.id === draft.id)
      if (overlay) {
        if (overlayIds.has(overlay.id)) throw new Error('Duplicate review ID.')
        overlayIds.add(overlay.id)
      }
      const value = { ...draft, ...overlay }
      if (!/^[a-z0-9_-]+$/.test(value.id) || !validBox(value.ocrBox)) throw new Error('Invalid candidate ID/bounds.')
      const sourceBox = mapRectangle(value.ocrBox, row)
      const crop = paddedCrop(sourceBox, entry.width, entry.height, .2)
      const ordered = value.lineIndexes.flatMap((i) => row.ocr!.lines[i] ? [row.ocr!.lines[i]!] : []).sort((a, b) => a.bbox.x - b.bbox.x)
      const span = value.replacement
      const baselineRaw = span && row.ocr!.lines[span.lineIndex] ? row.ocr!.lines[span.lineIndex]!.text.slice(span.start, span.end) : ordered.map((l) => l.text).join(' ')
      const candidate = { ...value, ocrBox: value.ocrBox!, sourceBox, cropBox: crop.box, padding: .2, clipped: crop.clipped, baselineRaw } as Candidate
      validateReview(candidate, row.ocr!)
      candidates.push(candidate)
    }
    const extraction = parseNutrition(row.ocr!)
    plan.images.push({ id: entry.id, productId: entry.productId, split, historicalSplit: entry.split, image: relative(root, imagePath), imageSha256: entry.imageSha256,
      width: entry.width, height: entry.height, tags: entry.tags, annotation: entry.annotation, supplementalFields: Object.keys(entry.supplementalFields ?? {}), baseline: row.ocr!, candidates,
      unresolvedFields: Object.entries(extraction.data.nutrients).filter(([, v]) => v === null).map(([k]) => k) })
  }
  if (manifest && (manifest.reservedImageIds.some((id) => !imageIds.has(id)) || overlayIds.size !== manifest.candidates.length)) throw new Error('Unknown/duplicate manifest image or candidate.')
  return plan
}

export function draftManifest(plan: Plan): ReviewManifest {
  return { version: 1, baselineRunSha256: plan.baselineSources.find((s) => s.path.endsWith('/run.json'))!.sha256,
    exposedProductIds: plan.images.map((i) => i.productId), reservedImageIds: [], reservedProvenance: '',
    candidates: plan.images.flatMap((i) => i.candidates.map(({ id, imageId, review, reviewNote, field, basis, lineIndexes, ocrBox, truth, failureBefore, replacement }) =>
      ({ id, imageId, review, reviewNote, field, basis, lineIndexes, ocrBox, truth, failureBefore, replacement }))) }
}
export async function verifyPlan(root: string, plan: Plan) {
  if (json(plan.sources) !== json(await sourceDigests(root))) throw new Error('Experiment/runtime/scoring code changed. Prepare a fresh experiment.')
  for (const source of plan.baselineSources) if (sha256(await readFile(await contained(root, source.path))) !== source.sha256) throw new Error(`Baseline/manifest changed: ${source.path}`)
  for (const image of plan.images) if (sha256(await readFile(await contained(root, image.image))) !== image.imageSha256) throw new Error('Source image changed.')
}
