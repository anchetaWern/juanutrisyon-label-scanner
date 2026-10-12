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
type Anchor = { box: Box; key: string; tail: string; unit?: string; corrected: boolean; sources?: Box[]; inlineOnly?: boolean }
type Amount = { text: string; boxes: Box[]; x: number; y: number; right: number; height: number }

const core = ['energy', 'total_fat', 'saturated_fat', 'trans_fat', 'cholesterol', 'sodium', 'carbohydrate', 'fiber', 'sugars', 'protein']
// Longest/specific labels must precede their parent nutrients.
const names: Array<[string, RegExp]> = [
  ['energy_from_fat', /^calor(?:ies|les)\s*from(?:\s*fat)?\b/i],
  ['added_sugars', /^(?:includes\s+)?(?:[\d.Oo]+\s*g\s+)?added\s+sugars?\b/i],
  ['energy', /^(?:total\s+calories|calories|calorles|alories|energy)\b/i],
  ['total_fat', /^(?:total\s*fats?(?:\s*\/\s*lipids)?|fat,\s*total)\b/i],
  ['saturated_fat', /^(?:saturated|sat\.?)\s+fat\b/i],
  ['unsaturated_fat', /^unsaturated\s+fat\b/i],
  ['trans_fat', /^trans\s*fat\b/i],
  ['omega_3', /^omega\s*[- ]?\s*3\b/i], ['omega_6', /^omega\s*[- ]?\s*6\b/i], ['omega_9', /^omega\s*[- ]?\s*9\b/i],
  ['dha', /^dha\b/i],
  ['cholesterol', /^cholest(?:erol|rol)\b/i],
  ['sodium', /^sodium\b/i],
  ['carbohydrate', /^(?:total\s*)?carb(?:ohydrate)?s?\b/i],
  ['soluble_fiber', /^soluble\s+fib(?:er|re)\b/i],
  ['insoluble_fiber', /^insoluble\s+fib(?:er|re)\b/i],
  ['fiber', /^(?:dietary\s+)?fib(?:er|re)\b/i],
  ['sugars', /^(?:total\s+)?sugars?\b/i],
  ['protein', /^(?:total\s*)?protein\b/i],
  ['vitamin', /^(?:vitamin|vit\.)\s*(b12|b1|b2|b3|b5|b6|b7|b9|a|c|d3|d2|d|e|k)\b/i],
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
const vitaminNames: Record<string, RegExp> = {
  vitamin_b1: /^\(thiamine\)\s*/i, vitamin_b2: /^\(riboflavin\)\s*/i, vitamin_b3: /^\(niacin\)\s*/i,
}
const cx = (b: Box) => b.bbox.x + b.bbox.width / 2
const cy = (b: Box) => b.bbox.y + b.bbox.height / 2
const right = (b: Box) => b.bbox.x + b.bbox.width
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 1

function anchor(box: Box): Anchor | undefined {
  // Explicit observed OCR spellings only; retain the source and flag every match.
  const text = box.text.trim().normalize('NFKC').replace(/^Dletary\s+Fiber\b/i, 'Dietary Fiber')
    .replace(/^Sodiun\b/i, 'Sodium').replace(/^Irón\b/i, 'Iron')
    .replace(/^Toial\s+Protein\b/i, 'Total Protein')
    .replace(/^Total\s+Proten\b/i, 'Total Protein')
    .replace(/^Dietayy\s+Fiber\b/i, 'Dietary Fiber')
    .replace(/^Tolal\s+Carbohydrates?\b/i, 'Total Carbohydrates')
    .replace(/^Calcum\b/i, 'Calcium').replace(/^Lodine\b/i, 'Iodine').replace(/^Selenlum\b/i, 'Selenium')
    .replace(/^Calorlas(?=\s+from\s+Fat\b)/i, 'Calories')
    .replace(/^sugarg\)(?=\s|$)/i, 'Sugar(g)')
    .replace(/^Calclum\b/i, 'Calcium').replace(/^Potasslum\b/i, 'Potassium')
    .replace(/^[•·-]\s*/, '')
    .replace(/^(cholesterol|zinc|dha|trans\s*fat)(?=\d)/i, '$1 ')
  for (const [name, pattern] of names) {
    const match = text.match(pattern)
    if (!match) continue
    const key = name === 'vitamin' ? `vitamin_${match[1]!.toLowerCase()}` : name
    let tail = text.slice(match[0].length).trim()
    if (vitaminNames[key]) tail = tail.replace(vitaminNames[key], '')
    if (key === 'added_sugars') tail = box.text.match(/[\d.Oo]+\s*g\b/i)?.[0] ?? tail
    tail = tail.replace(/^[,:]\s*/, '')
    const unitMatch = tail.match(/^\(\s*(kcal|kJ|g|mg|mcg(?:\s+RE)?|[μµu]g(?:\s+RE)?|IU)\s*(?:\)|$)/i)
    const rawUnit = unitMatch?.[1]
    const unit = rawUnit?.replace(/^ug/i, 'μg')
    if (unitMatch) tail = tail.slice(unitMatch[0].length).trim()
    return { box, key, tail: tail.replace(/^:\s*/, ''), unit, corrected: text !== box.text.trim() || rawUnit !== unit }
  }
}

function anchorsInBox(box: Box): Anchor[] {
  // Split only explicit nutrient starts following a complete printed amount/DV.
  // Geometry is NOT invented: each fragment retains the original OCR line/index,
  // and fragments are accepted only inline, never as detached spatial labels.
  const boundaries = [...box.text.matchAll(/(?:\d|%)(?:\s*[•·]\s*|\s+)(?=(?:calories\s+from\s+fat|vitamin\s+(?:b12|b1|b2|b3|b5|b6|b7|b9|a|c|d3|d2|d|e|k)\b|calcium\b|iron\b|potassium\b))/gi)]
  if (!boundaries.length) {
    const a = anchor(box)
    return a ? [a] : []
  }
  const starts = [0, ...boundaries.map((m) => m.index! + m[0].length)]
  const fragments = starts.map((start, i) => anchor({ ...box, text: box.text.slice(start, starts[i + 1]).replace(/[•·]\s*$/, '').trim() }))
  if (fragments.some((a) => !a || !readAmount(a.tail, a.unit ?? (a.key.startsWith('energy') ? 'kcal' : undefined), a.key.startsWith('energy')))) {
    const a = anchor(box)
    return a ? [a] : []
  }
  return fragments.map((a) => ({ ...a!, box, inlineOnly: true }))
}

function readAmount(text: string, unit?: string, foodEnergy = false): { value: string; corrected: boolean } | undefined {
  const source = text.trim()
  // Food-label Calories (Cal) are kcal. Never reinterpret cal on a mass
  // nutrient or outside an explicitly named energy row; keep a review warning.
  const calorieText = foodEnergy ? source.replace(/(\d)\s*cal(?=\s*(?:\d+(?:\.\d+)?\s*%)?\s*\.?$)/i, '$1kcal') : source
  // These character fixes are restricted to the numeric/unit slot, never the raw OCR.
  const normalized = calorieText.replace(/\b[Oo](?=\s*(?:g|mg|mcg|[μµ]g)\b)/g, '0').replace(/mmg\b/gi, 'mg')
    .replace(/(\d)\s*ug\b/gi, '$1μg')
    .replace(/(kcal|kj|mcg|mg|g|IU)\.$/i, '$1')
  const match = normalized.match(/^(less than\s+|<\s*|>\s*)?(\d+(?:\.\d+)?)\s*(kcal|kj|mcg(?:\s+RE)?|mg|[μµ]g(?:\s+RE)?|g|IU|%)?(\s+\d+(?:\.\d+)?\s*%)?\s*$/i)
  if (!match) return
  const suffix = match[3] ?? unit
  if (!suffix || (suffix === '%' && match[4])) return
  const canonicalUnit = /^iu$/i.test(suffix) ? 'IU' : /^(kcal|g|mg|mcg)$/i.test(suffix) ? suffix.toLowerCase() : suffix
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
    const previousName = names[i - 1], previousValue = values[i - 1]
    const localScale = previousName && previousValue ? (value.y - previousValue.y) / (cy(name.box) - cy(previousName.box)) : 1
    return localScale > .7 && localScale < 1.4 && Math.abs(value.y - predicted) < spacing * .5 &&
      Math.abs(value.y - cy(name.box)) < spacing * .9 && value.x > right(name.box)
  })
}

/** Pure, conservative post-processing. Never modifies recognition results or infers missing digits. */
export function parseNutrition(result: OcrResult): NutritionExtraction {
  const output: NutritionExtraction = {
    parserVersion: 'spatial-review-v5',
    data: { serving: { serving_size: null, servings_per_container: null }, nutrients: Object.fromEntries(core.map((key) => [key, null])) },
    issues: [], evidence: {},
  }
  const issue = (field: string, message: string) => output.issues.push({ field, message })
  const boxes = result.lines.map((line, index) => ({ ...line, index })).filter((line) =>
    Object.values(line.bbox).every(Number.isFinite) && line.bbox.width > 0 && line.bbox.height > 0)
    .sort((a, b) => cy(a) - cy(b) || a.bbox.x - b.bbox.x || a.text.localeCompare(b.text))
  const width = result.sourceSize?.width ?? Math.max(1, ...boxes.map(right))
  const found = boxes.flatMap(anchorsInBox)
  // Stop before the generic 2,000/2,500-calorie reference table, not at its repeated nutrient rows.
  const referenceHeading = boxes.find((b) => /^calories\s*:\s*$/i.test(b.text) &&
    boxes.some((n) => /2[,.]?000|2[,.]?500/.test(n.text) && Math.abs(cy(n) - cy(b)) < b.bbox.height * 2))
  const footnote = boxes.find((b) => /(?:percent daily values are based|calories per gram|ingredients\s*:)/i.test(b.text))
  const cutoff = Math.min(referenceHeading?.bbox.y ?? Infinity, footnote?.bbox.y ?? Infinity)
  const anchors = found.filter((a) => cy(a.box) < cutoff)
  // Short subrow labels are used on some split tables. Require an explicit
  // total-fat label before the footer; do not interpret standalone prose as fat.
  if (anchors.some((a) => a.key === 'total_fat')) for (const box of boxes.filter((b) => cy(b) < cutoff)) {
    const match = box.text.trim().match(/^[-•·]\s*(trans|saturated)\s*$/i)
    if (match) anchors.push({ box, key: match[1]!.toLowerCase() === 'trans' ? 'trans_fat' : 'saturated_fat', tail: '', corrected: true })
  }
  anchors.sort((a, b) => cy(a.box) - cy(b.box))
  // A split "Includes 0g | Added Sugar" is one explicit amount, not an inferred unit.
  for (const a of anchors.filter((a) => a.key === 'added_sugars' && !a.tail)) {
    const prefixes = boxes.filter((b) => /^includes\s+[\d.Oo]+\s*g\s*$/i.test(b.text) &&
      right(b) <= a.box.bbox.x + a.box.bbox.height * .5 && a.box.bbox.x - right(b) < a.box.bbox.height &&
      Math.abs(cy(b) - cy(a.box)) < Math.min(b.bbox.height, a.box.bbox.height) * .45)
    if (prefixes.length === 1) { a.tail = prefixes[0]!.text.replace(/^includes\s+/i, ''); a.sources = prefixes }
  }
  for (const a of anchors.filter((a) => a.corrected)) {
    issue(a.key, 'Normalized an OCR nutrient-name error; verify against the image.')
  }
  if (cutoff < Infinity) issue('panel', 'Excluded the daily-reference table or footer below the nutrition panel.')
  const used = new Set<number>()
  const remember = (field: string, value: string, source: Box[], method: string) => {
    output.evidence[field] = { lineIndexes: source.map((b) => b.index), text: source.map((b) => b.text).join(' | '), method }
    if (field.startsWith('serving.')) output.data.serving[field.slice(8) as keyof NutritionData['serving']] = value
    else output.data.nutrients[field] = value
  }
  const store = (a: Anchor, text: string, source: Box[], method: string) => {
    const amount = readAmount(text, a.unit ?? (a.key.startsWith('energy') ? 'kcal' : undefined), a.key.startsWith('energy'))
    if (!amount) return false
    // Validate printed units without supplying missing units or converting amounts.
    const expectedUnit = a.unit ?? (method === 'inline' ? undefined : ['total_fat', 'saturated_fat', 'trans_fat', 'carbohydrate', 'fiber', 'sugars', 'added_sugars', 'protein'].includes(a.key) ? 'g'
      : ['sodium', 'cholesterol'].includes(a.key) ? 'mg' : undefined)
    const unitIdentity = (value: string) => value.toLowerCase().replace(/[μµ]/g, 'mc')
    const actualUnit = amount.value.match(/(?:kcal|kj|mcg(?:\s+RE)?|mg|[μµ]g(?:\s+RE)?|g|IU|%)$/i)?.[0]
    if (expectedUnit && actualUnit && unitIdentity(actualUnit) !== unitIdentity(expectedUnit)) return false
    const sources = [...(a.sources ?? []), ...source]
    remember(a.key, amount.value, [a.box, ...sources], method)
    sources.forEach((b) => used.add(b.index))
    if (amount.corrected) issue(a.key, 'Normalized an OCR character/unit error; verify against the image.')
    return true
  }

  // Only accept legible serving fields. Garbled headers/values remain visible in raw OCR.
  const firstNutrientY = anchors[0]?.box.bbox.y ?? 0
  const header = boxes.filter((b) => cy(b) < firstNutrientY)
  const servingValue = (value: string) => value.trim().replace(/^[,:;]\s*/, '').replace(/\boz[.,](?=\s*(?:\(|\d))/gi, 'oz')
  for (const [field, pattern] of [
    ['serving_size', /^serving\s+size\b\s*:?\s*(.*)$/i],
    ['servings_per_container', /^(?:no\.?\s*of\s+)?servings?\s+per\s+(?:container|pack)\s*:?\s*(.*)$/i],
  ] as const) {
    const line = header.find((b) => pattern.test(b.text))
    const rawValue = line?.text.match(pattern)?.[1]?.trim()
    let value = rawValue ? servingValue(rawValue) : ''
    let sources = line ? [line] : []
    if (line && field === 'serving_size' && /^\d+(?:\/\d+|\.\d+)?$/.test(value)) {
      const continuations = header.filter((b) => b.index !== line.index && /^(?:pieces?|slices?|cups?|bags?|packs?)\b.*\(\d+(?:\.\d+)?\s*(?:g|ml)\)$/i.test(b.text.trim()) &&
        b.bbox.x >= right(line) - Math.min(line.bbox.width, b.bbox.width) * .2 && b.bbox.x - right(line) < line.bbox.height &&
        Math.abs(cy(b) - cy(line)) < Math.min(line.bbox.height, b.bbox.height) * .6)
      if (continuations.length === 1) { value += ` ${continuations[0]!.text.trim()}`; sources = [...sources, continuations[0]!] }
      else value = '' // A detached household count alone is an incomplete size.
    }
    if (line && value && /\d/.test(value)) {
      remember(`serving.${field}`, value, sources, sources.length > 1 ? 'spatial-serving-fragment' : 'inline')
      if (rawValue !== value) issue(`serving.${field}`, 'Normalized serving punctuation or joined explicit fragments; verify against the image.')
    }
  }
  const countPrefix = header.filter((b) => /^(?:no\.?\s*of\s+)?servings?\s*(?:per\s*)?$/i.test(b.text.trim()))
  for (const prefix of countPrefix) {
    const suffixes = header.filter((b) => /^(?:per\s+)?container(?:\s*\/\s*pack)?\s*:\s*(?:about\s+)?\d+(?:\.\d+)?\s*$/i.test(b.text.trim()) &&
      b.bbox.x >= right(prefix) && b.bbox.x - right(prefix) < prefix.bbox.height &&
      Math.abs(cy(b) - cy(prefix)) < Math.min(prefix.bbox.height, b.bbox.height) * .6)
    if (countPrefix.length === 1 && suffixes.length === 1) remember('serving.servings_per_container', suffixes[0]!.text.split(':')[1]!.trim(), [prefix, suffixes[0]!], 'spatial-serving-fragment')
  }
  const aboutCount = header.find((b) => /^(?:about\s+)?\d+(?:\.\d+)?\s+servings?\s+per\s+container$/i.test(b.text))
  if (aboutCount) remember('serving.servings_per_container', aboutCount.text.replace(/\s+servings?\s+per\s+container$/i, ''), [aboutCount], 'inline')
  // A detached mass can complete a size label or a readable household measure.
  // This does not depend on successfully reading the separate container count.
  const detachedSize = header.find((b) => /^serving\s+size\s*:?\s*(\(\d+\s+slices?\))?\s*$/i.test(b.text))
  if (detachedSize) {
    const masses = header.filter((b) => b.bbox.x > right(detachedSize) &&
      /^(?:\d+(?:\.\d+)?\s*(?:g|ml)|\(\d+(?:\.\d+)?\s*(?:g|ml)\))$/i.test(b.text.trim()) &&
      Math.abs(cy(b) - cy(detachedSize)) < detachedSize.bbox.height * 0.6)
    if (masses.length === 1) {
      const measure = detachedSize.text.match(/\(\d+\s+slices?\)/i)?.[0]
      remember('serving.serving_size', [measure, masses[0]!.text.trim()].filter(Boolean).join(' '),
        [detachedSize, masses[0]!], 'spatial-serving-row')
    }
  }
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

  // A single panel may put its serving block BESIDE the nutrient sections.
  // Fill unresolved fields only; do not widen the scope across panels or bases.
  const singleServingPanel = boxes.filter((b) => /^nutrition\s+(?:facts|information)\b/i.test(b.text)).length <= 1 &&
    !boxes.some((b) => /(?:per\s*100\s*(?:g|ml)|as prepared|as sold)/i.test(b.text))
  if (singleServingPanel) {
    const region = boxes.filter((b) => cy(b) < cutoff)
    const servingText = (text: string) => text.trim().replace(/^Sevings?\b/i, (s) => s.toLowerCase() === 'seving' ? 'Serving' : 'Servings')
      .replace(/\bconíainer\b/i, 'container')
    const sizePattern = /^(?:approx\.?\s*)?\d+(?:\/\d+|\.\d+)?\s*(?:g|ml|oz|tbsp|tsp|cups?|pieces?|pcs|sandwich(?:es)?|slices?|bags?|packs?)(?:\s*\(\d+(?:\.\d+)?\s*(?:g|ml)\))?$/i
    for (const [field, pattern] of [
      ['serving_size', /^serving\s+size\s*:?\s*(.*)$/i],
      ['servings_per_container', /^(?:no\.?\s*of\s+)?servings?\s+per\s+(?:container|pack)\s*:?\s*(.*)$/i],
    ] as const) {
      if (output.data.serving[field] !== null) continue
      const labels = region.filter((b) => pattern.test(servingText(b.text)))
      if (labels.length !== 1) continue
      const label = labels[0]!
      if (field === 'serving_size' && region.some((b) => /^makes\b/i.test(b.text.trim()) &&
        Math.abs(b.bbox.x - label.bbox.x) < label.bbox.width * .35 && cy(b) > cy(label) && cy(b) - cy(label) < label.bbox.height * 2)) continue
      let value = servingValue(servingText(label.text).match(pattern)![1]!)
      let sources = [label]
      if (field === 'serving_size' && !value) {
        const options = region.filter((b) => b.index !== label.index && sizePattern.test(servingValue(b.text)) && (
          (b.bbox.x >= right(label) && Math.abs(cy(b) - cy(label)) < Math.min(b.bbox.height, label.bbox.height) * .45) ||
          (Math.abs(b.bbox.x - label.bbox.x) < label.bbox.width * .35 && b.bbox.y >= label.bbox.y + label.bbox.height * .4 &&
            cy(b) - cy(label) < label.bbox.height * 1.5)) &&
          !anchors.some((a) => a.box.bbox.x >= right(label) && a.box.bbox.x < b.bbox.x &&
            Math.abs(cy(a.box) - cy(b)) < Math.max(a.box.bbox.height, b.bbox.height)))
        if (options.length !== 1) continue
        value = servingValue(options[0]!.text)
        sources = [label, options[0]!]
      }
      const valid = field === 'serving_size' ? sizePattern.test(value) : /^(?:about\s+)?\d+(?:\.\d+)?$/i.test(value)
      if (!valid) continue
      remember(`serving.${field}`, value, sources, 'single-panel-serving-block')
      if (sources.some((b) => servingText(b.text) !== b.text.trim()) || sources.length > 1) {
        issue(`serving.${field}`, 'Normalized a serving-label spelling or joined explicit fragments; verify against the image.')
      }
    }
    if (output.data.serving.servings_per_container === null) {
      const prefixes = region.filter((b) => /^(?:about\s+)?\d+(?:\.\d+)?\s+servings?$/i.test(b.text.trim()))
      const suffixes = region.filter((b) => /^per\s+container$/i.test(b.text.trim()))
      if (prefixes.length === 1 && suffixes.length === 1) {
        const prefix = prefixes[0]!, suffix = suffixes[0]!
        if (Math.abs(prefix.bbox.x - suffix.bbox.x) < prefix.bbox.width * .25 && cy(suffix) > cy(prefix) &&
          cy(suffix) - cy(prefix) < Math.max(prefix.bbox.height, suffix.bbox.height) * 1.2) {
          remember('serving.servings_per_container', prefix.text.replace(/\s+servings?\s*$/i, '').trim(), [prefix, suffix], 'single-panel-serving-block')
        }
      }
    }
  }

  // Multiple per-serving/per-100g amount columns require explicit selection, not an arbitrary first column.
  const basisHeadings = boxes.filter((b) => /(?:per\s*100\s*(?:g|ml)|as prepared|as sold)/i.test(b.text))
  const per100 = basisHeadings.length === 1 && /^per\s*100\s*(?:g|ml)$/i.test(basisHeadings[0]!.text.trim())
    ? basisHeadings[0] : undefined
  const servingHeadings = boxes.filter((b) => /^per\s+serving$/i.test(b.text.trim()))
  const perServing = servingHeadings.length === 1 ? servingHeadings[0] : undefined
  const tableRows = per100 ? anchors.filter((a) => cy(a.box) > cy(per100)) : []
  const upperRows = per100 ? anchors.filter((a) => cy(a.box) < per100.bbox.y) : []
  // Narrow exception: inline per-serving macros above a separately headed,
  // detached micronutrient table. All other multi-basis layouts still abstain.
  const servingTable = per100 && perServing && right(perServing) < per100.bbox.x &&
    Math.abs(cy(perServing) - cy(per100)) < Math.min(perServing.bbox.height, per100.bbox.height) * 0.5 &&
    upperRows.length >= 3 && upperRows.length + tableRows.length === anchors.length &&
    upperRows.every((a) => readAmount(a.tail, a.unit ?? (a.key.startsWith('energy') ? 'kcal' : undefined), a.key.startsWith('energy'))) &&
    boxes.some((b) => /^amount per serving$/i.test(b.text.trim()) && cy(b) < upperRows[0]!.box.bbox.y) &&
    tableRows.length >= 3 && tableRows.every((a) => !core.includes(a.key) && !a.key.startsWith('energy') &&
      !a.tail && right(a.box) < right(perServing))
  const scopedRows = new Set(servingTable ? tableRows : [])
  const multiBasis = basisHeadings.length > 0 && !servingTable
  if (multiBasis) issue('panel', 'Multiple or non-serving nutrition bases detected; automatic nutrient extraction is disabled.')
  if (servingTable) issue('panel', 'Selected the explicitly headed per-serving micronutrient column; excluded the per-100g/ml column. Verify the basis against the image.')
  const duplicates = new Set(anchors.filter((a, i) => anchors.findIndex((b) => b.key === a.key) !== i).map((a) => a.key))
  const panelHeadings = boxes.filter((b) => /^nutrition\s+(?:facts|information)\b/i.test(b.text.trim()))
  const multiplePanels = duplicates.size >= 3 && panelHeadings.length > 1 &&
    Math.max(...panelHeadings.map(cy)) - Math.min(...panelHeadings.map(cy)) > Math.max(...panelHeadings.map((b) => b.bbox.height)) * 2
  if (multiplePanels) issue('panel', 'Multiple nutrition panels detected; automatic nutrient extraction is disabled. Crop one panel.')
  for (const a of anchors) {
    output.data.nutrients[a.key] ??= null
    if (multiBasis || multiplePanels || duplicates.has(a.key)) continue
    if (a.tail) store(a, a.tail, [], 'inline')
  }
  if (servingTable && perServing && per100) {
    // Include unreadable cells as blockers. Do not slide ordered percentages
    // across a missing row or fall back to the adjacent per-100g column.
    const cells = groupAmounts(boxes.filter((b) => b.bbox.x >= perServing.bbox.x && right(b) < per100.bbox.x &&
      cy(b) > Math.max(cy(perServing), cy(per100)) && cy(b) < cutoff && !anchors.some((a) => a.box.index === b.index)))
    for (const a of tableRows) {
      if (duplicates.has(a.key)) continue
      const options = cells.filter((v) => v.x > right(a.box) && !v.boxes.some((b) => used.has(b.index)) &&
        Math.abs(v.y - cy(a.box)) < a.box.bbox.height * 0.45)
      if (options.length === 1) store(a, options[0]!.text, [...options[0]!.boxes, perServing, per100], 'per-serving-table-row')
    }
  }

  // Group unresolved names by their horizontal label column (micronutrient tables may have two).
  const columns: Anchor[][] = []
  for (const a of anchors.filter((a) => !multiBasis && !multiplePanels && !scopedRows.has(a) && !a.inlineOnly && !duplicates.has(a.key) && !output.data.nutrients[a.key])) {
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
      !anchors.some((other) => !column.includes(other) && other.box.bbox.x > minX && right(other.box) < b.bbox.x &&
        Math.abs(cy(other.box) - cy(b)) < Math.max(other.box.bbox.height, b.bbox.height) * .85 &&
        Math.abs(cy(other.box) - cy(b)) + typicalHeight * .05 < Math.min(...column.map((a) => Math.abs(cy(a.box) - cy(b))))) &&
      cy(b) > Math.min(minY - typicalHeight, ...column.map((a) => cy(a.box) - a.box.bbox.height)) &&
      cy(b) < Math.min(cutoff, Math.max(maxY + typicalHeight, ...column.map((a) => cy(a.box) + a.box.bbox.height))) &&
      /^[\dOo<>.%μµ\s\-]+$|^(?:less than\s+)?[\dOo<>.]+\s*(?:kcal|cal|kj|g|mg|mmg|mcg(?:\s+RE)?|[μµu]g(?:\s+RE)?|IU|%)$|^(?:g|mg|mcg(?:\s+RE)?|[μµ]g(?:\s+RE)?|IU)$/i.test(b.text.trim()) &&
      b.bbox.height > typicalHeight * 0.2)
    const massBoxes = candidates.filter((b) => !b.text.includes('%') && (!percentHeading ||
      cy(b) < percentHeading.bbox.y || cx(b) < percentHeading.bbox.x))
    const amounts = groupAmounts(massBoxes)
    // Ordered complete columns handle curved/tilted labels where nearest-y assigns a value to the next row.
    const detached = column.filter((a) => !a.tail)
    const rowSpacing = detached.length > 1 ? median(detached.slice(1).map((a, i) => cy(a.box) - cy(detached[i]!.box))) : Infinity
    const compactRows = rowSpacing >= typicalHeight * .85 && column.every((a) => a.box.bbox.height <= typicalHeight * 1.3)
    let ordered = false
    if (detached.length >= 4 && amounts.length === detached.length) {
      ordered = orderedAlignment(detached, amounts)
      if (ordered) detached.forEach((a, i) => store(a, amounts[i]!.text, amounts[i]!.boxes, 'ordered-column'))
    }
    for (const a of column) {
      if (output.data.nutrients[a.key] || a.tail) continue
      // Do not slide remaining values up/down an incomplete bare-number table.
      const bareUnitTable = a.unit || (a.key.startsWith('energy') && amounts.every((v) => /^[\d.]+$/.test(v.text)))
      if (bareUnitTable && detached.length >= 4 && !ordered && !compactRows) continue
      const offsets = column.flatMap((other) => {
        const evidence = output.evidence[other.key]
        if (!evidence || evidence.method !== 'spatial-row' || Math.abs(cy(other.box) - cy(a.box)) > typicalHeight * 5) return []
        const sources = boxes.filter((b) => evidence.lineIndexes.includes(b.index) && b.index !== other.box.index)
        return sources.length ? [median(sources.map(cy)) - cy(other.box)] : []
      })
      const expectedY = cy(a.box) + (offsets.length ? median(offsets) : 0)
      const options = amounts.filter((v) => !v.boxes.some((b) => used.has(b.index)) && v.x >= right(a.box) &&
        Math.abs(v.y - expectedY) < (bareUnitTable && detached.length >= 4 && !ordered ? Math.min(v.height, a.box.bbox.height) * .4 : Math.max(v.height, a.box.bbox.height) * .85) &&
        // A lower row's amount cannot be borrowed when the current cell is damaged.
        (core.includes(a.key) || a.key.startsWith('energy') || !column.some((other) => other !== a && v.x >= right(other.box) && Math.abs(v.y - cy(other.box)) + typicalHeight * .15 < Math.abs(v.y - cy(a.box)))))
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
        const blocked = percents.length === 1 && boxes.some((b) => b.index !== percents[0]!.index && !labelIndexes.has(b.index) &&
          /^\d/.test(b.text.trim()) && b.bbox.x > right(a.box) && right(b) < percents[0]!.bbox.x &&
          Math.abs(cy(b) - cy(a.box)) < Math.max(b.bbox.height, a.box.bbox.height) * .6)
        if (options.length === 0 && percents.length === 1 && !blocked) store(a, percents[0]!.text, [percents[0]!], 'percent-only-row')
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
  if (!multiBasis && !multiplePanels) {
    // Separate name | unit | amount columns. Align the COMPLETE unit-cell
    // column, including damaged cells as blockers, before reading any amounts.
    // A missing cell must never slide a later unit/value into an earlier row.
    const unitPattern = /^(kcal|kj|mcg(?:\s+RE)?|mg|[μµ]g(?:\s+RE)?|g|IU)$/i
    const eligible = anchors.filter((a) => !scopedRows.has(a) && !a.inlineOnly && !duplicates.has(a.key))
    const labelColumns: Anchor[][] = []
    for (const a of eligible.filter((a) => !a.tail)) {
      const column = labelColumns.find((c) => Math.abs(c[0]!.box.bbox.x - a.box.bbox.x) < width * .18)
      if (column) column.push(a)
      else labelColumns.push([a])
    }
    const unitStarts = boxes.filter((b) => !labelIndexes.has(b.index) &&
      /^(?:kcal|kj|mcg(?:\s+RE)?|mg|[μµ]g(?:\s+RE)?|g|IU)(?:\s+(?:[<>]\s*)?\d+(?:\.\d+)?)?$/i.test(b.text.trim()))
    const unitColumns: Box[][] = []
    for (const b of unitStarts) {
      const column = unitColumns.find((c) => Math.abs(median(c.map((v) => v.bbox.x)) - b.bbox.x) < width * .06)
      if (column) column.push(b)
      else unitColumns.push([b])
    }
    for (const names of labelColumns.filter((c) => c.length >= 4)) {
      const typicalHeight = median(names.map((a) => a.box.bbox.height))
      for (const units of unitColumns.filter((c) => c.length >= 4)) {
        const x = median(units.map((b) => b.bbox.x))
        if (names.some((a) => right(a.box) >= x)) continue
        const cells = boxes.filter((b) => !labelIndexes.has(b.index) && Math.abs(b.bbox.x - x) < width * .06 &&
          cy(b) >= cy(names[0]!.box) - typicalHeight && cy(b) <= cy(names[names.length - 1]!.box) + typicalHeight)
          .sort((a, b) => cy(a) - cy(b))
          .map((b): Amount => ({ text: b.text.trim(), boxes: [b], x: b.bbox.x, y: cy(b), right: right(b), height: b.bbox.height }))
        if (cells.length !== names.length || !orderedAlignment(names, cells)) continue
        const edge = Math.min(Infinity, ...boxes.filter((b) => /^%\s*(?:daily|re|dv)/i.test(b.text) && b.bbox.x > x).map((b) => b.bbox.x))
        // Bare daily values can look exactly like amounts. This initial pass
        // requires an explicit right-hand percent heading as the column bound.
        if (!Number.isFinite(edge)) continue
        const shifts: number[] = []
        names.forEach((a, i) => {
          const cell = cells[i]!
          const prefixAmount = cell.text.replace(/^(kcal|kj|mcg(?:\s+RE)?|mg|[μµ]g(?:\s+RE)?|g|IU)\s+((?:[<>]\s*)?\d+(?:\.\d+)?)$/i, '$2$1')
          if (readAmount(prefixAmount)?.value && !unitPattern.test(cell.text)) {
            if (!output.data.nutrients[a.key] && store(a, prefixAmount, cell.boxes, 'separate-unit-column')) shifts.push(cell.y - cy(a.box))
            return
          }
          if (!unitPattern.test(cell.text)) return // damaged unit stays unresolved
          const options = boxes.filter((b) => !labelIndexes.has(b.index) && !used.has(b.index) && b.bbox.x >= cell.right && right(b) <= edge &&
            /^(?:[<>]\s*)?\d+(?:\.\d+)?$/.test(b.text.trim()) &&
            Math.abs(cy(b) - cell.y) < Math.min(b.bbox.height, cell.height) * .45)
          if (!output.data.nutrients[a.key] && options.length === 1 &&
            store(a, `${options[0]!.text.trim()}${cell.text}`, [...cell.boxes, options[0]!], 'separate-unit-column')) {
            shifts.push(cy(options[0]!) - cy(a.box))
          }
        })
        // A unit printed inside its label can interrupt the unit-cell column.
        // Only use a shift supported by multiple successful explicit-unit rows.
        if (shifts.length >= 3) for (const a of eligible.filter((a) => unitPattern.test(a.tail) && !output.data.nutrients[a.key] &&
          Math.abs(a.box.bbox.x - names[0]!.box.bbox.x) < width * .18)) {
          const options = boxes.filter((b) => !labelIndexes.has(b.index) && !used.has(b.index) && b.bbox.x >= right(a.box) && right(b) <= edge &&
            /^(?:[<>]\s*)?\d+(?:\.\d+)?$/.test(b.text.trim()) &&
            Math.abs(cy(b) - cy(a.box) - median(shifts)) < Math.min(b.bbox.height, a.box.bbox.height) * .4)
          if (options.length === 1) store({ ...a, unit: a.tail }, options[0]!.text, [options[0]!], 'separate-unit-column')
        }
      }
    }

    // Tight local rows avoid merging amounts from parallel table sections.
    // Require an explicit readable amount/unit token, unique local
    // ownership, and no intervening nutrient label. Never fall back past a
    // damaged inline amount, or use a distant %DV as a replacement.
    for (const a of eligible.filter((a) => !a.tail && !output.data.nutrients[a.key])) {
      const options = boxes.filter((b) => !labelIndexes.has(b.index) && !used.has(b.index) &&
        b.bbox.x >= right(a.box) - Math.min(b.bbox.height, a.box.bbox.height) * .1 &&
        Math.abs(cy(b) - cy(a.box)) < Math.min(b.bbox.height, a.box.bbox.height) * .45 &&
        !b.text.includes('%') && Boolean(readAmount(b.text)) &&
        !anchors.some((other) => other !== a && other.box.bbox.x >= right(a.box) && other.box.bbox.x < b.bbox.x &&
          cy(other.box) >= a.box.bbox.y - other.box.bbox.height && cy(other.box) <= a.box.bbox.y + a.box.bbox.height * 2) &&
        !anchors.some((other) => other !== a && Math.abs(other.box.bbox.x - a.box.bbox.x) < width * .18 && right(other.box) <= b.bbox.x &&
          Math.abs(cy(other.box) - cy(b)) <= Math.abs(cy(a.box) - cy(b))))
      if (options.length === 1) store(a, options[0]!.text, [options[0]!], 'local-explicit-unit-row')
    }
  }
  // A complete, explicitly per-serving statement can carry amounts outside
  // the table. Do not search arbitrary prose for numbers, cross ingredient or
  // reference-table boundaries, fill damaged table rows, or choose among claims.
  if (!multiBasis && !multiplePanels && singleServingPanel && panelHeadings.length === 1 && anchors.length >= 3) {
    const statementPattern = /^\*{0,2}\s*each\s+serving\s+contains\s+(\d+(?:\.\d+)?\s*(?:mg|[μµu]g|g))\s+DHA\s+of\s+the\s+(\d+(?:\.\d+)?\s*(?:mg|[μµu]g|g))\s+of\s+Omega[- ]?3\s*\.?$/i
    const statementBoundary = Math.min(referenceHeading?.bbox.y ?? Infinity,
      boxes.find((b) => /^ingredients\b/i.test(b.text.trim()))?.bbox.y ?? Infinity)
    // Retain malformed competing claims as blockers too, not only the claims
    // whose amounts happen to parse. Otherwise damaged duplicates look unique.
    const statements = boxes.filter((b) => cy(b) > Math.max(...anchors.map((a) => cy(a.box))) && cy(b) < statementBoundary &&
      /^\*{0,2}\s*each\s+serving\s+contains\b/i.test(b.text.trim()))
    if (statements.length === 1) {
      const box = statements[0]!, match = box.text.trim().match(statementPattern)
      for (const [key, text] of match ? [['dha', match[1]!], ['omega_3', match[2]!]] as const : []) {
        if (anchors.some((a) => a.key === key)) continue
        if (store({ box, key, tail: text, corrected: false }, text, [], 'explicit-per-serving-statement')) {
          issue(key, 'Read an explicit per-serving statement outside the table; verify against the image.')
        }
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
