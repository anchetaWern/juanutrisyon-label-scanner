import { loadImage, canvasToBlob } from '../../src/utils/image'
import { renderPerspective, suggestPanel } from '../../src/services/image/geometryClient'
import { PERSPECTIVE_VERSION, type Quad } from '../../src/services/image/perspective'
import { useImageQuality } from '../../src/composables/useImageQuality'
import { PADDLE_PREDICTION_DEFAULTS, PaddleOcrEngine, type PaddleOcrEngineConfig } from '../../src/services/ocr/PaddleOcrEngine'
import { PRODUCTION_PREPROCESSING_CONFIG } from '../../src/services/image/preprocessForOcr'
import type { CaptureResult, PilotCase, PilotResult, Variant } from './types'
import { VARIANTS } from './types'

const token = new URLSearchParams(location.search).get('token')!
async function post(path: string, data: unknown) {
  const response = await fetch(`/__pilot/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Pilot-Token': token }, body: JSON.stringify(data) })
  if (!response.ok) throw new Error(await response.text())
}
async function status(message: string) {
  document.querySelector('#status')!.textContent = message
  await post('status', { message })
}
function context(canvas: HTMLCanvasElement) {
  const value = canvas.getContext('2d', { willReadFrequently: true })
  if (!value) throw new Error('Canvas unavailable')
  return value
}
function createCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
  return canvas
}
const pixelsToBase64 = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]!); reader.onerror = reject; reader.readAsDataURL(blob)
})

async function prepare(entry: Pick<PilotCase, 'id' | 'image' | 'width' | 'height' | 'panel'>) {
  const image = await loadImage(`/${entry.image}`)
  if (image.naturalWidth !== entry.width || image.naturalHeight !== entry.height) throw new Error(`Image dimensions changed: ${entry.id}`)
  const full = createCanvas(entry.width, entry.height); context(full).drawImage(image, 0, 0)
  const absolute = entry.panel.map((p) => ({ x: p.x * (entry.width - 1), y: p.y * (entry.height - 1) })) as Quad
  const margin = 8
  const x = Math.max(0, Math.floor(Math.min(...absolute.map((p) => p.x))) - margin)
  const y = Math.max(0, Math.floor(Math.min(...absolute.map((p) => p.y))) - margin)
  const width = Math.min(entry.width, Math.ceil(Math.max(...absolute.map((p) => p.x))) + margin + 1) - x
  const height = Math.min(entry.height, Math.ceil(Math.max(...absolute.map((p) => p.y))) + margin + 1) - y
  const scale = Math.min(1, 2400 / Math.max(width, height))
  const rectangle = createCanvas(Math.round(width * scale), Math.round(height * scale))
  context(rectangle).drawImage(full, x, y, width, height, 0, 0, rectangle.width, rectangle.height)
  const points = absolute.map((p) => ({ x: (p.x - x) * rectangle.width / width, y: (p.y - y) * rectangle.height / height })) as Quad
  for (const variant of VARIANTS) {
    await status(`Preparing ${entry.id}/${variant}`)
    const start = performance.now()
    let canvas = variant === 'original' ? full : rectangle
    let geometry: CaptureResult['geometry'] = null
    let blob: Blob
    if (variant === 'perspective') {
      const rendered = await renderPerspective(rectangle, points, 2400, new AbortController().signal)
      blob = rendered.blob
      geometry = { version: PERSPECTIVE_VERSION, coordinateSpace: 'rendered-rectangular-crop', sourceSize: { width: rectangle.width, height: rectangle.height },
        corners: points, outputSize: { width: rendered.width, height: rendered.height }, outputToSource: rendered.matrix, selection: 'manual', suggestionScore: null }
      canvas = createCanvas(rendered.width, rendered.height)
      const url = URL.createObjectURL(blob)
      try { context(canvas).drawImage(await loadImage(url), 0, 0) } finally { URL.revokeObjectURL(url) }
    } else blob = await canvasToBlob(canvas, 'image/png')
    const quality = useImageQuality()
    await quality.analyze(blob, geometry ?? undefined)
    let suggestion: CaptureResult['suggestion'] = null, suggestionError: string | null = null
    const suggestStarted = performance.now()
    // Suggestions on original and rectangle are assessed separately; no suggestion is applied automatically.
    if (variant !== 'perspective') {
      try { suggestion = await suggestPanel(canvas, new AbortController().signal) }
      catch (cause) { suggestionError = cause instanceof Error ? cause.message : String(cause) }
    }
    const capture: CaptureResult = { id: entry.id, variant, width: canvas.width, height: canvas.height, geometry,
      rectangle: variant === 'original' ? null : { x, y, width, height },
      quality: { metrics: quality.metrics.value, warnings: quality.warnings.value, error: quality.error.value },
      suggestion, suggestionError, suggestionMs: variant === 'perspective' ? 0 : performance.now() - suggestStarted, preparationMs: performance.now() - start }
    await post('capture', { capture, png: await pixelsToBase64(blob) })
    if (variant === 'perspective') { canvas.width = 1; canvas.height = 1 }
  }
  full.width = rectangle.width = 1; full.height = rectangle.height = 1
}

async function main() {
  const response = await fetch('/__pilot/jobs', { headers: { 'X-Pilot-Token': token } })
  if (!response.ok) throw new Error('Could not load batch jobs')
  // Expected nutrient values are deliberately not sent to the OCR runner.
  const jobs = await response.json() as { mode: 'prepare' | 'run'; entries: Array<Pick<PilotCase, 'id' | 'image' | 'width' | 'height' | 'panel'>>;
    captures: Array<{ capture: CaptureResult; url: string }>; variants: Variant[]; config: PaddleOcrEngineConfig }
  if (jobs.mode === 'prepare') for (const entry of jobs.entries) await prepare(entry)
  else {
    const engine = new PaddleOcrEngine(jobs.config)
    await status('Initializing production PaddleOCR models…')
    const start = performance.now()
    try {
      await engine.initialize()
      await post('initialized', { initializationMs: performance.now() - start,
        config: { ...jobs.config, prediction: { ...PADDLE_PREDICTION_DEFAULTS, ...jobs.config.prediction }, preprocessing: jobs.config.preprocessing ?? PRODUCTION_PREPROCESSING_CONFIG },
        environment: { userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency, devicePixelRatio, mode: 'desktop-headless-chrome', provider: engine.getInitializationSummary() } })
      for (const { capture, url } of jobs.captures) {
        await status(`Recognizing ${capture.id}/${capture.variant}`)
        const started = performance.now()
        let result: PilotResult
        try {
          const imageResponse = await fetch(url)
          if (!imageResponse.ok) throw new Error(`Missing prepared crop: ${url}`)
          const ocr = await engine.recognize(await imageResponse.blob())
          result = { ...capture, ocr, processingMs: performance.now() - started }
        } catch (cause) { result = { ...capture, ocr: null, error: cause instanceof Error ? cause.message : String(cause), processingMs: performance.now() - started } }
        await post('result', result)
      }
    } finally { await engine.terminate() }
  }
  await post('complete', {})
  document.querySelector('#status')!.textContent = 'Complete'
}
void main().catch(async (cause: unknown) => {
  const error = cause instanceof Error ? cause.stack ?? cause.message : String(cause)
  document.querySelector('#status')!.textContent = error
  await post('fatal', { error })
})
