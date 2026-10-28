<script setup lang="ts">
import { computed } from 'vue'
import ScannerImagePicker from '@/components/scanner/ScannerImagePicker.vue'
import ScannerCropper from '@/components/scanner/ScannerCropper.vue'
import AssessmentResults from '@/components/assessment/AssessmentResults.vue'
import AssessmentValueEditor from '@/components/assessment/AssessmentValueEditor.vue'
import { useLabelAssessment } from '@/composables/useLabelAssessment'

const { scanner, extraction, draft, portion, customMultiplier, references, referenceError, referenceLoading,
  editing, options, assessment, resetEdits, fetchReferences, selectImage, reset, enterManually } = useLabelAssessment()
const busy = computed(() => scanner.ocrBusy.value || scanner.quality.isAnalyzing.value)
const progressText = computed(() => scanner.quality.isAnalyzing.value ? 'Preparing your photo…'
  : scanner.progress.value.state === 'initializing' ? 'Getting the label reader ready…' : 'Reading your nutrition label…')
</script>

<template>
  <v-container class="assessment-container py-7 py-md-10">
    <template v-if="!scanner.hasImage.value && !draft">
      <v-alert v-if="scanner.error.value" type="error" variant="tonal" class="mb-5" role="alert">{{ scanner.error.value }}</v-alert>
      <section class="assessment-intro">
        <h1>Understand your nutrition label</h1>
        <p>Take a photo to see calories, nutrients, and what to watch for.</p>
      </section>
      <section class="assessment-section upload-section" aria-labelledby="upload-heading">
        <div class="upload-icon"><v-icon icon="mdi-nutrition" size="42" /></div>
        <h2 id="upload-heading">Add a nutrition label photo</h2>
        <p class="text-body-1 text-medium-emphasis mt-2 mb-6">Include the serving size and the whole nutrition table.</p>
        <ScannerImagePicker @selected="selectImage" />
        <p class="section-note">Your photo is read on your device. It isn’t uploaded.</p>
      </section>
      <div class="photo-tips">
        <div><v-icon icon="mdi-lightbulb-outline" /><span>Use even light without glare.</span></div>
        <div><v-icon icon="mdi-focus-field" /><span>Keep small numbers sharp and readable.</span></div>
        <div><v-icon icon="mdi-crop" /><span>You can crop or straighten after scanning.</span></div>
      </div>
    </template>

    <template v-else>
      <div class="assessment-page-heading">
        <div><h1>{{ draft ? 'Your nutrition assessment' : 'Read your nutrition label' }}</h1><p class="text-body-2 text-medium-emphasis mt-2">{{ draft?.servingSize ? `Serving size: ${draft.servingSize}` : 'Readings from your label photo' }}<span v-if="draft?.servingsPerContainer"> · {{ draft.servingsPerContainer }} servings per container</span></p></div>
        <v-btn variant="outlined" prepend-icon="mdi-refresh" @click="reset">Scan another label</v-btn>
      </div>

      <v-alert v-if="scanner.error.value" type="error" variant="tonal" class="mb-5" role="alert">
        {{ scanner.error.value }}
        <div class="d-flex flex-wrap ga-2 mt-3">
          <v-btn v-if="scanner.canRecognize.value" size="small" variant="outlined" @click="scanner.recognize">Retry reading</v-btn>
          <v-btn v-if="!draft && !busy" size="small" variant="text" @click="enterManually">Enter values manually</v-btn>
        </div>
      </v-alert>

      <section v-if="busy" class="assessment-section reading-progress" role="status" aria-live="polite">
        <v-progress-circular indeterminate color="primary" size="40" width="3" />
        <div><h2>{{ progressText }}</h2><p class="text-body-2 text-medium-emphasis mt-2">The first scan downloads the reader and can take a little longer.</p></div>
      </section>

      <section v-if="scanner.stage.value === 'cropping' && scanner.originalUrl.value" class="assessment-section">
        <h2 class="mb-2">Choose the nutrition panel</h2>
        <p class="text-body-2 text-medium-emphasis mb-5">Include serving details and all nutrient rows. Confirming the crop reads it again.</p>
        <ScannerCropper :src="scanner.originalUrl.value" :initial-coordinates="scanner.cropCoordinates.value" @confirm="scanner.confirmCrop" @error="scanner.reportError" />
      </section>

      <template v-else>
        <div v-if="scanner.hasImage.value && !busy" class="assessment-actions mb-5">
          <v-btn v-if="draft" variant="outlined" prepend-icon="mdi-pencil-outline" :aria-expanded="editing" @click="editing = !editing">{{ editing ? 'Hide editing' : 'Check/edit values' }}</v-btn>
          <v-btn variant="text" prepend-icon="mdi-crop-rotate" @click="scanner.editCrop">Crop or straighten photo</v-btn>
        </div>
        <v-alert v-if="draft" type="info" variant="tonal" density="compact" class="mb-5">Check the readings against your photo. Missing or uncertain values may leave part of the assessment unavailable.</v-alert>
        <v-alert v-if="draft?.basis === 'unknown'" type="warning" variant="tonal" class="mb-5">Confirm whether the amounts are per serving, per 100 g, or per 100 mL in <strong>Check label values</strong> to enable assessments.</v-alert>
        <details v-if="scanner.quality.warnings.value.length && !busy" class="quality-advice mb-5">
          <summary>Photo tips that may improve this reading</summary>
          <p v-for="warning in scanner.quality.warnings.value" :key="warning.code" class="text-body-2 mt-2">{{ warning.message }}</p>
        </details>

        <div :class="{ 'assessment-review-grid': editing && scanner.originalUrl.value }">
          <details v-if="scanner.originalUrl.value" :open="editing || !draft" class="assessment-photo mb-5">
            <summary>View label photo</summary>
            <img :src="scanner.croppedUrl.value ?? scanner.originalUrl.value" alt="Your nutrition label photo, for checking extracted values" />
          </details>
          <AssessmentValueEditor v-if="editing && draft" v-model="draft" :extraction="extraction" @reset="resetEdits" @close="editing = false" />
        </div>

        <template v-if="assessment">
          <div class="portion-controls">
            <v-btn-toggle v-model="portion" mandatory color="primary" variant="outlined" density="comfortable" aria-label="Nutrition portion">
              <v-btn v-for="option in options" :key="option.value" :value="option.value">{{ option.title }}</v-btn>
            </v-btn-toggle>
            <v-text-field v-if="portion === 'custom'" v-model="customMultiplier" label="Multiple of label amount" inputmode="decimal" variant="outlined" density="compact" hide-details class="custom-portion" />
          </div>
          <v-alert v-if="assessment.factor === null" type="warning" variant="tonal" class="mb-5">Enter a positive portion multiplier to calculate amounts.</v-alert>
          <v-alert v-if="referenceError" type="warning" variant="tonal" class="mb-5">
            {{ referenceError }}
            <v-btn variant="text" size="small" :loading="referenceLoading" @click="fetchReferences(true)">Retry daily references</v-btn>
          </v-alert>
          <p v-if="referenceLoading" role="status" class="text-body-2 text-medium-emphasis mb-4">Loading daily references…</p>
          <AssessmentResults :assessment="assessment" :references="references" />
        </template>
      </template>
    </template>
  </v-container>
</template>
