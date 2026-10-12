import type { OcrBoundingBox, OcrResult } from '../../src/services/ocr/types'
import type { Annotation } from '../types'
import type { SourceDigest } from '../load'

export const SCALES = [1, 2] as const
export type Scale = typeof SCALES[number]
export type Split = 'development' | 'reserved'
export type Failure = 'none' | 'detection' | 'recognition' | 'association' | 'basis' | 'unreadable' | 'unknown'
export interface Truth {
  status: 'readable' | 'unreadable' | 'unreviewed'
  /** Transcription of this region, not an inferred nutrient unit. */
  numeric: string | null
  unit: string | null
  provenance: string
}
export interface Replacement { lineIndex: number; start: number; end: number }
export interface Candidate {
  id: string
  imageId: string
  field: string | null
  /** Original parser selection, preserved when region review corrects identity. */
  parserField: string | null
  basis: string | null
  selection: 'parser-evidence' | 'adjacent' | 'value-like' | 'manual'
  lineIndexes: number[]
  baselineRaw: string
  evidence: { lineIndexes: number[]; text: string; method: string } | null
  ocrBox: OcrBoundingBox
  sourceBox: OcrBoundingBox
  cropBox: OcrBoundingBox
  padding: number
  clipped: boolean
  review: 'pending' | 'verified' | 'excluded'
  reviewNote: string
  truth: Truth
  failureBefore: Failure
  replacement: Replacement | null
}
export interface ExperimentImage {
  id: string
  productId: string
  split: Split
  historicalSplit: string
  image: string
  imageSha256: string
  width: number
  height: number
  tags: string[]
  annotation: Annotation
  supplementalFields: string[]
  baseline: OcrResult
  candidates: Candidate[]
  unresolvedFields: string[]
}
export interface Plan {
  version: 1
  parserVersion: string
  padding: number
  scales: readonly Scale[]
  baselineDirectory: string
  baselineSources: SourceDigest[]
  sources: SourceDigest[]
  images: ExperimentImage[]
  policy: {
    minimumFailureRecovery: number
    maximumReservedRegressions: number
    maximumWrongIncrease: number
    phoneMedianLabelMs: number | null
    phoneP95LabelMs: number | null
    referenceDevice: string | null
    mode: 'detection-and-recognition'
  }
}
/** Optional region-review overlay; edits are applied only into a NEW plan. */
export interface ReviewManifest {
  version: 1
  baselineRunSha256: string
  exposedProductIds: string[]
  reservedImageIds: string[]
  reservedProvenance: string
  phone?: { device: string; medianLabelMs: number; p95LabelMs: number }
  candidates: Array<{
    id: string
    imageId: string
    review: Candidate['review']
    reviewNote: string
    field: string | null
    basis: string | null
    lineIndexes: number[]
    ocrBox?: OcrBoundingBox
    truth: Truth
    failureBefore: Failure
    replacement: Replacement | null
  }>
}
export interface CandidateResult {
  candidateId: string
  imageId: string
  scale: Scale
  ocr: OcrResult | null
  error: string | null
  crop: { width: number; height: number; path: string; sha256: string } | null
  timing: { extractionMs: number; resizeMs: number; recognitionMs: number; totalMs: number }
}
export interface LabelTiming { imageId: string; scale: Scale; totalMs: number; sourceLoadMs: number; candidates: number }
export interface Run {
  version: 1
  planSha256: string
  split: Split
  completedAt: string | null
  sessions: Array<Record<string, unknown>>
  results: CandidateResult[]
  labels: LabelTiming[]
}
