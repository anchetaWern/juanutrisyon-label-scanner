// Offline audit of saved phone exports. Never invokes an OCR provider or changes app code.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import ts from 'typescript'
import { parseNutrition, type NutritionExtraction } from '../../src/services/nutrition/parseNutrition'
import type { OcrResult } from '../../src/services/ocr/types'
import { validateAnnotation, validateOcr } from '../load'
import { aggregate, buildReport, evaluateCase } from '../metrics'
import { comparisonGate, fieldChanges } from '../phase5/report'
import { IMAGE_DIRECTORY, MANIFEST_PATH, importOwnerFields, sha256 } from '../pilot/dataset'
import type { PilotManifest } from '../pilot/types'
import { csv } from '../report'
import type { CaseResult, EvaluationCase } from '../types'

interface PhoneExport {
  schemaVersion: number
  images: {
    original: { filename: string; bytes: number }
    crop: { bytes: number; width: number; height: number; ocrInputSize: { width: number; height: number }; geometry: unknown }
  }
  ocr: OcrResult
  nutrition: NutritionExtraction
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const baselineRevision = '57234a0'
const savedParserRevision = '0927174'
const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n'

async function main() {
  const args = process.argv.slice(2)
  if (args.length !== 2 || args[0] !== '--out') throw new Error('Usage: node --import tsx evaluation/phone/audit.ts --out evaluation/results/<new-directory>')
  const out = resolve(root, args[1]!)
  const rel = relative(join(root, 'evaluation/results'), out)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Output must be a new subdirectory of evaluation/results/.')
  const sources: Array<{ path: string; sha256: string }> = []
  async function input(path: string) {
    const bytes = await readFile(join(root, path))
    sources.push({ path, sha256: sha256(bytes) })
    return bytes
  }
  const manifest = JSON.parse((await input(MANIFEST_PATH)).toString()) as PilotManifest
  assert.equal(manifest.version, 1)
  assert.equal(new Set(manifest.entries.map((e) => e.id)).size, manifest.entries.length)
  const baselineSource = execFileSync('git', ['show', `${baselineRevision}:src/services/nutrition/parseNutrition.ts`], { cwd: root, encoding: 'utf8' })
  const compiled = ts.transpileModule(baselineSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  const baseline = (await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)).parseNutrition as typeof parseNutrition
  const savedParserSource = execFileSync('git', ['show', `${savedParserRevision}:src/services/nutrition/parseNutrition.ts`], { cwd: root, encoding: 'utf8' })
  const savedCompiled = ts.transpileModule(savedParserSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  const savedParser = (await import(`data:text/javascript;base64,${Buffer.from(savedCompiled).toString('base64')}`)).parseNutrition as typeof parseNutrition
  const before: CaseResult[] = [], after: CaseResult[] = []
  const supplemental: CaseResult[] = []
  const audits = []
  const timings: Record<string, number[]> = {}
  const cropHashes = new Set<string>()
  for (const entry of manifest.entries) {
    assert.match(entry.id, /^[a-z0-9_]+$/)
    const prefix = `${IMAGE_DIRECTORY}/${entry.id}`
    // Explicit suffixes keep the old labels distinct from new OCR/diagnostic JSON.
    // The strict Phase 2 folder loader predates these additional exports.
    const [label, crop, ocrBytes, diagnosticBytes, original] = await Promise.all([
      input(`${prefix}.json`), input(`${prefix}-ocr-crop.png`), input(`${prefix}-ocr.json`),
      input(`${prefix}-diagnostics.json`), input(`${prefix}.jpeg`),
    ])
    const ocr: unknown = JSON.parse(ocrBytes.toString())
    validateOcr(ocr)
    const diagnostic = JSON.parse(diagnosticBytes.toString()) as PhoneExport
    assert.equal(diagnostic.schemaVersion, 3, entry.id)
    assert.deepEqual(ocr, diagnostic.ocr, `${entry.id}: standalone OCR differs from diagnostics`)
    const meta = await sharp(crop).metadata()
    await sharp(crop).stats() // Decode pixels, rather than trusting only the PNG header.
    assert.equal(meta.format, 'png')
    assert.equal(crop.length, diagnostic.images.crop.bytes)
    const size = { width: meta.width, height: meta.height }
    assert.deepEqual(size, { width: diagnostic.images.crop.width, height: diagnostic.images.crop.height })
    assert.deepEqual(size, diagnostic.images.crop.ocrInputSize)
    assert.deepEqual(size, ocr.sourceSize)
    const cropSha256 = sha256(crop)
    assert(!cropHashes.has(cropSha256), `${entry.id}: duplicate crop`)
    cropHashes.add(cropSha256)
    assert.deepEqual(savedParser(ocr), diagnostic.nutrition, `${entry.id}: saved extraction does not match frozen v3 parser replay`)
    const annotation = { id: entry.id, productId: entry.productId, split: entry.split, cohort: 'iphone-owner-fields',
      provenance: `${prefix}.json; owner-verified, unchanged`, tags: entry.tags, fields: importOwnerFields(JSON.parse(label.toString())) }
    validateAnnotation(annotation)
    const c: EvaluationCase = { annotation, ocr }
    before.push(evaluateCase(c, baseline(ocr)))
    after.push(evaluateCase(c, diagnostic.nutrition))
    const extra = evaluateCase({ annotation: { ...annotation, cohort: 'codex-supplemental-fields',
      provenance: MANIFEST_PATH + '; Codex visual review, not independently owner-verified', fields: entry.supplementalFields }, ocr }, diagnostic.nutrition)
    supplemental.push({ ...extra, fields: extra.fields.filter((f) => Object.hasOwn(entry.supplementalFields, f.field)) })
    const timing = ocr.diagnostics?.timing
    for (const key of ['initializationMs', 'preprocessingMs', 'recognitionMs', 'totalMs'] as const) {
      const value = timing?.[key]
      assert(typeof value === 'number' && Number.isFinite(value) && value >= 0, `${entry.id}: missing timing ${key}`)
      const samples = timings[key] ??= []
      samples.push(value)
    }
    audits.push({ id: entry.id, size, cropSha256, parserVersion: diagnostic.nutrition.parserVersion,
      providerConfig: ocr.diagnostics?.provider?.configId, initializedDuringRequest: timing?.initializedDuringRequest,
      geometry: diagnostic.images.crop.geometry === null ? 'rectangle' : 'perspective',
      replayMatchesSavedExtraction: true,
      folderOriginal: { filename: `${entry.id}.jpeg`, bytes: original.length }, phoneOriginal: diagnostic.images.original,
      folderOriginalMetadataMatchesPhone: diagnostic.images.original.filename === `${entry.id}.jpeg` && diagnostic.images.original.bytes === original.length })
  }
  const inputFingerprint = sha256(json([...sources].sort((a, b) => a.path.localeCompare(b.path))))
  for (const path of ['evaluation/phone/audit.ts', 'evaluation/metrics.ts', 'evaluation/load.ts',
    'evaluation/pilot/dataset.ts', 'evaluation/phase5/report.ts', 'evaluation/report.ts', 'src/services/nutrition/parseNutrition.ts']) await input(path)
  const notes = [
    'Primary scores use only unchanged owner-verified fields; manifest supplemental fields are excluded.',
    'Score saved diagnostic nutrition, not a hypothetical new extraction. Frozen v3 parser replay matches every saved extraction.',
    'No annotated negative fields: false-positive performance is not established. Unannotated predictions are unscored.',
    'These are previously exposed products, including the former holdout; this is not fresh blind validation.',
    'Existing smaller JPEGs are not the exact phone originals. Cross-run crop/device comparisons are confounded.',
    'OCR presence probes are whole-panel string checks, not detection recall; separate unit cells can cause false negatives.',
    'Timings are diagnostic phone measurements including initialization, not desktop processing latency.',
  ]
  const report = { ...buildReport(after), sources, notes }
  const comparison = { baselineRevision, baselineParserSha256: sha256(baselineSource), savedParserRevision, savedParserSha256: sha256(savedParserSource), inputFingerprint,
    before: aggregate(before), after: aggregate(after), changes: fieldChanges(before, after), gate: comparisonGate(before, after) }
  const timingSummary = Object.fromEntries(Object.entries(timings).map(([key, values]) => {
    const sorted = [...values].sort((a, b) => a - b)
    return [key, { samples: values.length, mean: values.reduce((a, b) => a + b, 0) / values.length, p95: sorted[Math.ceil(sorted.length * .95) - 1] }]
  }))
  // Refuse to overwrite a previous audit. All validation finishes before creating outputs.
  await mkdir(out)
  await Promise.all([
    writeFile(join(out, 'report.json'), json(report), { flag: 'wx' }),
    writeFile(join(out, 'fields.csv'), csv(report), { flag: 'wx' }),
    writeFile(join(out, 'comparison.json'), json(comparison), { flag: 'wx' }),
    writeFile(join(out, 'audit.json'), json({ inputFingerprint, cases: audits, timings: timingSummary }), { flag: 'wx' }),
    writeFile(join(out, 'supplemental.json'), json(buildReport(supplemental)), { flag: 'wx' }),
  ])
  console.log(json({ inputFingerprint, before: comparison.before, after: comparison.after, gate: comparison.gate, timings: timingSummary }))
}
main().catch((cause: unknown) => { console.error(cause instanceof Error ? cause.message : String(cause)); process.exitCode = 1 })
