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

export interface OcrResult {
  text: string
  lines: OcrLine[]
  engine: string
  engineVersion?: string
  sourceSize?: {
    width: number
    height: number
  }
}

export type OcrEngineState = 'idle' | 'initializing' | 'ready' | 'recognizing' | 'error'

export interface OcrProgress {
  state: OcrEngineState
  status?: string
  progress?: number
}
