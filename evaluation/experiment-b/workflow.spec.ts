import { describe, it, expect } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises'
import { resolve, relative } from 'node:path'
import { main } from './cli'
import { developmentInputs, hash, json, reservedInputs } from './dataset'
import { replay } from './replay'
import { resultsReport } from './report'
import { DEFAULT_CONFIG } from './types'

const root = process.cwd()
describe('Experiment B development and freeze safeguards', () => {
  it('does not allow losses on controls to be offset by multi-basis recoveries', async () => {
    const { inputs, coverageGaps } = await developmentInputs(root)
    const report = resultsReport(inputs.map((c) => replay(c)), DEFAULT_CONFIG, coverageGaps)
    expect(report.multiBasis.B.nutrients.correct).toBeGreaterThan(report.multiBasis.A.nutrients.correct)
    expect(report.multiBasis.A.crossColumn).toBe(0) // header support is not value provenance
    expect(report.multiBasis.B.crossColumn).toBe(0)
    expect(report.gate.noLostControlFields).toBe(false)
    expect(report.gate.improvedProducts).toBe(1) // repeated Spam crops do not add products
    expect(report.gate.passed).toBe(false)
  })
  it('blocks freeze/reserved access, rejects stale input and refuses overwriting a run', async () => {
    await mkdir(resolve(root, 'evaluation/results'), { recursive: true })
    const temp = await mkdtemp(resolve(root, 'evaluation/results/experiment-b-test-'))
    const out = relative(root, resolve(temp, 'run'))
    try {
      await main(['prepare', '--out', out], root)
      await expect(main(['prepare', '--out', out], root)).rejects.toThrow()
      await main(['develop', '--out', out], root)
      await expect(main(['develop', '--out', out], root)).rejects.toThrow()
      await expect(main(['freeze', '--out', out], root)).rejects.toThrow('Development gate failed')
      await expect(main(['validate', '--out', out, '--reserved', 'must-not-be-opened.json', '--validation-out', `${out}/validation`], root)).rejects.toThrow('Development gate failed')
      await expect(access(resolve(root, out, 'validation-attempt.json'))).rejects.toThrow()
      const planPath = resolve(root, out, 'plan.json'), plan = JSON.parse(await readFile(planPath, 'utf8')) as { inputs: Array<{ ocr: { text: string } }> }
      plan.inputs[0]!.ocr.text += 'changed'
      await writeFile(planPath, json(plan))
      await expect(main(['develop', '--out', out], root)).rejects.toThrow('Prepared OCR/truth changed')
    } finally { await rm(temp, { recursive: true, force: true }) }
  })
  it('rejects exposed reserved products before opening their OCR', async () => {
    const temp = await mkdtemp(resolve(root, 'evaluation/results/experiment-b-reserved-test-'))
    try {
      const manifest = resolve(temp, 'reserved.json')
      await writeFile(manifest, json({ provenance: 'synthetic safety check', cases: [{ annotation: { productId: 'spam' }, ocrFile: 'must-not-be-opened.json' }] }))
      await expect(reservedInputs(root, relative(root, manifest), new Set(['spam']))).rejects.toThrow('already exposed')
    } finally { await rm(temp, { recursive: true, force: true }) }
  })
  it('rejects duplicate OCR despite a new product name', async () => {
    const { inputs } = await developmentInputs(root), input = inputs.find((c) => c.truth)!
    const temp = await mkdtemp(resolve(root, 'evaluation/results/experiment-b-duplicate-test-'))
    try {
      const ocrFile = resolve(temp, 'ocr.json'), ocrBytes = json(input.ocr)
      await writeFile(ocrFile, ocrBytes)
      const manifest = resolve(temp, 'reserved.json')
      await writeFile(manifest, json({ provenance: 'synthetic safety check', cases: [{ annotation: { ...input.annotation, productId: 'renamed-exposed-product' }, truth: input.truth, ocrFile: relative(root, ocrFile), ocrSha256: hash(ocrBytes) }] }))
      await expect(reservedInputs(root, relative(root, manifest), new Set(), new Set([hash(json(input.ocr))]))).rejects.toThrow('Duplicate/exposed reserved OCR')
    } finally { await rm(temp, { recursive: true, force: true }) }
  })
})
