import type { Annotation, FieldTruth } from '../types'
import type { SourceDigest } from '../load'
import type { Quad, PerspectiveGeometry } from '../../src/services/image/perspective'
import type { ImageQualityMetrics, ImageQualityWarning } from '../../src/composables/useImageQuality'
import type { PanelSuggestion } from '../../src/services/image/detectPanel'
import type { OcrResult } from '../../src/services/ocr/types'
import type { PaddleOcrEngineConfig } from '../../src/services/ocr/PaddleOcrEngine'

export const VARIANTS = ['original', 'rectangle', 'perspective'] as const
export type Variant = typeof VARIANTS[number]
export interface PilotEntry {
  id: string
  productId: string
  split: 'development' | 'holdout'
  tags: string[]
  /** Normalized original-image points, clockwise TL/TR/BR/BL; selected before OCR. */
  panel: Quad
  panelNote: string
  review: { glareOnPanel: boolean; smallText: boolean; blur: boolean; clippedNutrientFields: boolean }
  supplementalFields: Record<string, FieldTruth>
}
export interface PilotManifest {
  version: 1
  reviewedAt: string
  reviewProvenance: string
  entries: PilotEntry[]
}
export interface PilotCase extends PilotEntry {
  image: string
  imageSha256: string
  width: number
  height: number
  annotation: Annotation
}
export interface PilotDataset {
  version: 1
  fingerprint: string
  reviewProvenance: string
  cases: PilotCase[]
  sources: SourceDigest[]
  notes: string[]
}
export interface CaptureResult {
  id: string
  variant: Variant
  width: number
  height: number
  geometry: PerspectiveGeometry | null
  rectangle: { x: number; y: number; width: number; height: number } | null
  quality: { metrics: ImageQualityMetrics | null; warnings: ImageQualityWarning[]; error: string | null }
  suggestion: PanelSuggestion | null
  suggestionError: string | null
  suggestionMs: number
  preparationMs: number
}
export interface PilotResult extends CaptureResult {
  ocr: OcrResult | null
  error?: string
  processingMs: number
}
export interface PilotRun {
  version: 1
  datasetFingerprint: string
  startedAt: string
  completedAt: string | null
  environment: Record<string, unknown>
  initializationMs: number | null
  config: Record<string, unknown>
  request?: { split: 'all' | 'development' | 'holdout'; config: PaddleOcrEngineConfig }
  sources: SourceDigest[]
  results: PilotResult[]
}
