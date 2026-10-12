<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import type { CropCoordinates } from '@/composables/useImageCrop'
import type { ImageQualityMetrics, ImageQualityWarning } from '@/composables/useImageQuality'
import { buildScannerDiagnosticReport, cropDownloadFilename } from '@/services/diagnostics/scannerDiagnostics'
import type { OcrBoundingBox, OcrResult } from '@/services/ocr/types'
import { copyText } from '@/utils/clipboard'
import { canShareBlob, saveBlob } from '@/utils/saveBlob'
import { parseNutrition } from '@/services/nutrition/parseNutrition'
import ScannerNutritionResult from './ScannerNutritionResult.vue'

const props = defineProps<{
  originalUrl: string
  croppedUrl: string
  originalFile: File
  croppedBlob: Blob
  cropCoordinates: CropCoordinates | null
  qualityMetrics: ImageQualityMetrics | null
  qualityWarnings: ImageQualityWarning[]
  result: OcrResult
}>()

const showBoxes = ref(true)
const expanded = ref<number[]>([])
const snackbarMessage = ref('')
const snackbarVisible = ref(false)
const copyError = ref<string | null>(null)
const manualCopyText = ref('')
const manualCopyField = ref<HTMLTextAreaElement | null>(null)
const cropFilename = computed(() => cropDownloadFilename(props.originalFile.name, props.croppedBlob.type))
const exportStem = computed(() => cropFilename.value.replace(/-ocr-crop\.[^.]+$/, ''))
const canShareCrop = computed(() => canShareBlob(props.croppedBlob, cropFilename.value))
const nutrition = computed(() => parseNutrition(props.result))

async function copy(value: string, successMessage: string): Promise<void> {
  copyError.value = null
  manualCopyText.value = ''
  snackbarVisible.value = false
  try {
    await copyText(value)
    snackbarMessage.value = successMessage
    snackbarVisible.value = true
  } catch {
    copyError.value = 'Copy did not complete. Select the content below and use Copy, or save the OCR JSON or diagnostics as a file.'
    manualCopyText.value = value
    await nextTick()
    selectManualCopyText()
  }
}

function selectManualCopyText(): void {
  manualCopyField.value?.focus()
  manualCopyField.value?.select()
  manualCopyField.value?.setSelectionRange(0, manualCopyText.value.length)
}

function copyRawText(): Promise<void> {
  return copy(props.result.text, 'Raw OCR text copied')
}

function copyCompleteResult(): Promise<void> {
  return copy(JSON.stringify(props.result, null, 2), 'Complete OCR result copied')
}

function diagnosticJson(): string {
  return JSON.stringify(buildScannerDiagnosticReport({
    originalFile: props.originalFile,
    croppedBlob: props.croppedBlob,
    cropCoordinates: props.cropCoordinates,
    qualityMetrics: props.qualityMetrics,
    qualityWarnings: props.qualityWarnings,
    result: props.result,
  }), null, 2)
}

function copyDiagnostics(): Promise<void> {
  return copy(diagnosticJson(), 'Scanner diagnostics copied')
}

async function exportJson(kind: 'ocr' | 'diagnostics'): Promise<void> {
  copyError.value = null
  manualCopyText.value = ''
  snackbarVisible.value = false
  const value = kind === 'ocr' ? JSON.stringify(props.result, null, 2) : diagnosticJson()
  try {
    const outcome = await saveBlob(new Blob([value], { type: 'application/json' }), `${exportStem.value}-${kind}.json`,
      kind === 'ocr' ? 'Nutrition label OCR JSON' : 'Nutrition label diagnostics')
    if (outcome === 'cancelled') return
    snackbarMessage.value = outcome === 'shared' ? 'JSON file shared' : 'JSON download or preview opened'
    snackbarVisible.value = true
  } catch {
    copyError.value = 'The browser could not save the JSON file. Select the content below and use Copy.'
    manualCopyText.value = value
    await nextTick()
    selectManualCopyText()
  }
}

async function downloadCrop(): Promise<void> {
  copyError.value = null
  try {
    const outcome = await saveBlob(props.croppedBlob, cropFilename.value, 'Nutrition label OCR crop')
    if (outcome === 'cancelled') return
    snackbarMessage.value = outcome === 'shared' ? 'Crop shared' : 'Crop download or preview opened'
    snackbarVisible.value = true
  } catch {
    copyError.value = 'The browser could not save the crop. Long-press the cropped image below and choose Save Image.'
  }
}

function boxStyle(box: OcrBoundingBox): Record<string, string> {
  const width = props.result.sourceSize?.width ?? 1
  const height = props.result.sourceSize?.height ?? 1
  return {
    left: `${(box.x / width) * 100}%`,
    top: `${(box.y / height) * 100}%`,
    width: `${(box.width / width) * 100}%`,
    height: `${(box.height / height) * 100}%`,
  }
}

const averageConfidence = computed(() => {
  const values = props.result.lines
    .map((line) => line.confidence)
    .filter((confidence): confidence is number => typeof confidence === 'number')
  if (!values.length) return null
  return values.reduce((sum, confidence) => sum + confidence, 0) / values.length
})

function confidenceLabel(confidence?: number): string {
  return confidence === undefined ? '—' : `${confidence.toFixed(1)}%`
}
</script>

<template>
  <div>
    <div class="d-flex flex-wrap align-center ga-2 mb-4">
      <v-chip color="primary" variant="tonal" prepend-icon="mdi-text-recognition">
        {{ result.engine }}<template v-if="result.engineVersion"> v{{ result.engineVersion }}</template>
      </v-chip>
      <v-chip variant="tonal">{{ result.lines.length }} lines</v-chip>
      <v-chip v-if="averageConfidence !== null" variant="tonal">
        {{ averageConfidence.toFixed(1) }}% avg. confidence
      </v-chip>
      <v-chip v-if="result.preprocessing" variant="tonal" prepend-icon="mdi-image-filter-black-white">
        Enhanced for OCR
      </v-chip>
      <v-spacer />
      <v-btn variant="outlined" prepend-icon="mdi-download" @click="downloadCrop">
        {{ canShareCrop ? 'Save / share crop' : 'Download crop' }}
      </v-btn>
      <v-btn variant="outlined" prepend-icon="mdi-code-json" @click="copyCompleteResult">
        Copy OCR JSON
      </v-btn>
      <v-btn color="primary" variant="flat" prepend-icon="mdi-clipboard-text-outline" @click="copyDiagnostics">
        Copy diagnostics
      </v-btn>
      <v-btn variant="outlined" prepend-icon="mdi-file-download-outline" @click="exportJson('ocr')">
        Save OCR JSON
      </v-btn>
      <v-btn variant="outlined" prepend-icon="mdi-file-download-outline" @click="exportJson('diagnostics')">
        Save diagnostics
      </v-btn>
    </div>

    <v-alert v-if="copyError" type="warning" variant="tonal" density="compact" class="mb-4" :text="copyError" />
    <div v-if="manualCopyText" class="manual-copy mb-4">
      <div class="d-flex align-center justify-space-between ga-2 mb-2">
        <span class="text-caption text-medium-emphasis">Long-press or use your browser’s Copy command after selecting.</span>
        <v-btn size="small" variant="outlined" prepend-icon="mdi-select-all" @click="selectManualCopyText">Select all</v-btn>
      </div>
      <textarea ref="manualCopyField" :value="manualCopyText" readonly rows="8" aria-label="Content ready for manual copying" />
    </div>
    <v-alert type="info" variant="tonal" density="compact" class="mb-4">
      Diagnostics include browser/device details, crop metadata, quality checks, OCR timings, the complete OCR result, and nutrition extraction with evidence. Image
      pixels are not copied.
    </v-alert>

    <ScannerNutritionResult :extraction="nutrition" @copy="copy" />

    <v-row>
      <v-col cols="12" md="5">
        <div class="text-subtitle-2 mb-2">Original photo</div>
        <v-img :src="originalUrl" cover max-height="240" rounded="lg" class="debug-image" />
      </v-col>
      <v-col cols="12" md="7">
        <div class="d-flex align-center justify-space-between mb-2">
          <div class="text-subtitle-2">Cropped OCR input</div>
          <v-switch v-model="showBoxes" label="Line boxes" color="primary" density="compact" hide-details inset />
        </div>
        <div class="overlay-stage">
          <img :src="croppedUrl" alt="Cropped nutrition label with OCR bounding boxes" />
          <template v-if="showBoxes">
            <div
              v-for="(line, index) in result.lines"
              :key="`${index}-${line.text}`"
              class="ocr-box"
              :style="boxStyle(line.bbox)"
              :title="line.text"
            >
              <span>{{ index + 1 }}</span>
            </div>
          </template>
        </div>
      </v-col>
    </v-row>

    <v-divider class="my-6" />

    <div class="d-flex align-center justify-space-between flex-wrap ga-2 mb-2">
      <div class="text-subtitle-1 font-weight-bold">Raw OCR text</div>
      <v-btn size="small" variant="text" color="primary" prepend-icon="mdi-content-copy" @click="copyRawText">
        Copy text
      </v-btn>
    </div>
    <pre class="raw-text">{{ result.text || 'No text returned.' }}</pre>

    <div class="text-subtitle-1 font-weight-bold mt-6 mb-2">OCR lines and geometry</div>
    <v-expansion-panels v-model="expanded" multiple variant="accordion">
      <v-expansion-panel v-for="(line, index) in result.lines" :key="`${index}-${line.text}`" :value="index">
        <v-expansion-panel-title>
          <div class="line-title">
            <span class="line-number">{{ index + 1 }}</span>
            <span class="line-text">{{ line.text }}</span>
            <span class="text-caption text-medium-emphasis">{{ confidenceLabel(line.confidence) }}</span>
          </div>
        </v-expansion-panel-title>
        <v-expansion-panel-text>
          <pre class="geometry">{{ JSON.stringify(line.bbox, null, 2) }}</pre>
          <v-table v-if="line.tokens?.length" density="compact" class="mt-3">
            <thead><tr><th>Token</th><th>Confidence</th><th>Bounding box</th></tr></thead>
            <tbody>
              <tr v-for="(token, tokenIndex) in line.tokens" :key="`${tokenIndex}-${token.text}`">
                <td>{{ token.text }}</td>
                <td>{{ confidenceLabel(token.confidence) }}</td>
                <td><code>{{ JSON.stringify(token.bbox) }}</code></td>
              </tr>
            </tbody>
          </v-table>
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>

    <v-snackbar v-model="snackbarVisible" color="success" timeout="2200">
      {{ snackbarMessage }}
    </v-snackbar>
  </div>
</template>

<style scoped>
.debug-image {
  background: #eef1ed;
}

.overlay-stage {
  background: #17201d;
  border-radius: 12px;
  display: inline-block;
  line-height: 0;
  max-height: 520px;
  max-width: 100%;
  overflow: hidden;
  position: relative;
}

.overlay-stage img {
  display: block;
  height: auto;
  max-height: 520px;
  max-width: 100%;
  width: auto;
}

.ocr-box {
  border: 2px solid #ff9f43;
  box-shadow: 0 0 0 1px rgb(0 0 0 / 22%);
  min-height: 3px;
  min-width: 3px;
  pointer-events: none;
  position: absolute;
}

.ocr-box span {
  background: #ff9f43;
  color: #17201d;
  font-size: 10px;
  font-weight: 800;
  left: -2px;
  line-height: 14px;
  padding: 0 3px;
  position: absolute;
  top: -16px;
}

.raw-text,
.geometry {
  background: #17201d;
  border-radius: 12px;
  color: #e9f3ee;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.8rem;
  line-height: 1.55;
  margin: 0;
  overflow: auto;
  padding: 16px;
  white-space: pre-wrap;
}

.manual-copy textarea {
  background: #fff;
  border: 1px solid #85aa9f;
  border-radius: 8px;
  color: #17201d;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 16px;
  padding: 12px;
  resize: vertical;
  width: 100%;
}

.geometry {
  display: inline-block;
  min-width: 220px;
}

.line-title {
  align-items: center;
  display: grid;
  gap: 10px;
  grid-template-columns: 26px minmax(0, 1fr) auto;
  min-width: 0;
  padding-right: 8px;
  width: 100%;
}

.line-number {
  align-items: center;
  background: #e9f3ee;
  border-radius: 50%;
  color: #0b6b56;
  display: flex;
  font-size: 0.72rem;
  font-weight: 700;
  height: 24px;
  justify-content: center;
  width: 24px;
}

.line-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
