// Typed boundary for the food app's pure helpers. See calculation/provenance.json.
import { normalizeNutrient as normalize } from './calculation/nutrients.js'
import { normalizeReferenceRows as normalizeRows, referencePercentage as percentage } from './calculation/references.js'
import { referenceProvenance as provenance } from './calculation/reference-provenance.js'
import { classifyNutrientHighlights as highlights } from './calculation/highlights.js'
import { calculatePnpmWarnings as warnings } from './calculation/PnpmWarnings.js'

export interface NutrientNode {
  nutrient_id: string
  value: number | null
  unit: string | null
  state: string
  reason?: string
  source?: Record<string, unknown>
  composition?: NutrientNode[]
}
export interface ReferenceNode extends NutrientNode {
  reference_metadata?: Record<string, unknown>
}
export interface ReferenceSet {
  records: Record<string, ReferenceNode>
  snapshot_id: string
  fetchedAt: string
  cached: boolean
}
export interface HighlightGroup {
  items: Array<{ name: string; amount: number; unit: string; percentage: number }>
  evaluatedCount: number
  state: string
}
export interface WarningResult {
  nutrient: string
  status: 'high' | 'not-high' | 'unknown'
  label: string
  reason?: string
  value?: number
  threshold?: number
  unit?: string
}

export const normalizeNutrient = normalize as (input: Record<string, unknown>) => NutrientNode
export const normalizeReferenceRows = normalizeRows as (rows: Array<{ nutrient: string; daily_value: number; unit: string }>) => Record<string, ReferenceNode>
export const referencePercentage = percentage as (nutrient: NutrientNode, reference?: ReferenceNode) => { percentage: number | null }
export const referenceProvenance = provenance as (name: string) => Record<string, unknown>
export const classifyHighlights = highlights as unknown as (nodes: NutrientNode[], references: ReferenceSet) => { notable: HighlightGroup; monitor: HighlightGroup }
export const calculateWarnings = warnings as (input: Record<string, number | null>) => Record<string, WarningResult>
