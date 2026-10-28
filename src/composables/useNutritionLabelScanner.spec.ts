import { defineComponent, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { useNutritionLabelScanner } from './useNutritionLabelScanner'
import type { NutritionLabelOcrEngine } from '@/services/ocr/NutritionLabelOcrEngine'
import type { OcrResult } from '@/services/ocr/types'

function mountScanner(result: OcrResult, automatic = false) {
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
        scanner = useNutritionLabelScanner(engine, { automatic })
        return () => null
      },
    }),
  )
  scanner.quality.analyze = vi.fn().mockResolvedValue(undefined)
  return { scanner, engine, wrapper }
}

describe('scanner state flow', () => {
  it('automatically reads a full image and reads a confirmed recovery crop again', async () => {
    const result = { text: 'Protein 3g', lines: [{ text: 'Protein 3g', bbox: { x: 0, y: 0, width: 100, height: 30 } }], engine: 'mock' }
    const { scanner, engine, wrapper } = mountScanner(result, true)
    const file = new File(['image'], 'label.png', { type: 'image/png' })
    await scanner.selectImage(file)
    expect(engine.recognize).toHaveBeenCalledWith(file)
    expect(scanner.stage.value).toBe('complete')
    expect(scanner.croppedBlob.value).toBeNull()
    scanner.editCrop()
    const blob = new Blob(['crop'])
    await scanner.confirmCrop({ blob, coordinates: { x: 0, y: 0, width: 100, height: 200, rotate: 0, scaleX: 1, scaleY: 1 } })
    expect(engine.recognize).toHaveBeenLastCalledWith(blob)
    expect(scanner.stage.value).toBe('complete')
    wrapper.unmount()
  })

  it('serializes automatic replacements and ignores a late reading from the previous photo', async () => {
    const result = { text: 'Protein 3g', lines: [{ text: 'Protein 3g', bbox: { x: 0, y: 0, width: 100, height: 30 } }], engine: 'mock' }
    const { scanner, engine, wrapper } = mountScanner(result, true)
    let finish!: (result: OcrResult) => void
    vi.mocked(engine.recognize).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const first = scanner.selectImage(new File(['old'], 'old.png', { type: 'image/png' }))
    await nextTick()
    scanner.removeImage()
    const replacement = new File(['new'], 'new.png', { type: 'image/png' })
    const second = scanner.selectImage(replacement)
    await nextTick()
    expect(engine.recognize).toHaveBeenCalledTimes(1)
    finish({ text: 'obsolete', lines: [], engine: 'mock' })
    await Promise.all([first, second])
    expect(engine.recognize).toHaveBeenLastCalledWith(replacement)
    expect(scanner.result.value?.text).toBe(result.text)
    expect(scanner.stage.value).toBe('complete')
    wrapper.unmount()
  })

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

  it('ignores an old OCR completion after the image is removed or replaced', async () => {
    const oldResult = { text: 'Old label', lines: [], engine: 'mock' }
    const { scanner, engine, wrapper } = mountScanner(oldResult)
    let finish!: (result: OcrResult) => void
    vi.mocked(engine.recognize).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    await scanner.confirmCrop({ blob: new Blob(['old']), coordinates: { x: 0, y: 0, width: 400, height: 600, rotate: 0, scaleX: 1, scaleY: 1 } })
    const recognition = scanner.recognize()
    scanner.removeImage()
    await scanner.selectImage(new File(['new'], 'new.png', { type: 'image/png' }))
    finish(oldResult)
    await recognition
    expect(scanner.stage.value).toBe('cropping')
    expect(scanner.result.value).toBeNull()
    expect(scanner.error.value).toBeNull()
    expect(scanner.ocrBusy.value).toBe(false)
    wrapper.unmount()
  })

  it('prevents scanning an old crop while the user adjusts geometry', async () => {
    const { scanner, engine, wrapper } = mountScanner({ text: '', lines: [], engine: 'mock' })
    await scanner.selectImage(new File(['image'], 'label.png', { type: 'image/png' }))
    await scanner.confirmCrop({ blob: new Blob(['crop']), coordinates: { x: 0, y: 0, width: 400, height: 600, rotate: 0, scaleX: 1, scaleY: 1 } })
    scanner.editCrop()
    expect(scanner.canRecognize.value).toBe(false)
    await scanner.recognize()
    expect(engine.recognize).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
