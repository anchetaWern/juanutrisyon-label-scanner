import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { aggregate, buildReport, evaluateCase } from '../metrics'
import { validateCases } from '../load'
import { csv, markdown } from '../report'
import { ownerOnlyCases } from '../pilot/report'
import { VARIANTS, type PilotDataset, type PilotRun } from '../pilot/types'
import { sha256 } from '../pilot/dataset'
import { experiments, selectionPolicy } from './experiments'

export function scoreRun(dataset: PilotDataset, run: PilotRun, split: 'development' | 'holdout') {
  if (run.version !== 1 || !run.completedAt || run.datasetFingerprint !== dataset.fingerprint || run.request?.split !== split) throw new Error('Experiment run is incomplete or has a different dataset/split.')
  const entries = new Map(dataset.cases.filter((c) => c.split === split).map((c) => [c.id, c]))
  const seen = new Set<string>()
  const cases = run.results.map((r) => {
    const entry = entries.get(r.id), key = `${r.id}/${r.variant}`
    if (!entry || !VARIANTS.includes(r.variant) || seen.has(key)) throw new Error(`Unexpected or duplicate experiment case: ${key}`)
    seen.add(key)
    return { annotation: { ...entry.annotation, id: key, cohort: r.variant }, ocr: r.ocr, error: r.error, recordedProcessingMs: r.processingMs }
  })
  if (seen.size !== entries.size * VARIANTS.length) throw new Error('Missing experiment cases must remain in the denominator.')
  validateCases(cases)
  const expanded = cases.map((entry) => evaluateCase(entry))
  const owner = ownerOnlyCases(dataset, expanded)
  return { owner, expanded, byVariant: Object.fromEntries(VARIANTS.map((v) => [v, aggregate(owner.filter((c) => c.annotation.cohort === v))])) }
}
export type ExperimentSummary = ReturnType<typeof scoreRun>['byVariant']

export function developmentGate(candidate: ExperimentSummary, control: ExperimentSummary) {
  const failures: string[] = []
  for (const v of VARIANTS) {
    if (candidate[v]!.providerFailures) failures.push(`${v}: provider failure`)
    if (candidate[v]!.nutrients.wrong > control[v]!.nutrients.wrong) failures.push(`${v}: more wrong nutrients`)
    if (candidate[v]!.serving.wrong > control[v]!.serving.wrong) failures.push(`${v}: more wrong serving strings`)
  }
  if (candidate.rectangle!.nutrients.correct < control.rectangle!.nutrients.correct + selectionPolicy.minimumAdditionalNutrients) failures.push('Insufficient rectangle nutrient improvement')
  if (VARIANTS.reduce((sum, v) => sum + candidate[v]!.nutrients.correct - control[v]!.nutrients.correct, 0) < 0) failures.push('Fewer nutrients across paired variants')
  const candidateTime = candidate.rectangle!.storedProcessingMs, controlTime = control.rectangle!.storedProcessingMs
  if (candidateTime.mean == null || controlTime.mean == null || candidateTime.mean > controlTime.mean * selectionPolicy.maximumMeanTimeRatio) failures.push('Rectangle mean runtime exceeds budget')
  if (candidateTime.p95 == null || controlTime.p95 == null || candidateTime.p95 > controlTime.p95 * selectionPolicy.maximumP95TimeRatio) failures.push('Rectangle p95 runtime exceeds budget')
  return { eligible: failures.length === 0, failures }
}
export function validationGate(candidate: ExperimentSummary, control: ExperimentSummary) {
  const failures: string[] = []
  for (const v of VARIANTS) {
    if (candidate[v]!.providerFailures) failures.push(`${v}: provider failure`)
    if (candidate[v]!.nutrients.wrong > control[v]!.nutrients.wrong || candidate[v]!.serving.wrong > control[v]!.serving.wrong) failures.push(`${v}: more wrong fields`)
  }
  if (candidate.rectangle!.nutrients.correct < control.rectangle!.nutrients.correct) failures.push('Fewer validation rectangle nutrients')
  if (candidate.rectangle!.serving.correct < control.rectangle!.serving.correct) failures.push('Fewer validation rectangle serving fields')
  return { accepted: failures.length === 0, failures }
}
export async function reportRun(out: string, dataset: PilotDataset, split: 'development' | 'holdout') {
  const bytes = await readFile(join(out, 'run.json'))
  const run = JSON.parse(bytes.toString()) as PilotRun
  const scored = scoreRun(dataset, run, split)
  const report = { ...buildReport(scored.owner), mode: 'phase-4-saved-browser-ocr',
    sources: [...dataset.sources, ...run.sources, { path: 'run.json', sha256: sha256(bytes) }],
    notes: ['Primary metrics include only owner-verified fields. Supplements remain outside candidate selection.',
      'Paired variants share the same photographs. Desktop timings exclude initialization and are not phone timings.'] }
  await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  await writeFile(join(out, 'report.md'), markdown(report))
  await writeFile(join(out, 'fields.csv'), csv(report))
  return { byVariant: scored.byVariant, runSha256: sha256(bytes), config: run.config }
}
export async function selectDevelopment(out: string, dataset: PilotDataset) {
  const results = Object.fromEntries(await Promise.all(experiments.map(async (e) => [e.id, await reportRun(join(out, 'development', e.id), dataset, 'development')] as const)))
  const control = results.control!.byVariant
  const gates = Object.fromEntries(experiments.filter((e) => e.id !== 'control').map((e) => [e.id, developmentGate(results[e.id]!.byVariant, control)]))
  const eligible = experiments.filter((e) => gates[e.id]?.eligible).sort((a, b) => {
    const x = results[a.id]!.byVariant.rectangle!, y = results[b.id]!.byVariant.rectangle!
    return y.nutrients.correct - x.nutrients.correct || x.all.wrong - y.all.wrong || (x.storedProcessingMs.mean ?? Infinity) - (y.storedProcessingMs.mean ?? Infinity)
  })
  const selected = eligible[0]?.id ?? 'control'
  return { version: 1, datasetFingerprint: dataset.fingerprint, policy: selectionPolicy, selected, selectedConfig: experiments.find((e) => e.id === selected)!.config, results, gates }
}
