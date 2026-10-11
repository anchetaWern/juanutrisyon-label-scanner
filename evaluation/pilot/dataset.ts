import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import sharp from 'sharp'
import { validateAnnotation } from '../load'
import { validateQuad } from '../../src/services/image/perspective'
import type { Quad } from '../../src/services/image/perspective'
import type { FieldTruth } from '../types'
import type { PilotDataset, PilotManifest } from './types'

export const sha256 = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex')
export const IMAGE_DIRECTORY = 'labels/nutrition_labels_json'
export const MANIFEST_PATH = 'evaluation/datasets/phase-2-pilot.json'
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
export function importOwnerFields(value: unknown): Record<string, FieldTruth> {
  if (!object(value) || !object(value.serving) || !object(value.nutrients)) throw new Error('Expected serving and nutrients objects.')
  if (Object.keys(value).some((key) => !['serving', 'nutrients'].includes(key))) throw new Error('Unexpected label section.')
  const fields: Record<string, FieldTruth> = {}
  for (const [key, truth] of Object.entries(value.nutrients)) {
    if (!/^[a-z][a-z0-9_]*$/.test(key) || typeof truth !== 'string' || !truth.trim()) throw new Error(`Invalid nutrient truth: ${key}. Null is ambiguous.`)
    fields[key] = truth
  }
  for (const [key, truth] of Object.entries(value.serving)) {
    if (!['serving_size', 'servings_per_container'].includes(key) || typeof truth !== 'string' || !truth.trim()) throw new Error(`Invalid serving truth: ${key}.`)
    fields[`serving.${key}`] = truth
  }
  if (!Object.keys(value.nutrients).length || Object.keys(value.serving).length !== 2) throw new Error('Missing nutrient or serving annotations.')
  return fields
}

export async function loadPilotDataset(root: string): Promise<PilotDataset> {
  const manifestBytes = await readFile(resolve(root, MANIFEST_PATH))
  const manifest = JSON.parse(manifestBytes.toString()) as PilotManifest
  if (manifest.version !== 1 || !Array.isArray(manifest.entries) || !manifest.entries.length) throw new Error('Invalid pilot manifest.')
  const sources = [{ path: MANIFEST_PATH, sha256: sha256(manifestBytes) }]
  const files = (await readdir(resolve(root, IMAGE_DIRECTORY))).filter((name) => /\.(json|jpe?g|png|webp)$/i.test(name)).sort()
  const expected = manifest.entries.flatMap((entry) => [`${entry.id}.json`, `${entry.id}.jpeg`]).sort()
  if (JSON.stringify(files) !== JSON.stringify(expected)) throw new Error('Pilot folder/manifest mismatch: every image and JSON must be paired and listed.')
  const ids = new Set<string>(), imageDigests = new Set<string>(), products = new Map<string, string>()
  const cases: PilotDataset['cases'] = []
  for (const entry of manifest.entries) {
    if (!/^[a-z0-9_]+$/.test(entry.id) || ids.has(entry.id)) throw new Error(`Invalid or duplicate ID: ${entry.id}`)
    ids.add(entry.id)
    if (products.has(entry.productId) && products.get(entry.productId) !== entry.split) throw new Error(`Product split leakage: ${entry.productId}`)
    products.set(entry.productId, entry.split)
    if (!entry.panelNote || !object(entry.review) || ['glareOnPanel', 'smallText', 'blur', 'clippedNutrientFields'].some((k) => typeof entry.review[k as keyof typeof entry.review] !== 'boolean')) throw new Error(`Missing visual review: ${entry.id}`)
    const image = `${IMAGE_DIRECTORY}/${entry.id}.jpeg`, label = `${IMAGE_DIRECTORY}/${entry.id}.json`
    const [bytes, labelBytes] = await Promise.all([readFile(resolve(root, image)), readFile(resolve(root, label))])
    const imageSha256 = sha256(bytes)
    if (imageDigests.has(imageSha256)) throw new Error(`Duplicate image: ${entry.id}`)
    imageDigests.add(imageSha256)
    sources.push({ path: image, sha256: imageSha256 }, { path: label, sha256: sha256(labelBytes) })
    const meta = await sharp(bytes).metadata()
    if (!meta.width || !meta.height || (meta.orientation && meta.orientation !== 1)) throw new Error(`Unsupported dimensions/orientation; review coordinates first: ${entry.id}`)
    if (!Array.isArray(entry.panel) || entry.panel.length !== 4 || entry.panel.some((p) => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1)) throw new Error(`Invalid normalized corners: ${entry.id}`)
    const corners = entry.panel.map((p) => ({ x: p.x * (meta.width! - 1), y: p.y * (meta.height! - 1) })) as Quad
    const invalid = validateQuad(corners, meta.width, meta.height)
    if (invalid) throw new Error(`${entry.id}: ${invalid}`)
    const fields = importOwnerFields(JSON.parse(labelBytes.toString()))
    for (const [key, truth] of Object.entries(entry.supplementalFields)) {
      if (key in fields) throw new Error(`Supplement would overwrite owner truth: ${entry.id}:${key}`)
      fields[key] = truth
    }
    const annotation = { id: entry.id, productId: entry.productId, split: entry.split, cohort: 'phase-2-pilot', tags: entry.tags,
      provenance: `${label}; ${manifest.reviewProvenance}`, fields }
    validateAnnotation(annotation)
    cases.push({ ...entry, image, imageSha256, width: meta.width, height: meta.height, annotation })
  }
  return { version: 1, fingerprint: sha256(JSON.stringify(sources)), reviewProvenance: manifest.reviewProvenance, cases, sources,
    notes: ['15 original photos from one supplied capture collection; no representative unreadable/blurred negative set.',
      '10 development / 5 validation products frozen before OCR. Validation is reserved for evaluation, but images and labels were seen for annotation.',
      'Manual panel selection and condition tags were reviewed by Codex before OCR. Original owner JSON is preserved; supplements are identified separately.',
      'Other omitted fields are unreviewed. Printed values remain targets even when the current parser does not support their layout, key, or unit.',
      'Multiple-panel originals are stress tests with an explicit intended panel. Cropped variants measure the effect of supplying that panel.',
      'No text-region ground truth, independent human geometry review, or phone timing is available.'] }
}
