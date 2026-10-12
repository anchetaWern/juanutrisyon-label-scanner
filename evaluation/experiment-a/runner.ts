import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer, type Plugin } from 'vite'
import sharp from 'sharp'
import { validateOcr } from '../load'
import { sha256 } from '../pilot/dataset'
import { json } from './dataset'
import type { CandidateResult, LabelTiming, Plan, Run, Split } from './types'

export async function exists(path: string) { try { await access(path); return true } catch { return false } }
export async function writeJson(path: string, value: unknown) {
  await writeFile(`${path}.tmp`, json(value)); await rename(`${path}.tmp`, path)
}
export function jobKeys(plan: Plan, split: Split): string[] {
  return plan.images.filter((i) => i.split === split && i.candidates.some((c) => c.review === 'verified')).flatMap((i) => plan.scales.map((s) => `${i.id}/${s}`))
}
export function checkCheckpoint(run: Run, plan: Plan, planSha256: string, split: Split) {
  if (run.version !== 1 || run.planSha256 !== planSha256 || run.split !== split || !Array.isArray(run.sessions) || !Array.isArray(run.labels) || !Array.isArray(run.results)) throw new Error('Checkpoint identity mismatch.')
  const expected = new Set(jobKeys(plan, split)), received = new Set<string>(), candidates = new Set<string>()
  for (const label of run.labels) {
    const key = `${label.imageId}/${label.scale}`
    const image = plan.images.find((i) => i.id === label.imageId)!
    if (!expected.has(key) || received.has(key) || !Number.isFinite(label.totalMs) || label.totalMs < 0
      || !Number.isFinite(label.sourceLoadMs) || label.sourceLoadMs < 0) throw new Error('Invalid/duplicate label checkpoint.')
    received.add(key)
    const selected = image.candidates.filter((c) => c.review === 'verified')
    const results = run.results.filter((r) => r.imageId === label.imageId && r.scale === label.scale)
    if (label.candidates !== selected.length || results.length !== selected.length) throw new Error('Checkpoint candidate count mismatch.')
    for (const result of results) {
      const candidate = selected.find((c) => c.id === result.candidateId)
      const resultKey = `${result.candidateId}/${result.scale}`
      if (!candidate || candidates.has(resultKey) || (!result.ocr && !result.error) || (result.ocr && result.error)
        || (result.error !== null && typeof result.error !== 'string')
        || !result.timing || ['extractionMs', 'resizeMs', 'recognitionMs', 'totalMs'].some((key) => {
          const n = result.timing[key as keyof typeof result.timing]; return !Number.isFinite(n) || n < 0
        })) throw new Error('Invalid/duplicate candidate checkpoint.')
      candidates.add(resultKey)
      if (result.ocr) {
        validateOcr(result.ocr)
        if (!result.crop || result.ocr.sourceSize?.width !== candidate.cropBox.width * result.scale
          || result.ocr.sourceSize?.height !== candidate.cropBox.height * result.scale || result.ocr.engine !== 'paddleocr.js'
          || result.ocr.engineVersion !== '0.4.2' || result.ocr.preprocessing !== 'experiment-a-original-local-v1') throw new Error('Local prediction dimensions/configuration mismatch.')
      }
      if (result.crop && (result.crop.width !== candidate.cropBox.width * result.scale || result.crop.height !== candidate.cropBox.height * result.scale
        || result.crop.path !== `actual/${candidate.id}-${result.scale}.png` || !/^[a-f0-9]{64}$/.test(result.crop.sha256))) throw new Error('Checkpoint crop mismatch.')
    }
  }
  if (candidates.size !== run.results.length || (run.completedAt && expected.size !== received.size)) throw new Error('Incomplete/extra checkpoint results.')
}
async function chromePath() {
  for (const p of [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/usr/bin/google-chrome', '/usr/bin/chromium']) {
    if (p && await exists(p)) return p
  }
  throw new Error('Chrome not found; set CHROME_PATH or use --manual.')
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return
  await new Promise<void>((done) => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000)
    child.once('exit', () => { clearTimeout(timer); done() }); child.kill('SIGTERM')
  })
}
export async function runExperiment(root: string, out: string, plan: Plan, split: Split, manual = false) {
  const planSha256 = sha256(await readFile(join(out, 'plan.json'))), path = join(out, `${split}-run.json`)
  const run: Run = await exists(path) ? JSON.parse(await readFile(path, 'utf8')) as Run
    : { version: 1, planSha256, split, completedAt: null, sessions: [], results: [], labels: [] }
  if (!jobKeys(plan, split).length) throw new Error(`No verified ${split} candidates. Review crops and prepare a new directory with --manifest.`)
  checkCheckpoint(run, plan, planSha256, split)
  for (const result of run.results) if (result.crop && sha256(await readFile(join(out, result.crop.path))) !== result.crop.sha256) throw new Error('Saved diagnostic crop changed.')
  if (run.completedAt) return run
  await mkdir(join(out, 'actual'), { recursive: true })
  const token = randomBytes(24).toString('hex')
  const images = plan.images.filter((i) => i.split === split)
  const pending = new Set(jobKeys(plan, split).filter((key) => !run.labels.some((l) => `${l.imageId}/${l.scale}` === key)))
  let finish!: () => void, fail!: (error: Error) => void
  const completed = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject })
  void completed.catch(() => {})
  let timer: ReturnType<typeof setTimeout> | undefined, initialized = false, busy = false
  const keepAlive = () => { clearTimeout(timer); timer = setTimeout(() => fail(new Error('Experiment stalled; completed labels are checkpointed.')), manual ? 900_000 : 300_000) }
  const plugin: Plugin = { name: 'local-experiment-a', configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (!req.url?.startsWith('/__experiment_a/')) { next(); return }
      void (async () => {
        const url = new URL(req.url!, 'http://localhost'), route = url.pathname.slice('/__experiment_a/'.length)
        if (req.headers['x-experiment-token'] !== token && !(route === 'source' && url.searchParams.get('token') === token)) { res.statusCode = 403; res.end('Invalid experiment token'); return }
        keepAlive()
        if (route === 'source' && req.method === 'GET') {
          const image = images.find((i) => i.id === url.searchParams.get('id'))
          if (!image) throw new Error('Unknown source image.')
          res.setHeader('Content-Type', 'application/octet-stream'); res.end(await readFile(join(root, image.image))); return
        }
        if (route === 'jobs' && req.method === 'GET') {
          res.setHeader('Content-Type', 'application/json')
          res.end(json({ jobs: images.flatMap((i) => plan.scales.filter((scale) => pending.has(`${i.id}/${scale}`)).map((scale) => ({ imageId: i.id, scale,
            sourceUrl: `/__experiment_a/source?id=${encodeURIComponent(i.id)}&token=${token}`, width: i.width, height: i.height,
            candidates: i.candidates.filter((c) => c.review === 'verified').map((c) => ({ id: c.id, cropBox: c.cropBox })) }))) })); return
        }
        if (req.method !== 'POST') throw new Error('Expected POST.')
        const chunks: Buffer[] = []; let size = 0
        for await (const chunk of req) { const bytes = Buffer.from(chunk as Uint8Array); size += bytes.length; if (size > 64_000_000) throw new Error('Payload too large.'); chunks.push(bytes) }
        const body = JSON.parse(Buffer.concat(chunks).toString())
        if (route === 'status') console.log(String(body.message))
        else if (route === 'fatal') throw new Error(String(body.error))
        else if (route === 'initialized') {
          if (initialized) throw new Error('Duplicate initialization.')
          initialized = true; run.sessions.push({ ...body, execution: manual ? 'manual-browser' : 'desktop-headless-chrome', at: new Date().toISOString() })
          await writeJson(path, run)
        } else if (route === 'label') {
          if (!initialized || busy) throw new Error('Unexpected concurrent label write.')
          busy = true
          try {
            const timing = body.timing as LabelTiming, incoming = body.results as Array<{ result: CandidateResult; png: string | null }>
            if (!timing || !Array.isArray(incoming) || !pending.has(`${timing.imageId}/${timing.scale}`)) throw new Error('Unexpected label job.')
            const staged: CandidateResult[] = []
            for (const entry of incoming) {
              const result = entry.result
              if (result.imageId !== timing.imageId || result.scale !== timing.scale) throw new Error('Job/result mismatch.')
              const candidate = images.find((i) => i.id === timing.imageId)!.candidates.find((c) => c.id === result.candidateId && c.review === 'verified')
              if (!candidate) throw new Error('Unknown candidate.')
              if (entry.png) {
                const png = Buffer.from(entry.png, 'base64'), meta = await sharp(png).metadata()
                if (meta.format !== 'png' || meta.width !== candidate.cropBox.width * timing.scale || meta.height !== candidate.cropBox.height * timing.scale) throw new Error('Diagnostic PNG dimensions mismatch.')
                result.crop = { width: meta.width!, height: meta.height!, path: `actual/${candidate.id}-${timing.scale}.png`, sha256: sha256(png) }
                await writeFile(join(out, result.crop.path), png)
              } else { result.crop = null; if (!result.error) throw new Error('Missing diagnostic crop without failure.') }
              staged.push(result)
            }
            const next = { ...run, results: [...run.results, ...staged], labels: [...run.labels, timing] }
            checkCheckpoint(next, plan, planSha256, split)
            run.results = next.results; run.labels = next.labels
            await writeJson(path, run); pending.delete(`${timing.imageId}/${timing.scale}`)
          } finally { busy = false }
        } else if (route === 'complete') {
          if (!initialized || pending.size || busy) throw new Error('Incomplete experiment batch.')
          run.completedAt = new Date().toISOString(); checkCheckpoint(run, plan, planSha256, split); await writeJson(path, run); finish()
        } else throw new Error('Unknown experiment endpoint.')
        res.end('ok')
      })().catch((cause: unknown) => { const error = cause instanceof Error ? cause : new Error(String(cause)); res.statusCode = 400; res.end(error.message); fail(error) })
    })
  } }
  const server = await createServer({ root, configFile: join(root, 'vite.config.ts'), appType: 'mpa', logLevel: 'warn', plugins: [plugin], server: { host: '127.0.0.1', port: 0, watch: null } })
  let child: ChildProcess | undefined, profile: string | undefined
  try {
    await server.listen(); const address = server.httpServer!.address()
    if (!address || typeof address === 'string') throw new Error('Missing local port.')
    const url = `http://127.0.0.1:${address.port}/evaluation/experiment-a/browser.html?token=${token}`
    keepAlive()
    if (manual) console.log(`Open this URL in the reference browser (forward this loopback port for a phone):\n${url}`)
    else {
      const executable = await chromePath(); profile = await mkdtemp(join(tmpdir(), 'experiment-a-'))
      child = spawn(executable, ['--headless=new', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, url], { stdio: ['ignore', 'ignore', 'pipe'] })
      child.stderr?.on('data', () => {})
      child.once('error', fail); child.once('exit', (code) => fail(new Error(`Evaluation browser exited (${code}).`)))
    }
    await completed
  } finally {
    clearTimeout(timer); if (child) await stop(child); await server.close()
    if (profile) await rm(profile, { recursive: true, force: true })
  }
  return run
}
