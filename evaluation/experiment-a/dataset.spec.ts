// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import sharp from 'sharp'
import { PADDLE_OCR_CONFIGS, PADDLE_PREDICTION_DEFAULTS } from '../../src/services/ocr/PaddleOcrEngine'
import { PRODUCTION_PREPROCESSING_CONFIG } from '../../src/services/image/preprocessForOcr'
import { sha256 } from '../pilot/dataset'
import { contained, draftManifest, json, preparePlan, sourceDigests, verifyPlan } from './dataset'
import type { ReviewManifest } from './types'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'experiment-a-test-')); roots.push(root)
  const write = async (path: string, value: unknown) => { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), json(value)) }
  await mkdir(join(root, 'evaluation/experiment-a'), { recursive: true })
  await write('evaluation/datasets/phase-2-pilot.json', { entries: [{ productId: 'exposed' }] })
  await write('evaluation/annotations/mobile.json', [{ productId: 'old-mobile' }])
  const hashFiles = ['package.json', 'package-lock.json', 'vite.config.ts', 'src/services/nutrition/parseNutrition.ts', 'evaluation/metrics.ts', 'evaluation/load.ts', 'evaluation/types.ts',
    'src/services/ocr/PaddleOcrEngine.ts', 'src/services/ocr/types.ts', 'src/services/image/preprocessForOcr.ts', 'src/utils/image.ts', 'evaluation/pilot/dataset.ts']
  for (const path of hashFiles) await write(path, {})
  const png = await sharp({ create: { width: 100, height: 100, channels: 3, background: 'white' } }).png().toBuffer()
  await writeFile(join(root, 'source.png'), png)
  await mkdir(join(root, 'baseline/crops'), { recursive: true }); await writeFile(join(root, 'baseline/crops/image-rectangle.png'), png)
  const annotation = { id: 'image', productId: 'new', split: 'development', cohort: 'test', provenance: 'owner', tags: [], fields: { sodium: '230mg' } }
  await write('baseline/dataset.json', { version: 1, fingerprint: 'fingerprint', cases: [{ id: 'image', productId: 'new', split: 'development', tags: [], image: 'source.png',
    imageSha256: sha256(png), width: 100, height: 100, annotation }] })
  const capture = { id: 'image', variant: 'rectangle', width: 100, height: 100, rectangle: { x: 0, y: 0, width: 100, height: 100 }, geometry: null }
  await write('baseline/prepared.json', { datasetFingerprint: 'fingerprint', complete: true, captures: [{ capture, pngSha256: sha256(png) }] })
  const ocr = { text: 'Sodium\n280 mq', lines: [{ text: 'Sodium', bbox: { x: 5, y: 30, width: 25, height: 10 } }, { text: '280 mq', bbox: { x: 50, y: 30, width: 40, height: 10 } }],
    sourceSize: { width: 100, height: 100 }, engine: 'paddleocr.js', engineVersion: '0.4.2', preprocessing: PRODUCTION_PREPROCESSING_CONFIG.id }
  await write('baseline/run.json', { version: 1, datasetFingerprint: 'fingerprint', completedAt: 'done', config: { ...PADDLE_OCR_CONFIGS.v6Tiny,
    prediction: { ...PADDLE_PREDICTION_DEFAULTS, ...PADDLE_OCR_CONFIGS.v6Tiny.prediction }, preprocessing: PRODUCTION_PREPROCESSING_CONFIG }, results: [{ ...capture, ocr }] })
  const mutate = async (path: string, transform: (value: Record<string, unknown>) => unknown) => write(path, transform(JSON.parse(await readFile(join(root, path), 'utf8'))))
  return { root, write, mutate }
}
describe('baseline provenance and reviewed data contract', () => {
  it('prepares unscored draft regions from frozen OCR and maps them to source pixels', async () => {
    const { root } = await fixture(), plan = await preparePlan(root, 'baseline')
    expect(plan.images[0]!.split).toBe('development')
    expect(plan.images[0]!.candidates[0]).toMatchObject({ baselineRaw: '280 mq', review: 'pending', truth: { status: 'unreviewed' }, sourceBox: { x: 50, y: 30, width: 40, height: 10 } })
    await expect(verifyPlan(root, plan)).resolves.toBeUndefined()
  })
  it('rejects changed source images and prepared PNGs', async () => {
    const { root } = await fixture(), plan = await preparePlan(root, 'baseline')
    await writeFile(join(root, 'source.png'), 'changed')
    await expect(verifyPlan(root, plan)).rejects.toThrow(/Source image/)
    await expect(preparePlan(root, 'baseline')).rejects.toThrow(/source image/)
    const second = await fixture(); await writeFile(join(second.root, 'baseline/crops/image-rectangle.png'), 'changed')
    await expect(preparePlan(second.root, 'baseline')).rejects.toThrow(/PNG changed/)
  })
  it('rejects a code change before resume or replay', async () => {
    const { root } = await fixture(), plan = await preparePlan(root, 'baseline')
    await writeFile(join(root, 'evaluation/metrics.ts'), 'changed')
    await expect(verifyPlan(root, plan)).rejects.toThrow(/code changed/)
    expect(await sourceDigests(root)).not.toEqual(plan.sources)
  })
  it('rejects altered production settings and inconsistent image coordinates', async () => {
    const { root, mutate } = await fixture()
    await mutate('baseline/run.json', (v) => ({ ...v, config: { ...(v.config as object), recognitionModel: 'other' } }))
    await expect(preparePlan(root, 'baseline')).rejects.toThrow(/unchanged production/)
    const second = await fixture()
    await second.mutate('baseline/run.json', (v) => ({ ...v, results: (v.results as Array<Record<string, unknown>>).map((r) => ({ ...r, ocr: { ...(r.ocr as object), sourceSize: { width: 90, height: 100 } } })) }))
    await expect(preparePlan(second.root, 'baseline')).rejects.toThrow(/preprocessing dimensions/)
  })
  it('applies independently reviewed region truth without rewriting baseline OCR or nutrient truth', async () => {
    const { root, write } = await fixture(), original = await preparePlan(root, 'baseline'), manifest = draftManifest(original)
    Object.assign(manifest.candidates[0]!, { review: 'verified', reviewNote: 'Visual source review', field: 'sodium', basis: 'per serving', failureBefore: 'recognition',
      truth: { status: 'readable', numeric: '230', unit: 'mg', provenance: 'independent visual transcription' } })
    await write('review.json', manifest)
    const reviewed = await preparePlan(root, 'baseline', 'review.json')
    expect(reviewed.images[0]!.candidates[0]!.truth.numeric).toBe('230')
    expect(reviewed.images[0]!.baseline).toEqual(original.images[0]!.baseline)
    expect(reviewed.images[0]!.annotation).toEqual(original.images[0]!.annotation)
  })
  it('refuses exposed products as reserved, and unknown/duplicate review records', async () => {
    const { root, write, mutate } = await fixture(), initial = await preparePlan(root, 'baseline'), manifest = draftManifest(initial)
    manifest.reservedImageIds = ['image']; manifest.reservedProvenance = 'fresh'; manifest.exposedProductIds = ['new']
    await write('review.json', manifest)
    await expect(preparePlan(root, 'baseline', 'review.json')).rejects.toThrow(/Reserved product is exposed/)
    manifest.reservedImageIds = []; manifest.candidates.push(manifest.candidates[0]!)
    await write('review.json', manifest)
    await expect(preparePlan(root, 'baseline', 'review.json')).rejects.toThrow(/Unknown\/duplicate/)
    manifest.candidates.pop(); manifest.baselineRunSha256 = 'stale'; await write('review.json', manifest)
    await expect(preparePlan(root, 'baseline', 'review.json')).rejects.toThrow(/identity/)
    await mutate('baseline/dataset.json', (v) => ({ ...v, cases: [...v.cases as unknown[], ...v.cases as unknown[]] }))
    await expect(preparePlan(root, 'baseline')).rejects.toThrow(/duplicate image ID/)
  })
  it('accepts fresh reserved provenance while preserving historical split metadata', async () => {
    const { root, write } = await fixture(), plan = await preparePlan(root, 'baseline'), manifest: ReviewManifest = draftManifest(plan)
    manifest.exposedProductIds = []; manifest.reservedImageIds = ['image']; manifest.reservedProvenance = 'Owner attests fresh product, unseen in historical corpora.'
    await write('review.json', manifest)
    const reserved = await preparePlan(root, 'baseline', 'review.json')
    expect(reserved.images[0]).toMatchObject({ split: 'reserved', historicalSplit: 'development' })
  })
  it('rejects unreviewed regions marked verified and false baseline failure classifications', async () => {
    const { root, write } = await fixture(), plan = await preparePlan(root, 'baseline'), manifest = draftManifest(plan)
    manifest.candidates[0]!.review = 'verified'; await write('review.json', manifest)
    await expect(preparePlan(root, 'baseline', 'review.json')).rejects.toThrow(/Verified regions require/)
    Object.assign(manifest.candidates[0]!, { failureBefore: 'none', truth: { status: 'readable', numeric: '230', unit: 'mg', provenance: 'human' } }); await write('review.json', manifest)
    await expect(preparePlan(root, 'baseline', 'review.json')).rejects.toThrow(/Baseline error/)
    await expect(contained(root, '..')).rejects.toThrow(/inside the repository/)
  })
})
