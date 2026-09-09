import type { OcrProgress, OcrResult } from './types'

export interface NutritionLabelOcrEngine {
  readonly id: string
  initialize(): Promise<void>
  recognize(image: Blob | File): Promise<OcrResult>
  terminate(): Promise<void>
  onProgress?(listener: (progress: OcrProgress) => void): () => void
}
