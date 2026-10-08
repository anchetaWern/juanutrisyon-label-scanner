import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { suggestPanel } from './geometryClient'

class MockWorker {
  static instances: MockWorker[] = []
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: (() => void) | null = null
  postMessage = vi.fn()
  terminate = vi.fn()
  constructor() { MockWorker.instances.push(this) }
}
function source() {
  const canvas = document.createElement('canvas')
  canvas.width = 100; canvas.height = 100
  return canvas
}
beforeEach(() => {
  MockWorker.instances = []
  vi.stubGlobal('Worker', MockWorker)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn(),
    getImageData: () => ({ data: new Uint8ClampedArray(100 * 100 * 4) }) } as unknown as CanvasRenderingContext2D)
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('geometry worker lifecycle', () => {
  it('transfers input pixels and terminates the worker after success', async () => {
    const pending = suggestPanel(source(), new AbortController().signal)
    const worker = MockWorker.instances[0]!
    const [request, transfers] = worker.postMessage.mock.calls[0]!
    expect(transfers).toEqual([request.pixels.buffer])
    worker.onmessage!({ data: { result: null } })
    expect(await pending).toBeNull()
    expect(worker.terminate).toHaveBeenCalledOnce()
  })
  it('terminates on abort and rejects already-aborted work without a worker', async () => {
    const controller = new AbortController()
    const pending = suggestPanel(source(), controller.signal)
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort(); await rejected
    expect(MockWorker.instances[0]!.terminate).toHaveBeenCalledOnce()
    await expect(suggestPanel(source(), controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(MockWorker.instances).toHaveLength(1)
  })
  it('cleans up failed and timed-out workers', async () => {
    vi.useFakeTimers()
    const pending = suggestPanel(source(), new AbortController().signal)
    const rejected = expect(pending).rejects.toThrow('took too long')
    await vi.advanceTimersByTimeAsync(30_000); await rejected
    expect(MockWorker.instances[0]!.terminate).toHaveBeenCalledOnce()
    const failed = suggestPanel(source(), new AbortController().signal)
    MockWorker.instances[1]!.onerror!()
    await expect(failed).rejects.toThrow('rectangular crop')
    expect(MockWorker.instances[1]!.terminate).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
})
