import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadCases } from './load'
import { buildReport, evaluateCase } from './metrics'
import { csv, markdown } from './report'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
async function main() {
  const options: Record<string, string> = {}
  const args = process.argv.slice(2)
  if (args.includes('--help')) {
    console.log('Usage: npm run evaluate -- [--legacy benchmark] [--run benchmark/results/<candidate>.json] [--out evaluation/results/<name>]\nDefault: portable mobile fixtures only. --legacy explicitly requires the local corpus; missing/corrupt inputs fail. Outputs: report.json, report.md, fields.csv. No OCR is run.')
    return
  }
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]!, value = args[i + 1]
    if (!['--legacy', '--run', '--out'].includes(key) || !value || value.startsWith('--') || key in options) throw new Error(`Invalid or repeated argument: ${key}. Use --help.`)
    options[key] = value
  }
  if (options['--run'] && !options['--legacy']) throw new Error('--run requires --legacy.')
  const out = resolve(root, options['--out'] ?? 'evaluation/results/latest')
  const relativeOut = relative(resolve(root, 'evaluation/results'), out)
  if (!relativeOut || relativeOut.startsWith('..') || isAbsolute(relativeOut)) throw new Error('--out must be a subdirectory of evaluation/results/.')
  const { cases, sources, notes } = await loadCases(root, options['--legacy'], options['--run'])
  const report = { ...buildReport(cases.map((entry) => evaluateCase(entry))), sources, notes }
  await mkdir(out, { recursive: true })
  await writeFile(resolve(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  await writeFile(resolve(out, 'report.md'), markdown(report))
  await writeFile(resolve(out, 'fields.csv'), csv(report))
  for (const [cohort, group] of Object.entries(report.byCohort)) {
    console.log(`${cohort}: ${group.cases} cases; nutrients ${group.nutrients.correct}/${group.nutrients.readable}; serving ${group.serving.correct}/${group.serving.readable}; wrong ${group.all.wrong}; false positive ${group.all.falsePositive}; unscored outputs ${group.all.unscoredPredictions}`)
  }
  console.log(`Reports: ${relative(root, out)}/report.{json,md} and fields.csv`)
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
