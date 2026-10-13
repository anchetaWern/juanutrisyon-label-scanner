import type { OcrResult } from '../../src/services/ocr/types'
import { nutritionPrimitives as p, parseNutrition } from '../../src/services/nutrition/parseNutrition'
import { rowsAndBoxes } from './columns'
import { DEFAULT_CONFIG, type Association, type Config, type Structure } from './types'

/** Separate experiment entry point. All value ownership precedes ranking. */
export function associate(ocr: OcrResult, structure: Structure, selectedId: string | null, config: Config = DEFAULT_CONFIG): Association {
  const baseline = parseNutrition(ocr), { boxes, rows } = rowsAndBoxes(ocr)
  const extraction = { ...baseline, parserVersion: 'experiment-b-scoped-v1', data: { serving: { ...baseline.data.serving },
    nutrients: Object.fromEntries(Object.keys(baseline.data.nutrients).map((key) => [key, null as string | null])) },
  issues: baseline.issues.filter((i) => i.field.startsWith('serving.')), evidence: Object.fromEntries(Object.entries(baseline.evidence).filter(([key]) => key.startsWith('serving.'))) }
  const result: Association = { extraction, sources: {}, rejected: [], nullReasons: {} }
  const basis = structure.bases.find((b) => b.id === selectedId && b.kind === 'quantity')
  const width = ocr.sourceSize?.width ?? Math.max(1, ...boxes.map(p.right))
  const labelIds = new Set(rows.map((a) => a.box.index)), used = new Set<number>()
  const owned = new Set(basis?.valueIndexes ?? [])
  const percentLinks = structure.bases.filter((b) => b.kind === 'percent_reference' && b.context === basis?.id)
  const percentOwned = new Set(percentLinks.flatMap((b) => b.valueIndexes))
  const amountValueIds = (indexes: number[]) => indexes.filter((index) => (!labelIds.has(index) && /^(?:less than\s+)?[<>\dOo.]/i.test(ocr.lines[index]!.text.trim())) || rows.some((a) => a.box.index === index && Boolean(p.readAmount(a.tail, a.unit ?? (a.key.startsWith('energy') ? 'kcal' : undefined), a.key.startsWith('energy')))))
  const percentOnly = (row: typeof rows[number], indexes: number[]) => {
    if (p.core.includes(row.key) || row.key.startsWith('energy')) return false
    if (!indexes.every((i) => owned.has(i) || percentOwned.has(i))) return false
    // Include damaged and unit-only cells as blockers, regardless of eligibility.
    // Per-serving/per-100g percentage-only tables remain valid if all cells are percentages.
    return !boxes.some((b) => !labelIds.has(b.index) && !b.text.includes('%') && b.bbox.x > p.right(row.box) &&
      /^(?:[<>\dOo.]|(?:g|mg|mcg|[μµ]g|IU)\b)/i.test(b.text.trim()) &&
      Math.abs(p.cy(b) - p.cy(row.box)) < Math.max(b.bbox.height, row.box.bbox.height) * config.damagedCellHeight)
  }
  const store = (row: typeof rows[number], text: string, indexes: number[], method: string) => {
    const amount = p.readAmount(text, row.unit ?? (row.key.startsWith('energy') ? 'kcal' : undefined), row.key.startsWith('energy'))
    if (!amount) return false
    const values = amountValueIds(indexes), isPercent = amount.value.endsWith('%')
    const safe = values.length > 0 && values.every((i) => owned.has(i) || (isPercent && percentOwned.has(i))) && (!isPercent || percentOnly(row, values))
    if (!safe) { result.rejected.push({ field: row.key, reason: 'unproven-value-ownership-or-percent-context', valueIndexes: values }); return false }
    const expected = row.unit ?? (method === 'inline' ? undefined : ['total_fat', 'saturated_fat', 'trans_fat', 'carbohydrate', 'fiber', 'sugars', 'added_sugars', 'protein'].includes(row.key) ? 'g' : ['sodium', 'cholesterol'].includes(row.key) ? 'mg' : undefined)
    const actual = amount.value.match(/(?:kcal|kj|mcg(?:\s+RE)?|mg|[μµ]g(?:\s+RE)?|g|IU|%)$/i)?.[0]
    const identity = (v: string) => v.toLowerCase().replace(/[μµ]/g, 'mc')
    if (expected && actual && identity(expected) !== identity(actual)) return false
    const support = [...new Set([row.box.index, ...(row.sources?.map((b) => b.index) ?? []), ...indexes])]
    extraction.data.nutrients[row.key] = amount.value
    extraction.evidence[row.key] = { lineIndexes: support, text: support.map((i) => ocr.lines[i]!.text).join(' | '), method }
    result.sources[row.key] = { basisId: basis!.id, valueIndexes: values, contextLinkedPercent: isPercent }
    values.forEach((i) => used.add(i))
    if (amount.corrected || row.corrected) extraction.issues.push({ field: row.key, message: 'Used unchanged v5 OCR normalization; verify against the image.' })
    return true
  }
  const duplicates = new Set(rows.filter((a, i) => rows.findIndex((b) => b.key === a.key) !== i).map((a) => a.key))
  const blocked = !basis || structure.blockers.length > 0
  if (!blocked) {
    // Reuse established v5 row associations on a single context, only after
    // independently validating every value source against the selected basis.
    // Multi-context association never receives an unscoped baseline fallback.
    if (structure.bases.filter((b) => b.kind === 'quantity').length === 1) {
      for (const row of rows) {
        const value = baseline.data.nutrients[row.key], evidence = baseline.evidence[row.key]
        if (value && evidence && !duplicates.has(row.key)) store(row, value, evidence.lineIndexes, `v5-verified:${evidence.method}`)
      }
    }
    for (const row of rows) {
      if (duplicates.has(row.key) || extraction.data.nutrients[row.key] || !row.tail) continue
      if (owned.has(row.box.index)) store(row, row.tail, [row.box.index], 'inline')
    }
    const columns: Array<typeof rows> = []
    for (const row of rows.filter((a) => !a.inlineOnly && !duplicates.has(a.key) && !a.tail)) {
      const column = columns.find((c) => Math.abs(c[0]!.box.bbox.x - row.box.bbox.x) < width * config.labelColumnWidthFraction)
      if (column) column.push(row); else columns.push([row])
    }
    for (const column of columns) {
      const typical = p.median(column.map((a) => a.box.bbox.height))
      const candidates = boxes.filter((b) => (owned.has(b.index) || percentOwned.has(b.index)) && !labelIds.has(b.index) &&
        b.bbox.x >= Math.min(...column.map((a) => p.right(a.box))) &&
        !rows.some((a) => !column.includes(a) && a.box.bbox.x > column[0]!.box.bbox.x + width * config.labelColumnWidthFraction && p.right(a.box) < b.bbox.x &&
          Math.abs(p.cy(a.box) - p.cy(b)) < typical))
      // Do not concatenate percentage references into quantity cells.
      const amounts = p.groupAmounts(candidates.filter((b) => !b.text.includes('%')))
      const percentages = p.groupAmounts(candidates.filter((b) => b.text.includes('%')))
      // Reuse v5's complete unit-column alignment rule for shared units. A
      // unit column must precede every competing quantity stream, and a printed
      // percentage boundary must exist. Damaged unit cells remain blockers.
      const unitPattern = /^(kcal|kj|mcg(?:\s+RE)?|mg|[μµ]g(?:\s+RE)?|g|IU)$/i
      const unitStarts = boxes.filter((b) => !labelIds.has(b.index) && unitPattern.test(b.text.trim()))
      const unitColumns: Array<typeof boxes> = []
      for (const unit of unitStarts) {
        const found = unitColumns.find((c) => Math.abs(p.median(c.map((b) => b.bbox.x)) - unit.bbox.x) < width * .06)
        if (found) found.push(unit); else unitColumns.push([unit])
      }
      const quantityLeft = Math.min(Infinity, ...structure.bases.filter((b) => b.kind === 'quantity').flatMap((b) => b.valueIndexes.map((i) => ocr.lines[i]!.bbox.x)))
      const percentEdge = Math.min(Infinity, ...boxes.filter((b) => /^%\s*(?:daily|re|dv)/i.test(b.text)).map((b) => b.bbox.x))
      if (column.length >= 4 && Number.isFinite(percentEdge)) for (const units of unitColumns.filter((c) => c.length >= 4)) {
        const x = p.median(units.map((b) => b.bbox.x))
        if (x >= quantityLeft || column.some((a) => p.right(a.box) >= x)) continue
        const cells = boxes.filter((b) => !labelIds.has(b.index) && Math.abs(b.bbox.x - x) < width * .06 &&
          p.cy(b) >= p.cy(column[0]!.box) - typical && p.cy(b) <= p.cy(column.at(-1)!.box) + typical)
          .sort((a, b) => p.cy(a) - p.cy(b)).map((b) => ({ text: b.text.trim(), boxes: [b], x: b.bbox.x, y: p.cy(b), right: p.right(b), height: b.bbox.height }))
        if (!p.orderedAlignment(column, cells)) continue
        column.forEach((row, i) => {
          const unit = cells[i]!
          if (extraction.data.nutrients[row.key] || !unitPattern.test(unit.text)) return
          const values = candidates.filter((b) => owned.has(b.index) && !used.has(b.index) && b.bbox.x >= unit.right && p.right(b) <= percentEdge &&
            /^(?:[<>]\s*)?\d+(?:\.\d+)?$/.test(b.text.trim()) && Math.abs(p.cy(b) - unit.y) < Math.min(b.bbox.height, unit.height) * .45)
          if (values.length === 1) store(row, `${values[0]!.text.trim()}${unit.text}`, [unit.boxes[0]!.index, values[0]!.index], 'selected-separate-unit-column')
        })
      }
      const ordered = column.length >= 4 && p.orderedAlignment(column, amounts)
      if (ordered) column.forEach((row, i) => {
        if (!extraction.data.nutrients[row.key]) store(row, amounts[i]!.text, amounts[i]!.boxes.map((b) => b.index), 'ordered-column')
      })
      for (const row of column) {
        if (extraction.data.nutrients[row.key]) continue
        const options = amounts.filter((a) => !a.boxes.some((b) => used.has(b.index)) && a.x >= p.right(row.box) &&
          Math.abs(a.y - p.cy(row.box)) < Math.min(a.height, row.box.bbox.height) * config.rowHeightTolerance &&
          !column.some((other) => other !== row && Math.abs(p.cy(other.box) - a.y) <= Math.abs(p.cy(row.box) - a.y)))
        const energyAlternates = row.key.startsWith('energy') && amounts.filter((a) => a.x >= p.right(row.box) &&
          Math.abs(a.y - p.cy(row.box)) < typical * config.energyAlternatesHeight && /(?:kcal|kj)\b/i.test(a.text)).length > 1
        if (options.length === 1 && !energyAlternates) store(row, options[0]!.text, options[0]!.boxes.map((b) => b.index), 'selected-spatial-row')
        if (!extraction.data.nutrients[row.key]) {
          const ps = percentages.filter((a) => !a.boxes.some((b) => used.has(b.index)) && a.x > p.right(row.box) &&
            Math.abs(a.y - p.cy(row.box)) < row.box.bbox.height * config.rowHeightTolerance)
          if (ps.length === 1) store(row, ps[0]!.text, ps[0]!.boxes.map((b) => b.index), 'selected-percent-only-row')
        }
      }
    }
  }
  for (const [key, value] of Object.entries(extraction.data.nutrients)) if (value === null) {
    result.nullReasons[key] = blocked ? basis ? 'structural-ambiguity' : 'selection-required-or-unavailable' : duplicates.has(key) ? 'repeated-row' : 'missing-or-ambiguous-selected-cell'
    extraction.issues.push({ field: key, message: result.nullReasons[key]! })
  }
  // A second, independent final ownership audit guards all association paths.
  for (const [field, source] of Object.entries(result.sources)) {
    if (source.valueIndexes.some((i) => !owned.has(i) && !(source.contextLinkedPercent && percentOwned.has(i)))) {
      result.rejected.push({ field, reason: 'final-provenance-audit', valueIndexes: source.valueIndexes })
      extraction.data.nutrients[field] = null; delete result.sources[field]; delete extraction.evidence[field]
      result.nullReasons[field] = 'final-provenance-audit'
    }
  }
  return result
}
