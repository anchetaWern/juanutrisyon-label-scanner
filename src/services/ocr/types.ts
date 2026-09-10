export interface OcrBoundingBox {
  x: number
  y: number
  width: number
  height: number
}

export interface OcrToken {
  text: string
  confidence?: number
  bbox: OcrBoundingBox
}

export interface OcrLine {
  text: string
  confidence?: number
  bbox: OcrBoundingBox
  tokens?: OcrToken[]
}

export interface OcrDiagnostics {
  completedAt: string
  timing: {
    initializedDuringRequest: boolean
    initializationMs: number
    preprocessingMs: number
    recognitionMs: number
    totalMs: number
    detectionMs?: number
    textRecognitionMs?: number
  }
  provider: {
    configId: string
    model?: string
    backend?: string
    detectionProvider?: string
    recognitionProvider?: string
    worker?: boolean
    totalInitializationMs?: number
    providerInitializationMs?: number
    modelAssets?: Array<{ url: string; bytes: number }>
    predictionSettings?: Record<string, unknown>
    detectedBoxes?: number
    recognizedCount?: number
  }
}

export interface OcrResult {
  text: string
  lines: OcrLine[]
  engine: string
  engineVersion?: string
  sourceSize?: {
    width: number
    height: number
  }
  preprocessing?: string
  diagnostics?: OcrDiagnostics
}

export type OcrEngineState = 'idle' | 'initializing' | 'ready' | 'recognizing' | 'error'

export interface OcrProgress {
  state: OcrEngineState
  status?: string
  progress?: number
}
