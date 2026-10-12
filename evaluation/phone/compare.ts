// Frozen-OCR regression comparison. The former holdout is exposed, not fresh validation.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { parseNutrition } from '../../src/services/nutrition/parseNutrition'
import { loadCases, validateCases } from '../load'
import { aggregate, buildReport, evaluateCase } from '../metrics'
import { comparisonGate, fieldChanges } from '../phase5/report'
import { importOwnerFields, sha256 } from '../pilot/dataset'
import { ownerOnlyCases, pilotCases } from '../pilot/report'
import type { PilotDataset, PilotRun } from '../pilot/types'
import { csv } from '../report'
import type { EvaluationCase } from '../types'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const baselineRevision = '0927174'
const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n'
async function main() {
  const args = process.argv.slice(2)
  if (args.length && (args.length !== 2 || args[0] !== '--out')) throw new Error('Usage: node --import tsx evaluation/phone/compare.ts [--out evaluation/results/<new-directory>]')
  const out = args[1] ? resolve(root, args[1]) : null
  if (out) {
    const rel = relative(join(root, 'evaluation/results'), out)
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Output must be a new subdirectory of evaluation/results/.')
  }
  const sources: Array<{ path: string; sha256: string }> = []
  const read = async <T>(path: string): Promise<T> => {
    const bytes = await readFile(join(root, path))
    sources.push({ path, sha256: sha256(bytes) })
    return JSON.parse(bytes.toString()) as T
  }
  const baselineSource = execFileSync('git', ['show', `${baselineRevision}:src/services/nutrition/parseNutrition.ts`], { cwd: root, encoding: 'utf8' })
  const compiled = ts.transpileModule(baselineSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  const baseline = (await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)).parseNutrition as typeof parseNutrition
  // Use the saved dataset snapshot, not the old strict folder-inventory loader.
  const directory = 'evaluation/results/phase-2-pilot-2026-10-11'
  const dataset = await read<PilotDataset>(`${directory}/dataset.json`)
  const pilot = pilotCases(dataset, await read<PilotRun>(`${directory}/run.json`))
  const phone: EvaluationCase[] = []
  for (const entry of dataset.cases) {
    const prefix = `labels/nutrition_labels_json/${entry.id}`
    const fields = importOwnerFields(await read(`${prefix}.json`))
    // Detect accidental ground-truth drift relative to the frozen pilot snapshot.
    assert.deepEqual(fields, Object.fromEntries(Object.entries(entry.annotation.fields).filter(([key]) => !Object.hasOwn(entry.supplementalFields, key))))
    const saved = await read<{ ocr: NonNullable<EvaluationCase['ocr']>; nutrition: ReturnType<typeof parseNutrition> }>(`${prefix}-diagnostics.json`)
    const ocr = await read<NonNullable<EvaluationCase['ocr']>>(`${prefix}-ocr.json`)
    assert.deepEqual(ocr, saved.ocr)
    assert.deepEqual(baseline(ocr), saved.nutrition)
    phone.push({ annotation: { ...entry.annotation, cohort: 'iphone-owner', fields }, ocr })
  }
  validateCases(phone)
  const supplemental = phone.map((c, i): EvaluationCase => ({ ...c, annotation: { ...c.annotation,
    cohort: 'iphone-supplemental', fields: dataset.cases[i]!.supplementalFields } }))
  const legacy = await loadCases(root, 'benchmark')
  sources.push(...legacy.sources)
  const groups: Array<[string, EvaluationCase[], boolean]> = [
    ['iphone-owner', phone, false], ['iphone-supplemental', supplemental, false],
    ['pilot', pilot, true], ['historical', legacy.cases, false],
  ]
  const reports = groups.map(([name, cases, owner]) => {
    const before = cases.map((c) => evaluateCase(c, baseline(c.ocr ?? { text: '', lines: [], engine: 'failed' })))
    const after = cases.map((c) => {
      const original = JSON.stringify(c.ocr)
      const extraction = parseNutrition(c.ocr ?? { text: '', lines: [], engine: 'failed' })
      assert.equal(JSON.stringify(c.ocr), original)
      if (c.ocr) {
        const input = { ...c.ocr, sourceSize: c.ocr.sourceSize ? { width: c.ocr.sourceSize.width * .5, height: c.ocr.sourceSize.height * .5 } : undefined,
          lines: [...c.ocr.lines].reverse().map((l) => ({ ...l, bbox: { x: l.bbox.x * .5, y: l.bbox.y * .5, width: l.bbox.width * .5, height: l.bbox.height * .5 } })) }
        assert.deepEqual(parseNutrition(input).data, extraction.data, `${name}/${c.annotation.id}: scale/order dependence`)
        for (const evidence of Object.values(extraction.evidence)) assert.equal(evidence.text, evidence.lineIndexes.map((i) => c.ocr!.lines[i]!.text).join(' | '))
      }
      return evaluateCase(c, extraction)
    })
    const selectedBefore = owner ? ownerOnlyCases(dataset, before) : before
    const selectedAfter = owner ? ownerOnlyCases(dataset, after) : after
    return { name, before: aggregate(selectedBefore), after: aggregate(selectedAfter), gate: comparisonGate(before, after),
      changes: fieldChanges(before, after), byCohortBefore: buildReport(selectedBefore).byCohort, byCohortAfter: buildReport(selectedAfter).byCohort,
      report: { ...buildReport(after), sources, notes: ['Frozen OCR replay; exposed regression products, not fresh blind validation.', 'No OCR, unit conversions, digit repair, or basis selection changes. Pilot gate includes supplements/negative fields; headline pilot counts are owner-only.'] } }
  })
  for (const path of ['src/services/nutrition/parseNutrition.ts', 'evaluation/phone/compare.ts', 'evaluation/phase5/report.ts', 'evaluation/pilot/report.ts']) {
    sources.push({ path, sha256: sha256(await readFile(join(root, path))) })
  }
  const passed = reports.every((r) => r.gate.passed)
  const summary = { baselineRevision, baselineParserSha256: sha256(baselineSource), sources, passed,
    groups: reports.map((r) => ({ name: r.name, before: r.before, after: r.after, gate: r.gate,
      changes: r.changes, byCohortBefore: r.byCohortBefore, byCohortAfter: r.byCohortAfter })) }
  if (out) {
    await mkdir(out)
    await writeFile(join(out, 'comparison.json'), json(summary), { flag: 'wx' })
    for (const { name, report } of reports) {
      await writeFile(join(out, `${name}-report.json`), json(report), { flag: 'wx' })
      await writeFile(join(out, `${name}-fields.csv`), csv(report), { flag: 'wx' })
    }
  }
  for (const r of reports) console.log(json({ name: r.name, nutrients: `${r.before.nutrients.correct} -> ${r.after.nutrients.correct}/${r.after.nutrients.readable}`,
    serving: `${r.before.serving.correct} -> ${r.after.serving.correct}/${r.after.serving.readable}`, wrong: r.after.all.wrong,
    falsePositive: r.after.all.falsePositive, gate: r.gate }))
  if (!passed) process.exitCode = 1
}
main().catch((cause: unknown) => { console.error(cause instanceof Error ? cause.message : String(cause)); process.exitCode = 1 })
