import { beforeEach, describe, expect, it, vi } from 'vitest'

const recognizeMock = vi.hoisted(() => vi.fn())
const terminateMock = vi.hoisted(() => vi.fn())
const createWorkerMock = vi.hoisted(() => vi.fn())

vi.mock('tesseract.js', () => ({
  createWorker: createWorkerMock,
}))

vi.mock('@/utils/image', () => ({
  getImageDimensions: vi.fn().mockResolvedValue({ width: 1200, height: 900 }),
}))

import { normalizeTesseractBlocks, TesseractOcrEngine } from './TesseractOcrEngine'

const blocks = [
  {
    paragraphs: [
      {
        lines: [
          {
            text: 'Sodium 120 mg',
            confidence: 94.5,
            bbox: { x0: 10, y0: 20, x1: 310, y1: 64 },
            words: [
              { text: 'Sodium', confidence: 96, bbox: { x0: 10, y0: 20, x1: 130, y1: 64 } },
              { text: '120', confidence: 93, bbox: { x0: 200, y0: 20, x1: 250, y1: 64 } },
            ],
          },
        ],
      },
    ],
  },
]

describe('Tesseract OCR adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    recognizeMock.mockResolvedValue({ data: { text: 'Sodium 120 mg\n', blocks } })
    createWorkerMock.mockResolvedValue({ recognize: recognizeMock, terminate: terminateMock })
  })

  it('normalizes lines, tokens, confidence and bounding boxes', () => {
    const lines = normalizeTesseractBlocks(blocks)

    expect(lines).toEqual([
      {
        text: 'Sodium 120 mg',
        confidence: 94.5,
        bbox: { x: 10, y: 20, width: 300, height: 44 },
        tokens: [
          { text: 'Sodium', confidence: 96, bbox: { x: 10, y: 20, width: 120, height: 44 } },
          { text: '120', confidence: 93, bbox: { x: 200, y: 20, width: 50, height: 44 } },
        ],
      },
    ])
  })

  it('returns provider-independent OCR output and initializes once', async () => {
    const engine = new TesseractOcrEngine()
    const image = new File(['image'], 'label.jpg', { type: 'image/jpeg' })

    const first = await engine.recognize(image)
    const second = await engine.recognize(image)

    expect(createWorkerMock).toHaveBeenCalledTimes(1)
    expect(recognizeMock).toHaveBeenCalledTimes(2)
    expect(first).toMatchObject({
      text: 'Sodium 120 mg',
      engine: 'tesseract.js',
      sourceSize: { width: 1200, height: 900 },
    })
    expect(second.lines).toHaveLength(1)
  })

  it('terminates the worker cleanly', async () => {
    const engine = new TesseractOcrEngine()
    await engine.initialize()
    await engine.terminate()
    expect(terminateMock).toHaveBeenCalledOnce()
  })
})
