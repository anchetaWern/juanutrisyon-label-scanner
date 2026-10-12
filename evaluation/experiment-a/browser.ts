import { PaddleOcrEngine, PADDLE_OCR_CONFIGS } from '../../src/services/ocr/PaddleOcrEngine'
import { PRODUCTION_PREPROCESSING_CONFIG } from '../../src/services/image/preprocessForOcr'
import { canvasToBlob, loadImage } from '../../src/utils/image'
import type { OcrBoundingBox } from '../../src/services/ocr/types'
import type { CandidateResult, LabelTiming, Scale } from './types'

interface Job { imageId: string; scale: Scale; sourceUrl: string; width: number; height: number; candidates: Array<{ id: string; cropBox: OcrBoundingBox }> }
const token = new URLSearchParams(location.search).get('token')!
async function post(path: string, body: unknown) {
  const response = await fetch(`/__experiment_a/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Experiment-Token': token }, body: JSON.stringify(body) })
  if (!response.ok) throw new Error(await response.text())
}
async function status(message: string) {
  document.querySelector('#status')!.textContent = message
  await post('status', { message })
}
function canvas(width: number, height: number) {
  if (width * height > 16_000_000 || Math.max(width, height) > 20000) throw new Error('Local crop exceeds experimental memory limit; not downscaled.')
  const value = document.createElement('canvas'); value.width = width; value.height = height
  const context = value.getContext('2d')
  if (!context) throw new Error('Canvas is unavailable.')
  context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high'
  return { value, context }
}
const base64 = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]!); reader.onerror = reject; reader.readAsDataURL(blob)
})
async function main() {
  const response = await fetch('/__experiment_a/jobs', { headers: { 'X-Experiment-Token': token } })
  if (!response.ok) throw new Error(await response.text())
  const { jobs } = await response.json() as { jobs: Job[] }
  // Only IDs, bounds, images, and scales enter these jobs. No expected values/baseline text.
  const engine = new PaddleOcrEngine({ ...PADDLE_OCR_CONFIGS.v6Tiny,
    preprocessing: { ...PRODUCTION_PREPROCESSING_CONFIG, id: 'experiment-a-original-local-v1', mode: 'original', scale: 1, maxDimension: 20000 } })
  try {
    await status('Initializing unchanged PaddleOCR models…')
    const initStarted = performance.now(); await engine.initialize()
    await post('initialized', { initializationMs: performance.now() - initStarted, userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency, devicePixelRatio, mode: 'browser-local', provider: engine.getInitializationSummary(),
      memory: (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null })
    for (const job of jobs) {
      await status(`Recognizing ${job.imageId} at ${job.scale}× (${job.candidates.length} regions)`)
      const sourceStarted = performance.now()
      const source = await loadImage(job.sourceUrl)
      if (source.naturalWidth !== job.width || source.naturalHeight !== job.height) throw new Error('Source image dimensions changed.')
      const sourceLoadMs = performance.now() - sourceStarted
      let totalMs = sourceLoadMs
      const results: Array<{ result: CandidateResult; png: string | null }> = []
      for (const candidate of job.candidates) {
        const started = performance.now()
        let extractionMs = 0, resizeMs = 0, recognitionMs = 0, blob: Blob | null = null
        let region: ReturnType<typeof canvas> | null = null, enlarged: ReturnType<typeof canvas> | null = null
        let ocr: CandidateResult['ocr'] = null, error: string | null = null
        const { x, y, width, height } = candidate.cropBox
        try {
          region = canvas(width, height)
          region.context.drawImage(source, x, y, width, height, 0, 0, width, height)
          extractionMs = performance.now() - started
          const resizingStarted = performance.now()
          if (job.scale === 2) {
            enlarged = canvas(width * 2, height * 2)
            enlarged.context.drawImage(region.value, 0, 0, width * 2, height * 2)
          }
          blob = await canvasToBlob(enlarged?.value ?? region.value, 'image/png')
          resizeMs = performance.now() - resizingStarted
          const recognitionStarted = performance.now()
          try { ocr = await engine.recognize(blob) } finally { recognitionMs = performance.now() - recognitionStarted }
        } catch (cause) { error = cause instanceof Error ? cause.message : String(cause) }
        finally { if (region) region.value.width = region.value.height = 1; if (enlarged) enlarged.value.width = enlarged.value.height = 1 }
        const elapsed = performance.now() - started; totalMs += elapsed
        const result: CandidateResult = { candidateId: candidate.id, imageId: job.imageId, scale: job.scale, ocr, error, crop: null,
          timing: { extractionMs, resizeMs, recognitionMs, totalMs: elapsed } }
        // Diagnostic serialization is excluded from candidate/label latency, but not OCR PNG encoding.
        results.push({ result, png: blob ? await base64(blob) : null })
      }
      const timing: LabelTiming = { imageId: job.imageId, scale: job.scale, totalMs, sourceLoadMs, candidates: job.candidates.length }
      await post('label', { timing, results })
    }
    await post('complete', {})
    document.querySelector('#status')!.textContent = 'Complete. Results are saved locally.'
  } finally { await engine.terminate() }
}
void main().catch(async (cause: unknown) => {
  const error = cause instanceof Error ? cause.stack ?? cause.message : String(cause)
  document.querySelector('#status')!.textContent = error
  await post('fatal', { error })
})
