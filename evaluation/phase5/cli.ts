import { execFileSync } from 'node:child_process'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { parseNutrition, type NutritionExtraction } from '../../src/services/nutrition/parseNutrition'
import type { OcrResult } from '../../src/services/ocr/types'
import { loadCases } from '../load'
import { buildReport, evaluateCase } from '../metrics'
import { markdown, csv } from '../report'
import { loadPilotDataset, sha256 } from '../pilot/dataset'
import { ownerOnlyCases, pilotCases } from '../pilot/report'
import type { PilotRun } from '../pilot/types'
import type { EvaluationCase } from '../types'
import { comparisonGate, fieldChanges } from './report'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const baselineRevision = '57234a0'
const pilotDirectory = 'evaluation/results/phase-2-pilot-2026-10-11'
const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n'
const exists = async (path: string) => { try { await access(path); return true } catch { return false } }

async function main() {
  const [mode, ...args] = process.argv.slice(2)
  if (mode === '--help') { console.log('Usage: phase5 <develop|freeze|validate> --out evaluation/results/<new-name>\nSaved OCR only. develop scores the ten development products and exposed historical regressions against parser v2 from commit 57234a0; freeze locks passing development results and source hashes; validate scores only the five reserved products with that exact parser. Use a new directory for a new development iteration.'); return }
  if (!['develop', 'freeze', 'validate'].includes(mode ?? '') || args.length !== 2 || args[0] !== '--out') throw new Error('Expected <develop|freeze|validate> --out evaluation/results/<directory>.')
  const out = resolve(root, args[1]!)
  const rel = relative(join(root, 'evaluation/results'), out)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Output must be a subdirectory of evaluation/results/.')
  const dataset = await loadPilotDataset(root)
  const runBytes = await readFile(join(root, pilotDirectory, 'run.json'))
  const pilotRun = JSON.parse(runBytes.toString()) as PilotRun
  const baselineSource = execFileSync('git', ['show', `${baselineRevision}:src/services/nutrition/parseNutrition.ts`], { cwd: root, encoding: 'utf8' })
  const compiled = ts.transpileModule(baselineSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  const baseline = (await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)).parseNutrition as (result: OcrResult) => NutritionExtraction
  const paths = ['src/services/nutrition/parseNutrition.ts', 'evaluation/metrics.ts',
    'evaluation/load.ts', 'evaluation/pilot/dataset.ts', 'evaluation/pilot/report.ts', 'evaluation/phase5/cli.ts', 'evaluation/phase5/report.ts']
  const sources = await Promise.all(paths.map(async (path) => ({ path, sha256: sha256(await readFile(join(root, path))) })))
  const identity = { baselineRevision, baselineParserSha256: sha256(baselineSource), datasetFingerprint: dataset.fingerprint,
    pilotRunSha256: sha256(runBytes), sources }
  async function compare(name: string, cases: EvaluationCase[], owner = false) {
    const beforeExpanded = cases.map((c) => evaluateCase(c, baseline(c.ocr ?? { text: '', lines: [], engine: 'failed' })))
    const afterExpanded = cases.map((c) => evaluateCase(c, parseNutrition(c.ocr ?? { text: '', lines: [], engine: 'failed' })))
    const before = owner ? ownerOnlyCases(dataset, beforeExpanded) : beforeExpanded
    const after = owner ? ownerOnlyCases(dataset, afterExpanded) : afterExpanded
    const beforeReport = buildReport(before), afterReport = buildReport(after)
    const delta = fieldChanges(before, after), expandedDelta = fieldChanges(beforeExpanded, afterExpanded)
    const gate = comparisonGate(beforeExpanded, afterExpanded)
    const summary = { before: beforeReport.byCohort, after: afterReport.byCohort,
      expandedBefore: buildReport(beforeExpanded).byCohort, expandedAfter: buildReport(afterExpanded).byCohort, gate, changes: delta, expandedChanges: expandedDelta }
    const dir = join(out, name)
    await mkdir(dir, { recursive: true })
    const report = { ...afterReport, sources, notes: ['Saved OCR replay; only the parser changed. Primary pilot metrics use owner-verified fields.',
      'Supplemental/negative annotations are audited separately. Historical cases are exposed regressions, not a new blind validation set.'] }
    await writeFile(join(dir, 'report.json'), json(report))
    await writeFile(join(dir, 'report.md'), markdown(report))
    await writeFile(join(dir, 'fields.csv'), csv(report))
    await writeFile(join(dir, 'comparison.json'), json(summary))
    for (const [cohort, a] of Object.entries(summary.after)) console.log(`${name}/${cohort}: nutrients ${summary.before[cohort]!.nutrients.correct} -> ${a.nutrients.correct}/${a.nutrients.readable}; serving ${summary.before[cohort]!.serving.correct} -> ${a.serving.correct}/${a.serving.readable}; wrong ${a.all.wrong}; false positives ${a.all.falsePositive}`)
    return summary
  }
  if (mode === 'develop') {
    if (await exists(out)) throw new Error('Use a new output directory for each development iteration.')
    await mkdir(out, { recursive: true })
    // Filter before invoking either parser: reserved products cannot affect development selection.
    const cases = pilotCases(dataset, pilotRun).filter((c) => c.annotation.split === 'development')
    const pilot = await compare('development', cases, true)
    const legacy = await loadCases(root, 'benchmark')
    const regression = await compare('regression', legacy.cases)
    const development = { ...identity, regressionSources: legacy.sources, pilot, regression,
      passed: pilot.gate.passed && regression.gate.passed }
    await writeFile(join(out, 'development.json'), json(development))
    console.log(`Development gate: ${development.passed ? 'passed' : 'failed'}`)
    if (!development.passed) process.exitCode = 1
  } else {
    const developmentBytes = await readFile(join(out, 'development.json'))
    const development = JSON.parse(developmentBytes.toString()) as typeof identity & { passed: boolean }
    for (const key of Object.keys(identity) as Array<keyof typeof identity>) if (json(development[key]) !== json(identity[key])) throw new Error('Parser, scoring code or inputs changed after development. Start a new iteration.')
    if (!development.passed) throw new Error('Development gate failed; cannot freeze or validate this candidate.')
    const frozen = { ...identity, developmentSha256: sha256(developmentBytes) }
    if (mode === 'freeze') {
      await writeFile(join(out, 'frozen.json'), json(frozen), { flag: 'wx' })
      console.log('Parser frozen for validation.')
    } else {
      if (await readFile(join(out, 'frozen.json'), 'utf8') !== json(frozen)) throw new Error('Frozen parser or development results changed.')
      if (await exists(join(out, 'validation.json'))) throw new Error('Validation already recorded. Do not retune against these outcomes.')
      const cases = pilotCases(dataset, pilotRun).filter((c) => c.annotation.split === 'holdout')
      const validation = await compare('holdout', cases, true)
      await writeFile(join(out, 'validation.json'), json({ ...frozen, ...validation }))
      console.log(`Validation gate: ${validation.gate.passed ? 'passed' : 'failed'}`)
      if (!validation.gate.passed) process.exitCode = 1
    }
  }
}
main().catch((cause: unknown) => { console.error(cause instanceof Error ? cause.message : String(cause)); process.exitCode = 1 })
