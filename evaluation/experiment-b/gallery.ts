import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { hash, repoFile } from './dataset'
import type { RecordResult } from './types'

export async function writeGallery(root: string, output: string, records: RecordResult[]) {
  await mkdir(join(output, 'images'), { recursive: true })
  const views = []
  for (const [index, record] of records.entries()) {
    let image: string | null = null, overlayImage = false, note = 'Source image unavailable. Geometry shown on a blank OCR coordinate plane.'
    if (record.image) {
      try {
        const source = await repoFile(root, record.image), bytes = await readFile(source), meta = await sharp(bytes).metadata()
        const expected = records[index]!.imageSha256
        if (expected && hash(bytes) !== expected) throw new Error('Source image changed before gallery generation.')
        image = `images/${index}.${meta.format === 'jpeg' ? 'jpg' : 'png'}`
        await writeFile(join(output, image), bytes)
        overlayImage = meta.width === record.ocr.sourceSize?.width && meta.height === record.ocr.sourceSize?.height && (!meta.orientation || meta.orientation === 1)
        note = overlayImage ? 'Dimensions match OCR coordinates. Re-encoded mobile images are not exact OCR input bytes.' : 'Image coordinates are not verified. Source image is separate from the OCR overlay.'
      } catch (cause) {
        if (!(cause instanceof Error && 'code' in cause && cause.code === 'ENOENT')) throw cause
      }
    }
    views.push({ ...record, image, overlayImage, imageNote: note })
  }
  const data = JSON.stringify(views).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029')
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Experiment B review</title>
<style>body{font:16px system-ui;margin:24px;color:#14352f}select,button,label{font:inherit;padding:8px}main{display:grid;grid-template-columns:minmax(280px,1fr) minmax(280px,1fr);gap:24px}svg,img{width:100%;max-height:75vh;object-fit:contain}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f1f5f3;padding:16px}label{display:block;border:1px solid #ccc;margin:8px 0;cursor:pointer}label:has(input:checked){border:3px solid #167d61}small{display:block}#percent{padding:8px;background:#eee}@media(max-width:700px){main{display:block}body{margin:12px}}</style>
<h1>Experiment B · review required</h1><p>Frozen OCR. Choose a quantity context to inspect precomputed scoped extraction. Percentages never replace damaged quantity cells. This page does not export to the scanner.</p>
<label for="cases">Case</label><select id="cases"></select><p id="note"></p><main><section><div id="source"></div><svg id="overlay" xmlns="http://www.w3.org/2000/svg" aria-label="OCR boxes colored by basis"></svg></section><section><h2>Nutrition basis</h2><div id="choices"></div><p id="percent"></p><p id="status"></p><pre id="result"></pre><details><summary>Baseline, oracle, auto and simulated explicit results</summary><pre id="modes"></pre></details><details><summary>Owner truth and source annotations</summary><pre id="truth"></pre></details><details><summary>Rejected associations and unresolved cells</summary><pre id="diagnostics"></pre></details></section></main>
<script>const records=${data};
const byId=id=>document.getElementById(id), colors=['#126b4a','#984e00','#465bb3','#8b2878','#007b8b'];let selected=null;
const select=byId('cases');records.forEach((r,i)=>{const option=document.createElement('option');option.value=String(i);option.textContent=r.id;select.append(option)});
function paint(){const r=records[Number(select.value)||0], svg=byId('overlay');svg.replaceChildren();
const width=r.ocr.sourceSize?.width||Math.max(1,...r.ocr.lines.map(l=>l.bbox.x+l.bbox.width)),height=r.ocr.sourceSize?.height||Math.max(1,...r.ocr.lines.map(l=>l.bbox.y+l.bbox.height));svg.setAttribute('viewBox','0 0 '+width+' '+height);
const element=(tag,attrs)=>{const e=document.createElementNS('http://www.w3.org/2000/svg',tag);Object.entries(attrs).forEach(([k,v])=>e.setAttribute(k,String(v)));return e};
if(r.image&&r.overlayImage)svg.append(element('image',{href:r.image,width,height}));
r.ocr.lines.forEach((l,i)=>{const bi=r.structure.bases.findIndex(b=>b.valueIndexes.includes(i)||b.headerIndexes.includes(i)),b=r.structure.bases[bi];const rect=element('rect',{x:l.bbox.x,y:l.bbox.y,width:l.bbox.width,height:l.bbox.height,fill:'none',stroke:bi<0?'#aaa':colors[bi%colors.length],'stroke-width':b?.id===selected?Math.max(width/200,2):Math.max(width/600,1)});const title=element('title',{});title.textContent=i+': '+l.text+(b?' · '+b.id:' · unassigned/label');rect.append(title);svg.append(rect);const label=element('text',{x:l.bbox.x,y:l.bbox.y+Math.max(12,height/120),'font-size':Math.max(12,height/120),fill:bi<0?'#555':colors[bi%colors.length]});label.textContent=String(i);svg.append(label)});
const a=selected?r.alternatives[selected]:null;byId('result').textContent=a?JSON.stringify(a.extraction.data,null,2):'Select a basis. No quantity context is selected.';byId('diagnostics').textContent=JSON.stringify(a?{sources:a.sources,rejected:a.rejected,nullReasons:a.nullReasons,blockers:r.structure.blockers}:r.structure,null,2);
byId('status').textContent=selected?'Selected: '+selected+' · one explicit selection; verify against the image.':'Selection required or unavailable.';}
function load(){const r=records[Number(select.value)||0];selected=null;byId('note').textContent=r.imageNote;byId('choices').replaceChildren();byId('source').replaceChildren();if(r.image&&!r.overlayImage){const img=document.createElement('img');img.src=r.image;img.alt='Source label, shown separately from unverified OCR coordinates';byId('source').append(img)}
r.structure.bases.filter(b=>b.kind==='quantity').forEach((b,i)=>{const label=document.createElement('label'),radio=document.createElement('input'),text=document.createElement('span'),sample=document.createElement('small');radio.type='radio';radio.name='basis';radio.value=b.id;radio.addEventListener('change',()=>{selected=b.id;paint()});text.textContent=' '+(b.rawHeader||'Column '+(i+1))+' ['+b.id+']';sample.textContent=b.valueIndexes.slice(0,3).map(index=>r.ocr.lines[index].text).join(' · ');label.append(radio,text,sample);byId('choices').append(label)});
byId('percent').textContent='Supporting percent references: '+(r.structure.bases.filter(b=>b.kind==='percent_reference').map(b=>b.rawHeader||b.id).join(' · ')||'none detected');byId('modes').textContent=JSON.stringify(r.modes,null,2);byId('truth').textContent=JSON.stringify(r.truth,null,2);paint();}select.addEventListener('change',load);load();</script></html>`
  await writeFile(join(output, 'review.html'), html)
}
