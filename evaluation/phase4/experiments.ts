import type { PaddleOcrEngineConfig } from '../../src/services/ocr/PaddleOcrEngine'
import type { OcrPreprocessingConfig } from '../../src/services/image/preprocessForOcr'

// Frozen independently of production defaults so the control survives promotion.
const preprocessing: OcrPreprocessingConfig = {
  id: 'grayscale-contrast-sharpen-v1', mode: 'grayscale-contrast-sharpen',
  scale: 1, maxDimension: 2400, contrastLowPercentile: .01,
  contrastHighPercentile: .99, sharpenAmount: .32,
}
const control: PaddleOcrEngineConfig = {
  id: 'v6-tiny-recall-v2', title: 'PP-OCRv6 tiny',
  detectionModel: 'PP-OCRv6_tiny_det', recognitionModel: 'PP-OCRv6_tiny_rec',
  prediction: { textDetBoxThresh: .45 }, preprocessing,
}
function candidate(id: string, changes: Partial<OcrPreprocessingConfig>, hypothesis: string) {
  return { id, hypothesis, config: { ...control, id: `phase4-${id}`,
    preprocessing: { ...preprocessing, ...changes, id: `phase4-${id}` } } }
}
export const experiments = [
  { id: 'control', hypothesis: 'Reproduce the Phase 2 production configuration.', config: control },
  candidate('color', { mode: 'original' }, 'Preserving color avoids grayscale contrast and sharpening artifacts.'),
  candidate('contrast', { mode: 'grayscale-contrast', sharpenAmount: 0 }, 'Removing sharpening avoids halos on fine glyphs.'),
  candidate('upscale', { scale: 2 }, 'Upscaling compact crops improves detector and recognizer sampling.'),
  candidate('contrast-upscale', { mode: 'grayscale-contrast', sharpenAmount: 0, scale: 2 }, 'Upscaling without sharpening retains fine units.'),
  candidate('color-upscale', { mode: 'original', scale: 2 }, 'Upscaling color retains small colored or inverse text without enhancement artifacts.'),
]

export const selectionPolicy = {
  primaryVariant: 'rectangle', minimumAdditionalNutrients: 3,
  maximumMeanTimeRatio: 2.5, maximumP95TimeRatio: 3,
  description: 'Development only: zero provider failures; at least three more exact owner nutrient fields on rectangles; no increase in wrong nutrients or wrong serving strings on any variant; no loss of total correct nutrients across variants; rectangle mean <=2.5x and p95 <=3x control. Rank eligible candidates by rectangle nutrient recovery, then fewer wrong fields, then lower mean time. Validation requires no loss of correct rectangle nutrients or serving fields and no increase in wrong fields on any variant. Otherwise retain control.',
} as const
