import type { OcrLine, OcrResult } from '../ocr/types'

export interface NutritionData {
  serving: { serving_size: string | null; servings_per_container: string | null }
  nutrients: Record<string, string | null>
}

export interface NutritionExtraction {
  parserVersion: string
  data: NutritionData
  issues: Array<{ field: string; message: string }>
  evidence: Record<string, { lineIndexes: number[]; text: string; method: string }>
}

type Box = OcrLine & { index: number }
type Anchor = { box: Box; key: string; tail: string; unit?: string }
type Amount = { text: string; boxes: Box[]; x: number; y: number; right: number; height: number }

const core = ['energy', 'total_fat', 'saturated_fat', 'trans_fat', 'cholesterol', 'sodium', 'carbohydrate', 'fiber', 'sugars', 'protein']
// Longest/specific labels must precede their parent nutrients.
const names: Array<[string, RegExp]> = [
  ['energy_from_fat', /^calor(?:ies|les)\s+from(?:\s+fat)?\b/i],
  ['added_sugars', /^(?:includes\s+)?(?:[\d.Oo]+\s*g\s+)?added\s+sugars?\b/i],
  ['energy', /^(?:calories|calorles|alories|energy)\b/i],
  ['total_fat', /^total\s+fat\b/i],
  ['saturated_fat', /^(?:saturated|sat\.?)\s+fat\b/i],
  ['trans_fat', /^trans\s+fat\b/i],
  ['cholesterol', /^cholest(?:erol|rol)\b/i],
  ['sodium', /^sodium\b/i],
  ['carbohydrate', /^(?:total\s+)?carb(?:ohydrate)?s?\b/i],
  ['fiber', /^(?:dietary\s+)?fib(?:er|re)\b/i],
  ['sugars', /^(?:total\s+)?sugars?\b/i],
  ['protein', /^(?:total\s+)?protein\b/i],
  ['vitamin', /^vitamin\s+(b12|b1|b2|b3|b5|b6|b7|b9|a|c|d3|d2|d|e|k)\b/i],
  ['calcium', /^calcium\b/i], ['iron', /^iron\b/i], ['potassium', /^potassium\b/i],
  ['niacin', /^niacin\b/i], ['thiamine', /^thiamin(?:e)?\b/i],
  ['riboflavin', /^riboflavin\b/i], ['folate', /^folate\b/i], ['folic_acid', /^folic\s+acid\b/i],
  ['magnesium', /^magnesium\b/i], ['zinc', /^zinc\b/i], ['phosphorus', /^phosphorus\b/i],
  ['iodine', /^iodine\b/i], ['selenium', /^selenium\b/i], ['copper', /^copper\b/i],
  ['manganese', /^manganese\b/i], ['biotin', /^biotin\b/i],
  ['chloride', /^chloride\b/i], ['chromium', /^chromium\b/i], ['molybdenum', /^molybdenum\b/i],
  ['pantothenic_acid', /^pantothenic\s+acid\b/i],
  ['taurine', /^taurine\b/i], ['caffeine', /^caffeine\b/i],
  ['l_carnitine_l_tartrate', /^l[- ]ca(?:r)?nitine\s+l[- ]tartrate\b/i],
]
const cx = (b: Box) => b.bbox.x + b.bbox.width / 2
const cy = (b: Box) => b.bbox.y + b.bbox.height / 2
const right = (b: Box) => b.bbox.x + b.bbox.width
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 1

function anchor(box: Box): Anchor | undefined {
  for (const [name, pattern] of names) {
    const match = box.text.trim().match(pattern)
    if (!match) continue
    const key = name === 'vitamin' ? `vitamin_${match[1]!.toLowerCase()}` : name
    let tail = box.text.trim().slice(match[0].length).trim()
    if (key === 'added_sugars') tail = box.text.match(/[\d.Oo]+\s*g\b/i)?.[0] ?? tail
    const unit = tail.match(/^\((kcal|kJ|g|mg|mcg|[μµ]g)\)/i)?.[1]
    if (unit) tail = tail.replace(/^\([^)]+\)/, '').trim()
    return { box, key, tail: tail.replace(/^:\s*/, ''), unit }
  }
}

function readAmount(text: string, unit?: string): { value: string; corrected: boolean } | undefined {
  const source = text.trim()
  // These character fixes are restricted to the numeric/unit slot, never the raw OCR.
  const normalized = source.replace(/\b[Oo](?=\s*(?:g|mg|mcg|[μµ]g)\b)/g, '0').replace(/mmg\b/gi, 'mg')
  const match = normalized.match(/^(less than\s+|<\s*|>\s*)?(\d+(?:\.\d+)?)\s*(kcal|kj|mcg|mg|[μµ]g|g|%)?(?:\s+\d+(?:\.\d+)?\s*%)?\s*$/i)
  if (!match) return
  const suffix = match[3] ?? unit
  if (!suffix) return
  const canonicalUnit = /^(kcal|g|mg|mcg)$/i.test(suffix) ? suffix.toLowerCase() : suffix
  return { value: `${match[1] ?? ''}${match[2]}${canonicalUnit}`, corrected: normalized !== source }
}

function groupAmounts(boxes: Box[]): Amount[] {
  const rows: Box[][] = []
  for (const box of [...boxes].sort((a, b) => cy(a) - cy(b) || a.bbox.x - b.bbox.x)) {
    const row = rows.find((r) => Math.abs(cy(r[0]!) - cy(box)) < Math.min(r[0]!.bbox.height, box.bbox.height) * 0.45)
    if (row) row.push(box)
    else rows.push([box])
  }
  return rows.map((row) => {
    row.sort((a, b) => a.bbox.x - b.bbox.x)
    return { text: row.map((b) => b.text).join(' '), boxes: row, x: row[0]!.bbox.x,
      y: median(row.map(cy)), right: Math.max(...row.map(right)), height: median(row.map((b) => b.bbox.height)) }
  })
}

function orderedAlignment(names: Anchor[], values: Amount[]): boolean {
  if (names.length < 3 || names.length !== values.length) return false
  const first = names[0]!, last = names[names.length - 1]!
  const span = cy(last.box) - cy(first.box)
  const scale = (values[values.length - 1]!.y - values[0]!.y) / span
  const spacing = span / (names.length - 1)
  return scale > 0.75 && scale < 1.3 && values.every((value, i) => {
    const name = names[i]!
    const predicted = values[0]!.y + (cy(name.box) - cy(first.box)) * scale
    return Math.abs(value.y - predicted) < spacing * 0.35 && Math.abs(value.y - cy(name.box)) < spacing * 0.9 && value.x > right(name.box)
  })
}

/** Pure, conservative post-processing. Never modifies recognition results or infers missing digits. */
export function parseNutrition(result: OcrResult): NutritionExtraction {
  const output: NutritionExtraction = {
    parserVersion: 'spatial-review-v1',
    data: { serving: { serving_size: null, servings_per_container: null }, nutrients: Object.fromEntries(core.map((key) => [key, null])) },
    issues: [], evidence: {},
  }
  const issue = (field: string, message: string) => output.issues.push({ field, message })
  const boxes = result.lines.map((line, index) => ({ ...line, index })).filter((line) =>
    Object.values(line.bbox).every(Number.isFinite) && line.bbox.width > 0 && line.bbox.height > 0)
  const width = result.sourceSize?.width ?? Math.max(1, ...boxes.map(right))
  const found = boxes.map(anchor).filter((a): a is Anchor => Boolean(a)).sort((a, b) => cy(a.box) - cy(b.box))
  // Stop before the generic 2,000/2,500-calorie reference table, not at its repeated nutrient rows.
  const referenceHeading = boxes.find((b) => /^calories\s*:\s*$/i.test(b.text) &&
    boxes.some((n) => /2[,.]?000|2[,.]?500/.test(n.text) && Math.abs(cy(n) - cy(b)) < b.bbox.height * 2))
  const footnote = boxes.find((b) => /(?:percent daily values are based|calories per gram|ingredients\s*:)/i.test(b.text))
  const cutoff = Math.min(referenceHeading?.bbox.y ?? Infinity, footnote?.bbox.y ?? Infinity)
  const anchors = found.filter((a) => cy(a.box) < cutoff)
  if (cutoff < Infinity) issue('panel', 'Excluded the daily-reference table or footer below the nutrition panel.')
  const used = new Set<number>()
  const remember = (field: string, value: string, source: Box[], method: string) => {
    output.evidence[field] = { lineIndexes: source.map((b) => b.index), text: source.map((b) => b.text).join(' | '), method }
    if (field.startsWith('serving.')) output.data.serving[field.slice(8) as keyof NutritionData['serving']] = value
    else output.data.nutrients[field] = value
  }
  const store = (a: Anchor, text: string, source: Box[], method: string) => {
    const amount = readAmount(text, a.unit ?? (a.key.startsWith('energy') ? 'kcal' : undefined))
    if (!amount) return false
    remember(a.key, amount.value, [a.box, ...source], method)
    source.forEach((b) => used.add(b.index))
    if (amount.corrected) issue(a.key, 'Normalized an OCR character/unit error; verify against the image.')
    return true
  }

  // Only accept legible serving fields. Garbled headers/values remain visible in raw OCR.
  const firstNutrientY = anchors[0]?.box.bbox.y ?? 0
  const header = boxes.filter((b) => cy(b) < firstNutrientY)
  for (const [field, pattern] of [
    ['serving_size', /^serving\s+size\s*:?\s*(.*)$/i],
    ['servings_per_container', /^(?:no\.\s*of\s+)?servings?\s+per\s+container\s*:?\s*(.*)$/i],
  ] as const) {
    const line = header.find((b) => pattern.test(b.text))
    const value = line?.text.match(pattern)?.[1]?.trim()
    if (line && value && /\d/.test(value)) remember(`serving.${field}`, value, [line], 'inline')
  }
  const aboutCount = header.find((b) => /^about\s+\d+(?:\.\d+)?\s+servings?\s+per\s+container$/i.test(b.text))
  if (aboutCount) remember('serving.servings_per_container', aboutCount.text.replace(/\s+servings?\s+per\s+container$/i, ''), [aboutCount], 'inline')
  const sizeLabel = header.find((b) => /^serving size\s*:?\s*$/i.test(b.text))
  const countLabel = header.find((b) => /^servings? per container\s*:?\s*$/i.test(b.text))
  if (sizeLabel && countLabel) {
    const cells = groupAmounts(header.filter((b) => b.bbox.x > Math.max(right(sizeLabel), right(countLabel)) &&
      /^(?:\d|about\s+\d|bag\b|cup\b|pieces?\b)/i.test(b.text)))
    const sizes = cells.filter((cell) => /^\d+(?:\/\d+|\.\d+)?\s*(?:bag|cup|pieces?|g|ml)\b/i.test(cell.text) &&
      Math.abs(cell.y - cy(sizeLabel)) < sizeLabel.bbox.height * 2)
    if (sizes.length === 1) {
      const size = sizes[0]!
      const shift = size.y - cy(sizeLabel)
      const counts = cells.filter((cell) => /^(?:about\s+)?\d+(?:\.\d+)?$/i.test(cell.text) &&
        Math.abs(cell.y - cy(countLabel) - shift) < countLabel.bbox.height * 0.5)
      if (counts.length === 1) {
        remember('serving.serving_size', size.text, [sizeLabel, ...size.boxes], 'spatial-serving-column')
        remember('serving.servings_per_container', counts[0]!.text, [countLabel, ...counts[0]!.boxes], 'spatial-serving-column')
      }
    }
  }

  // Multiple per-serving/per-100g amount columns require explicit selection, not an arbitrary first column.
  const multiBasis = boxes.some((b) => /(?:per\s*100\s*(?:g|ml)|as prepared|as sold)/i.test(b.text))
  if (multiBasis) issue('panel', 'Multiple or non-serving nutrition bases detected; automatic nutrient extraction is disabled.')
  const duplicates = new Set(anchors.filter((a, i) => anchors.findIndex((b) => b.key === a.key) !== i).map((a) => a.key))
  for (const a of anchors) {
    output.data.nutrients[a.key] ??= null
    if (multiBasis || duplicates.has(a.key)) continue
    if (a.tail) store(a, a.tail, [], 'inline')
  }

  // Group unresolved names by their horizontal label column (micronutrient tables may have two).
  const columns: Anchor[][] = []
  for (const a of anchors.filter((a) => !multiBasis && !duplicates.has(a.key) && !output.data.nutrients[a.key])) {
    const column = columns.find((c) => Math.abs(c[0]!.box.bbox.x - a.box.bbox.x) < width * 0.18)
    if (column) column.push(a)
    else columns.push([a])
  }
  const percentHeading = boxes.find((b) => /^%\s*(?:daily|re)/i.test(b.text))
  const labelIndexes = new Set(anchors.map((a) => a.box.index))
  for (const column of columns) {
    const minX = Math.min(...column.map((a) => right(a.box)))
    const minY = Math.min(...column.map((a) => cy(a.box)))
    const maxY = Math.max(...column.map((a) => cy(a.box)))
    const typicalHeight = median(column.map((a) => a.box.bbox.height))
    const candidates = boxes.filter((b) => !labelIndexes.has(b.index) && !used.has(b.index) && b.bbox.x >= minX &&
      cy(b) > minY - typicalHeight && cy(b) < Math.min(cutoff, maxY + typicalHeight) &&
      /^[\dOo<>.%μµ\s\-]+$|^(?:less than\s+)?[\dOo<>.]+\s*(?:kcal|kj|g|mg|mmg|mcg|[μµ]g|%)$|^(?:g|mg|mcg|[μµ]g)$/i.test(b.text.trim()) &&
      b.bbox.height > typicalHeight * 0.2)
    const massBoxes = candidates.filter((b) => !b.text.includes('%') && (!percentHeading ||
      cy(b) < percentHeading.bbox.y || cx(b) < percentHeading.bbox.x))
    const amounts = groupAmounts(massBoxes)
    // Ordered complete columns handle curved/tilted labels where nearest-y assigns a value to the next row.
    const detached = column.filter((a) => !a.tail)
    let ordered = false
    if (detached.length >= 4 && amounts.length === detached.length) {
      ordered = orderedAlignment(detached, amounts)
      if (ordered) detached.forEach((a, i) => store(a, amounts[i]!.text, amounts[i]!.boxes, 'ordered-column'))
    }
    for (const a of column) {
      if (output.data.nutrients[a.key] || a.tail) continue
      // Do not slide remaining values up/down an incomplete bare-number table.
      if (a.unit && detached.length >= 4 && !ordered) continue
      const offsets = column.flatMap((other) => {
        const evidence = output.evidence[other.key]
        if (!evidence || evidence.method !== 'spatial-row' || Math.abs(cy(other.box) - cy(a.box)) > typicalHeight * 5) return []
        const sources = boxes.filter((b) => evidence.lineIndexes.includes(b.index) && b.index !== other.box.index)
        return sources.length ? [median(sources.map(cy)) - cy(other.box)] : []
      })
      const expectedY = cy(a.box) + (offsets.length ? median(offsets) : 0)
      const options = amounts.filter((v) => !v.boxes.some((b) => used.has(b.index)) && v.x >= right(a.box) &&
        Math.abs(v.y - expectedY) < Math.max(v.height, a.box.bbox.height) * 0.85)
        .sort((x, y) => Math.abs(x.y - expectedY) - Math.abs(y.y - expectedY))
      const best = options[0]
      if (best && (options.length === 1 || Math.abs(options[1]!.y - expectedY) - Math.abs(best.y - expectedY) > a.box.bbox.height * 0.2)) {
        store(a, best.text, best.boxes, 'spatial-row')
      }
      // Percent-only micronutrients: choose within the local label column, never a distant macro DV.
      if (!output.data.nutrients[a.key] && !core.includes(a.key) && !a.key.startsWith('energy')) {
        const adjacentColumn = Math.min(Infinity, ...anchors.filter((other) => other.box.bbox.x > right(a.box) &&
          Math.abs(cy(other.box) - cy(a.box)) < typicalHeight * 2).map((other) => other.box.bbox.x))
        const percents = candidates.filter((b) => b.text.includes('%') && !used.has(b.index) && b.bbox.x > right(a.box) && b.bbox.x < adjacentColumn &&
          Math.abs(cy(b) - cy(a.box)) < a.box.bbox.height * 0.45)
          .sort((x, y) => Math.abs(cy(x) - cy(a.box)) - Math.abs(cy(y) - cy(a.box)))
        // A neighboring amount, even if unreadable, must not be replaced by its %DV.
        if (options.length === 0 && percents.length === 1) store(a, percents[0]!.text, [percents[0]!], 'percent-only-row')
      }
    }
    // Compact, percent-only vitamin/mineral columns can be slanted independently of the macro table.
    const micros = column.filter((a) => !core.includes(a.key) && !a.key.startsWith('energy') && !a.tail)
    if (micros.length >= 3) {
      const left = Math.max(...micros.map((a) => right(a.box)))
      const top = Math.min(...micros.map((a) => cy(a.box)))
      const bottom = Math.max(...micros.map((a) => cy(a.box)))
      const edge = Math.min(Infinity, ...anchors.filter((a) => a.box.bbox.x > left && cy(a.box) >= top - typicalHeight &&
        cy(a.box) <= bottom + typicalHeight).map((a) => a.box.bbox.x))
      const percents = groupAmounts(candidates.filter((b) => b.text.includes('%') && b.bbox.x > left && b.bbox.x < edge &&
        cy(b) > top - typicalHeight && cy(b) < bottom + typicalHeight))
      const nearbyMass = amounts.some((v) => v.x > left && v.x < edge && v.y > top - typicalHeight && v.y < bottom + typicalHeight)
      if (!nearbyMass && orderedAlignment(micros, percents)) {
        micros.forEach((a, i) => {
          if (!output.data.nutrients[a.key]) store(a, percents[i]!.text, percents[i]!.boxes, 'ordered-percent-column')
        })
      }
    }
  }
  for (const key of duplicates) issue(key, 'Repeated nutrient rows or multiple panels detected; select one panel.')
  for (const [key, value] of Object.entries(output.data.nutrients)) {
    if (value === null) {
      issue(key, 'Missing or ambiguous amount; check the image. Missing does not mean zero.')
      const sources = anchors.filter((a) => a.key === key).map((a) => a.box)
      if (sources.length) output.evidence[key] = { lineIndexes: sources.map((b) => b.index), text: sources.map((b) => b.text).join(' | '), method: 'unresolved' }
    }
  }
  for (const [key, value] of Object.entries(output.data.serving)) {
    if (value === null) issue(`serving.${key}`, 'Serving information could not be read reliably; check the image.')
  }
  return output
}
