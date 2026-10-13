import type { OcrLine } from '../../src/services/ocr/types'
import { DEFAULT_CONFIG, type Basis, type Category, type Config } from './types'

export function headerCategory(text: string): { category: Category; preparation: Basis['preparation']; context: string | null } | null {
  const s = text.normalize('NFKC').toLowerCase().replace(/[,:;*()]/g, ' ').replace(/\s+/g, ' ').trim()
  if (/servings?\s+(?:size|per\s+(?:container|pack))/.test(s)) return null
  const preparation = /as prepared/.test(s) ? 'as_prepared' : /as sold/.test(s) ? 'as_sold' : null
  const category: Category | null = /(?:per\s*)?100\s*ml\b/.test(s) ? 'per_100ml'
    : /(?:per\s*)?100\s*g\b/.test(s) ? 'per_100g'
    : /\bper\s+(?:serving|serve|prepared serving)\b/.test(s) ? 'per_serving'
    : /\bper\s+pack\b/.test(s) ? 'per_pack'
    : /\bper\s+container\b/.test(s) ? 'per_container'
    : /\bper\s+piece\b/.test(s) ? 'per_piece'
    : /(?:%\s*(?:daily|dv|re)|daily value)/.test(s) ? 'percent_dv'
    : /\bper\s+\d+(?:\.\d+)?\s*(?:g|ml)\b/.test(s) ? 'unknown' : preparation
  if (!category) return null
  return { category, preparation, context: s.match(/\bper\s*\d+(?:\.\d+)?\s*(?:g|ml)\b/)?.[0] ?? category }
}
export function headerCandidates(lines: OcrLine[], config: Config = DEFAULT_CONFIG) {
  const candidates = lines.flatMap((l, i) => {
    const label = headerCategory(l.text)
    return label ? [{ ...label, text: l.text, indexes: [i], bbox: l.bbox }] : []
  })
  // Join only header fragments with actual geometry, never repair characters.
  lines.forEach((a, i) => {
    if (!/^(?:per|100|100\s*(?:g|ml)|daily|as)$/i.test(a.text.trim())) return
    lines.forEach((b, j) => {
      if (i === j || !/^(?:serving|serve|100\s*(?:g|ml)|g|ml|value|prepared|sold)$/i.test(b.text.trim())) return
      const horizontal = b.bbox.x >= a.bbox.x + a.bbox.width && b.bbox.x - a.bbox.x - a.bbox.width < Math.max(a.bbox.height, b.bbox.height) * config.fragmentGapHeight
        && Math.abs(b.bbox.y - a.bbox.y) < Math.max(a.bbox.height, b.bbox.height) * config.fragmentRowHeight
      const vertical = b.bbox.y >= a.bbox.y + a.bbox.height * config.fragmentVerticalStartHeight && b.bbox.y - a.bbox.y - a.bbox.height < Math.max(a.bbox.height, b.bbox.height) * config.fragmentGapHeight
        && Math.abs(b.bbox.x - a.bbox.x) < Math.max(a.bbox.width, b.bbox.width) * config.fragmentColumnWidth
      const text = `${a.text} ${b.text}`, label = headerCategory(text)
      if ((!horizontal && !vertical) || !label) return
      candidates.push({ ...label, text, indexes: [i, j], bbox: { x: Math.min(a.bbox.x, b.bbox.x), y: Math.min(a.bbox.y, b.bbox.y),
        width: Math.max(a.bbox.x + a.bbox.width, b.bbox.x + b.bbox.width) - Math.min(a.bbox.x, b.bbox.x),
        height: Math.max(a.bbox.y + a.bbox.height, b.bbox.y + b.bbox.height) - Math.min(a.bbox.y, b.bbox.y) } })
    })
  })
  return candidates.filter((a, i) => !candidates.some((b, j) => j !== i && b.indexes.length > a.indexes.length && a.indexes.every((v) => b.indexes.includes(v))))
}
