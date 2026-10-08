import { flushPromises, mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ScannerPerspectiveEditor from './ScannerPerspectiveEditor.vue'
import { renderPerspective, suggestPanel } from '@/services/image/geometryClient'
import { homography, type PerspectiveGeometry, type Quad } from '@/services/image/perspective'

vi.mock('@/services/image/geometryClient', () => ({ renderPerspective: vi.fn(), suggestPanel: vi.fn() }))
const points: Quad = [{ x: 20, y: 10 }, { x: 280, y: 20 }, { x: 290, y: 390 }, { x: 10, y: 390 }]
function editor(geometry?: PerspectiveGeometry) {
  const canvas = document.createElement('canvas'); canvas.width = 300; canvas.height = 400
  return mount(ScannerPerspectiveEditor, { props: { source: canvas, src: 'blob:source', initialGeometry: geometry },
    global: { plugins: [createVuetify()] } })
}
const button = (wrapper: ReturnType<typeof editor>, text: string) => wrapper.findAll('button').find((b) => b.text() === text)!
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.mocked(renderPerspective).mockReset().mockResolvedValue({ blob: new Blob(['rendered'], { type: 'image/png' }), width: 280, height: 390, matrix: homography(points) })
  vi.mocked(suggestPanel).mockReset().mockResolvedValue({ corners: points.map((p) => ({ ...p })) as Quad, score: .8, version: 'test' })
})
afterEach(() => vi.unstubAllGlobals())

describe('four-corner review workflow', () => {
  it('requires a preview, invalidates it after edits and emits geometry with a confirmed crop', async () => {
    const wrapper = editor()
    expect(button(wrapper, 'Use straightened crop').attributes('disabled')).toBeDefined()
    await button(wrapper, 'Suggest panel edges').trigger('click'); await flushPromises()
    await button(wrapper, 'Preview straightened label').trigger('click'); await flushPromises()
    expect(button(wrapper, 'Use straightened crop').attributes('disabled')).toBeUndefined()
    await wrapper.find('.corner-handle').trigger('keydown', { key: 'ArrowRight', shiftKey: true })
    expect(button(wrapper, 'Use straightened crop').attributes('disabled')).toBeDefined()
    await button(wrapper, 'Preview straightened label').trigger('click'); await flushPromises()
    await button(wrapper, 'Use straightened crop').trigger('click'); await flushPromises()
    const [blob, geometry] = wrapper.emitted('confirm')![0]!
    expect((blob as Blob).type).toBe('image/png')
    expect(geometry).toMatchObject({ coordinateSpace: 'rendered-rectangular-crop', sourceSize: { width: 300, height: 400 },
      outputSize: { width: 280, height: 390 }, selection: 'adjusted-suggestion', corners: [{ x: 30, y: 10 }, points[1], points[2], points[3]] })
    wrapper.unmount()
  })

  it('restores saved points without reusing a previous preview and permits manual fallback', async () => {
    const geometry: PerspectiveGeometry = { version: 'four-corner-v1', coordinateSpace: 'rendered-rectangular-crop',
      sourceSize: { width: 300, height: 400 }, outputSize: { width: 280, height: 390 }, corners: points,
      outputToSource: homography(points), selection: 'manual', suggestionScore: null }
    const wrapper = editor(geometry)
    expect(wrapper.find('polygon').attributes('points')).toBe('20,10 280,20 290,390 10,390')
    expect(button(wrapper, 'Use straightened crop').attributes('disabled')).toBeDefined()
    vi.mocked(suggestPanel).mockResolvedValueOnce(null)
    await button(wrapper, 'Suggest panel edges').trigger('click'); await flushPromises()
    expect(wrapper.text()).toContain('No clear four-sided border')
    expect(wrapper.find('polygon').attributes('points')).toBe('20,10 280,20 290,390 10,390')
    wrapper.unmount()
  })

  it('rejects crossed corners and cancels pending work when returning to the rectangle', async () => {
    const wrapper = editor()
    vi.mocked(suggestPanel).mockResolvedValueOnce({ corners: [points[0], points[2], points[1], points[3]], score: .8, version: 'test' })
    await button(wrapper, 'Suggest panel edges').trigger('click'); await flushPromises()
    expect(button(wrapper, 'Preview straightened label').attributes('disabled')).toBeDefined()
    await button(wrapper, 'Reset corners').trigger('click')
    let resolve!: (value: Awaited<ReturnType<typeof renderPerspective>>) => void
    vi.mocked(renderPerspective).mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    await button(wrapper, 'Preview straightened label').trigger('click')
    const signal = vi.mocked(renderPerspective).mock.calls.at(-1)![3]
    await button(wrapper, 'Back to rectangle').trigger('click')
    expect(signal.aborted).toBe(true)
    resolve({ blob: new Blob(), width: 300, height: 400, matrix: homography(points) }); await flushPromises()
    expect(wrapper.emitted('confirm')).toBeUndefined()
    expect(wrapper.find('img[alt="Straightened nutrition panel preview"]').exists()).toBe(false)
    expect(wrapper.emitted('cancel')).toHaveLength(1)
    wrapper.unmount()
  })
})
