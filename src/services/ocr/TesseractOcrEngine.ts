import { createWorker, type Block, type LoggerMessage, type Worker } from 'tesseract.js'
import type { NutritionLabelOcrEngine } from './NutritionLabelOcrEngine'
import type { OcrBoundingBox, OcrLine, OcrProgress, OcrResult, OcrToken } from './types'
import { getImageDimensions } from '../../utils/image'
import { PRODUCTION_PREPROCESSING_CONFIG, preprocessForOcr } from '../image/preprocessForOcr'
import { applyTesseractConfig, PRODUCTION_TESSERACT_CONFIG } from './tesseractConfig'

type TesseractBox = { x0: number; y0: number; x1: number; y1: number }

interface TesseractWordLike {
  text: string
  confidence?: number
  bbox: TesseractBox
}

interface TesseractLineLike {
  text: string
  confidence?: number
  bbox: TesseractBox
  words?: TesseractWordLike[]
}

interface TesseractParagraphLike {
  lines?: TesseractLineLike[]
}

interface TesseractBlockLike {
  paragraphs?: TesseractParagraphLike[]
}

function normalizeBox(box: TesseractBox): OcrBoundingBox {
  return {
    x: box.x0,
    y: box.y0,
    width: Math.max(0, box.x1 - box.x0),
    height: Math.max(0, box.y1 - box.y0),
  }
}

function finiteConfidence(value: number | undefined): number | undefined {
  return Number.isFinite(value) ? value : undefined
}

export function normalizeTesseractBlocks(blocks: TesseractBlockLike[] | null | undefined): OcrLine[] {
  return (blocks ?? []).flatMap((block) =>
    (block.paragraphs ?? []).flatMap((paragraph) =>
      (paragraph.lines ?? [])
        .filter((line) => line.text.trim().length > 0)
        .map((line): OcrLine => {
          const tokens = (line.words ?? [])
            .filter((word) => word.text.trim().length > 0)
            .map(
              (word): OcrToken => ({
                text: word.text.trim(),
                confidence: finiteConfidence(word.confidence),
                bbox: normalizeBox(word.bbox),
              }),
            )

          return {
            text: line.text.trim(),
            confidence: finiteConfidence(line.confidence),
            bbox: normalizeBox(line.bbox),
            ...(tokens.length ? { tokens } : {}),
          }
        }),
    ),
  )
}

export class TesseractOcrEngine implements NutritionLabelOcrEngine {
  readonly id = 'tesseract.js'
  private worker: Worker | null = null
  private initialization: Promise<void> | null = null
  private listeners = new Set<(progress: OcrProgress) => void>()

  onProgress(listener: (progress: OcrProgress) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(progress: OcrProgress): void {
    this.listeners.forEach((listener) => listener(progress))
  }

  async initialize(): Promise<void> {
    if (this.worker) return
    if (this.initialization) return this.initialization

    this.emit({ state: 'initializing', status: 'Loading English OCR model', progress: 0 })
    this.initialization = (async () => {
      try {
        this.worker = await createWorker('eng', 1, {
          logger: (message: LoggerMessage) => {
            this.emit({
              state: message.status === 'recognizing text' ? 'recognizing' : 'initializing',
              status: message.status,
              progress: message.progress,
            })
          },
        })
        await applyTesseractConfig(this.worker, PRODUCTION_TESSERACT_CONFIG)
        this.emit({ state: 'ready', status: 'OCR is ready', progress: 1 })
      } catch (error) {
        this.emit({ state: 'error', status: error instanceof Error ? error.message : 'OCR initialization failed' })
        throw error
      } finally {
        this.initialization = null
      }
    })()

    return this.initialization
  }

  async recognize(image: Blob | File): Promise<OcrResult> {
    await this.initialize()
    if (!this.worker) throw new Error('OCR engine is unavailable.')

    this.emit({ state: 'recognizing', status: 'Preparing a high-contrast OCR image', progress: 0 })
    try {
      const preparedImage = await preprocessForOcr(image)
      this.emit({ state: 'recognizing', status: 'Recognizing label text', progress: 0 })
      const [dimensions, recognition] = await Promise.all([
        getImageDimensions(preparedImage),
        this.worker.recognize(preparedImage, {}, { blocks: true, text: true }),
      ])
      const text = recognition.data.text.trim()
      const lines = normalizeTesseractBlocks(recognition.data.blocks as Block[] | null)

      this.emit({ state: 'ready', status: 'OCR complete', progress: 1 })
      return {
        text,
        lines,
        engine: this.id,
        engineVersion: '6',
        sourceSize: dimensions,
        preprocessing: PRODUCTION_PREPROCESSING_CONFIG.id,
      }
    } catch (error) {
      this.emit({ state: 'error', status: error instanceof Error ? error.message : 'OCR failed' })
      throw error
    }
  }

  async terminate(): Promise<void> {
    if (this.worker) await this.worker.terminate()
    this.worker = null
    this.emit({ state: 'idle' })
  }
}
