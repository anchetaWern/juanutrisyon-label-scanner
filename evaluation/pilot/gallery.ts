import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp, { type OverlayOptions } from 'sharp'
import type { PilotDataset } from './types'

const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
/** Static review artifacts; no server, third-party assets or image uploads required. */
export async function writeGallery(out: string, dataset: PilotDataset) {
  await mkdir(join(out, 'review'), { recursive: true })
  for (let offset = 0; offset < dataset.cases.length; offset += 3) {
    const group = dataset.cases.slice(offset, offset + 3)
    const overlays: OverlayOptions[] = []
    for (const [row, entry] of group.entries()) for (const [col, variant] of ['rectangle', 'perspective'].entries()) {
      const input = await sharp(join(out, 'crops', `${entry.id}-${variant}.png`)).resize(580, 460, { fit: 'contain', background: '#f2f2f2' }).png().toBuffer()
      overlays.push({ input, left: col * 600 + 10, top: row * 500 + 35 })
      overlays.push({ input: Buffer.from(`<svg width="590" height="30"><text x="10" y="22" font-family="sans-serif" font-size="17">${escape(entry.id)} · ${variant}</text></svg>`), left: col * 600, top: row * 500 })
    }
    await sharp({ create: { width: 1200, height: group.length * 500, channels: 3, background: 'white' } }).composite(overlays).png().toFile(join(out, 'review', `crops-${offset / 3 + 1}.png`))
  }
  const sections = dataset.cases.map((entry) => `<section><h2>${escape(entry.id)} · ${entry.split}</h2><p>${escape(entry.panelNote)}</p><div class="images">${['original', 'rectangle', 'perspective'].map((v) => `<figure><a href="crops/${entry.id}-${v}.png"><img loading="lazy" src="crops/${entry.id}-${v}.png" alt="${escape(entry.id)} ${v}"></a><figcaption>${v}</figcaption></figure>`).join('')}</div><details><summary>Annotations and provenance</summary><pre>${escape(JSON.stringify({ ownerAndSupplementalFields: entry.annotation.fields, supplementalFields: entry.supplementalFields, review: entry.review, panel: entry.panel }, null, 2))}</pre></details></section>`)
  await writeFile(join(out, 'review.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Phase 2 crop review</title><style>body{font:16px system-ui;max-width:1400px;margin:2rem auto;padding:0 1rem}section{border-top:1px solid #aaa;margin-top:2rem}.images{display:flex;flex-wrap:wrap}figure{flex:1;min-width:220px;margin:8px}img{width:100%;max-height:650px;object-fit:contain}pre{white-space:pre-wrap}figcaption{text-align:center}</style><h1>Phase 2 crop review</h1><p>${escape(dataset.reviewProvenance)}</p><p>Check serving headers, every nutrient, and intended panel. Click a crop to inspect full resolution. These are operator-selected regions, not automatic detections.</p>${sections.join('\n')}</html>\n`)
}
