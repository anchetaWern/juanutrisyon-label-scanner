import type { OcrResult } from '../../src/services/ocr/types'
import { nutritionPrimitives as p } from '../../src/services/nutrition/parseNutrition'
import { headerCandidates } from './headers'
import { DEFAULT_CONFIG, type Basis, type Config, type Structure } from './types'

export function rowsAndBoxes(ocr: OcrResult) {
  const boxes = ocr.lines.map((l, index) => ({ ...l, index })).filter((b) => Object.values(b.bbox).every(Number.isFinite) && b.bbox.width > 0 && b.bbox.height > 0)
    .sort((a, b) => p.cy(a) - p.cy(b) || a.bbox.x - b.bbox.x || a.text.localeCompare(b.text))
  const reference = boxes.find((b) => /^calories\s*:\s*$/i.test(b.text) && boxes.some((n) => /2[,.]?000|2[,.]?500/.test(n.text) && Math.abs(p.cy(n) - p.cy(b)) < b.bbox.height * 2))
  const footer = boxes.find((b) => /(?:percent daily values are based|calories per gram|ingredients\s*:)/i.test(b.text))
  const cutoff = Math.min(reference?.bbox.y ?? Infinity, footer?.bbox.y ?? Infinity)
  const rows = boxes.flatMap(p.anchorsInBox).filter((a) => p.cy(a.box) < cutoff)
  // Preserve v5's contextual abbreviated fat subrows exactly.
  if (rows.some((a) => a.key === 'total_fat')) for (const box of boxes.filter((b) => p.cy(b) < cutoff)) {
    const m = box.text.trim().match(/^[-•·]\s*(trans|saturated)\s*$/i)
    if (m) rows.push({ box, key: m[1]!.toLowerCase() === 'trans' ? 'trans_fat' : 'saturated_fat', tail: '', corrected: true })
  }
  rows.sort((a, b) => p.cy(a.box) - p.cy(b.box))
  return { boxes, rows, cutoff }
}
export function detectBases(ocr: OcrResult, config: Config = DEFAULT_CONFIG): Structure {
  const { boxes, rows, cutoff } = rowsAndBoxes(ocr)
  const width = ocr.sourceSize?.width ?? Math.max(1, ...boxes.map(p.right))
  const typical = p.median(rows.map((a) => a.box.bbox.height))
  const headers = headerCandidates(ocr.lines, config).filter((h) => h.bbox.y < cutoff &&
    // A printed 100g quantity in a nutrient row is not a bare basis heading.
    !(/^(?:100\s*(?:g|ml))\s*$/i.test(h.text.trim()) && rows.some((a) => p.right(a.box) <= h.bbox.x &&
      Math.abs(p.cy(a.box) - (h.bbox.y + h.bbox.height / 2)) < typical * config.rowCandidateHeight)))
  const labelIds = new Set(rows.map((a) => a.box.index))
  const blockers: string[] = []
  const panelHeadings = boxes.filter((b) => /^nutrition[\s,]+(?:facts|information)\b/i.test(b.text.trim()))
  const duplicates = rows.filter((a, i) => rows.findIndex((b) => b.key === a.key) !== i)
  if (duplicates.length >= 3 && panelHeadings.length > 1 && Math.max(...panelHeadings.map(p.cy)) - Math.min(...panelHeadings.map(p.cy)) > typical * config.panelSeparationHeight) blockers.push('multiple-panels')
  // Numeric-looking damaged cells are retained. Bare units belong to a cell,
  // not an independent denominator. Their actual source indexes survive.
  const cells = boxes.filter((b) => p.cy(b) < cutoff && !labelIds.has(b.index) && !headers.some((h) => h.indexes.includes(b.index)) &&
    /^(?:less than\s+)?[<>\dOo.]/i.test(b.text.trim()) && rows.some((a) => b.bbox.x >= p.right(a.box) && Math.abs(p.cy(a.box) - p.cy(b)) < typical * config.rowCandidateHeight))
  const inline = rows.filter((a) => Boolean(p.readAmount(a.tail, a.unit ?? (a.key.startsWith('energy') ? 'kcal' : undefined), a.key.startsWith('energy'))))
  type Cluster = { boxes: typeof boxes; rowKeys: Set<string>; labelX: number; section: number; inline: boolean }
  const clusters: Cluster[] = []
  const bands = [...new Set(headers.filter((h) => h.category !== 'percent_dv').map((h) => Math.round(h.bbox.y / (typical * config.headerBandHeight))))].sort((a, b) => a - b)
  const sectionOf = (y: number) => bands.filter((b) => b * typical * config.headerBandHeight < y).at(-1) ?? -1
  const add = (box: typeof boxes[number], row: typeof rows[number], isInline: boolean) => {
    const section = sectionOf(p.cy(box))
    const cluster = clusters.find((c) => c.inline === isInline && c.section === section && Math.abs(c.labelX - row.box.bbox.x) < width * config.labelColumnWidthFraction &&
      (isInline || Math.abs(p.median(c.boxes.map((b) => b.bbox.x)) - box.bbox.x) < typical * config.columnHeightTolerance))
    if (cluster) { if (!cluster.boxes.some((b) => b.index === box.index)) cluster.boxes.push(box); cluster.rowKeys.add(row.key) }
    else clusters.push({ boxes: [box], rowKeys: new Set([row.key]), labelX: row.box.bbox.x, section, inline: isInline })
  }
  for (const box of cells) {
    const local = rows.filter((a) => p.right(a.box) <= box.bbox.x && Math.abs(p.cy(a.box) - p.cy(box)) < typical * config.rowCandidateHeight)
      .sort((a, b) => Math.abs(p.cy(a.box) - p.cy(box)) - Math.abs(p.cy(b.box) - p.cy(box)))
    const close = local.filter((a) => Math.abs(p.cy(a.box) - p.cy(box)) < Math.abs(p.cy(local[0]!.box) - p.cy(box)) + typical * config.rowOwnerSlackHeight).sort((a, b) => b.box.bbox.x - a.box.bbox.x)
    if (close[0]) add(box, close[0], false)
  }
  inline.forEach((a) => add(a.box, a, true))
  const bases: Basis[] = []
  const rowKeys = new Map<string, Set<string>>()
  for (const cluster of clusters.sort((a, b) => a.section - b.section || p.median(a.boxes.map((b) => b.bbox.x)) - p.median(b.boxes.map((b) => b.bbox.x)))) {
    const top = Math.min(...cluster.boxes.map(p.cy)), x = p.median(cluster.boxes.map((b) => b.bbox.x))
    const percent = cluster.boxes.every((b) => b.text.includes('%'))
    const nearby = headers.filter((h) => h.bbox.y < top && top - h.bbox.y < typical * config.headerSearchHeight &&
      (cluster.inline ? h.category !== 'percent_dv' && h.bbox.x < p.right(cluster.boxes[0]!)
        : x >= h.bbox.x - typical * config.headerPaddingHeight && x <= h.bbox.x + h.bbox.width + typical * config.headerPaddingHeight))
      .sort((a, b) => b.bbox.y - a.bbox.y)
    const globalHeaders = headers.filter((h) => h.category !== 'percent_dv' && /amount\s+per/i.test(h.text) && h.bbox.y < top)
    const header = nearby[0] ?? (globalHeaders.length === 1 && headers.filter((h) => h.category !== 'percent_dv' && h.bbox.y < top).every((h) => h.context === globalHeaders[0]!.context) ? globalHeaders[0] : undefined)
    if (cluster.rowKeys.size < config.minimumRows && !header) continue
    if (header && nearby.some((h) => h.category !== header.category && Math.abs(h.bbox.y - header.bbox.y) < typical * config.headerConflictHeight)) {
      blockers.push(`ambiguous-header:${cluster.boxes[0]!.index}`)
    }
    const reference = percent && (!header || header.category === 'percent_dv' || /%|amount/i.test(header.text))
    const category = reference ? 'percent_dv' : header?.category ?? 'unknown'
    const basis: Basis = { id: `basis_${bases.length + 1}`, category, kind: category === 'percent_dv' ? 'percent_reference' : 'quantity',
      rawHeader: header?.text ?? '', headerIndexes: header?.indexes ?? [], valueIndexes: cluster.boxes.map((b) => b.index),
      context: header?.context ?? null, preparation: header?.preparation ?? null, section: `section_${cluster.section}`,
      support: cluster.rowKeys.size, reasons: [header ? 'header+geometry' : 'geometry-only', cluster.inline ? 'inline-cells' : 'detached-cells'] }
    // A split nutrient section may repeat a header. Merge only explicit equal
    // contexts with disjoint nutrient rows; same-category competing rows stay distinct.
    const previous = bases.find((b) => b.category !== 'unknown' && b.category === basis.category && b.context === basis.context && b.preparation === basis.preparation &&
      ![...cluster.rowKeys].some((key) => rowKeys.get(b.id)?.has(key)))
    if (previous && basis.kind === 'quantity') {
      previous.valueIndexes.push(...basis.valueIndexes); previous.headerIndexes.push(...basis.headerIndexes)
      previous.support += basis.support; previous.reasons.push('disjoint-section-context-link')
      cluster.rowKeys.forEach((key) => rowKeys.get(previous.id)!.add(key))
    } else { bases.push(basis); rowKeys.set(basis.id, new Set(cluster.rowKeys)) }
  }
  // Percentage references have a context link only when the local section has
  // a unique quantity context. The association stage still proves percent-only rows.
  for (const basis of bases.filter((b) => b.kind === 'percent_reference')) {
    const local = bases.filter((b) => b.kind === 'quantity' && b.section === basis.section)
    if (local.length === 1) basis.context = local[0]!.id
  }
  const assigned = new Set(bases.flatMap((b) => b.valueIndexes))
  return { bases, unassigned: cells.filter((b) => !assigned.has(b.index)).map((b) => b.index), blockers }
}
export function autoSelect(structure: Structure): string | null {
  if (structure.blockers.length) return null
  const quantity = structure.bases.filter((b) => b.kind === 'quantity')
  return quantity.length === 1 ? quantity[0]!.id : null
}
