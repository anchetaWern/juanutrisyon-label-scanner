import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { buildReport, evaluateCase, aggregate } from '../metrics'
import { validateCases } from '../load'
import { markdown, csv } from '../report'
import type { CaseResult, EvaluationCase } from '../types'
import { sha256 } from './dataset'
import { VARIANTS, type PilotDataset, type PilotRun, type PilotResult } from './types'

export function pilotCases(dataset: PilotDataset, run: PilotRun): EvaluationCase[] {
  if (run.version !== 1 || !run.completedAt || run.datasetFingerprint !== dataset.fingerprint) throw new Error('Run is incomplete or belongs to a different dataset.')
  const entries = new Map(dataset.cases.map((entry) => [entry.id, entry]))
  const seen = new Set<string>()
  const cases = run.results.map((row): EvaluationCase => {
    const entry = entries.get(row.id), key = `${row.id}/${row.variant}`
    if (!entry || !VARIANTS.includes(row.variant) || seen.has(key)) throw new Error(`Unexpected or duplicate result: ${key}`)
    seen.add(key)
    return { annotation: { ...entry.annotation, id: key, cohort: `phase-2-${row.variant}` },
      ocr: row.ocr, error: row.error, recordedProcessingMs: row.processingMs }
  })
  if (seen.size !== dataset.cases.length * VARIANTS.length) throw new Error('Every pilot image requires every variant; missing results cannot be skipped.')
  validateCases(cases)
  return cases
}

export function ownerOnlyCases(dataset: PilotDataset, scored: CaseResult[]): CaseResult[] {
  return scored.map((entry) => {
    const id = entry.annotation.id.split('/')[0]!
    const source = dataset.cases.find((c) => c.id === id)
    if (!source) throw new Error(`Unknown owner annotation: ${id}`)
    return { ...entry, fields: entry.fields.filter((f) => f.field in source.annotation.fields && !(f.field in source.supplementalFields)) }
  })
}
function confusion(pairs: Array<{ expected: boolean; predicted: boolean }>) {
  const count = (expected: boolean, predicted: boolean) => pairs.filter((p) => p.expected === expected && p.predicted === predicted).length
  const tp = count(true, true), fp = count(false, true), tn = count(false, false), fn = count(true, false)
  return { samples: pairs.length, truePositive: tp, falsePositive: fp, trueNegative: tn, falseNegative: fn,
    precision: tp + fp ? tp / (tp + fp) : null, recall: tp + fn ? tp / (tp + fn) : null }
}
export function calibration(dataset: PilotDataset, rows: PilotResult[]) {
  const entries = new Map(dataset.cases.map((entry) => [entry.id, entry]))
  const groups = Object.fromEntries(VARIANTS.flatMap((variant) => ['development', 'holdout'].map((split) => {
    const group = rows.filter((r) => r.variant === variant && entries.get(r.id)?.split === split)
    const valid = group.filter((r) => !r.quality.error && r.quality.metrics)
    return [`${variant}/${split}`, { samples: group.length, qualityFailures: group.length - valid.length,
      glare: confusion(valid.map((r) => ({ expected: entries.get(r.id)!.review.glareOnPanel, predicted: r.quality.warnings.some((w) => w.code === 'glare') }))),
      smallText: confusion(valid.map((r) => ({ expected: entries.get(r.id)!.review.smallText, predicted: r.quality.warnings.some((w) => w.code === 'small_text') }))),
    }]
  })))
  const development = rows.filter((r) => r.variant === 'rectangle' && entries.get(r.id)?.split === 'development' && r.quality.metrics && !r.quality.error)
  return { provenance: 'Provisional Codex visual condition labels, not independently human-verified readability labels.',
    note: 'Glare means a reflection on the selected panel, not necessarily an unreadable field. Original-image warnings may concern background. Small-text tags are qualitative. Do not interpret these counts as OCR confidence calibration.',
    groups,
    developmentOnlyThresholdExploration: {
      smallText: [8, 10, 12, 14, 16].map((threshold) => {
        const known = development.filter((r) => r.quality.metrics?.estimatedTextHeightPx != null)
        return { threshold, unknown: development.length - known.length, ...confusion(known.map((r) => ({ expected: entries.get(r.id)!.review.smallText,
          predicted: r.quality.metrics!.estimatedTextHeightPx! < threshold }))) }
      }),
      glare: [0, .001, .003, .01, .03].map((threshold) => ({ threshold, ...confusion(development.map((r) => ({ expected: entries.get(r.id)!.review.glareOnPanel,
        predicted: (r.quality.metrics!.localizedHighlightRatio ?? 0) > threshold }))) })),
    },
    decision: 'Retain production thresholds. The pilot lacks independently verified condition labels and unreadable/blurred negatives; no threshold was selected from validation outcomes.' }
}

export async function writePilotReport(root: string, out: string, dataset: PilotDataset) {
  const runBytes = await readFile(join(out, 'run.json'))
  const run = JSON.parse(runBytes.toString()) as PilotRun
  const scored = pilotCases(dataset, run).map((entry) => evaluateCase(entry))
  const ownerScored = ownerOnlyCases(dataset, scored)
  const metricSources = await Promise.all(['src/services/nutrition/parseNutrition.ts', 'evaluation/metrics.ts', 'evaluation/pilot/report.ts'].map(async (path) => ({ path, sha256: sha256(await readFile(resolve(root, path))) })))
  const report = { ...buildReport(scored), mode: 'saved-phase-2-browser-ocr', sources: [...dataset.sources, ...run.sources, ...metricSources, { path: 'run.json', sha256: sha256(runBytes) }],
    notes: [...dataset.notes, 'Fresh browser OCR was saved in run.json and scored by the current parser; this report can be regenerated without OCR.',
      'Crops are operator-supplied geometry selected before OCR. Gains include panel selection and cannot be attributed to automatic detection.',
      'The three variants share 15 photos. They are paired observations, not 45 independent test images. Each cohort is scored separately.',
      'Desktop Chrome/WASM timings exclude separately recorded initialization and capture preparation. They are not real-phone latency.',
      'Supplemental fields were visually transcribed by Codex and are distinguishable from owner-verified fields in dataset.json.',
      'The owner vitamin_d key for brown cream milk refers to printed D3, while green biscuit uses vitamin_d3. These keys are preserved, and mismatches need semantic review.'] }
  await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  await writeFile(join(out, 'report.md'), markdown(report))
  await writeFile(join(out, 'fields.csv'), csv(report))
  const calibrationReport = calibration(dataset, run.results)
  await writeFile(join(out, 'calibration.json'), JSON.stringify(calibrationReport, null, 2) + '\n')

  const entries = new Map(dataset.cases.map((entry) => [entry.id, entry]))
  const ownerOnly = { byVariant: Object.fromEntries(VARIANTS.map((v) => [v, aggregate(ownerScored.filter((c) => c.annotation.cohort === `phase-2-${v}`))])),
    bySplit: Object.fromEntries(VARIANTS.flatMap((v) => ['development', 'holdout'].map((s) => [`${v}/${s}`, aggregate(ownerScored.filter((c) => c.annotation.cohort === `phase-2-${v}` && c.annotation.split === s))]))) }
  const comparisons = dataset.cases.map((entry) => ({ id: entry.id, split: entry.split,
    variants: Object.fromEntries(VARIANTS.map((variant) => {
      const item = scored.find((c) => c.annotation.id === `${entry.id}/${variant}`)!
      return [variant, aggregate([item])]
    })) }))
  const warnings = run.results.map((r) => {
    const item = scored.find((c) => c.annotation.id === `${r.id}/${r.variant}`)!
    return { id: r.id, variant: r.variant, split: entries.get(r.id)!.split, metrics: r.quality.metrics,
      warningCodes: r.quality.warnings.map((w) => w.code), qualityError: r.quality.error, fieldOutcomes: aggregate([item]).all }
  })
  const suggestions = run.results.filter((r) => r.variant !== 'perspective').map((r) => {
    const entry = entries.get(r.id)!
    const expected = entry.panel.map((p) => ({ x: p.x * (entry.width - 1), y: p.y * (entry.height - 1) }))
    const suggested = r.suggestion?.corners.map((p) => r.rectangle ? ({ x: r.rectangle.x + p.x * r.rectangle.width / r.width, y: r.rectangle.y + p.y * r.rectangle.height / r.height }) : p)
    const errors = suggested?.map((p, i) => Math.hypot(p.x - expected[i]!.x, p.y - expected[i]!.y))
    const panelDiagonal = Math.hypot(Math.max(...expected.map((p) => p.x)) - Math.min(...expected.map((p) => p.x)), Math.max(...expected.map((p) => p.y)) - Math.min(...expected.map((p) => p.y)))
    return { id: r.id, variant: r.variant, split: entry.split, offered: Boolean(suggested), error: r.suggestionError, score: r.suggestion?.score ?? null,
      normalizedMaxCornerError: errors ? Math.max(...errors) / panelDiagonal : null,
      closeToReference: errors ? Math.max(...errors) / panelDiagonal <= .05 : null }
  })
  const comparison = { datasetFingerprint: dataset.fingerprint, ownerOnly, comparisons, warnings, suggestions,
    notes: ['Suggestion closeness means all four corners within 5% of reference panel diagonal. This is a geometric proxy against provisional operator corners, not verified text coverage.',
      'Warnings and field errors are paired per case; their association is not proof that the warning caused the error.'] }
  await writeFile(join(out, 'comparison.json'), JSON.stringify(comparison, null, 2) + '\n')
  const lines = ['# Phase 2 paired crop comparison', '', '15 photos, 10 development and 5 validation. Primary results use the 191 nutrient and 30 serving values supplied and verified by the owner.', '',
    '| Variant | Owner nutrients correct/readable | Owner serving correct/readable | Wrong nutrient values | Wrong serving strings |',
    '| --- | ---: | ---: | ---: | ---: |']
  for (const [v, a] of Object.entries(ownerOnly.byVariant)) lines.push(`| ${v} | ${a.nutrients.correct}/${a.nutrients.readable} | ${a.serving.correct}/${a.serving.readable} | ${a.nutrients.wrong} | ${a.serving.wrong} |`)
  lines.push('', '## Owner fields by split', '', '| Variant/split | Nutrients correct/readable | Serving correct/readable | Wrong |', '| --- | ---: | ---: | ---: |')
  for (const [key, a] of Object.entries(ownerOnly.bySplit)) lines.push(`| ${key} | ${a.nutrients.correct}/${a.nutrients.readable} | ${a.serving.correct}/${a.serving.readable} | ${a.all.wrong} |`)
  lines.push('', '## Expanded audit (includes supplements)', '', 'The remaining tables and report.md additionally include nine calories-from-fat transcriptions and seven absent-field annotations, visually reviewed by Codex. They await independent human verification.', '',
    '| Split | Variant | Nutrients correct/readable | Serving correct/readable | Wrong | False positives | Provider failures |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: |')
  for (const split of ['development', 'holdout']) for (const variant of VARIANTS) {
    const a = aggregate(scored.filter((c) => c.annotation.split === split && c.annotation.cohort === `phase-2-${variant}`))
    lines.push(`| ${split} | ${variant} | ${a.nutrients.correct}/${a.nutrients.readable} | ${a.serving.correct}/${a.serving.readable} | ${a.all.wrong} | ${a.all.falsePositive} | ${a.providerFailures} |`)
  }
  lines.push('', '| Case | Split | Original correct | Rectangle correct | Perspective correct | Rectangle wrong | Perspective wrong |', '| --- | --- | ---: | ---: | ---: | ---: | ---: |')
  for (const c of comparisons) lines.push(`| ${c.id} | ${c.split} | ${c.variants.original!.all.correct} | ${c.variants.rectangle!.all.correct} | ${c.variants.perspective!.all.correct} | ${c.variants.rectangle!.all.wrong} | ${c.variants.perspective!.all.wrong} |`)
  lines.push('', '## Capture warning assessment', '', calibrationReport.provenance, '', calibrationReport.note, '',
    '| Variant/split | Glare TP/FP/FN/TN | Small text TP/FP/FN/TN | Quality failures |', '| --- | --- | --- | ---: |')
  for (const [key, g] of Object.entries(calibrationReport.groups)) {
    const counts = (c: ReturnType<typeof confusion>) => `${c.truePositive}/${c.falsePositive}/${c.falseNegative}/${c.trueNegative}`
    lines.push(`| ${key} | ${counts(g.glare)} | ${counts(g.smallText)} | ${g.qualityFailures} |`)
  }
  lines.push('', '## Edge suggestions', '', '| Variant/split | Offered | Close to reference | Errors |', '| --- | ---: | ---: | ---: |')
  for (const variant of ['original', 'rectangle']) for (const split of ['development', 'holdout']) {
    const group = suggestions.filter((s) => s.variant === variant && s.split === split)
    const offered = group.filter((s) => s.offered).length
    lines.push(`| ${variant}/${split} | ${offered}/${group.length} | ${offered ? `${group.filter((s) => s.closeToReference).length}/${offered}` : 'N/A (no suggestions)'} | ${group.filter((s) => s.error).length} |`)
  }
  lines.push('', ...comparison.notes, '', calibrationReport.decision, '', 'See report.md and fields.csv for individual errors, comparison.json for paired quality/error records, and calibration.json for development-only threshold exploration.', '')
  await writeFile(join(out, 'comparison.md'), lines.join('\n'))
  for (const [cohort, a] of Object.entries(report.byCohort)) console.log(`${cohort}: nutrients ${a.nutrients.correct}/${a.nutrients.readable}; serving ${a.serving.correct}/${a.serving.readable}; wrong ${a.all.wrong}; false positives ${a.all.falsePositive}; provider failures ${a.providerFailures}`)
}
