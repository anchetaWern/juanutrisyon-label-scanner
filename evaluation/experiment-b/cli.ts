import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, resolve, relative, isAbsolute } from 'node:path'
import { parseNutrition } from '../../src/services/nutrition/parseNutrition'
import { DEFAULT_CONFIG, type Config, type Input, type RecordResult } from './types'
import { BASELINE_REVISION, developmentInputs, frozenBaseline, hash, json, reservedInputs, sourceIdentity } from './dataset'
import { replay } from './replay'
import { csv, markdown, resultsReport, type Report } from './report'
import { writeGallery } from './gallery'

interface Plan {
  version: 1
  identity: Awaited<ReturnType<typeof sourceIdentity>>
  baselineSha256: string
  inputs: Input[]
  digests: Array<{ path: string; sha256: string }>
  coverageGaps: string[]
  inputsSha256: string
  exposedProducts: string[]
}
async function read<T>(path: string): Promise<T> { return JSON.parse(await readFile(path, 'utf8')) as T }
export async function main(args = process.argv.slice(2), root = process.cwd()) {
  if (args[0] === '--help') { console.log('experiment:b prepare|develop|freeze|validate --out evaluation/results/<run> [--pilot <exposed pilot directory>] [--config <json>] [--reserved <manifest> --validation-out <new directory>]'); return }
  const [command, ...rest] = args
  const flags = new Map<string, string>()
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i]!, value = rest[i + 1]
    if (!['--out', '--pilot', '--config', '--reserved', '--validation-out'].includes(key) || !value || flags.has(key)) throw new Error('Invalid/duplicate CLI option.')
    flags.set(key, value)
  }
  if (!['prepare', 'develop', 'freeze', 'validate'].includes(command ?? '') || !flags.has('--out')) throw new Error('Usage: experiment:b prepare|develop|freeze|validate --out evaluation/results/<run> [--pilot <existing exposed pilot dir>] [--config <json>] [--reserved <manifest> --validation-out <new dir>]')
  const out = resolve(root, flags.get('--out')!), outRelative = relative(resolve(root, 'evaluation/results'), out)
  if (!outRelative || outRelative.startsWith('..') || isAbsolute(outRelative)) throw new Error('Output must be a new directory under evaluation/results.')
  const config = { ...DEFAULT_CONFIG, ...(flags.has('--config') ? await read<Partial<Config>>(resolve(root, flags.get('--config')!)) : {}) }
  if (Object.keys(config).some((k) => !(k in DEFAULT_CONFIG)) || Object.values(config).some((n) => typeof n !== 'number' || !Number.isFinite(n) || n <= 0) || config.matchOverlap > 1 || config.minimumRows < 2 || !Number.isInteger(config.minimumRows) || !Number.isInteger(config.minimumGain) || !Number.isInteger(config.minimumImprovedProducts)) throw new Error('Invalid experimental thresholds.')
  if (command === 'prepare') {
    const baseline = await frozenBaseline(root), data = await developmentInputs(root, flags.get('--pilot'))
    for (const c of data.inputs) assert.deepEqual(parseNutrition(c.ocr), baseline.parse(c.ocr), `Production default differs from frozen ${BASELINE_REVISION}: ${c.annotation.id}`)
    const plan: Plan = { version: 1, identity: await sourceIdentity(root, config), baselineSha256: baseline.sha256, ...data,
      inputsSha256: hash(json(data.inputs)), exposedProducts: [...new Set([...data.exposedProducts, ...data.inputs.map((c) => c.annotation.productId)])].sort() }
    // Nonrecursive leaf creation rejects existing output instead of overwriting runs.
    await mkdir(resolve(root, 'evaluation/results'), { recursive: true }); await mkdir(out)
    await writeFile(join(out, 'plan.json'), json(plan), { flag: 'wx' })
    console.log(`Prepared ${data.inputs.length} exposed cases; exact v5 production parity verified.`)
    return
  }
  const plan = await read<Plan>(join(out, 'plan.json'))
  assert.deepEqual(await sourceIdentity(root, plan.identity.config), plan.identity, 'Experiment source/config changed; prepare a new run.')
  if (flags.has('--config')) assert.deepEqual(config, plan.identity.config, 'Configuration changed after preparation.')
  assert.equal(hash(json(plan.inputs)), plan.inputsSha256, 'Prepared OCR/truth changed.')
  for (const d of plan.digests) assert.equal(hash(await readFile(resolve(root, d.path))), d.sha256, 'Source OCR changed after preparation.')
  if (command === 'develop') {
    const records = plan.inputs.map((c) => replay(c, plan.identity.config)), report = resultsReport(records, plan.identity.config, plan.coverageGaps)
    await writeFile(join(out, 'records.json'), json(records), { flag: 'wx' })
    await writeFile(join(out, 'report.json'), json(report), { flag: 'wx' })
    await writeFile(join(out, 'report.md'), markdown(report), { flag: 'wx' })
    await writeFile(join(out, 'fields.csv'), csv(records), { flag: 'wx' })
    await writeGallery(root, out, records)
    await writeFile(join(out, 'development.json'), json({ planSha256: hash(await readFile(join(out, 'plan.json'))), recordsSha256: hash(json(records)), reportSha256: hash(json(report)), passed: report.gate.passed }), { flag: 'wx' })
    console.log(`${report.conclusion}\nDevelopment gate: ${report.gate.passed ? 'passed' : 'failed'}\n${join(out, 'report.md')}`)
    return
  }
  const development = await read<{ planSha256: string; recordsSha256: string; reportSha256: string; passed: boolean }>(join(out, 'development.json'))
  assert.equal(hash(await readFile(join(out, 'plan.json'))), development.planSha256, 'Plan changed after development.')
  assert.equal(hash(await readFile(join(out, 'records.json'))), development.recordsSha256, 'Development records changed.')
  assert.equal(hash(await readFile(join(out, 'report.json'))), development.reportSha256, 'Development report changed.')
  // Recompute gate from records; edited summary booleans cannot unlock validation.
  const records = await read<RecordResult[]>(join(out, 'records.json')), report = resultsReport(records, plan.identity.config, plan.coverageGaps)
  if (!development.passed || !report.gate.passed) throw new Error('Development gate failed; cannot freeze or consume reserved data.')
  const frozen = { planSha256: development.planSha256, developmentSha256: hash(await readFile(join(out, 'development.json'))) }
  if (command === 'freeze') {
    await writeFile(join(out, 'frozen.json'), json(frozen), { flag: 'wx' }); console.log('Candidate frozen.'); return
  }
  assert.deepEqual(await read(join(out, 'frozen.json')), frozen, 'Frozen identity changed.')
  if (!flags.has('--reserved') || !flags.has('--validation-out')) throw new Error('Validation requires --reserved and --validation-out.')
  // Claim the validation attempt BEFORE opening reserved inputs. Failed attempts
  // stay consumed and cannot be rerun after inspection/tuning.
  await writeFile(join(out, 'validation-attempt.json'), json({ ...frozen, reservedManifest: flags.get('--reserved') }), { flag: 'wx' })
  const reserved = await reservedInputs(root, flags.get('--reserved')!, new Set(plan.exposedProducts), new Set(plan.inputs.map((c) => hash(json(c.ocr)))))
  const validationOut = resolve(root, flags.get('--validation-out')!), validationRelative = relative(resolve(root, 'evaluation/results'), validationOut)
  if (!validationRelative || validationRelative.startsWith('..') || isAbsolute(validationRelative)) throw new Error('Validation output must be under evaluation/results.')
  await mkdir(validationOut)
  const validationRecords = reserved.inputs.map((c) => replay(c, plan.identity.config)), validationReport: Report = resultsReport(validationRecords, plan.identity.config)
  await writeFile(join(validationOut, 'records.json'), json(validationRecords), { flag: 'wx' })
  await writeFile(join(validationOut, 'report.json'), json(validationReport), { flag: 'wx' })
  await writeFile(join(validationOut, 'report.md'), markdown(validationReport), { flag: 'wx' })
  await writeFile(join(validationOut, 'fields.csv'), csv(validationRecords), { flag: 'wx' })
  await writeGallery(root, validationOut, validationRecords)
  await writeFile(join(out, 'validation.json'), json({ ...frozen, reservedManifestSha256: reserved.manifestSha256, output: relative(root, validationOut), productionGate: 'not evaluated: reference-phone UX/timing and sample-size agreement still required' }), { flag: 'wx' })
  console.log('Reserved replay complete; production adoption remains a separate decision.')
}
// Importing the module in tests does not execute a run.
if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 })
