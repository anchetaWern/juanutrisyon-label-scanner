import type { SourceDigest } from './load'
import { aggregate, buildReport } from './metrics'

export type Report = ReturnType<typeof buildReport> & { sources: SourceDigest[]; notes: string[] }
const pct = (value: number | null) => value === null ? 'N/A' : `${(value * 100).toFixed(2)}%`
const cell = (value: unknown) => String(value ?? '—').replaceAll('|', '\\|').replace(/[\r\n]+/g, ' ')

export function markdown(report: Report): string {
  const lines = [
    '# Nutrition extraction accuracy baseline', '',
    `Metric: \`${report.metricVersion}\`. Parser: ${report.parserVersions.map((v) => `\`${v}\``).join(', ')}. Mode: ${report.mode}.`, '',
    '## Field-level results', '',
    'Exact recall counts correct field/value pairs over readable annotated fields. Precision counts correct outputs over scored outputs (including wrong and false-positive outputs). Unreviewed fields are excluded.', '',
    '| Cohort / fields | Readable | Correct | Wrong | Missing | Exact recall | Precision | Coverage | False positives / negative fields |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ]
  for (const [name, group] of Object.entries(report.byCohort)) {
    for (const kind of ['nutrients', 'serving'] as const) {
      const s = group[kind]
      lines.push(`| ${name} / ${kind} | ${s.readable} | ${s.correct} | ${s.wrong} | ${s.missing} | ${pct(s.exactRecall)} | ${pct(s.precision)} | ${pct(s.coverage)} | ${s.falsePositive} / ${s.falsePositive + s.correctAbstention} |`)
    }
  }
  lines.push('', '## OCR presence proxies and recorded runtime', '',
    'These bounded matches search recognized lines across the panel. They do not prove detection, correct row association, or correct nutrition basis. No OCR character repair is applied by the metric.', '',
    '| Cohort | Name presence | Amount/string presence | Provider failures | Recorded desktop processing mean / p95 | Timing samples | Unscored outputs |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |')
  for (const [name, group] of Object.entries(report.byCohort)) {
    const n = group.all.namePresence, v = group.all.valuePresence, t = group.storedProcessingMs
    lines.push(`| ${name} | ${n.matched}/${n.total} | ${v.matched}/${v.total} | ${group.providerFailures}/${group.cases} | ${t.mean === null ? 'N/A' : `${t.mean.toFixed(0)} / ${t.p95!.toFixed(0)} ms`} | ${t.samples} | ${group.all.unscoredPredictions} |`)
  }
  lines.push('', `Detection recall: **N/A** — ${report.detectionRecall.reason}`, '', '## Historical splits', '',
    '| Cohort / split | Cases | Correct / readable fields | Exact recall | Wrong | Missing |',
    '| --- | ---: | ---: | ---: | ---: | ---: |')
  for (const [name, group] of Object.entries(report.bySplit)) {
    lines.push(`| ${name} | ${group.cases} | ${group.all.correct}/${group.all.readable} | ${pct(group.all.exactRecall)} | ${group.all.wrong} | ${group.all.missing} |`)
  }
  for (const overlap of report.crossCohortSplitOverlaps) {
    lines.push('', `Known overlap: **${overlap.productId}** (${overlap.cases.map((c) => `${c.id}: ${c.split}`).join('; ')}). ${overlap.note}`)
  }
  lines.push('', '## Ranked review queue', '',
    'Counts are affected fields, not independent images. Categories identify observable symptoms; detection versus recognition needs image/region review.', '',
    '| Triage category | Fields | Examples |', '| --- | ---: | --- |')
  for (const failure of report.rankedErrors) lines.push(`| ${failure.category} | ${failure.count} | ${failure.examples.join(', ')} |`)
  lines.push('', '## Per-case results', '',
    '| Case | Correct / readable | Wrong | Missing | False positives | Unscored outputs |', '| --- | ---: | ---: | ---: | ---: | ---: |')
  for (const entry of report.cases) {
    const s = aggregate([entry]).all
    lines.push(`| ${entry.annotation.id} | ${s.correct}/${s.readable} | ${s.wrong} | ${s.missing} | ${s.falsePositive} | ${s.unscoredPredictions} |`)
  }
  lines.push('', '## Wrong, false-positive, and unscored outputs', '',
    '| Case | Field | Expected/status | Output | Outcome |', '| --- | --- | --- | --- | --- |')
  for (const f of report.cases.flatMap((c) => c.fields).filter((f) => f.outcome === 'wrong' || f.outcome === 'false-positive' || (f.outcome === 'unscored' && f.predicted !== null))) {
    lines.push(`| ${cell(f.caseId)} | ${cell(f.field)} | ${cell(typeof f.truth === 'string' ? f.truth : f.truth.status)} | ${cell(f.predicted)} | ${f.outcome} |`)
  }
  lines.push('', '## Scope and limitations', '', ...report.notes.map((note) => `- ${note}`), '',
    'Full field outcomes, original OCR evidence indexes, parser warnings, source SHA-256 digests, and results by field/tag are in report.json. fields.csv provides a review worksheet. No confidence score is interpreted as calibrated correctness.', '')
  return lines.join('\n')
}

export function csv(report: Report): string {
  const escapeCsv = (value: unknown) => {
    let text = String(value ?? '')
    // Keep exported raw OCR from becoming spreadsheet formulas.
    if (/^[=+@\-\t\r]/.test(text)) text = `'${text}`
    return `"${text.replaceAll('"', '""')}"`
  }
  const rows: unknown[][] = [['case', 'cohort', 'split', 'field', 'truth_status', 'expected', 'predicted', 'outcome', 'triage', 'ocr_evidence', 'line_indexes', 'warnings']]
  for (const c of report.cases) for (const f of c.fields) rows.push([
    c.annotation.id, c.annotation.cohort, c.annotation.split, f.field,
    typeof f.truth === 'string' ? 'readable' : f.truth.status, typeof f.truth === 'string' ? f.truth : '',
    f.predicted, f.outcome, f.triage, f.evidence?.text, f.evidence?.lineIndexes.join(' '), f.warnings.join(' | '),
  ])
  return `${rows.map((row) => row.map(escapeCsv).join(',')).join('\n')}\n`
}
