import type { OcrResult } from '../src/services/ocr/types'

// A missing annotation is never equivalent to an absent printed field.
export type FieldTruth = string | { status: 'absent' | 'unreadable' | 'unreviewed'; note: string }
export interface Annotation {
  id: string
  productId: string
  split: 'development' | 'holdout' | 'regression'
  cohort: string
  provenance: string
  tags: string[]
  fields: Record<string, FieldTruth>
}
export interface EvaluationCase {
  annotation: Annotation
  ocr: OcrResult | null
  error?: string
  recordedProcessingMs?: number
}
export type Outcome = 'correct' | 'wrong' | 'missing' | 'false-positive' | 'correct-abstention' | 'unscored'
export interface FieldResult {
  caseId: string
  field: string
  truth: FieldTruth
  predicted: string | null
  outcome: Outcome
  namePresent: boolean | null
  valuePresent: boolean | null
  triage: string | null
  evidence: { lineIndexes: number[]; text: string; method: string } | null
  warnings: string[]
}
export interface CaseResult {
  annotation: Annotation
  parserVersion: string
  providerFailed: boolean
  error: string | null
  recordedProcessingMs: number | null
  fields: FieldResult[]
}
