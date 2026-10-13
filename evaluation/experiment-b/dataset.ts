import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile, readdir, realpath } from 'node:fs/promises'
import { resolve, relative, isAbsolute } from 'node:path'
import ts from 'typescript'
import type { OcrResult } from '../../src/services/ocr/types'
import type { NutritionExtraction } from '../../src/services/nutrition/parseNutrition'
import type { Annotation } from '../types'
import { validateAnnotation, validateOcr } from '../load'
import type { PilotDataset, PilotRun } from '../pilot/types'
import type { BasisTruth, Config, Input } from './types'

export const BASELINE_REVISION = '335d5849558f6ff474ae732db5e78233de3f8e29'
export const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n'
export const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
export async function repoFile(root: string, path: string) {
  const actual = await realpath(resolve(root, path)), base = await realpath(root), rel = relative(base, actual)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Input must be a file within the repository.')
  return actual
}
export async function sourceIdentity(root: string, config: Config) {
  const files = (await readdir(resolve(root, 'evaluation/experiment-b'))).filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts')).sort().map((f) => `evaluation/experiment-b/${f}`)
  files.push('evaluation/datasets/experiment-b-development.json', 'src/services/nutrition/parseNutrition.ts', 'src/services/ocr/types.ts',
    'evaluation/types.ts', 'evaluation/load.ts', 'evaluation/metrics.ts', 'evaluation/phase5/report.ts', 'package.json', 'package-lock.json')
  return { config, baselineRevision: BASELINE_REVISION, files: await Promise.all(files.map(async (path) => ({ path, sha256: hash(await readFile(resolve(root, path))) }))) }
}
export async function frozenBaseline(root: string) {
  const source = execFileSync('git', ['show', `${BASELINE_REVISION}:src/services/nutrition/parseNutrition.ts`], { cwd: root, encoding: 'utf8' })
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  const parse = (await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)).parseNutrition as (ocr: OcrResult) => NutritionExtraction
  return { parse, sha256: hash(source) }
}
export function validateTruth(truth: BasisTruth, ocr: OcrResult) {
  if (!truth.provenance?.trim() || !['reviewed', 'provisional'].includes(truth.status) || !['multi-basis', 'single-context', 'multiple-panels'].includes(truth.layout)) throw new Error('Invalid truth provenance/status/layout.')
  const ids = new Set<string>(), owners = new Set<number>()
  for (const basis of truth.bases) {
    if (!basis.id || ids.has(basis.id) || !['quantity', 'percent_reference'].includes(basis.kind) || !Array.isArray(basis.valueIndexes) || !Array.isArray(basis.headerIndexes)) throw new Error('Invalid/duplicate basis.')
    ids.add(basis.id)
    for (const i of [...basis.valueIndexes, ...basis.headerIndexes]) if (!Number.isInteger(i) || i < 0 || i >= ocr.lines.length) throw new Error('Invalid basis source index.')
    for (const i of basis.valueIndexes) { if (owners.has(i)) throw new Error('Ambiguous truth ownership. Leave spanning lines unassigned.'); owners.add(i) }
  }
  if (truth.intended !== null && !truth.bases.some((b) => b.id === truth.intended && b.kind === 'quantity')) throw new Error('Intended basis is missing or percentage-only reference.')
  for (const basis of truth.bases) if (basis.kind === 'percent_reference' && basis.context !== null && !truth.bases.some((b) => b.id === basis.context && b.kind === 'quantity')) throw new Error('Invalid percentage context link.')
  for (const target of Object.values(truth.fields)) {
    const basis = truth.bases.find((b) => b.id === target.basis)
    if (!basis || !target.valueIndexes.length || target.valueIndexes.some((i) => !basis.valueIndexes.includes(i))) throw new Error('Field provenance must belong to its annotated basis.')
  }
}
interface Definition { id: string; fixture: string; fixtureSha256: string; fixtureKey: string; annotation: Annotation; layout: string; truth?: BasisTruth; image?: string | null; imageSha256?: string }
export interface DevelopmentManifest { version: number; cases: Definition[]; pilotTruth: Record<string, BasisTruth>; coverageGaps: string[]; exposedProducts: string[] }
export async function developmentInputs(root: string, pilotDirectory?: string) {
  const manifest = JSON.parse(await readFile(resolve(root, 'evaluation/datasets/experiment-b-development.json'), 'utf8')) as DevelopmentManifest
  const inputs: Input[] = [], digests: Array<{ path: string; sha256: string }> = []
  for (const d of manifest.cases) {
    const bytes = await readFile(await repoFile(root, d.fixture))
    if (hash(bytes) !== d.fixtureSha256) throw new Error(`Frozen fixture changed: ${d.fixture}`)
    const raw = JSON.parse(bytes.toString()) as Record<string, OcrResult | { ocr: OcrResult }>
    const entry = raw[d.fixtureKey], ocr = entry && 'ocr' in entry ? entry.ocr : entry
    if (!ocr) throw new Error(`Missing fixture ${d.id}`)
    validateOcr(ocr); validateAnnotation(d.annotation)
    if (d.truth) validateTruth(d.truth, ocr)
    inputs.push({ annotation: d.annotation, ocr, split: 'development', truth: d.truth, image: d.image ?? undefined, imageSha256: d.imageSha256,
      imageNote: d.fixtureKey === 'new-2' ? 'Re-encoded label image; dimensions/coordinates checked, not exact OCR input bytes.' : undefined })
    digests.push({ path: d.fixture, sha256: hash(bytes) })
  }
  if (pilotDirectory) {
    const datasetPath = await repoFile(root, `${pilotDirectory}/dataset.json`), runPath = await repoFile(root, `${pilotDirectory}/run.json`)
    const datasetBytes = await readFile(datasetPath), runBytes = await readFile(runPath)
    const dataset = JSON.parse(datasetBytes.toString()) as PilotDataset, run = JSON.parse(runBytes.toString()) as PilotRun
    if (!run.completedAt || run.datasetFingerprint !== dataset.fingerprint) throw new Error('Incomplete or mismatched pilot run.')
    for (const c of dataset.cases) {
      const matches = run.results.filter((r) => r.id === c.id && r.variant === 'rectangle')
      if (matches.length !== 1 || !matches[0]!.ocr) throw new Error(`Missing/duplicate pilot OCR ${c.id}`)
      const ocr = matches[0]!.ocr!, truth = manifest.pilotTruth[c.id]
      validateOcr(ocr)
      if (truth) validateTruth(truth, ocr)
      const fields = Object.fromEntries(Object.entries(c.annotation.fields).filter(([key]) => !(key in c.supplementalFields)))
      inputs.push({ annotation: { ...c.annotation, id: `pilot/${c.id}`, fields }, ocr, split: 'development', truth,
        image: `${pilotDirectory}/crops/${c.id}-rectangle.png`, supplementalFields: c.supplementalFields })
    }
    digests.push({ path: relative(root, datasetPath), sha256: hash(datasetBytes) }, { path: relative(root, runPath), sha256: hash(runBytes) })
  }
  for (const input of inputs) if (input.image) {
    try {
      const bytes = await readFile(await repoFile(root, input.image)), digest = hash(bytes)
      if (input.imageSha256 && input.imageSha256 !== digest) throw new Error('Reviewed source image changed.')
      input.imageSha256 = digest; digests.push({ path: input.image, sha256: digest })
    } catch (cause) {
      if (!(cause instanceof Error && 'code' in cause && cause.code === 'ENOENT')) throw cause
      input.imageNote = 'Source image unavailable; prior reviewed annotation retained for replay, no new image verification.'
    }
  }
  if (new Set(inputs.map((c) => c.annotation.id)).size !== inputs.length) throw new Error('Duplicate cases.')
  return { inputs, digests, coverageGaps: manifest.coverageGaps, exposedProducts: manifest.exposedProducts }
}
/** Call only after a passed, unchanged development freeze. */
export async function reservedInputs(root: string, path: string, exposed: Set<string>, exposedOcr: Set<string> = new Set()) {
  const bytes = await readFile(await repoFile(root, path))
  const manifest = JSON.parse(bytes.toString()) as { provenance: string; cases: Array<{ annotation: Annotation; ocrFile: string; ocrSha256: string; truth: BasisTruth; image?: string }> }
  if (!manifest.provenance?.trim() || !manifest.cases?.length) throw new Error('Reserved provenance/cases required.')
  // Check all products BEFORE opening any reserved OCR files.
  for (const c of manifest.cases) if (!c.annotation.productId?.trim() || exposed.has(c.annotation.productId)) throw new Error('Reserved product already exposed.')
  const inputs: Input[] = []
  for (const c of manifest.cases) {
    validateAnnotation(c.annotation)
    const raw = await readFile(await repoFile(root, c.ocrFile))
    if (hash(raw) !== c.ocrSha256) throw new Error('Reserved OCR hash mismatch.')
    const ocr = JSON.parse(raw.toString()) as OcrResult
    validateOcr(ocr); validateTruth(c.truth, ocr)
    const ocrDigest = hash(json(ocr))
    if (exposedOcr.has(ocrDigest)) throw new Error('Duplicate/exposed reserved OCR.')
    exposedOcr.add(ocrDigest)
    if (c.truth.status !== 'reviewed') throw new Error('Reserved truth must be reviewed.')
    inputs.push({ annotation: c.annotation, ocr, split: 'reserved', truth: c.truth, image: c.image })
  }
  if (new Set(inputs.map((c) => c.annotation.id)).size !== inputs.length) throw new Error('Duplicate reserved case IDs.')
  if (!inputs.some((c) => c.truth!.layout === 'multi-basis') || !inputs.some((c) => c.truth!.layout === 'single-context')) throw new Error('Reserved set requires multi-basis and single-context products.')
  return { inputs, manifestSha256: hash(bytes) }
}
