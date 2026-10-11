import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadPilotDataset, sha256 } from '../pilot/dataset'
import { runBrowser, runtimeSources } from '../pilot/runner'
import { writeGallery } from '../pilot/gallery'
import { experiments, selectionPolicy } from './experiments'
import { reportRun, selectDevelopment, validationGate } from './report'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n'
const exists = async (path: string) => { try { await access(path); return true } catch { return false } }
async function main() {
  const [mode, ...args] = process.argv.slice(2)
  if (mode === '--help') { console.log('Usage: phase4 <prepare|develop|validate|report> --out evaluation/results/<new-name>\nprepare freezes the plan and renders the 45 crops; develop runs the frozen six configurations on development only and selects one; validate evaluates control and the selected configuration only; report rescores development OCR. Completed cases resume automatically with identical code/data/config.'); return }
  if (!['prepare', 'develop', 'validate', 'report'].includes(mode ?? '') || args.length !== 2 || args[0] !== '--out') throw new Error('Expected <prepare|develop|validate|report> --out evaluation/results/<directory>.')
  const out = resolve(root, args[1]!)
  const rel = relative(resolve(root, 'evaluation/results'), out)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Output must be a subdirectory of evaluation/results/.')
  const dataset = await loadPilotDataset(root)
  const scoringPaths = ['src/services/nutrition/parseNutrition.ts', 'evaluation/metrics.ts', 'evaluation/phase4/experiments.ts', 'evaluation/phase4/report.ts', 'evaluation/phase4/cli.ts']
  const scoringSources = await Promise.all(scoringPaths.map(async (path) => ({ path, sha256: sha256(await readFile(join(root, path))) })))
  const plan = { version: 1, datasetFingerprint: dataset.fingerprint, experiments, selectionPolicy, runtimeSources: await runtimeSources(root), scoringSources }
  if (mode === 'prepare') {
    if (await exists(out)) throw new Error('Choose a new directory to preserve prior experiments.')
    await mkdir(out, { recursive: true })
    await writeFile(join(out, 'plan.json'), json(plan))
    await writeFile(join(out, 'dataset.json'), json(dataset))
    await runBrowser(root, out, dataset, 'prepare')
    await writeGallery(out, dataset)
    return
  }
  const frozen = await readFile(join(out, 'plan.json'), 'utf8')
  if (frozen !== json(plan)) throw new Error('Plan, runtime, scoring code or dataset changed. Prepare a new experiment directory.')
  async function run(id: string, split: 'development' | 'holdout') {
    const experiment = experiments.find((e) => e.id === id)
    if (!experiment) throw new Error('Unknown experiment')
    const runOut = join(out, split, id)
    await mkdir(runOut, { recursive: true })
    console.log(`${split}/${id}: ${experiment.hypothesis}`)
    await runBrowser(root, runOut, dataset, 'run', await exists(join(runOut, 'run.json')), { config: experiment.config, split, preparedDirectory: out })
    return reportRun(runOut, dataset, split)
  }
  if (mode === 'develop' || mode === 'report') {
    if (await exists(join(out, 'validation.json'))) throw new Error('Development is frozen after validation. Use a new experiment directory for further work.')
    if (mode === 'develop') for (const experiment of experiments) await run(experiment.id, 'development')
    const selection = await selectDevelopment(out, dataset)
    await writeFile(join(out, 'selection.json'), json(selection))
    console.log(`Development selection: ${selection.selected}`)
    for (const [id, result] of Object.entries(selection.results)) console.log(`${id}: rectangle nutrients ${result.byVariant.rectangle!.nutrients.correct}/${result.byVariant.rectangle!.nutrients.readable}; wrong ${result.byVariant.rectangle!.all.wrong}; eligible ${selection.gates[id]?.eligible ?? 'control'}`)
  } else {
    const bytes = await readFile(join(out, 'selection.json'))
    const selection = JSON.parse(bytes.toString()) as Awaited<ReturnType<typeof selectDevelopment>>
    const expected = await selectDevelopment(out, dataset)
    if (json(selection) !== json(expected)) throw new Error('Development selection changed or was edited.')
    const control = await run('control', 'holdout')
    const candidate = selection.selected === 'control' ? control : await run(selection.selected, 'holdout')
    const gate = validationGate(candidate.byVariant, control.byVariant)
    const validation = { selectionSha256: sha256(bytes), selected: selection.selected, gate, control, candidate,
      decision: selection.selected !== 'control' && gate.accepted ? 'eligible-for-production-review' : 'retain-control' }
    await writeFile(join(out, 'validation.json'), json(validation))
    console.log(`Validation: ${validation.decision}; ${gate.failures.join('; ')}`)
  }
}
main().catch((cause: unknown) => { console.error(cause instanceof Error ? cause.message : String(cause)); process.exitCode = 1 })
