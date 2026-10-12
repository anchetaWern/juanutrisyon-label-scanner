import { mkdir, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import sharp from 'sharp'
import type { Plan, Run } from './types'
import { localReading, scoreReading } from './scoring'

const escape = (v: unknown) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
export async function writeGallery(root: string, out: string, plan: Plan, runs: Run[] = []) {
  await mkdir(join(out, 'review'), { recursive: true })
  const sections: string[] = []
  for (const image of plan.images) {
    const source = join(root, image.image)
    const svg = `<svg width="${image.width}" height="${image.height}">${image.candidates.map((c, i) => `<rect x="${c.sourceBox.x}" y="${c.sourceBox.y}" width="${c.sourceBox.width}" height="${c.sourceBox.height}" fill="none" stroke="${c.review === 'verified' ? '#00ad4b' : '#e65c00'}" stroke-width="2"/><text x="${c.sourceBox.x}" y="${Math.max(16, c.sourceBox.y)}" font-family="sans-serif" font-size="14" fill="#b00020">${i}</text>`).join('')}</svg>`
    await sharp(source).composite([{ input: Buffer.from(svg) }]).png().toFile(join(out, 'review', `${image.id}-overlay.png`))
    const crops: string[] = [], sheet: Array<{ input: Buffer; left: number; top: number }> = []
    for (const [index, candidate] of image.candidates.entries()) {
      const path = `review/${candidate.id}.png`
      await sharp(source).extract({ left: candidate.cropBox.x, top: candidate.cropBox.y, width: candidate.cropBox.width, height: candidate.cropBox.height }).png().toFile(join(out, path))
      const thumb = await sharp(join(out, path)).resize(250, 90, { fit: 'contain', background: '#fff' }).png().toBuffer()
      const col = index % 4, row = Math.floor(index / 4)
      sheet.push({ input: thumb, left: col * 270 + 10, top: row * 135 + 40 },
        { input: Buffer.from(`<svg width="265" height="38"><text x="5" y="14" font-family="sans-serif" font-size="11">${index}: ${escape(candidate.field ?? 'unlinked')}</text><text x="5" y="30" font-family="sans-serif" font-size="11">${escape(candidate.baselineRaw.slice(0, 35))}</text></svg>`), left: col * 270, top: row * 135 })
      const results = runs.flatMap((r) => r.results.filter((v) => v.candidateId === candidate.id))
      crops.push(`<article id="${candidate.id}"><h3>${index}: ${escape(candidate.id)} · ${escape(candidate.field)} · ${candidate.review}</h3><p>${escape(candidate.reviewNote)}</p><div class="images"><figure><img src="${path}" alt="Source crop"><figcaption>Source pixels, 20% padding per side</figcaption></figure>${results.map((r) => `<figure>${r.crop ? `<img src="${escape(r.crop.path)}" alt="Actual OCR input ${r.scale}x">` : ''}<figcaption>${r.scale}× actual input; raw ${escape(r.ocr?.text)}; selected ${escape(localReading(r.ocr, candidate))}; ${escape(JSON.stringify(scoreReading(localReading(r.ocr, candidate), candidate.truth)))} ${escape(r.error)}</figcaption></figure>`).join('')}</div><details><summary>Truth, frozen evidence, coordinates and timings</summary><pre>${escape(JSON.stringify({ candidate, results }, null, 2))}</pre></details></article>`)
    }
    if (sheet.length) await sharp({ create: { width: 1080, height: Math.ceil(image.candidates.length / 4) * 135, channels: 3, background: 'white' } }).composite(sheet).png().toFile(join(out, 'review', `${image.id}-sheet.png`))
    sections.push(`<section><h2>${escape(image.id)} · ${image.split}</h2><p>${escape(image.tags.join(', '))}</p><a href="${escape(relative(out, source))}">Original photo</a> · <a href="review/${image.id}-overlay.png">Mapped OCR boxes</a> · <a href="review/${image.id}-sheet.png">Contact sheet</a>${crops.join('')}</section>`)
  }
  await writeFile(join(out, 'review.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Experiment A region review</title><style>body{font:15px system-ui;margin:2rem auto;max-width:1400px;padding:0 1rem}article,section{border-top:1px solid #ccc;margin-top:2rem}.images{display:flex;flex-wrap:wrap}figure{max-width:420px;margin:1rem}img{max-width:100%;max-height:230px;object-fit:contain}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><h1>Experiment A diagnostics</h1><p>Only verified regions enter OCR jobs. Orange boxes need review; green boxes are verified. Edit a review manifest and prepare a NEW output directory to change regions or truth. Source previews use Sharp; actual experiment inputs use browser canvas and are preserved separately.</p>${sections.join('\n')}</html>\n`)
}
