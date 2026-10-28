import { computed, onBeforeUnmount, ref } from 'vue'
import type { ConfirmedCrop, CropCoordinates } from './useImageCrop'
import { useImageQuality } from './useImageQuality'
import type { NutritionLabelOcrEngine } from '@/services/ocr/NutritionLabelOcrEngine'
import type { OcrProgress, OcrResult } from '@/services/ocr/types'

export type ScannerStage = 'empty' | 'cropping' | 'ready' | 'recognizing' | 'complete'

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback
}

export function useNutritionLabelScanner(engine: NutritionLabelOcrEngine, options: { automatic?: boolean } = {}) {
  const originalFile = ref<File | null>(null)
  const originalUrl = ref<string | null>(null)
  const croppedBlob = ref<Blob | null>(null)
  const croppedUrl = ref<string | null>(null)
  const cropCoordinates = ref<CropCoordinates | null>(null)
  const result = ref<OcrResult | null>(null)
  const stage = ref<ScannerStage>('empty')
  const error = ref<string | null>(null)
  const progress = ref<OcrProgress>({ state: 'idle' })
  const quality = useImageQuality()
  const ocrBusy = ref(false)
  let revision = 0
  let activeRecognition: Promise<void> | null = null

  const hasImage = computed(() => Boolean(originalFile.value && originalUrl.value))
  const recognitionInput = computed(() => croppedBlob.value ?? (options.automatic ? originalFile.value : null))
  const canRecognize = computed(() => Boolean(recognitionInput.value) && !ocrBusy.value && !quality.isAnalyzing.value
    && (stage.value === 'ready' || stage.value === 'complete'))

  const unsubscribe = engine.onProgress?.((update) => {
    if (stage.value === 'recognizing') progress.value = update
  })

  function revoke(url: string | null): void {
    if (url) URL.revokeObjectURL(url)
  }

  function clearCrop(): void {
    revoke(croppedUrl.value)
    croppedBlob.value = null
    croppedUrl.value = null
    cropCoordinates.value = null
    result.value = null
  }

  async function selectImage(file: File): Promise<void> {
    error.value = null
    if (!file.type.startsWith('image/')) {
      error.value = 'Choose a supported image file (JPEG, PNG, WebP, or another browser-readable image).'
      return
    }
    if (file.size === 0) {
      error.value = 'The selected image is empty. Choose another photo.'
      return
    }

    const current = ++revision
    revoke(originalUrl.value)
    clearCrop()
    quality.reset()
    originalFile.value = file
    originalUrl.value = URL.createObjectURL(file)
    stage.value = options.automatic ? 'ready' : 'cropping'
    await quality.analyze(file)
    if (current === revision && quality.error.value) error.value = quality.error.value
    if (current === revision && options.automatic) await recognize()
  }

  async function confirmCrop(crop: ConfirmedCrop): Promise<void> {
    const current = ++revision
    error.value = null
    revoke(croppedUrl.value)
    croppedBlob.value = crop.blob
    croppedUrl.value = URL.createObjectURL(crop.blob)
    cropCoordinates.value = crop.coordinates
    result.value = null
    stage.value = 'ready'
    await quality.analyze(crop.blob, crop.coordinates.perspective)
    if (current === revision && quality.error.value) error.value = quality.error.value
    if (current === revision && options.automatic) await recognize()
  }

  function editCrop(): void {
    if (originalFile.value) {
      revision++
      result.value = null
      error.value = null
      stage.value = 'cropping'
    }
  }

  async function recognize(): Promise<void> {
    const requestedRevision = revision
    // A replaced scan may still be finishing in the worker. Serialize calls,
    // then recheck the revision rather than dropping the replacement request.
    if (activeRecognition) await activeRecognition
    if (requestedRevision !== revision) return
    if (!recognitionInput.value) {
      error.value = 'Crop the nutrition panel before starting OCR.'
      return
    }
    if (!canRecognize.value) return

    const current = revision
    ocrBusy.value = true
    error.value = null
    result.value = null
    stage.value = 'recognizing'
    const input = recognitionInput.value
    activeRecognition = (async () => {
      try {
        const nextResult = await engine.recognize(input)
        if (current !== revision) return
        result.value = nextResult
        stage.value = 'complete'
        if (!nextResult.text.trim() || nextResult.lines.length === 0) {
          error.value = 'No readable text was found. Adjust the crop or try a clearer photo.'
        }
      } catch (cause) {
        if (current !== revision) return
        error.value = errorMessage(cause, 'OCR failed. Please retry or choose another image.')
        stage.value = 'ready'
      } finally {
        ocrBusy.value = false
      }
    })()
    try { await activeRecognition } finally { activeRecognition = null }
  }

  function removeImage(): void {
    revision++
    revoke(originalUrl.value)
    clearCrop()
    originalFile.value = null
    originalUrl.value = null
    stage.value = 'empty'
    error.value = null
    progress.value = { state: 'idle' }
    quality.reset()
  }

  function reportError(message: string): void {
    error.value = message
  }

  onBeforeUnmount(() => {
    revision++
    quality.reset()
    unsubscribe?.()
    revoke(originalUrl.value)
    revoke(croppedUrl.value)
    void engine.terminate()
  })

  return {
    originalFile,
    originalUrl,
    croppedBlob,
    croppedUrl,
    cropCoordinates,
    result,
    stage,
    error,
    progress,
    quality,
    hasImage,
    canRecognize,
    ocrBusy,
    selectImage,
    confirmCrop,
    editCrop,
    recognize,
    removeImage,
    reportError,
  }
}
