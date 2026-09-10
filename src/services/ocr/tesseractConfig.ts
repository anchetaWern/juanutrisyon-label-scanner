import { PSM, type Worker, type WorkerParams } from 'tesseract.js'

export interface TesseractRecognitionConfig {
  id: string
  pageSegmentationMode: PSM
  preserveInterwordSpaces: boolean
  userDefinedDpi: number
}

export const PRODUCTION_TESSERACT_CONFIG: TesseractRecognitionConfig = {
  id: 'tesseract-single-block-spacing-v2',
  pageSegmentationMode: PSM.SINGLE_BLOCK,
  preserveInterwordSpaces: true,
  userDefinedDpi: 300,
}

export function tesseractParametersForConfig(config: TesseractRecognitionConfig): Partial<WorkerParams> {
  return {
    tessedit_pageseg_mode: config.pageSegmentationMode,
    preserve_interword_spaces: config.preserveInterwordSpaces ? '1' : '0',
    user_defined_dpi: String(config.userDefinedDpi),
  }
}

export function applyTesseractConfig(worker: Worker, config: TesseractRecognitionConfig): Promise<unknown> {
  return worker.setParameters(tesseractParametersForConfig(config))
}
