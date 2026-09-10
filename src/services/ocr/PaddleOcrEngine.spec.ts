import { beforeEach, describe, expect, it, vi } from 'vitest'

const createMock = vi.hoisted(() => vi.fn())
const predictMock = vi.hoisted(() => vi.fn())
const disposeMock = vi.hoisted(() => vi.fn())

vi.mock('@paddleocr/paddleocr-js', () => ({ PaddleOCR: { create: createMock } }))
vi.mock('@/services/image/preprocessForOcr', () => ({
  PRODUCTION_PREPROCESSING_CONFIG: { id: 'grayscale-contrast-sharpen-v1' },
  preprocessForOcr: vi.fn(async (image: Blob) => image),
}))

import { normalizePaddleItems, PADDLE_OCR_CONFIGS, PADDLE_PREDICTION_DEFAULTS, PaddleOcrEngine } from './PaddleOcrEngine'
import { preprocessForOcr, PRODUCTION_PREPROCESSING_CONFIG } from '@/services/image/preprocessForOcr'

describe('normalizePaddleItems', () => {
  it('normalizes polygons, confidence, and empty text', () => {
    expect(
      normalizePaddleItems([
        {
          text: ' Sodium 70mg ',
          score: 0.91,
          poly: [
            [10, 20],
            [110, 18],
            [112, 42],
            [8, 44],
          ],
        },
        { text: '   ', score: 1, poly: [[0, 0]] },
      ]),
    ).toEqual([
      {
        text: 'Sodium 70mg',
        confidence: 91,
        bbox: { x: 8, y: 18, width: 104, height: 26 },
      },
    ])
  })
})

describe('Paddle OCR adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createMock.mockResolvedValue({
      getInitializationSummary: () => ({
        backend: 'wasm',
        detProvider: 'wasm',
        recProvider: 'wasm',
        assets: [],
        elapsedMs: 10,
        pipelineConfigWarnings: [],
        webgpuAvailable: false,
      }),
      predict: predictMock,
      dispose: disposeMock,
    })
    predictMock.mockResolvedValue([
      {
        image: { width: 100, height: 200 },
        items: [
          {
            text: 'Protein 2g',
            score: 0.95,
            poly: [
              [1, 2],
              [50, 2],
              [50, 12],
              [1, 12],
            ],
          },
        ],
      },
    ])
  })

  it('runs the selected tiny models in a worker and returns normalized OCR', async () => {
    const engine = new PaddleOcrEngine(PADDLE_OCR_CONFIGS.v6Tiny)
    const result = await engine.recognize(new Blob(['image'], { type: 'image/jpeg' }))

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        textDetectionModelName: 'PP-OCRv6_tiny_det',
        textRecognitionModelName: 'PP-OCRv6_tiny_rec',
        worker: true,
      }),
    )
    expect(result).toMatchObject({
      text: 'Protein 2g',
      engine: 'paddleocr.js',
      sourceSize: { width: 100, height: 200 },
      preprocessing: 'grayscale-contrast-sharpen-v1',
      diagnostics: {
        timing: {
          initializedDuringRequest: true,
          initializationMs: expect.any(Number),
          preprocessingMs: expect.any(Number),
          recognitionMs: expect.any(Number),
          totalMs: expect.any(Number),
        },
        provider: {
          configId: 'v6-tiny-recall-v2',
          model: 'PP-OCRv6_tiny_det + PP-OCRv6_tiny_rec',
          backend: 'wasm',
          totalInitializationMs: expect.any(Number),
          providerInitializationMs: 10,
          worker: true,
        },
      },
    })
    expect(result.lines[0]).toMatchObject({ text: 'Protein 2g', confidence: 95 })
    expect(result.diagnostics?.provider.predictionSettings).toEqual({
      ...PADDLE_PREDICTION_DEFAULTS,
      textDetBoxThresh: 0.45,
    })

    await engine.terminate()
    expect(disposeMock).toHaveBeenCalledOnce()
  })

  it('applies experimental settings through the production path and retains raw recognition text', async () => {
    const preprocessing = { ...PRODUCTION_PREPROCESSING_CONFIG, id: 'test-color', mode: 'original' as const }
    const prediction = { textDetBoxThresh: 0.45 }
    const engine = new PaddleOcrEngine({ ...PADDLE_OCR_CONFIGS.v6Tiny, preprocessing, prediction })
    const blob = new Blob(['image'], { type: 'image/jpeg' })
    predictMock.mockResolvedValue([{ image: { width: 100, height: 200 },
      metrics: { detMs: 100, recMs: 50, detectedBoxes: 2, recognizedCount: 1 },
      items: [{ text: 'Trans Fat Og', score: 0.99, poly: [[1, 2], [50, 2], [50, 12], [1, 12]] }] }])

    const result = await engine.recognize(blob)
    expect(preprocessForOcr).toHaveBeenCalledWith(blob, preprocessing)
    expect(predictMock).toHaveBeenCalledWith(blob, { ...PADDLE_PREDICTION_DEFAULTS, ...prediction })
    expect(result.text).toBe('Trans Fat Og')
    expect(result.preprocessing).toBe('test-color')
    expect(result.diagnostics).toMatchObject({
      timing: { detectionMs: 100, textRecognitionMs: 50 },
      provider: { predictionSettings: prediction, detectedBoxes: 2, recognizedCount: 1 },
    })
    await engine.terminate()
  })
})
