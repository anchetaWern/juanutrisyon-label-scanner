import { ref } from 'vue'
import { loadImage } from '@/utils/image'

export type ImageQualityWarningCode = 'too_small' | 'blurry' | 'too_dark' | 'too_bright' | 'glare'

export interface ImageQualityWarning {
  code: ImageQualityWarningCode
  title: string
  message: string
}

export interface ImageQualityMetrics {
  width: number
  height: number
  meanLuminance: number
  clippedDarkRatio: number
  clippedHighlightRatio: number
  laplacianVariance: number
}

const warningCopy: Record<ImageQualityWarningCode, Omit<ImageQualityWarning, 'code'>> = {
  too_small: { title: 'Image may be too small', message: 'Use a photo at least 900 px on its shortest side.' },
  blurry: { title: 'Image may be blurry', message: 'Hold the phone steady and make sure small text has crisp edges.' },
  too_dark: { title: 'Image is quite dark', message: 'Move to brighter, even lighting before scanning.' },
  too_bright: { title: 'Highlights may be blown out', message: 'Reduce direct light or exposure so white areas retain detail.' },
  glare: { title: 'Possible glare detected', message: 'Tilt the package or light slightly so reflections do not cover text.' },
}

export function calculateImageQuality(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  sourceWidth = width,
  sourceHeight = height,
): ImageQualityMetrics {
  const count = width * height
  if (!count || pixels.length < count * 4) throw new Error('Image pixel data is incomplete.')

  const gray = new Float32Array(count)
  let luminanceSum = 0
  let clippedDark = 0
  let clippedHighlight = 0

  for (let index = 0; index < count; index += 1) {
    const offset = index * 4
    const value = 0.2126 * (pixels[offset] ?? 0) + 0.7152 * (pixels[offset + 1] ?? 0) + 0.0722 * (pixels[offset + 2] ?? 0)
    gray[index] = value
    luminanceSum += value
    if (value <= 12) clippedDark += 1
    if (value >= 248) clippedHighlight += 1
  }

  let laplacianSum = 0
  let laplacianSquareSum = 0
  let laplacianCount = 0
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x
      const value =
        4 * (gray[index] ?? 0) -
        (gray[index - 1] ?? 0) -
        (gray[index + 1] ?? 0) -
        (gray[index - width] ?? 0) -
        (gray[index + width] ?? 0)
      laplacianSum += value
      laplacianSquareSum += value * value
      laplacianCount += 1
    }
  }
  const meanLaplacian = laplacianCount ? laplacianSum / laplacianCount : 0
  const laplacianVariance = laplacianCount ? laplacianSquareSum / laplacianCount - meanLaplacian ** 2 : 0

  return {
    width: sourceWidth,
    height: sourceHeight,
    meanLuminance: luminanceSum / count,
    clippedDarkRatio: clippedDark / count,
    clippedHighlightRatio: clippedHighlight / count,
    laplacianVariance,
  }
}

export function warningsFromMetrics(metrics: ImageQualityMetrics): ImageQualityWarning[] {
  const codes: ImageQualityWarningCode[] = []
  if (Math.min(metrics.width, metrics.height) < 900) codes.push('too_small')
  if (metrics.laplacianVariance < 55) codes.push('blurry')
  if (metrics.meanLuminance < 48 || metrics.clippedDarkRatio > 0.45) codes.push('too_dark')
  if (metrics.meanLuminance > 224 || metrics.clippedHighlightRatio > 0.42) codes.push('too_bright')
  if (metrics.clippedHighlightRatio > 0.08 && metrics.meanLuminance < 224) codes.push('glare')
  return codes.map((code) => ({ code, ...warningCopy[code] }))
}

async function analyzeImage(blob: Blob): Promise<ImageQualityMetrics> {
  const url = URL.createObjectURL(blob)
  try {
    const image = await loadImage(url)
    const scale = Math.min(1, 720 / Math.max(image.naturalWidth, image.naturalHeight))
    const width = Math.max(3, Math.round(image.naturalWidth * scale))
    const height = Math.max(3, Math.round(image.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('Canvas image analysis is not supported in this browser.')
    context.drawImage(image, 0, 0, width, height)
    const imageData = context.getImageData(0, 0, width, height)
    return calculateImageQuality(imageData.data, width, height, image.naturalWidth, image.naturalHeight)
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function useImageQuality() {
  const isAnalyzing = ref(false)
  const metrics = ref<ImageQualityMetrics | null>(null)
  const warnings = ref<ImageQualityWarning[]>([])
  const error = ref<string | null>(null)

  async function analyze(blob: Blob): Promise<void> {
    isAnalyzing.value = true
    error.value = null
    try {
      metrics.value = await analyzeImage(blob)
      warnings.value = warningsFromMetrics(metrics.value)
    } catch (cause) {
      metrics.value = null
      warnings.value = []
      error.value = cause instanceof Error ? cause.message : 'Image quality analysis failed.'
    } finally {
      isAnalyzing.value = false
    }
  }

  function reset(): void {
    metrics.value = null
    warnings.value = []
    error.value = null
    isAnalyzing.value = false
  }

  return { isAnalyzing, metrics, warnings, error, analyze, reset }
}
