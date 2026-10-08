import { ref } from 'vue'
import { loadImage } from '@/utils/image'
import { measureCaptureDetail, type CaptureDetailMetrics } from '@/services/image/captureQuality'
import { distance, type PerspectiveGeometry } from '@/services/image/perspective'

export type ImageQualityWarningCode = 'too_small' | 'blurry' | 'too_dark' | 'too_bright' | 'glare' | 'small_text' | 'text_uncertain' | 'loose_crop' | 'tight_crop' | 'strong_perspective'

export interface ImageQualityWarning {
  code: ImageQualityWarningCode
  title: string
  message: string
}

export interface ImageQualityMetrics extends Partial<CaptureDetailMetrics> {
  width: number
  height: number
  meanLuminance: number
  clippedDarkRatio: number
  clippedHighlightRatio: number
  laplacianVariance: number
  perspectiveStretch?: number
}

const warningCopy: Record<ImageQualityWarningCode, Omit<ImageQualityWarning, 'code'>> = {
  too_small: { title: 'Move closer to the panel', message: 'The selected area has limited detail. Retake a closer photo with the whole nutrition panel in focus.' },
  blurry: { title: 'Image may be blurry', message: 'Hold the phone steady and make sure small text has crisp edges.' },
  too_dark: { title: 'Image is quite dark', message: 'Move to brighter, even lighting before scanning.' },
  too_bright: { title: 'Highlights may be blown out', message: 'Reduce direct light or exposure so white areas retain detail.' },
  glare: { title: 'Possible glare detected', message: 'Tilt the package or light slightly so reflections do not cover text.' },
  small_text: { title: 'Small text may be difficult to read', message: 'Move closer and focus on the smallest nutrient values. Enlarging this image cannot restore missing detail.' },
  text_uncertain: { title: 'Check the smallest text', message: 'There is not enough distinct text detail to assess this crop. Zoom in and check that the small digits and units are clear.' },
  loose_crop: { title: 'Crop closer to the nutrition panel', message: 'Text occupies a small part of this crop. Leave a little margin while including the serving details and every nutrient row.' },
  tight_crop: { title: 'Check the edges of the crop', message: 'Some text appears to touch an edge. Expand the crop if any row names, values, or serving details are cut off.' },
  strong_perspective: { title: 'A straighter photo may help', message: 'Part of this panel has been stretched substantially. Retake a more front-facing photo if its small text looks soft.' },
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
    ...measureCaptureDetail(gray, width, height, sourceHeight),
  }
}

export function warningsFromMetrics(metrics: ImageQualityMetrics): ImageQualityWarning[] {
  const codes: ImageQualityWarningCode[] = []
  const smallestSide = Math.min(metrics.width, metrics.height)
  if (smallestSide < 600 || (smallestSide < 900 && (metrics.estimatedTextHeightPx ?? 0) < 12)) codes.push('too_small')
  if (metrics.laplacianVariance < 55) codes.push('blurry')
  if (metrics.meanLuminance < 48 || metrics.clippedDarkRatio > 0.45) codes.push('too_dark')
  // Bright paper with distinct text is not evidence of glare or overexposure.
  if (metrics.meanLuminance > 224 && metrics.clippedHighlightRatio > .8 && (metrics.textCandidateCount ?? 0) < 12) codes.push('too_bright')
  if ((metrics.localizedHighlightRatio ?? 0) > .003) codes.push('glare')
  if (metrics.estimatedTextHeightPx !== null && metrics.estimatedTextHeightPx !== undefined && metrics.estimatedTextHeightPx < 12) codes.push('small_text')
  if (metrics.textCandidateCount !== undefined && metrics.textCandidateCount < 12) codes.push('text_uncertain')
  if ((metrics.textAreaRatio ?? 1) < .28) codes.push('loose_crop')
  if ((metrics.edgeTextCandidateCount ?? 0) >= 3) codes.push('tight_crop')
  if ((metrics.perspectiveStretch ?? 1) > 1.8) codes.push('strong_perspective')
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
  let revision = 0

  async function analyze(blob: Blob, geometry?: PerspectiveGeometry): Promise<void> {
    const current = ++revision
    isAnalyzing.value = true
    error.value = null
    metrics.value = null
    warnings.value = []
    try {
      const next = await analyzeImage(blob)
      if (current !== revision) return
      if (geometry) {
        const [a, b, c, d] = geometry.corners
        const widths = [distance(a, b), distance(d, c)], heights = [distance(a, d), distance(b, c)]
        next.perspectiveStretch = Math.max(Math.max(...widths) / Math.min(...widths), Math.max(...heights) / Math.min(...heights))
        // A large output must not hide low source resolution on the foreshortened side.
        const sourceScale = Math.min(1, Math.min(...widths) / geometry.outputSize.width, Math.min(...heights) / geometry.outputSize.height)
        if (next.estimatedTextHeightPx) next.estimatedTextHeightPx *= sourceScale
      }
      metrics.value = next
      warnings.value = warningsFromMetrics(metrics.value)
    } catch (cause) {
      if (current !== revision) return
      metrics.value = null
      warnings.value = []
      error.value = cause instanceof Error ? cause.message : 'Image quality analysis failed.'
    } finally {
      if (current === revision) isAnalyzing.value = false
    }
  }

  function reset(): void {
    revision++
    metrics.value = null
    warnings.value = []
    error.value = null
    isAnalyzing.value = false
  }

  return { isAnalyzing, metrics, warnings, error, analyze, reset }
}
