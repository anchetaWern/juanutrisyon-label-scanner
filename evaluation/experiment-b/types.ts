import type { OcrResult } from '../../src/services/ocr/types'
import type { NutritionExtraction } from '../../src/services/nutrition/parseNutrition'
import type { Annotation, CaseResult } from '../types'

export type Category = 'per_serving' | 'per_100g' | 'per_100ml' | 'per_pack' | 'per_container' | 'per_piece' | 'as_sold' | 'as_prepared' | 'percent_dv' | 'unknown'
export interface Basis {
  id: string
  category: Category
  kind: 'quantity' | 'percent_reference'
  rawHeader: string
  headerIndexes: number[]
  valueIndexes: number[]
  context: string | null
  preparation: 'as_sold' | 'as_prepared' | null
  section: string
  support: number
  reasons: string[]
}
export interface Structure {
  bases: Basis[]
  unassigned: number[]
  blockers: string[]
}
export interface Config {
  columnHeightTolerance: number
  rowHeightTolerance: number
  labelColumnWidthFraction: number
  rowCandidateHeight: number
  rowOwnerSlackHeight: number
  headerBandHeight: number
  headerSearchHeight: number
  headerPaddingHeight: number
  headerConflictHeight: number
  panelSeparationHeight: number
  fragmentGapHeight: number
  fragmentRowHeight: number
  fragmentVerticalStartHeight: number
  fragmentColumnWidth: number
  damagedCellHeight: number
  energyAlternatesHeight: number
  minimumRows: number
  matchOverlap: number
  minimumGain: number
  minimumImprovedProducts: number
}
export const DEFAULT_CONFIG: Config = { columnHeightTolerance: 1.4, rowHeightTolerance: .45, minimumRows: 3,
  labelColumnWidthFraction: .18, rowCandidateHeight: 1.1, rowOwnerSlackHeight: .3, headerBandHeight: 1.5, headerSearchHeight: 12, headerPaddingHeight: .5, headerConflictHeight: .6, panelSeparationHeight: 2, fragmentGapHeight: 1, fragmentRowHeight: .6, fragmentVerticalStartHeight: .6, fragmentColumnWidth: 1, damagedCellHeight: .6, energyAlternatesHeight: 1.4,
  matchOverlap: .6, minimumGain: 3, minimumImprovedProducts: 2 }
export interface BasisTruth {
  status: 'reviewed' | 'provisional'
  provenance: string
  layout: 'multi-basis' | 'single-context' | 'multiple-panels'
  intended: string | null
  bases: Basis[]
  // These remain scorer-only. Oracle injection uses bases/intended, never field answers.
  fields: Record<string, { basis: string; valueIndexes: number[]; failure?: 'ocr-recognition' | 'within-basis'; note?: string }>
}
export interface Input {
  annotation: Annotation
  ocr: OcrResult
  split: 'development' | 'reserved'
  truth?: BasisTruth
  image?: string
  imageSha256?: string
  imageNote?: string
  supplementalFields?: Annotation['fields']
}
export interface Association {
  extraction: NutritionExtraction
  sources: Record<string, { basisId: string; valueIndexes: number[]; contextLinkedPercent: boolean }>
  rejected: Array<{ field: string; reason: string; valueIndexes: number[] }>
  nullReasons: Record<string, string>
}
export type Mode = 'A' | 'B' | 'C' | 'D'
export interface ModeResult {
  mode: Mode
  selected: string | null
  requiresSelection: boolean
  result: CaseResult
  supplemental: CaseResult | null
  sources: Association['sources']
  rejected: Association['rejected']
  nullReasons: Record<string, string>
  crossColumn: number | null
  attribution: Record<string, string>
  elapsedMs: number
}
export interface RecordResult {
  id: string
  productId: string
  layout: string
  image: string | null
  imageSha256?: string
  ocr: OcrResult
  truth: BasisTruth | null
  structure: Structure
  detectionElapsedMs: number
  matches: Array<{ expected: string; detected: string; overlap: number; labeledCorrectly: boolean }>
  modes: ModeResult[]
  // Safe precomputed alternatives for the standalone gallery, not owner truth.
  alternatives: Record<string, Association>
}
