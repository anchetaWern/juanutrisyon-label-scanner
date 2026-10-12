import type { OcrBoundingBox } from '../../src/services/ocr/types'
import type { PilotResult } from '../pilot/types'

export function validBox(box: OcrBoundingBox): boolean {
  return Boolean(box) && ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(box[k as keyof OcrBoundingBox]))
    && box.x >= 0 && box.y >= 0 && box.width > 0 && box.height > 0
}
export function unionBoxes(boxes: OcrBoundingBox[]): OcrBoundingBox {
  if (!boxes.length || boxes.some((b) => !validBox(b))) throw new Error('Invalid/empty region geometry.')
  const x = Math.min(...boxes.map((b) => b.x)), y = Math.min(...boxes.map((b) => b.y))
  return { x, y, width: Math.max(...boxes.map((b) => b.x + b.width)) - x, height: Math.max(...boxes.map((b) => b.y + b.height)) - y }
}
/** Saved SDK boxes are in prepared-image coordinates, not detector tensor coordinates. */
export function mapRectangle(box: OcrBoundingBox, capture: Pick<PilotResult, 'variant' | 'geometry' | 'rectangle' | 'width' | 'height' | 'ocr'>): OcrBoundingBox {
  if (!validBox(box) || capture.variant !== 'rectangle' || capture.geometry || !capture.rectangle || !capture.ocr?.sourceSize) {
    throw new Error('Experiment A requires verified rectangle-to-source mapping; perspective is not supported in this first pass.')
  }
  const { width, height } = capture.ocr.sourceSize
  if (![width, height, capture.width, capture.height].every((n) => Number.isInteger(n) && n > 0)
    || !validBox(capture.rectangle) || box.x + box.width > width + 1 || box.y + box.height > height + 1) throw new Error('Invalid source dimensions or out-of-image OCR box.')
  return { x: capture.rectangle.x + box.x / width * capture.rectangle.width,
    y: capture.rectangle.y + box.y / height * capture.rectangle.height,
    width: box.width / width * capture.rectangle.width, height: box.height / height * capture.rectangle.height }
}
export function paddedCrop(box: OcrBoundingBox, width: number, height: number, padding = .2) {
  if (!validBox(box) || ![width, height].every((n) => Number.isInteger(n) && n > 0)
    || ![.1, .2, .3].includes(padding) || box.x >= width || box.y >= height) throw new Error('Invalid source crop.')
  const left = Math.floor(box.x - box.width * padding), top = Math.floor(box.y - box.height * padding)
  const right = Math.ceil(box.x + box.width * (1 + padding)), bottom = Math.ceil(box.y + box.height * (1 + padding))
  const x = Math.max(0, left), y = Math.max(0, top)
  return { box: { x, y, width: Math.min(width, right) - x, height: Math.min(height, bottom) - y },
    clipped: left < 0 || top < 0 || right > width || bottom > height }
}
