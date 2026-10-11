import { buildReport, scoreField } from '../metrics'
import type { CaseResult } from '../types'

export function fieldChanges(before: CaseResult[], after: CaseResult[]) {
  const previousCases = new Map(before.map((c) => [c.annotation.id, c]))
  if (previousCases.size !== before.length || after.length !== before.length || new Set(after.map((c) => c.annotation.id)).size !== after.length) {
    throw new Error('Comparisons require unique, paired cases.')
  }
  return after.flatMap((c) => {
    const previousCase = previousCases.get(c.annotation.id)
    if (!previousCase) throw new Error(`Unpaired case: ${c.annotation.id}`)
    // Also retain fields that disappeared from the prediction object.
    const keys = new Set([...previousCase.fields, ...c.fields].map((f) => f.field))
    return [...keys].flatMap((key) => {
      const oldField = previousCase.fields.find((f) => f.field === key)
      const newField = c.fields.find((f) => f.field === key)
      const template = (oldField ?? newField)!
      // evaluateCase adds unannotated dynamic keys only when a parser recognizes
      // them. An absent prediction is null, not a missing comparison case.
      const absent = { ...template, predicted: null, outcome: scoreField(template.truth, null), evidence: null }
      const previous = oldField ?? absent
      const current = newField ?? absent
      if (previous.outcome === current.outcome && previous.predicted === current.predicted) return []
      return [{ caseId: current.caseId, field: key, truth: current.truth,
        before: { outcome: previous.outcome, predicted: previous.predicted },
        after: { outcome: current.outcome, predicted: current.predicted }, evidence: current.evidence }]
    })
  })
}

export function comparisonGate(before: CaseResult[], after: CaseResult[]) {
  const delta = fieldChanges(before, after)
  // Changed wrong values are regressions too; old errors do not grant a free pass.
  const newlyWrong = delta.filter((d) => ['wrong', 'false-positive'].includes(d.after.outcome))
  const lostCorrectFields = delta.filter((d) => d.before.outcome === 'correct' && d.after.outcome !== 'correct')
  const beforeReport = buildReport(before), afterReport = buildReport(after)
  const cohortsWithRecoveryLoss = Object.entries(afterReport.byCohort).flatMap(([cohort, a]) => {
    const b = beforeReport.byCohort[cohort]
    return !b || a.nutrients.correct < b.nutrients.correct || a.serving.correct < b.serving.correct ? [cohort] : []
  })
  return { passed: !newlyWrong.length && !lostCorrectFields.length && !cohortsWithRecoveryLoss.length,
    newlyWrong, lostCorrectFields, cohortsWithRecoveryLoss }
}
