import { canvasToBlob } from '../../utils/image'
import type { GeometryRequest } from './geometry.worker'
import type { PanelSuggestion } from './detectPanel'
import type { Quad, warpPerspective } from './perspective'

function run<T>(request: GeometryRequest, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('Cancelled', 'AbortError')); return }
    const worker = new Worker(new URL('./geometry.worker.ts', import.meta.url), { type: 'module' })
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); worker.terminate() }
    const fail = (error: Error) => { cleanup(); reject(error) }
    const abort = () => fail(new DOMException('Cancelled', 'AbortError'))
    const timer = setTimeout(() => fail(new Error('Image processing took too long. Try a smaller crop.')), 30_000)
    signal.addEventListener('abort', abort, { once: true })
    worker.onmessage = ({ data }: MessageEvent<{ result: T; error?: string }>) => {
      cleanup()
      if (data.error) reject(new Error(data.error))
      else resolve(data.result)
    }
    worker.onerror = () => fail(new Error('Straightening is unavailable in this browser. You can still use a rectangular crop.'))
    try { worker.postMessage(request, [request.pixels.buffer]) } catch (cause) { fail(cause instanceof Error ? cause : new Error('Image processing failed.')) }
  })
}

export async function suggestPanel(source: HTMLCanvasElement, signal: AbortSignal): Promise<PanelSuggestion | null> {
  const scale = Math.min(1, 640 / Math.max(source.width, source.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(source.width * scale)); canvas.height = Math.max(1, Math.round(source.height * scale))
  if (canvas.width < 2 || canvas.height < 2) return null
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Image analysis is unavailable.')
  context.drawImage(source, 0, 0, canvas.width, canvas.height)
  const result = await run<PanelSuggestion | null>({ kind: 'detect', pixels: context.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width, height: canvas.height }, signal)
  if (!result) return null
  return { ...result, corners: result.corners.map((p) => ({ x: p.x * (source.width - 1) / (canvas.width - 1), y: p.y * (source.height - 1) / (canvas.height - 1) })) as Quad }
}

export async function renderPerspective(source: HTMLCanvasElement, corners: Quad, maxDimension: number, signal: AbortSignal) {
  const context = source.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Image processing is unavailable.')
  const result = await run<ReturnType<typeof warpPerspective>>({ kind: 'warp', pixels: context.getImageData(0, 0, source.width, source.height).data,
    width: source.width, height: source.height, corners, maxDimension }, signal)
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError')
  const canvas = document.createElement('canvas')
  canvas.width = result.width; canvas.height = result.height
  const output = canvas.getContext('2d')
  if (!output) throw new Error('The straightened image could not be rendered.')
  output.putImageData(new ImageData(new Uint8ClampedArray(result.pixels), result.width, result.height), 0, 0)
  const blob = await canvasToBlob(canvas, 'image/png')
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError')
  return { blob, width: result.width, height: result.height, matrix: result.matrix }
}
