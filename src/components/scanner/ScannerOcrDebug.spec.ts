import { flushPromises, mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ScannerOcrDebug from './ScannerOcrDebug.vue'
import { copyText } from '@/utils/clipboard'
import { saveBlob } from '@/utils/saveBlob'
import type { OcrResult } from '@/services/ocr/types'

vi.mock('@/utils/clipboard', () => ({ copyText: vi.fn() }))
vi.mock('@/utils/saveBlob', () => ({ canShareBlob: vi.fn(() => false), saveBlob: vi.fn() }))
vi.mock('@/services/diagnostics/scannerDiagnostics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/diagnostics/scannerDiagnostics')>()
  return { ...actual, buildScannerDiagnosticReport: (input: Parameters<typeof actual.buildScannerDiagnosticReport>[0]) =>
    actual.buildScannerDiagnosticReport(input, { page: { origin: 'https://test.example', pathname: '/', mode: 'test' },
      browser: { userAgent: 'test' }, device: {}, display: {}, network: {}, performance: {} }) }
})

const result: OcrResult = { text: 'Protein 6g\nVitamin D₃ 0µg', lines: [
  { text: 'Protein 6g', bbox: { x: 10, y: 100, width: 140, height: 30 } },
  { text: 'Vitamin D₃ 0µg', bbox: { x: 10, y: 150, width: 180, height: 30 } },
], engine: 'test', sourceSize: { width: 500, height: 600 } }
let wrapper: ReturnType<typeof mount>
function debug() {
  wrapper = mount(ScannerOcrDebug, { attachTo: document.body, props: {
    originalUrl: 'blob:original', croppedUrl: 'blob:crop', originalFile: new File(['source'], 'My Label.JPG', { type: 'image/jpeg' }),
    croppedBlob: new Blob(['crop'], { type: 'image/png' }), cropCoordinates: null, qualityMetrics: null, qualityWarnings: [], result,
  }, global: { plugins: [createVuetify()], stubs: {
    VImg: true,
    VSnackbar: { props: ['modelValue'], template: '<div v-if="modelValue" role="status"><slot /></div>' },
  } } })
  return wrapper
}
const button = (text: string) => wrapper.findAll('button').find((b) => b.text() === text)!
const decode = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(reader.result as string)
  reader.onerror = () => reject(reader.error)
  reader.readAsText(blob)
})

beforeEach(() => {
  vi.mocked(copyText).mockReset().mockResolvedValue(undefined)
  vi.mocked(saveBlob).mockReset().mockResolvedValue('downloaded')
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
})
afterEach(() => { wrapper?.unmount(); vi.unstubAllGlobals() })

describe('OCR and diagnostics export', () => {
  for (const label of ['Copy text', 'Copy nutrition JSON']) {
    it(`${label} still copies the requested content`, async () => {
      debug()
      await button(label).trigger('click'); await flushPromises()
      const payload = vi.mocked(copyText).mock.calls[0]![0]
      if (label === 'Copy text') expect(payload).toBe(result.text)
      else expect(JSON.parse(payload).nutrients.protein).toBe('6g')
      expect(wrapper.find('[role="status"]').text()).toContain('copied')
    })

    it(`${label} exposes/selects the exact payload when clipboard access fails`, async () => {
      vi.mocked(copyText).mockRejectedValue(new Error('blocked'))
      debug()
      await button(label).trigger('click'); await flushPromises()
      const field = wrapper.find('textarea').element
      expect(field.value).toBe(vi.mocked(copyText).mock.calls[0]![0])
      expect([field.selectionStart, field.selectionEnd]).toEqual([0, field.value.length])
      expect(wrapper.text()).toContain('Copy did not complete')
      expect(wrapper.find('[role="status"]').exists()).toBe(false)
    })
  }

  for (const [label, kind] of [['Share OCR JSON', 'ocr'], ['Share diagnostics', 'diagnostics']] as const) {
    it(`${label} shares a named JSON file without needing clipboard permission`, async () => {
      vi.mocked(saveBlob).mockResolvedValue('shared')
      vi.mocked(copyText).mockRejectedValue(new Error('blocked'))
      debug()
      await button(label).trigger('click'); await flushPromises()
      const [blob, filename] = vi.mocked(saveBlob).mock.calls[0]!
      expect(blob.type).toBe('application/json')
      expect(filename).toBe(`My-Label-${kind}.json`)
      const payload = JSON.parse(await decode(blob))
      expect(kind === 'ocr' ? payload : payload.ocr).toEqual(result)
      if (kind === 'diagnostics') expect(payload.nutrition.data.nutrients.protein).toBe('6g')
      expect(copyText).not.toHaveBeenCalled()
      expect(wrapper.find('[role="status"]').text()).toBe('JSON file shared')
      expect(wrapper.text()).not.toContain('Copy OCR JSON')
      expect(wrapper.text()).not.toContain('Copy diagnostics')
    })
  }

  it('retains selectable JSON if file export fails too', async () => {
    vi.mocked(saveBlob).mockRejectedValue(new Error('blocked'))
    debug()
    await button('Share diagnostics').trigger('click'); await flushPromises()
    expect(JSON.parse(wrapper.find('textarea').element.value).ocr).toEqual(result)
    expect(wrapper.text()).toContain('could not save the JSON file')
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
  })

  it('does not claim a file was saved when the share sheet is cancelled', async () => {
    vi.mocked(saveBlob).mockResolvedValue('cancelled')
    debug()
    await button('Share diagnostics').trigger('click'); await flushPromises()
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    expect(wrapper.find('textarea').exists()).toBe(false)
  })

  it('reports the download fallback when native file sharing is unavailable', async () => {
    debug()
    await button('Share diagnostics').trigger('click'); await flushPromises()
    expect(wrapper.find('[role="status"]').text()).toBe('JSON download or preview opened')
  })
})
