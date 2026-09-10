import { canvasToBlob, loadImage } from '@/utils/image'

export const OCR_PREPROCESSING_VARIANT = 'grayscale-contrast-sharpen-v1'

function percentileFromHistogram(histogram: Uint32Array, pixelCount: number, percentile: number): number {
  const target = Math.max(1, Math.round(pixelCount * percentile))
  let seen = 0
  for (let value = 0; value < histogram.length; value += 1) {
    seen += histogram[value] ?? 0
    if (seen >= target) return value
  }
  return 255
}

export function enhancePixelsForOcr(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8ClampedArray {
  const pixelCount = width * height
  if (!pixelCount || pixels.length < pixelCount * 4) throw new Error('Image pixel data is incomplete.')

  const grayscale = new Uint8ClampedArray(pixelCount)
  const histogram = new Uint32Array(256)
  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 4
    const value = Math.round(
      0.2126 * (pixels[offset] ?? 0) +
        0.7152 * (pixels[offset + 1] ?? 0) +
        0.0722 * (pixels[offset + 2] ?? 0),
    )
    grayscale[index] = value
    histogram[value] = (histogram[value] ?? 0) + 1
  }

  const low = percentileFromHistogram(histogram, pixelCount, 0.01)
  const high = percentileFromHistogram(histogram, pixelCount, 0.99)
  const range = Math.max(24, high - low)
  const contrasted = new Uint8ClampedArray(pixelCount)
  for (let index = 0; index < pixelCount; index += 1) {
    contrasted[index] = Math.max(0, Math.min(255, Math.round((((grayscale[index] ?? 0) - low) * 255) / range)))
  }

  const output = new Uint8ClampedArray(pixelCount * 4)
  const sharpenAmount = 0.32
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x
      const center = contrasted[index] ?? 0
      let value = center
      if (x > 0 && x < width - 1 && y > 0 && y < height - 1) {
        value =
          center * (1 + 4 * sharpenAmount) -
          sharpenAmount *
            ((contrasted[index - 1] ?? 0) +
              (contrasted[index + 1] ?? 0) +
              (contrasted[index - width] ?? 0) +
              (contrasted[index + width] ?? 0))
      }
      const clamped = Math.max(0, Math.min(255, Math.round(value)))
      const offset = index * 4
      output[offset] = clamped
      output[offset + 1] = clamped
      output[offset + 2] = clamped
      output[offset + 3] = 255
    }
  }
  return output
}

export async function preprocessForOcr(blob: Blob): Promise<Blob> {
  const url = URL.createObjectURL(blob)
  try {
    const image = await loadImage(url)
    const scale = Math.min(1, 2400 / Math.max(image.naturalWidth, image.naturalHeight))
    const width = Math.max(1, Math.round(image.naturalWidth * scale))
    const height = Math.max(1, Math.round(image.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('Canvas preprocessing is not supported in this browser.')

    context.drawImage(image, 0, 0, width, height)
    const source = context.getImageData(0, 0, width, height)
    const enhanced = enhancePixelsForOcr(source.data, width, height)
    context.putImageData(new ImageData(enhanced, width, height), 0, 0)
    return canvasToBlob(canvas, 'image/png')
  } catch {
    throw new Error('The image could not be prepared for OCR.')
  } finally {
    URL.revokeObjectURL(url)
  }
}
