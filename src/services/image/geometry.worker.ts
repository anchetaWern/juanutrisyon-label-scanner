import { detectPanel } from './detectPanel'
import { warpPerspective, type Quad } from './perspective'

export type GeometryRequest = { kind: 'detect' | 'warp'; pixels: Uint8ClampedArray; width: number; height: number; corners?: Quad; maxDimension?: number }
const scope = self as unknown as { onmessage: (event: MessageEvent<GeometryRequest>) => void; postMessage: (message: unknown, transfer?: Transferable[]) => void }
scope.onmessage = ({ data }) => {
  try {
    if (data.kind === 'detect') scope.postMessage({ result: detectPanel(data.pixels, data.width, data.height) })
    else {
      if (!data.corners) throw new Error('Select all four panel corners.')
      const result = warpPerspective(data.pixels, data.width, data.height, data.corners, data.maxDimension)
      scope.postMessage({ result }, [result.pixels.buffer])
    }
  } catch (cause) { scope.postMessage({ error: cause instanceof Error ? cause.message : 'The image could not be processed.' }) }
}
