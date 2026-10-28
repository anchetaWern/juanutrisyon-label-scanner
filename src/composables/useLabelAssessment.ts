import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useNutritionLabelScanner } from './useNutritionLabelScanner'
import { PaddleOcrEngine, PADDLE_OCR_CONFIGS } from '@/services/ocr/PaddleOcrEngine'
import type { NutritionLabelOcrEngine } from '@/services/ocr/NutritionLabelOcrEngine'
import { parseNutrition } from '@/services/nutrition/parseNutrition'
import { assessNutrition, createAssessmentDraft, portionOptions, type AssessmentDraft, type Portion } from '@/services/nutrition/assessNutrition'
import type { ReferenceSet } from '@/services/nutrition/calculations'
import { loadDailyReferences } from '@/services/references/dailyReferences'

export function useLabelAssessment(engine: NutritionLabelOcrEngine = new PaddleOcrEngine(PADDLE_OCR_CONFIGS.v6Tiny)) {
  const scanner = useNutritionLabelScanner(engine, { automatic: true })
  const extraction = computed(() => scanner.result.value ? parseNutrition(scanner.result.value) : null)
  const draft = ref<AssessmentDraft | null>(null)
  const portion = ref<Portion>('source')
  const customMultiplier = ref('1')
  const references = ref<ReferenceSet | null>(null)
  const referenceError = ref<string | null>(null)
  const referenceLoading = ref(false)
  const editing = ref(false)
  let disposed = false

  function resetEdits() {
    if (extraction.value && scanner.result.value) draft.value = createAssessmentDraft(extraction.value, scanner.result.value)
    portion.value = 'source'
    customMultiplier.value = '1'
  }
  watch(scanner.result, () => {
    if (!scanner.result.value) { draft.value = null; return }
    resetEdits()
    editing.value = draft.value?.basis === 'unknown'
  })
  const options = computed(() => draft.value ? portionOptions(draft.value) : [])
  watch(options, (next) => {
    if (!next.some((item) => item.value === portion.value)) portion.value = 'source'
  })
  const assessment = computed(() => draft.value ? assessNutrition(draft.value, references.value, portion.value, customMultiplier.value) : null)

  async function fetchReferences(force = false) {
    referenceLoading.value = true
    referenceError.value = null
    try {
      const next = await loadDailyReferences(force)
      if (!disposed) references.value = next
    } catch (cause) {
      if (!disposed) referenceError.value = cause instanceof Error ? cause.message : 'Daily references are unavailable.'
    } finally { if (!disposed) referenceLoading.value = false }
  }
  async function selectImage(file: File) {
    editing.value = false
    await scanner.selectImage(file)
  }
  function reset() {
    scanner.removeImage()
    draft.value = null
    editing.value = false
    portion.value = 'source'
  }
  function enterManually() {
    const empty = { text: '', lines: [], engine: 'manual' }
    draft.value = createAssessmentDraft(parseNutrition(empty), empty)
    editing.value = true
  }
  onMounted(() => { void fetchReferences() })
  onBeforeUnmount(() => { disposed = true })
  return { scanner, extraction, draft, portion, customMultiplier, references, referenceError, referenceLoading,
    editing, options, assessment, resetEdits, fetchReferences, selectImage, reset, enterManually }
}
