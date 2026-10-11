import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join, relative } from 'node:path'
import { createServer, type Plugin } from 'vite'
import { validateOcr } from '../load'
import { sha256 } from './dataset'
import { VARIANTS, type CaptureResult, type PilotDataset, type PilotRun, type PilotResult } from './types'

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`
export async function runtimeSources(root: string) {
  const paths = ['package-lock.json', 'evaluation/pilot/browser.ts', 'evaluation/pilot/runner.ts', 'src/services/ocr/PaddleOcrEngine.ts',
    'src/services/image/preprocessForOcr.ts', 'src/services/image/perspective.ts', 'src/services/image/detectPanel.ts', 'src/services/image/geometryClient.ts',
    'src/services/image/geometry.worker.ts', 'src/services/image/captureQuality.ts', 'src/composables/useImageQuality.ts']
  return Promise.all(paths.map(async (path) => ({ path, sha256: sha256(await readFile(resolve(root, path))) })))
}
interface Prepared {
  datasetFingerprint: string
  sources: Awaited<ReturnType<typeof runtimeSources>>
  captures: Array<{ capture: CaptureResult; pngSha256: string }>
  complete: boolean
}
async function findChrome() {
  for (const file of [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/usr/bin/google-chrome', '/usr/bin/chromium']) {
    if (!file) continue
    try { await access(file); return file } catch { /* try the next installed browser */ }
  }
  throw new Error('Chrome was not found. Set CHROME_PATH to the installed executable.')
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return
  await new Promise<void>((done) => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000)
    child.once('exit', () => { clearTimeout(timer); done() }); child.kill('SIGTERM')
  })
}

export async function runBrowser(root: string, out: string, dataset: PilotDataset, mode: 'prepare' | 'run', resume = false) {
  await mkdir(join(out, 'crops'), { recursive: true })
  const sources = await runtimeSources(root)
  const prepared: Prepared = mode === 'run' ? JSON.parse(await readFile(join(out, 'prepared.json'), 'utf8')) as Prepared
    : { datasetFingerprint: dataset.fingerprint, sources, captures: [], complete: false }
  if (mode === 'run' && (!prepared.complete || prepared.datasetFingerprint !== dataset.fingerprint || JSON.stringify(prepared.sources) !== JSON.stringify(sources))) throw new Error('Prepared inputs are incomplete or stale. Run phase2:prepare in a new output directory.')
  const keys = new Set(dataset.cases.flatMap((entry) => VARIANTS.map((v) => `${entry.id}/${v}`)))
  const received = new Set<string>()
  for (const row of prepared.captures) {
    const key = `${row.capture.id}/${row.capture.variant}`
    if (!keys.has(key) || received.has(key)) throw new Error(`Invalid/duplicate prepared capture: ${key}`)
    received.add(key)
    if (mode === 'run' && sha256(await readFile(join(out, 'crops', `${row.capture.id}-${row.capture.variant}.png`))) !== row.pngSha256) throw new Error(`Prepared PNG changed: ${key}`)
  }
  if (mode === 'run' && received.size !== keys.size) throw new Error('Prepared crop count mismatch.')
  received.clear()
  const run: PilotRun = resume ? JSON.parse(await readFile(join(out, 'run.json'), 'utf8')) as PilotRun
    : { version: 1, datasetFingerprint: dataset.fingerprint, startedAt: new Date().toISOString(), completedAt: null,
      environment: {}, initializationMs: null, config: {}, sources, results: [] }
  if (resume) {
    if (run.version !== 1 || run.datasetFingerprint !== dataset.fingerprint || JSON.stringify(run.sources) !== JSON.stringify(sources)) throw new Error('Cannot resume: code or dataset changed.')
    for (const row of run.results) {
      const key = `${row.id}/${row.variant}`
      if (!keys.has(key) || received.has(key)) throw new Error(`Invalid checkpoint: ${key}`)
      if (row.ocr) validateOcr(row.ocr)
      else if (!row.error) throw new Error(`Missing checkpoint error: ${key}`)
      received.add(key)
    }
    if (run.completedAt) {
      if (received.size !== keys.size) throw new Error('Completed checkpoint has missing cases.')
      return
    }
    console.log(`Resuming ${received.size}/${keys.size} saved cases.`)
  }
  const token = randomBytes(24).toString('hex')
  let succeed!: () => void, fail!: (error: Error) => void
  const completed = new Promise<void>((resolve, reject) => { succeed = resolve; fail = reject })
  // Install a rejection handler before browser launch/server startup can fail.
  void completed.catch(() => {})
  let timer: ReturnType<typeof setTimeout> | undefined
  const keepAlive = () => { clearTimeout(timer); timer = setTimeout(() => fail(new Error('Batch stalled for five minutes; completed cases are checkpointed.')), 300_000) }
  const plugin: Plugin = { name: 'local-pilot-batch', configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (!req.url?.startsWith('/__pilot/')) { next(); return }
      void (async () => {
        if (req.headers['x-pilot-token'] !== token) { res.statusCode = 403; res.end('Invalid batch token'); return }
        keepAlive()
        const route = req.url!.slice('/__pilot/'.length)
        if (route === 'jobs' && req.method === 'GET') {
          res.setHeader('Content-Type', 'application/json')
          res.end(json({ mode, entries: dataset.cases.map(({ id, image, width, height, panel }) => ({ id, image, width, height, panel })),
            captures: prepared.captures.filter(({ capture }) => !received.has(`${capture.id}/${capture.variant}`))
              .map(({ capture }) => ({ capture, url: `/${relative(root, out).split('\\').join('/')}/crops/${capture.id}-${capture.variant}.png` })) }))
          return
        }
        if (req.method !== 'POST') throw new Error('Expected POST')
        const chunks: Buffer[] = []; let size = 0
        for await (const chunk of req) { const buffer = Buffer.from(chunk as Uint8Array); size += buffer.length; if (size > 40_000_000) throw new Error('Batch payload too large'); chunks.push(buffer) }
        const body = JSON.parse(Buffer.concat(chunks).toString())
        if (route === 'status') console.log(String(body.message))
        else if (route === 'fatal') throw new Error(String(body.error))
        else if (route === 'initialized' && mode === 'run') {
          if (run.results.length && JSON.stringify(run.config) !== JSON.stringify(body.config)) throw new Error('Resumed OCR configuration changed.')
          const sessions = (run.environment.sessions ?? []) as unknown[]
          sessions.push({ ...body.environment, initializationMs: body.initializationMs })
          run.initializationMs = body.initializationMs; run.environment = { ...body.environment, sessions }; run.config = body.config
          await writeFile(join(out, 'run.json'), json(run))
        } else if (route === 'capture' && mode === 'prepare') {
          const capture = body.capture as CaptureResult, key = `${capture.id}/${capture.variant}`
          if (!keys.has(key) || received.has(key)) throw new Error(`Unexpected/duplicate capture: ${key}`)
          const png = Buffer.from(body.png, 'base64')
          if (png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Expected PNG crop')
          await writeFile(join(out, 'crops', `${capture.id}-${capture.variant}.png`), png, { flag: 'wx' })
          prepared.captures.push({ capture, pngSha256: sha256(png) }); received.add(key)
          await writeFile(join(out, 'prepared.json'), json(prepared))
        } else if (route === 'result' && mode === 'run') {
          const result = body as PilotResult, key = `${result.id}/${result.variant}`
          if (!keys.has(key) || received.has(key)) throw new Error(`Unexpected/duplicate OCR result: ${key}`)
          if (result.ocr) validateOcr(result.ocr)
          else if (!result.error) throw new Error(`OCR failure without error: ${key}`)
          if (!Number.isFinite(result.processingMs) || result.processingMs < 0) throw new Error(`Invalid timing: ${key}`)
          run.results.push(result); received.add(key)
          await writeFile(join(out, 'run.json'), json(run))
        } else if (route === 'complete') {
          if (received.size !== keys.size) throw new Error(`Incomplete batch: ${received.size}/${keys.size}`)
          if (mode === 'prepare') { prepared.complete = true; await writeFile(join(out, 'prepared.json'), json(prepared)) }
          else { run.completedAt = new Date().toISOString(); await writeFile(join(out, 'run.json'), json(run)) }
          succeed()
        } else throw new Error(`Unknown batch operation: ${route}`)
        res.end('ok')
      })().catch((cause: unknown) => { const error = cause instanceof Error ? cause : new Error(String(cause)); res.statusCode = 500; res.end(error.message); fail(error) })
    })
  } }
  const executable = await findChrome()
  const profile = await mkdtemp(join(tmpdir(), 'label-pilot-chrome-'))
  let child: ChildProcess | undefined
  const server = await createServer({ root, configFile: resolve(root, 'vite.config.ts'), appType: 'mpa', logLevel: 'warn', plugins: [plugin],
    server: { host: '127.0.0.1', port: 0, watch: null } })
  try {
    await server.listen()
    const address = server.httpServer!.address()
    if (!address || typeof address === 'string') throw new Error('Missing evaluation port')
    keepAlive()
    child = spawn(executable, ['--headless=new', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`,
      `http://127.0.0.1:${address.port}/evaluation/pilot/browser.html?token=${token}`], { stdio: ['ignore', 'ignore', 'pipe'] })
    child.stderr?.on('data', () => { /* drain Chrome diagnostics without exposing unrelated browser logs */ })
    child.once('error', fail)
    child.once('exit', (code) => fail(new Error(`Evaluation browser exited (${code}) before batch completion.`)))
    await completed
  } finally {
    clearTimeout(timer)
    if (child) await stop(child)
    await server.close()
    await rm(profile, { recursive: true, force: true })
  }
}
