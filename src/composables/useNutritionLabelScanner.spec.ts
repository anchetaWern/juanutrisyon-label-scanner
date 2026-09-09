import { defineComponent, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { useNutritionLabelScanner } from './useNutritionLabelScanner'
import type { NutritionLabelOcrEngine } from '@/services/ocr/NutritionLabelOcrEngine'
import type { OcrResult } from '@/services/ocr/types'

function mountScanner(result: OcrResult) {
  const engine: NutritionLabelOcrEngine = {
    id: 'mock',
    initialize: vi.fn().mockResolvedValue(undefined),
    recognize: vi.fn().mockResolvedValue(result),
    terminate: vi.fn().mockResolvedValue(undefined),
  }
  let scanner!: ReturnType<typeof useNutritionLabelScanner>
  const wrapper = mount(
    defineComponent({
      setup() {
        scanner = useNutritionLabelScanner(engine)
        return () => null
      },
    }),
  )
  scanner.quality.analyze = vi.fn().mockResolvedValue(undefined)
  return { scanner, engine, wrapper }
}

describe('scanner state flow', () => {
  it('moves from a confirmed crop through OCR completion', async () => {
    const ocrResult: OcrResult = {
      text: 'Nutrition Facts',
      lines: [{ text: 'Nutrition Facts', bbox: { x: 1, y: 2, width: 30, height: 8 } }],
      engine: 'mock',
    }
    const { scanner, engine, wrapper } = mountScanner(ocrResult)

    await scanner.confirmCrop({
      blob: new Blob(['crop'], { type: 'image/jpeg' }),
      coordinates: { x: 0, y: 0, width: 400, height: 600, rotate: 0, scaleX: 1, scaleY: 1 },
    })
    expect(scanner.stage.value).toBe('ready')

    await scanner.recognize()
    expect(engine.recognize).toHaveBeenCalledOnce()
    expect(scanner.stage.value).toBe('complete')
    expect(scanner.result.value).toEqual(ocrResult)

    wrapper.unmount()
    await nextTick()
    expect(engine.terminate).toHaveBeenCalledOnce()
  })

  it('surfaces an advisory no-text error without discarding OCR output', async () => {
    const { scanner, wrapper } = mountScanner({ text: '', lines: [], engine: 'mock' })
    await scanner.confirmCrop({
      blob: new Blob(['crop'], { type: 'image/jpeg' }),
      coordinates: { x: 0, y: 0, width: 1, height: 1, rotate: 0, scaleX: 1, scaleY: 1 },
    })
    await scanner.recognize()

    expect(scanner.stage.value).toBe('complete')
    expect(scanner.error.value).toContain('No readable text')
    expect(scanner.result.value).not.toBeNull()
    wrapper.unmount()
  })
})
