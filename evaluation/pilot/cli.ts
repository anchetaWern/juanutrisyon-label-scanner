import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadPilotDataset } from './dataset'
import { runBrowser } from './runner'
import { writePilotReport } from './report'
import { writeGallery } from './gallery'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
async function exists(path: string) { try { await access(path); return true } catch { return false } }
async function main() {
  const [mode, ...inputArgs] = process.argv.slice(2)
  const resume = inputArgs.includes('--resume')
  const args = inputArgs.filter((arg) => arg !== '--resume')
  if (args.includes('--help') || mode === '--help') {
    console.log('Usage: node --import tsx evaluation/pilot/cli.ts <prepare|run|report> [--out evaluation/results/<new-name>] [--resume]\nprepare: validate all pairs and render 45 review crops/quality checks, no OCR. run: production browser OCR on prepared crops; --resume continues a checkpoint with identical code/data. report: rescore saved OCR. Images stay local; first OCR run downloads runtime/models. CHROME_PATH can select an installed Chrome executable.')
    return
  }
  if (!['prepare', 'run', 'report'].includes(mode ?? '')) throw new Error('Choose prepare, run, or report. Use --help.')
  if (resume && (mode !== 'run' || inputArgs.filter((a) => a === '--resume').length !== 1)) throw new Error('--resume is allowed once, with run only.')
  if (args.length && (args.length !== 2 || args[0] !== '--out' || !args[1] || args[1].startsWith('--'))) throw new Error('Expected only --out <directory>.')
  const out = resolve(root, args[1] ?? 'evaluation/results/phase-2-pilot')
  const rel = relative(resolve(root, 'evaluation/results'), out)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('--out must be a subdirectory of evaluation/results/.')
  const dataset = await loadPilotDataset(root)
  if (mode === 'prepare') {
    if (await exists(out)) throw new Error('Output directory already exists. Choose a new --out directory to preserve previous artifacts.')
    await mkdir(out, { recursive: true })
    await writeFile(join(out, 'dataset.json'), JSON.stringify(dataset, null, 2) + '\n')
  } else {
    const saved = JSON.parse(await readFile(join(out, 'dataset.json'), 'utf8')) as { fingerprint?: string }
    if (saved.fingerprint !== dataset.fingerprint) throw new Error('Dataset changed after preparation. Use a fresh --out directory.')
    if (mode === 'run' && !resume && await exists(join(out, 'run.json'))) throw new Error('A run already exists. Use --resume with identical code/data or a new output directory for a new experiment.')
  }
  console.log(`Pilot: ${dataset.cases.length} images; ${dataset.cases.filter((c) => c.split === 'development').length} development / ${dataset.cases.filter((c) => c.split === 'holdout').length} validation. Fingerprint: ${dataset.fingerprint}`)
  if (mode === 'prepare' || mode === 'run') await runBrowser(root, out, dataset, mode, resume)
  if (mode === 'prepare') await writeGallery(out, dataset)
  if (mode === 'run' || mode === 'report') await writePilotReport(root, out, dataset)
  console.log(`Artifacts: ${relative(root, out)}`)
}
main().catch((cause: unknown) => { console.error(cause instanceof Error ? cause.message : String(cause)); process.exitCode = 1 })
