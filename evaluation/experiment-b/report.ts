import { summarize } from '../metrics'
import type { FieldResult } from '../types'
import { DEFAULT_CONFIG, type Config, type Mode, type RecordResult } from './types'

const ratio = (n: number, d: number) => d ? n / d : null
export function resultsReport(records: RecordResult[], config: Config = DEFAULT_CONFIG, coverageGaps: string[] = []) {
  const byMode = (group: RecordResult[], mode: Mode) => {
    const runs = group.flatMap((r) => r.modes.filter((m) => m.mode === mode))
    const fields = runs.flatMap((m) => m.result.fields)
    return { labels: runs.length, nutrients: summarize(fields.filter((f) => !f.field.startsWith('serving.'))), serving: summarize(fields.filter((f) => f.field.startsWith('serving.'))),
      supplemental: summarize(runs.flatMap((m) => m.supplemental?.fields.filter((f) => !f.field.startsWith('serving.')) ?? [])),
      crossColumn: runs.filter((m) => m.crossColumn !== null).reduce((a, m) => a + m.crossColumn!, 0),
      provenanceReviewedLabels: runs.filter((m) => m.crossColumn !== null).length,
      unverifiedPopulatedSources: runs.flatMap((m) => m.result.fields.filter((f) => !f.field.startsWith('serving.') && f.predicted !== null && (!m.sources[f.field]?.valueIndexes.length || m.crossColumn === null))).length,
      contextLinkedPercentOutputs: runs.flatMap((m) => Object.values(m.sources).filter((s) => s.contextLinkedPercent)).length,
      rejectedAssociations: runs.reduce((n, m) => n + m.rejected.length, 0),
      nullReasons: Object.fromEntries([...new Set(runs.flatMap((m) => Object.values(m.nullReasons)))].map((reason) => [reason, runs.flatMap((m) => Object.values(m.nullReasons)).filter((r) => r === reason).length])),
      timing: (() => { const times = runs.map((m) => m.elapsedMs).sort((a, b) => a - b); return { samples: times.length, medianMs: times[Math.floor(times.length / 2)] ?? null, p95Ms: times[Math.ceil(times.length * .95) - 1] ?? null } })() }
  }
  const modes = (group: RecordResult[]) => Object.fromEntries((['A', 'B', 'C', 'D'] as Mode[]).map((m) => [m, byMode(group, m)])) as Record<Mode, ReturnType<typeof byMode>>
  const reviewed = records.filter((r) => r.truth), multi = reviewed.filter((r) => r.layout === 'multi-basis'), controls = records.filter((r) => !r.layout.startsWith('multi-basis'))
  const changes = records.flatMap((r) => {
    const baseline = r.modes.find((m) => m.mode === 'A')!
    return r.modes.filter((m) => m.mode !== 'A').flatMap((m) => {
      const keys = new Set([...baseline.result.fields, ...m.result.fields].map((f) => f.field))
      return [...keys].flatMap((field) => {
        const before = baseline.result.fields.find((f) => f.field === field), after = m.result.fields.find((f) => f.field === field)
        if (!before || !after || before.outcome !== after.outcome || before.predicted !== after.predicted) return [{ id: r.id, productId: r.productId, mode: m.mode, layout: r.layout, field, before: before ?? null, after: after ?? null }]
        return []
      })
    })
  })
  const expected = reviewed.flatMap((r) => r.truth!.bases), detected = reviewed.flatMap((r) => r.structure.bases), matched = reviewed.flatMap((r) => r.matches)
  const quantityExpected = expected.filter((b) => b.kind === 'quantity').length
  const auto = reviewed.map((r) => ({ record: r, mode: r.modes.find((m) => m.mode === 'C')! })).filter((r) => r.record.truth!.intended !== null)
  const chosen = auto.filter((r) => r.mode.selected !== null)
  const correctSelections = chosen.filter((r) => r.record.matches.some((m) => m.detected === r.mode.selected && m.expected === r.record.truth!.intended)).length
  const explicitAvailable = multi.filter((r) => r.matches.some((m) => m.expected === r.truth!.intended)).length
  const lost = changes.filter((c) => c.before?.outcome === 'correct' && c.after?.outcome !== 'correct')
  const wrong = changes.filter((c) => c.after && ['wrong', 'false-positive'].includes(c.after.outcome))
  const recovered = changes.filter((c) => c.before?.outcome !== 'correct' && c.after?.outcome === 'correct' && !c.field.startsWith('serving.') && c.layout === 'multi-basis' && c.mode === 'B')
  const improvedProducts = new Set(recovered.map((c) => c.productId)).size
  const reviewedControls = reviewed.filter((r) => r.layout === 'single-context')
  const falsePrompts = reviewedControls.filter((r) => r.modes.find((m) => m.mode === 'C')!.requiresSelection).length
  const multiModes = modes(multi)
  const gate = {
    materialOracleBenefit: recovered.length >= config.minimumGain && improvedProducts >= config.minimumImprovedProducts && !lost.some((c) => c.layout === 'multi-basis' && c.mode === 'B'),
    oracleRecoveredFields: recovered.length, improvedProducts,
    noNewWrong: wrong.length === 0,
    noLostControlFields: !lost.some((c) => !c.layout.startsWith('multi-basis')),
    zeroCrossColumn: records.every((r) => r.modes.filter((m) => m.mode !== 'A').every((m) => m.crossColumn === null || m.crossColumn === 0)),
    noWrongAutoSelections: chosen.length === correctSelections,
    intendedBasisSelectable: multi.length > 0 && explicitAvailable === multi.length,
    noFalsePrompts: reviewedControls.length > 0 && falsePrompts === 0,
    explicitSafer: multiModes.D.nutrients.correct > multiModes.A.nutrients.correct && multiModes.D.nutrients.wrong <= multiModes.A.nutrients.wrong,
    coverageComplete: coverageGaps.filter((g) => !/fresh|reference-phone/i.test(g)).length === 0,
  }
  const passed = gate.materialOracleBenefit && gate.noNewWrong && gate.noLostControlFields && gate.zeroCrossColumn && gate.noWrongAutoSelections && gate.intendedBasisSelectable && gate.noFalsePrompts && gate.explicitSafer && gate.coverageComplete
  const conclusion = passed ? 'Strong positive (development only)' : recovered.length ? 'Parser-positive / detection-weak; development gate not passed' : multi.length ? 'Negative: oracle benefit below development gate' : 'Blocked: insufficient reviewed basis truth'
  const failureCategories = records.flatMap((r) => r.modes.flatMap((m) => Object.values(m.attribution)))
  return { cases: records.length, products: new Set(records.map((r) => r.productId)).size, reviewedSpatialCases: reviewed.length,
    multiBasisCases: multi.length, multiBasisProducts: new Set(multi.map((r) => r.productId)).size, reviewedControlCases: reviewedControls.length,
    coverageGaps, all: modes(records), multiBasis: multiModes, controls: modes(controls),
    detection: { expected: expected.length, detected: detected.length, matched: matched.length, recall: ratio(matched.length, expected.length), precision: ratio(matched.length, detected.length),
      quantityExpected, quantityMatched: reviewed.reduce((n, r) => n + r.matches.filter((m) => r.truth!.bases.find((b) => b.id === m.expected)?.kind === 'quantity').length, 0),
      correctLabels: matched.filter((m) => m.labeledCorrectly).length, labelingAccuracy: ratio(matched.filter((m) => m.labeledCorrectly).length, matched.length),
      unknown: records.flatMap((r) => r.structure.bases).filter((b) => b.category === 'unknown').length },
    automatic: { eligibleReviewed: auto.length, selected: chosen.length, correct: correctSelections, wrong: chosen.length - correctSelections,
      precision: ratio(correctSelections, chosen.length), abstained: auto.length - chosen.length, abstentionRate: ratio(auto.length - chosen.length, auto.length),
      selectionRequiredAll: records.filter((r) => r.modes.find((m) => m.mode === 'C')!.requiresSelection).length,
      falsePrompts, reviewedControlDenominator: reviewedControls.length, falsePromptRate: ratio(falsePrompts, reviewedControls.length) },
    explicit: { intendedAvailable: explicitAvailable, reviewedMultiBasis: multi.length, simulatedInteractionCount: explicitAvailable,
      realUserInteractionCount: null, phoneUsability: 'not evaluated; simulation is ideal user choice' },
    failureCategories: Object.fromEntries([...new Set(failureCategories)].sort().map((key) => [key, failureCategories.filter((c) => c === key).length])),
    changes, gate: { ...gate, passed }, conclusion,
    recommendation: passed ? 'Freeze, then validate fresh product-disjoint data. No production integration yet.' : 'Keep production v5. Inspect false columns/association misses and expand exposed development coverage before reserved validation.',
  }
}
export type Report = ReturnType<typeof resultsReport>
export function markdown(report: Report) {
  const tables = (modes: Report['all']) => '| Mode | Labels | Correct nutrients | Missing | Wrong | False positive | Cross-column (reviewed only) |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: |\n' + (['A', 'B', 'C', 'D'] as Mode[]).map((m) => { const s = modes[m]; return `| ${m} | ${s.labels} | ${s.nutrients.correct} | ${s.nutrients.missing} | ${s.nutrients.wrong} | ${s.nutrients.falsePositive} | ${s.crossColumn} |` }).join('\n')
  const lines = ['# Experiment B Results', '', '## Dataset', '', `${report.cases} OCR cases / ${report.products} products. ${report.reviewedSpatialCases} spatially reviewed cases; ${report.multiBasisCases} multi-basis cases / ${report.multiBasisProducts} products. Fresh reserved labels: 0 in this development report.`, '',
    'Mode B/D denominators include only reviewed intended bases. Repeated crops are not independent products. Percentage-only targets linked to the selected context remain valid. Owner truth is primary; supplements are separate in JSON.', '', 'Coverage gaps:', ...report.coverageGaps.map((g) => `- ${g}`), '',
    '## Baseline and oracle selected-basis results', '', 'Paired multi-basis cases:', '', tables(report.multiBasis), '',
    '## Basis detection', '', `Expected ${report.detection.expected}; matched ${report.detection.matched}; detected ${report.detection.detected}; correct labels ${report.detection.correctLabels}; unknown candidates ${report.detection.unknown}. Detection scoring uses reviewed memberships, not expected values.`, '',
    '## Automatic selection', '', `Reviewed selections: ${report.automatic.correct} correct / ${report.automatic.selected} selected; ${report.automatic.wrong} wrong; ${report.automatic.abstained} abstained. False prompts: ${report.automatic.falsePrompts}/${report.automatic.reviewedControlDenominator} reviewed controls. Across all cases, ${report.automatic.selectionRequiredAll} require selection.`, '',
    '## Explicit selection', '', `Intended candidate available on ${report.explicit.intendedAvailable}/${report.explicit.reviewedMultiBasis} reviewed multi-basis cases. Ideal user-choice simulation only; phone usability and real interaction count are not evaluated.`, '',
    '## Single-basis controls and other exposed regressions', '', tables(report.controls), '', 'Unreviewed layouts are regression replays, not independently verified detection truth. Zero cross-column counts apply only to spatially reviewed labels; inspect the JSON provenance coverage before generalizing.', '',
    '## All-label totals', '', tables(report.all), '', 'Runtime in JSON is desktop replay only. No OCR was run.', '',
    '## Representative fixes', '', ...report.changes.filter((c) => c.mode === 'B' && c.before?.outcome !== 'correct' && c.after?.outcome === 'correct').slice(0,8).map((c) => `- ${c.id}: ${c.field}, ${c.before?.predicted ?? 'null'} → ${c.after!.predicted}.`), '',
    '## Representative failures', '', ...report.changes.filter((c) => c.before?.outcome === 'correct' && c.after?.outcome !== 'correct').slice(0,8).map((c) => `- ${c.id} Mode ${c.mode}: ${c.field}, ${c.before!.predicted} → ${c.after?.predicted ?? 'null'}.`), '',
    '## Failure analysis', '', ...Object.entries(report.failureCategories).map(([key, count]) => `- ${key}: ${count}`), '', 'Categories are source-reviewed where available; unverified causes are retained explicitly. Recognition-caused wrong values still count in end-to-end wrong totals.', '',
    '## Development gate', '', ...Object.entries(report.gate).map(([key, value]) => `- ${key}: ${value}`), '',
    '## Conclusion', '', report.conclusion, '', '## Recommendation', '', report.recommendation, '']
  return lines.join('\n')
}
export function csv(records: RecordResult[]) {
  const quote = (v: unknown) => `"${String(v ?? '').replaceAll('"', '""')}"`
  const rows: unknown[][] = [['case', 'product', 'layout', 'mode', 'field', 'truth', 'actual', 'outcome', 'selected_basis', 'source_basis', 'value_line_indexes', 'failure']]
  for (const r of records) for (const m of r.modes) for (const f of m.result.fields) rows.push([r.id, r.productId, r.layout, m.mode, f.field, typeof f.truth === 'string' ? f.truth : f.truth.status, f.predicted, f.outcome, m.selected, m.sources[f.field]?.basisId, m.sources[f.field]?.valueIndexes.join(' '), m.attribution[f.field]])
  return rows.map((r) => r.map(quote).join(',')).join('\n') + '\n'
}
// Kept exported for independent metric assertions without reproducing the scorer.
export const nutrientFields = (fields: FieldResult[]) => fields.filter((f) => !f.field.startsWith('serving.'))
