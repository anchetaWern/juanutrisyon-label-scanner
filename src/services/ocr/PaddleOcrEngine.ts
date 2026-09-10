import type { InitializationSummary, OcrResultItem, PaddleOCR } from '@paddleocr/paddleocr-js'
import type { NutritionLabelOcrEngine } from './NutritionLabelOcrEngine'
import type { OcrBoundingBox, OcrLine, OcrProgress, OcrResult } from './types'
import { PRODUCTION_PREPROCESSING_CONFIG, preprocessForOcr } from '../image/preprocessForOcr'

const PADDLE_OCR_VERSION = '0.4.2'

type PaddleInstance = Awaited<ReturnType<typeof PaddleOCR.create>>

export interface PaddleOcrEngineConfig {
  id: string
  title: string
  detectionModel: string
  recognitionModel: string
}

export const PADDLE_OCR_CONFIGS = {
  v5Mobile: {
    id: 'v5-mobile',
    title: 'PP-OCRv5 mobile',
    detectionModel: 'PP-OCRv5_mobile_det',
    recognitionModel: 'PP-OCRv5_mobile_rec',
  },
  v6Tiny: {
    id: 'v6-tiny',
    title: 'PP-OCRv6 tiny',
    detectionModel: 'PP-OCRv6_tiny_det',
    recognitionModel: 'PP-OCRv6_tiny_rec',
  },
} as const satisfies Record<string, PaddleOcrEngineConfig>

function polygonBox(poly: OcrResultItem['poly']): OcrBoundingBox {
  const xValues = poly.map(([x]) => x)
  const yValues = poly.map(([, y]) => y)
  const minX = Math.min(...xValues)
  const maxX = Math.max(...xValues)
  const minY = Math.min(...yValues)
  const maxY = Math.max(...yValues)
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

export function normalizePaddleItems(items: OcrResultItem[]): OcrLine[] {
  return items
    .filter((item) => item.text.trim().length > 0)
    .map((item) => ({
      text: item.text.trim(),
      confidence: Number.isFinite(item.score) ? item.score * 100 : undefined,
      bbox: polygonBox(item.poly),
    }))
}

/** Browser-only PaddleOCR provider normalized to the app's OCR abstraction. */
export class PaddleOcrEngine implements NutritionLabelOcrEngine {
  readonly id = 'paddleocr.js'
  private instance: PaddleInstance | null = null
  private initialization: Promise<void> | null = null
  private initializationDurationMs = 0
  private summary: InitializationSummary | null = null
  private listeners = new Set<(progress: OcrProgress) => void>()

  constructor(readonly config: PaddleOcrEngineConfig = PADDLE_OCR_CONFIGS.v6Tiny) {}

  onProgress(listener: (progress: OcrProgress) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getInitializationSummary(): InitializationSummary | null {
    return this.summary
  }

  private emit(progress: OcrProgress): void {
    this.listeners.forEach((listener) => listener(progress))
  }

  async initialize(): Promise<void> {
    if (this.instance) return
    if (this.initialization) return this.initialization

    this.emit({ state: 'initializing', status: `Loading ${this.config.title} English models`, progress: 0 })
    const startedAt = performance.now()
    this.initialization = (async () => {
      try {
        const { PaddleOCR } = await import('@paddleocr/paddleocr-js')
        this.instance = await PaddleOCR.create({
          textDetectionModelName: this.config.detectionModel,
          textRecognitionModelName: this.config.recognitionModel,
          worker: true,
          ortOptions: {
            backend: 'wasm',
            wasmPaths: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/',
            numThreads: 1,
            simd: true,
          },
        })
        this.summary = this.instance.getInitializationSummary()
        this.initializationDurationMs = performance.now() - startedAt
        this.emit({ state: 'ready', status: 'PaddleOCR is ready', progress: 1 })
      } catch (error) {
        this.emit({ state: 'error', status: error instanceof Error ? error.message : 'PaddleOCR initialization failed' })
        throw error
      } finally {
        this.initialization = null
      }
    })()

    return this.initialization
  }

  async recognize(image: Blob | File): Promise<OcrResult> {
    const totalStartedAt = performance.now()
    const initializedDuringRequest = this.instance === null
    await this.initialize()
    if (!this.instance) throw new Error('PaddleOCR engine is unavailable.')

    this.emit({ state: 'recognizing', status: 'Preparing OCR image', progress: 0 })
    try {
      const preprocessingStartedAt = performance.now()
      const preparedImage = await preprocessForOcr(image)
      const preprocessingMs = performance.now() - preprocessingStartedAt
      this.emit({ state: 'recognizing', status: 'Recognizing label text', progress: 0 })
      const recognitionStartedAt = performance.now()
      const [recognition] = await this.instance.predict(preparedImage)
      const recognitionMs = performance.now() - recognitionStartedAt
      if (!recognition) throw new Error('PaddleOCR returned no result.')
      const lines = normalizePaddleItems(recognition.items)

      this.emit({ state: 'ready', status: 'OCR complete', progress: 1 })
      return {
        text: lines.map((line) => line.text).join('\n'),
        lines,
        engine: this.id,
        engineVersion: PADDLE_OCR_VERSION,
        sourceSize: recognition.image,
        preprocessing: PRODUCTION_PREPROCESSING_CONFIG.id,
        diagnostics: {
          completedAt: new Date().toISOString(),
          timing: {
            initializedDuringRequest,
            initializationMs: initializedDuringRequest ? this.initializationDurationMs : 0,
            preprocessingMs,
            recognitionMs,
            totalMs: performance.now() - totalStartedAt,
          },
          provider: {
            configId: this.config.id,
            model: `${this.config.detectionModel} + ${this.config.recognitionModel}`,
            backend: this.summary?.backend,
            detectionProvider: this.summary?.detProvider,
            recognitionProvider: this.summary?.recProvider,
            worker: true,
            totalInitializationMs: this.initializationDurationMs,
            providerInitializationMs: this.summary?.elapsedMs,
            modelAssets: this.summary?.assets,
          },
        },
      }
    } catch (error) {
      this.emit({ state: 'error', status: error instanceof Error ? error.message : 'PaddleOCR failed' })
      throw error
    }
  }

  async terminate(): Promise<void> {
    if (this.instance) await this.instance.dispose()
    this.instance = null
    this.summary = null
    this.initializationDurationMs = 0
    this.emit({ state: 'idle' })
  }
}
