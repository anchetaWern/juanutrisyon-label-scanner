import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { evaluateCase } from '../metrics'
import type { FieldResult } from '../types'
import { localReading, percentile, scoreReading } from './scoring'
import { replayOcr } from './replay'
import { json } from './dataset'
import type { Candidate, Plan, Run, Scale, Split } from './types'

export interface RecognitionMetrics {
  candidates: number
  numeric: { correct: number; total: number }
  unit: { correct: number; total: number }
  combined: { correct: number; total: number }
  recovered: number
  regressed: number
  numericRegressed: number
  failureCandidates: number
  failureRecovered: number
  failures: number
  cropFailures: number
  ambiguous: number
}
export function recognitionMetrics(records: Array<{ candidate: Candidate; raw: string | null; error: string | null; cropFailed: boolean }>): RecognitionMetrics {
  const metrics: RecognitionMetrics = { candidates: records.length, numeric: { correct: 0, total: 0 }, unit: { correct: 0, total: 0 }, combined: { correct: 0, total: 0 },
    recovered: 0, regressed: 0, numericRegressed: 0, failureCandidates: 0, failureRecovered: 0, failures: 0, cropFailures: 0, ambiguous: 0 }
  for (const { candidate, raw, error, cropFailed } of records) {
    const before = scoreReading(candidate.baselineRaw, candidate.truth), after = scoreReading(raw, candidate.truth)
    for (const key of ['numeric', 'unit', 'combined'] as const) {
      if (after[key] !== null) { metrics[key].total++; if (after[key]) metrics[key].correct++ }
    }
    if (before.combined === false && after.combined === true) metrics.recovered++
    if (before.combined === true && after.combined !== true) metrics.regressed++
    if (before.numeric === true && after.numeric !== true) metrics.numericRegressed++
    if (candidate.failureBefore === 'recognition' && before.combined !== null) { metrics.failureCandidates++; if (after.combined) metrics.failureRecovered++ }
    if (error) metrics.failures++
    if (cropFailed) metrics.cropFailures++
    if (raw === null || after.ambiguous) metrics.ambiguous++
  }
  return metrics
}
function counts(fields: FieldResult[]) {
  const scored = fields.filter((f) => !f.field.startsWith('serving.'))
  return { correct: scored.filter((f) => f.outcome === 'correct').length, missing: scored.filter((f) => f.outcome === 'missing').length,
    wrong: scored.filter((f) => f.outcome === 'wrong' || f.outcome === 'false-positive').length,
    servingCorrect: fields.filter((f) => f.field.startsWith('serving.') && f.outcome === 'correct').length,
    servingWrong: fields.filter((f) => f.field.startsWith('serving.') && ['wrong', 'false-positive'].includes(f.outcome)).length }
}
export function pipelineMetrics(plan: Plan, run: Run | null, split: Split, scale: Scale | null) {
  const rows = plan.images.filter((i) => i.split === split).map((image) => {
    const baseline = evaluateCase({ annotation: image.annotation, ocr: image.baseline })
    const replay = scale === null ? { ocr: image.baseline, applied: [] as string[], skipped: [] as string[] }
      : replayOcr(image.baseline, image.candidates, run?.results.filter((r) => r.imageId === image.id && r.scale === scale) ?? [])
    const after = evaluateCase({ annotation: image.annotation, ocr: replay.ocr })
    return { imageId: image.id, applied: replay.applied, skipped: replay.skipped, baseline: baseline.fields, fields: after.fields,
      ownerFields: after.fields.filter((f) => !image.supplementalFields.includes(f.field)),
      regressions: after.fields.filter((f) => baseline.fields.find((b) => b.field === f.field)?.outcome === 'correct' && f.outcome !== 'correct'),
      newWrong: after.fields.filter((f) => ['wrong', 'false-positive'].includes(f.outcome) && (() => {
        const before = baseline.fields.find((b) => b.field === f.field)!
        return !['wrong', 'false-positive'].includes(before.outcome) || before.predicted !== f.predicted
      })()) }
  })
  return { ...counts(rows.flatMap((r) => r.ownerFields)), expanded: counts(rows.flatMap((r) => r.fields)), regressions: rows.flatMap((r) => r.regressions).length,
    newWrong: rows.flatMap((r) => r.newWrong).length, applied: rows.reduce((n, r) => n + r.applied.length, 0),
    skipped: rows.reduce((n, r) => n + r.skipped.length, 0), rows }
}
const fraction = (n: number, d: number) => d ? n / d : null
const summary = (values: number[]) => ({ count: values.length, median: percentile(values, .5), p95: percentile(values, .95) })
function cohort(plan: Plan, run: Run | null, split: Split) {
  const images = plan.images.filter((i) => i.split === split)
  const candidates = images.flatMap((i) => i.candidates.filter((c) => c.review === 'verified'))
  const baseline = recognitionMetrics(candidates.map((candidate) => ({ candidate, raw: candidate.baselineRaw, error: null, cropFailed: false })))
  const variants = plan.scales.map((scale) => {
    const results = run?.results.filter((r) => r.scale === scale) ?? []
    const records = candidates.map((candidate) => {
      const result = results.find((r) => r.candidateId === candidate.id)
      return { candidate, raw: localReading(result?.ocr ?? null, candidate), rawOcr: result?.ocr?.text ?? null, ocr: result?.ocr ?? null,
        error: result?.error ?? (result ? null : 'not-run'), cropFailed: Boolean(result && !result.crop), result: result ?? null,
        before: scoreReading(candidate.baselineRaw, candidate.truth), after: scoreReading(localReading(result?.ocr ?? null, candidate), candidate.truth) }
    })
    const recognition = recognitionMetrics(records)
    const gainProducts = new Set(records.filter((r) => r.before.combined === false && r.after.combined === true).map((r) => images.find((i) => i.id === r.candidate.imageId)!.productId))
    const gainPatterns = new Set(records.filter((r) => r.before.combined === false && r.after.combined === true).map((r) => `${r.candidate.truth.numeric?.includes('.') ? 'decimal' : 'integer'}:${r.candidate.truth.unit}`))
    const baselineAccuracy = fraction(baseline.combined.correct, baseline.combined.total)
    const variantAccuracy = fraction(recognition.combined.correct, recognition.combined.total)
    const groups: Record<string, typeof records> = {}
    const group = (key: string, record: typeof records[number]) => { (groups[key] ??= []).push(record) }
    for (const record of records) {
      group(`digits:${record.candidate.truth.numeric?.replace(/\D/g, '').length ?? 'unknown'}`, record)
      group(`decimal:${record.candidate.truth.numeric?.includes('.') ?? false}`, record)
      group(`unit:${record.candidate.truth.unit ?? 'not-printed-in-region'}`, record)
      group(`height:${record.candidate.sourceBox.height <= 20 ? '<=20' : record.candidate.sourceBox.height <= 40 ? '21-40' : '>40'}px`, record)
      group(`failure:${record.candidate.failureBefore}`, record)
      for (const tag of images.find((i) => i.id === record.candidate.imageId)!.tags) group(`condition:${tag}`, record)
    }
    return { scale, complete: Boolean(run?.completedAt), recognition, pipeline: pipelineMetrics(plan, run, split, scale),
      breakdowns: Object.fromEntries(Object.entries(groups).map(([key, value]) => [key, recognitionMetrics(value)])),
      relativeCombinedImprovement: baselineAccuracy && variantAccuracy !== null ? (variantAccuracy - baselineAccuracy) / baselineAccuracy : null,
      failureRecoveryFraction: fraction(recognition.failureRecovered, recognition.failureCandidates), gainProducts: gainProducts.size, gainPatterns: gainPatterns.size,
      timing: { candidates: summary(results.map((r) => r.timing.totalMs)), labels: summary(run?.labels.filter((l) => l.scale === scale).map((l) => l.totalMs) ?? []),
        prediction: summary(results.map((r) => r.timing.recognitionMs)), extraction: summary(results.map((r) => r.timing.extractionMs)), resizeAndEncode: summary(results.map((r) => r.timing.resizeMs)) }, records }
  })
  return { labels: images.length, products: new Set(images.map((i) => i.productId)).size, candidates: candidates.length,
    pending: images.flatMap((i) => i.candidates).filter((c) => c.review === 'pending').length,
    labelsWithCandidates: images.filter((i) => i.candidates.some((c) => c.review === 'verified')).length,
    labelsWithCandidatesFraction: fraction(images.filter((i) => i.candidates.some((c) => c.review === 'verified')).length, images.length),
    baseline, baselinePipeline: pipelineMetrics(plan, null, split, null), variants,
    sessions: run?.sessions ?? [], failureClasses: Object.fromEntries(['none', 'detection', 'recognition', 'association', 'basis', 'unreadable', 'unknown'].map((key) => [key, candidates.filter((c) => c.failureBefore === key).length])) }
}
export function buildReport(plan: Plan, development: Run | null, reserved: Run | null) {
  const dev = cohort(plan, development, 'development'), holdout = cohort(plan, reserved, 'reserved')
  const gates = holdout.variants.map((v) => {
    const reasons: string[] = []
    if (!holdout.labels || !v.complete) reasons.push('Fresh reserved evaluation is unavailable/incomplete.')
    if (v.failureRecoveryFraction === null || v.failureRecoveryFraction < plan.policy.minimumFailureRecovery) reasons.push('Recognition-failure recovery is below 10% or unevaluable.')
    if (v.recognition.combined.correct <= holdout.baseline.combined.correct) reasons.push('No net combined accuracy improvement.')
    if (v.recognition.regressed > plan.policy.maximumReservedRegressions || v.recognition.numericRegressed > plan.policy.maximumReservedRegressions
      || v.pipeline.regressions) reasons.push('Baseline-correct recognition or parser fields regressed.')
    if (v.pipeline.wrong > holdout.baselinePipeline.wrong + plan.policy.maximumWrongIncrease || v.pipeline.expanded.wrong > holdout.baselinePipeline.expanded.wrong || v.pipeline.newWrong) reasons.push('New or changed wrong populated fields.')
    if (v.recognition.failures || v.recognition.cropFailures) reasons.push('Crop/provider failures.')
    if (v.gainProducts < 2 || v.gainPatterns < 2) reasons.push('Gains do not span multiple products/patterns.')
    const phone = holdout.sessions.length > 0 && holdout.sessions.every((s) => s.execution === 'manual-browser' && /Android|iPhone|iPad/i.test(String(s.userAgent)))
    if (!phone || !plan.policy.referenceDevice || plan.policy.phoneMedianLabelMs === null || plan.policy.phoneP95LabelMs === null) reasons.push('Reference phone latency gate is unevaluated.')
    else if (v.timing.labels.median === null || v.timing.labels.p95 === null || v.timing.labels.median > plan.policy.phoneMedianLabelMs
      || v.timing.labels.p95 > plan.policy.phoneP95LabelMs) reasons.push('Phone latency exceeds frozen limits.')
    if (!v.pipeline.applied || v.pipeline.skipped) reasons.push('Secondary replay coverage is incomplete.')
    return { scale: v.scale, passed: reasons.length === 0, reasons }
  })
  const completed = dev.variants.filter((v) => v.complete)
  const promisingDevelopment = completed.some((v) => v.recognition.combined.correct > dev.baseline.combined.correct
    && v.recognition.regressed === 0 && v.recognition.numericRegressed === 0 && v.pipeline.newWrong === 0)
  const recommendation = gates.some((g) => g.passed) ? 'Promising: worth separate production design.'
    : !completed.length ? 'Blocked: no completed reviewed development comparison; production adoption is unevaluated.'
      : promisingDevelopment ? 'Mixed: development shows a safe gain, but fresh reserved and phone gates must pass before production design.'
        : 'Negative on the reviewed development sample: local rerecognition does not preserve baseline accuracy. Keep production unchanged; compare an alternative recognizer on the same crops before adding broad preprocessing.'
  return { version: 1, parserVersion: plan.parserVersion, mode: plan.policy.mode, development: dev, reserved: holdout, gates, recommendation }
}
const exact = (m: { correct: number; total: number }) => m.total ? `${m.correct}/${m.total}` : 'N/A'
export async function writeReport(out: string, plan: Plan, development: Run | null, reserved: Run | null) {
  const report = buildReport(plan, development, reserved)
  const markdown = ['# Experiment A Results', '', '## Dataset', '',
    `- Development labels: ${report.development.labels}; fresh reserved labels: ${report.reserved.labels}.`,
    `- Labels with verified regions: ${report.development.labelsWithCandidates}; verified development regions: ${report.development.candidates}; pending review: ${report.development.pending}.`,
    `- Baseline recognition-failure candidates with printed units: ${report.development.baseline.failureCandidates}.`,
    '- Historical pilot holdout is exposed development data. Counts concern paired regions/products, not independent variant observations.',
    '- Region transcriptions are provisional Codex visual reviews. Owner-only nutrient replay is primary; expanded supplemental counts are separate.', '',
    '## Variants', '', 'Baseline saved production OCR; local original-color 1× and 2×; 20% padding per side; unchanged PP-OCRv6 tiny detector + recognizer. No character repair in recognition scoring.', '']
  for (const [title, data] of [['Recognition results', report.development], ['Reserved-set results', report.reserved]] as const) {
    markdown.push(`## ${title}`, '', '| Variant | Exact numeric | Exact unit | Exact value+unit | Wrong populated (replay) | Recovered | Regressions |', '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
      `| Baseline | ${exact(data.baseline.numeric)} | ${exact(data.baseline.unit)} | ${exact(data.baseline.combined)} | ${data.labels ? data.baselinePipeline.wrong : 'N/A'} | — | — |`)
    for (const v of data.variants) markdown.push(v.complete
      ? `| Local ${v.scale}× | ${exact(v.recognition.numeric)} | ${exact(v.recognition.unit)} | ${exact(v.recognition.combined)} | ${v.pipeline.wrong} | ${v.recognition.recovered} | ${v.recognition.regressed} |`
      : `| Local ${v.scale}× | Not run | Not run | Not run | N/A | N/A | N/A |`)
    markdown.push('', 'Printed-unit and combined metrics exclude unitless regions. Unreviewed/unreadable regions do not enter exact denominators. Missing/failed local outputs remain failures for readable targets.', '')
    for (const v of data.variants.filter((v) => v.complete)) markdown.push(`Local ${v.scale}×: recognition-failure recovery ${v.recognition.failureRecovered}/${v.recognition.failureCandidates}; numeric regressions ${v.recognition.numericRegressed}; secondary replay applied ${v.pipeline.applied}, skipped ${v.pipeline.skipped}; owner correct/missing/wrong nutrients ${v.pipeline.correct}/${v.pipeline.missing}/${v.pipeline.wrong}; expanded ${v.pipeline.expanded.correct}/${v.pipeline.expanded.missing}/${v.pipeline.expanded.wrong}; changed/new wrong fields ${v.pipeline.newWrong}; crop/provider failures ${v.recognition.cropFailures}/${v.recognition.failures}.`, '')
  }
  markdown.push('## Latency', '', 'Initialization is separate. Added label time includes source loading plus sequential crop extraction, resizing/PNG encoding and prediction; diagnostic serialization/transport is excluded. Desktop measurements do not establish phone performance.', '',
    '| Cohort / variant | Candidate median / p95 ms | Label median / p95 ms |', '| --- | ---: | ---: |')
  for (const [name, data] of [['development', report.development], ['reserved', report.reserved]] as const) for (const v of data.variants) markdown.push(`| ${name} ${v.scale}× | ${v.timing.candidates.median?.toFixed(1) ?? 'N/A'} / ${v.timing.candidates.p95?.toFixed(1) ?? 'N/A'} | ${v.timing.labels.median?.toFixed(1) ?? 'N/A'} / ${v.timing.labels.p95?.toFixed(1) ?? 'N/A'} |`)
  markdown.push('', '## Failure analysis', '', `Development classifications: ${JSON.stringify(report.development.failureClasses)}. Full per-region records, conditions, source text heights, raw OCR, and gains/regressions are in report.json and review.html.`, '')
  for (const heading of ['Digits', 'Decimals', 'Units', 'Tiny text', 'Glare', 'Curved labels']) {
    markdown.push(`### ${heading}`, '')
    for (const v of report.development.variants.filter((v) => v.complete)) {
      const group = v.records.filter((r) => heading === 'Digits' ? true : heading === 'Decimals' ? r.candidate.truth.numeric?.includes('.')
        : heading === 'Units' ? r.candidate.truth.unit !== null : heading === 'Tiny text' ? r.candidate.sourceBox.height <= 20
          : plan.images.find((i) => i.id === r.candidate.imageId)!.tags.includes(heading === 'Glare' ? 'glare' : 'curved'))
      const metrics = recognitionMetrics(group)
      markdown.push(`${v.scale}×: combined ${exact(metrics.combined)}, recovered ${metrics.recovered}, regressed ${metrics.regressed}.`)
    }
    markdown.push('')
  }
  for (const [heading, predicate] of [['Representative recoveries', (before: boolean | null, after: boolean | null) => before === false && after === true],
    ['Representative regressions', (before: boolean | null, after: boolean | null) => before === true && after !== true]] as const) {
    markdown.push(`## ${heading}`, '')
    const cases = report.development.variants.flatMap((v) => v.records.filter((r) => predicate(r.before.combined, r.after.combined)).slice(0, 5).map((r) =>
      `- ${r.candidate.id} (${v.scale}×): ${JSON.stringify(r.candidate.baselineRaw)} → ${JSON.stringify(r.rawOcr)}; truth ${r.candidate.truth.numeric} ${r.candidate.truth.unit}.`))
    markdown.push(...(cases.length ? cases : ['None in completed reviewed comparisons.']), '')
  }
  markdown.push('## Conclusion', '', report.recommendation, '', '## Recommendation', '', ...report.gates.map((g) => `- ${g.scale}×: ${g.passed ? 'passed frozen gates' : g.reasons.join(' ')}`), '',
    'Review development errors before any narrowly targeted follow-up. Do not tune against reserved results or change production OCR based solely on these development measurements.', '')
  await writeFile(join(out, 'report.json'), json(report)); await writeFile(join(out, 'report.md'), markdown.join('\n'))
  const csv = (v: unknown) => `"${String(v ?? '').replaceAll('"', '""')}"`
  const rows = [['split', 'candidate', 'image', 'field', 'variant', 'baseline_raw', 'raw_ocr', 'truth_numeric', 'truth_unit', 'numeric_correct', 'unit_correct', 'combined_correct', 'failure_before', 'error', 'source_height', 'latency_ms']]
  for (const [split, data] of [['development', report.development], ['reserved', report.reserved]] as const) for (const v of data.variants) for (const r of v.records) rows.push([
    split, r.candidate.id, r.candidate.imageId, r.candidate.field ?? '', String(v.scale), r.candidate.baselineRaw, r.rawOcr ?? '', r.candidate.truth.numeric ?? '', r.candidate.truth.unit ?? '',
    String(r.after.numeric), String(r.after.unit), String(r.after.combined), r.candidate.failureBefore, r.error ?? '', String(r.candidate.sourceBox.height), String(r.result?.timing.totalMs ?? '')])
  await writeFile(join(out, 'fields.csv'), rows.map((r) => r.map(csv).join(',')).join('\n') + '\n')
  return report
}
