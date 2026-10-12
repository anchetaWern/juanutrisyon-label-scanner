import { mkdir, readFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sha256 } from '../pilot/dataset'
import { draftManifest, preparePlan, verifyPlan } from './dataset'
import { writeGallery } from './gallery'
import { checkCheckpoint, exists, runExperiment, writeJson } from './runner'
import { writeReport } from './report'
import type { Plan, Run, Split } from './types'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
async function main() {
  const [mode, ...args] = process.argv.slice(2)
  if (mode === '--help') { console.log('Usage: experiment:a <prepare|develop|report|freeze|validate> --out evaluation/results/<new-name> [--baseline <pilot-directory>] [--manifest <review.json>] [--manual]\nprepare writes source crops, a pending review manifest, and an immutable plan. Review regions and prepare a new directory using --manifest. develop runs verified development regions at 1x/2x. freeze locks completed development evidence. validate runs only fresh reserved products. report replays saved OCR. --manual opens a loopback server for a reference browser. No production behavior changes.'); return }
  if (!['prepare', 'develop', 'report', 'freeze', 'validate'].includes(mode ?? '')) throw new Error('Choose prepare, develop, report, freeze or validate; see --help.')
  const options: Record<string, string> = {}; let manual = false
  for (let i = 0; i < args.length; i++) {
    const key = args[i]!
    if (key === '--manual' && !manual) { manual = true; continue }
    if (!['--out', '--baseline', '--manifest'].includes(key) || key in options || !args[i + 1] || args[i + 1]!.startsWith('--')) throw new Error('Invalid/duplicate argument.')
    options[key] = args[++i]!
  }
  if (!options['--out'] || (mode !== 'prepare' && (options['--baseline'] || options['--manifest'])) || (manual && !['develop', 'validate'].includes(mode!))) throw new Error('Invalid options for command.')
  const out = resolve(root, options['--out']), rel = relative(join(root, 'evaluation/results'), out)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Output must be a subdirectory of evaluation/results/.')
  if (mode === 'prepare') {
    if (await exists(out)) throw new Error('Choose a new output directory.')
    const plan = await preparePlan(root, options['--baseline'] ?? 'evaluation/results/phase-2-pilot-2026-10-11', options['--manifest'])
    await mkdir(out, { recursive: true }); await writeJson(join(out, 'plan.json'), plan)
    await writeJson(join(out, 'identity.json'), { planSha256: sha256(await readFile(join(out, 'plan.json'))) })
    await writeJson(join(out, 'review-manifest.json'), draftManifest(plan))
    await writeGallery(root, out, plan)
    console.log(`Prepared ${plan.images.length} labels / ${plan.images.flatMap((i) => i.candidates).length} proposed regions; ${plan.images.flatMap((i) => i.candidates).filter((c) => c.review === 'verified').length} verified. Inspect ${options['--out']}/review.html. No OCR run.`)
    return
  }
  const planBytes = await readFile(join(out, 'plan.json')), plan = JSON.parse(planBytes.toString()) as Plan
  const identity = JSON.parse(await readFile(join(out, 'identity.json'), 'utf8')) as { planSha256: string }
  if (identity.planSha256 !== sha256(planBytes)) throw new Error('Prepared plan changed; use a review manifest and a fresh output directory.')
  await verifyPlan(root, plan)
  const loadRun = async (split: Split): Promise<Run | null> => {
    const file = join(out, `${split}-run.json`)
    if (!await exists(file)) return null
    const run = JSON.parse(await readFile(file, 'utf8')) as Run
    checkCheckpoint(run, plan, sha256(planBytes), split)
    for (const result of run.results) if (result.crop && sha256(await readFile(join(out, result.crop.path))) !== result.crop.sha256) throw new Error('Saved crop changed.')
    return run
  }
  if (mode === 'develop') {
    if (await exists(join(out, 'frozen.json')) || await exists(join(out, 'validation-started.json'))) throw new Error('Development is frozen; prepare a new study with untouched reserved data.')
    await runExperiment(root, out, plan, 'development', manual)
  }
  if (mode === 'freeze') {
    if (await exists(join(out, 'frozen.json'))) throw new Error('Experiment already frozen.')
    const development = await loadRun('development')
    if (!development?.completedAt) throw new Error('Complete development before freezing.')
    await writeJson(join(out, 'frozen.json'), { planSha256: sha256(planBytes), developmentSha256: sha256(await readFile(join(out, 'development-run.json'))), at: new Date().toISOString() })
  }
  if (mode === 'validate') {
    const frozen = JSON.parse(await readFile(join(out, 'frozen.json'), 'utf8')) as { planSha256: string; developmentSha256: string }
    if (frozen.planSha256 !== sha256(planBytes) || frozen.developmentSha256 !== sha256(await readFile(join(out, 'development-run.json')))) throw new Error('Frozen plan/development changed.')
    if (!plan.images.some((i) => i.split === 'reserved')) throw new Error('No fresh reserved data. Existing pilot holdout is exposed; do not relabel it reserved.')
    if (await exists(join(out, 'validation.json'))) throw new Error('Reserved evaluation already completed; do not tune against it.')
    if (!await exists(join(out, 'validation-started.json'))) await writeJson(join(out, 'validation-started.json'), { planSha256: sha256(planBytes), at: new Date().toISOString() })
    await runExperiment(root, out, plan, 'reserved', manual)
  }
  const development = await loadRun('development'), reserved = await loadRun('reserved')
  const report = await writeReport(out, plan, development, reserved)
  await writeGallery(root, out, plan, [development, reserved].filter((r): r is Run => r !== null))
  if (mode === 'validate') await writeJson(join(out, 'validation.json'), { gates: report.gates, recommendation: report.recommendation })
  console.log(`${report.recommendation}\nArtifacts: ${options['--out']}/report.md`)
}
main().catch((cause: unknown) => { console.error(cause instanceof Error ? cause.message : String(cause)); process.exitCode = 1 })
