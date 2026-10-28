import { normalizeReferenceRows, referenceProvenance, type ReferenceSet } from '../nutrition/calculations'

export const DAILY_REFERENCE_URL = 'https://api.juanutrisyon.info/api/consolidated-recommended-daily-nutrient-intake?gender=male&age=19'
const CACHE_KEY = 'jn-label-daily-reference:male:19:v1'
const MAX_AGE = 7 * 24 * 60 * 60 * 1000
let pending: Promise<ReferenceSet> | null = null
let memory: ReferenceSet | null = null

export function validateReferenceRows(value: unknown): Array<{ nutrient: string; daily_value: number; unit: string }> {
  if (!Array.isArray(value) || !value.length) throw new Error('Daily references are unavailable. Please retry.')
  for (const row of value) {
    if (!row || typeof row.nutrient !== 'string' || !row.nutrient.trim() || typeof row.unit !== 'string'
      || typeof row.daily_value !== 'number' || !Number.isFinite(row.daily_value) || row.daily_value <= 0) {
      throw new Error('The daily-reference response could not be verified.')
    }
  }
  return value
}

function makeSet(rows: ReturnType<typeof validateReferenceRows>, fetchedAt: string, cached: boolean): ReferenceSet {
  const records = normalizeReferenceRows(rows)
  for (const [id, record] of Object.entries(records)) record.reference_metadata = referenceProvenance(id)
  return { records, fetchedAt, cached, snapshot_id: `male:19:${fetchedAt}` }
}

export function loadDailyReferences(force = false): Promise<ReferenceSet> {
  if (pending) return pending
  if (!force && memory && Date.now() - Date.parse(memory.fetchedAt) < MAX_AGE) return Promise.resolve(memory)
  pending = (async () => {
    try {
      const response = await fetch(DAILY_REFERENCE_URL, { signal: AbortSignal.timeout(15000), credentials: 'omit' })
      if (!response.ok) throw new Error('Daily references could not be loaded.')
      const rows = validateReferenceRows(await response.json())
      const fetchedAt = new Date().toISOString()
      memory = makeSet(rows, fetchedAt, false)
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ rows, fetchedAt })) } catch { /* Storage is optional. */ }
      return memory
    } catch {
      try {
        const saved = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null')
        const age = Date.now() - Date.parse(saved?.fetchedAt)
        if (Number.isFinite(age) && age >= 0 && age < MAX_AGE) {
          memory = makeSet(validateReferenceRows(saved.rows), saved.fetchedAt, true)
          return memory
        }
      } catch { /* Do not use an invalid cache. */ }
      throw new Error('Daily references could not be loaded. Amounts and available PNPM results are still shown.')
    } finally { pending = null }
  })()
  return pending
}
