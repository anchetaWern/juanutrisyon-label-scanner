<script setup lang="ts">
import ScannerCaptureGuidance from '@/components/scanner/ScannerCaptureGuidance.vue'
import ScannerCropper from '@/components/scanner/ScannerCropper.vue'
import ScannerImagePicker from '@/components/scanner/ScannerImagePicker.vue'
import ScannerOcrDebug from '@/components/scanner/ScannerOcrDebug.vue'
import ScannerQualityWarnings from '@/components/scanner/ScannerQualityWarnings.vue'
import { useNutritionLabelScanner } from '@/composables/useNutritionLabelScanner'
import { PADDLE_OCR_CONFIGS, PaddleOcrEngine } from '@/services/ocr/PaddleOcrEngine'

const scanner = useNutritionLabelScanner(new PaddleOcrEngine(PADDLE_OCR_CONFIGS.v6Tiny))

function progressLabel(): string {
  const status = scanner.progress.value.status
  if (!status) return 'Preparing OCR…'
  return status.charAt(0).toUpperCase() + status.slice(1)
}
</script>

<template>
  <v-container class="scanner-container py-7 py-md-10">
    <section class="hero mb-7">
      <div class="step-kicker mb-2">Photo to OCR geometry</div>
      <h1 class="text-h4 text-md-h3 font-weight-bold mb-3">Scan a nutrition label</h1>
      <p class="text-body-1 text-medium-emphasis hero-copy">
        Take a clear photo, crop the nutrition panel, and inspect the text detected on your device.
      </p>
    </section>

    <v-alert
      v-if="scanner.error.value"
      type="error"
      variant="tonal"
      closable
      class="mb-5"
      :text="scanner.error.value"
      @click:close="scanner.error.value = null"
    />

    <v-card v-if="!scanner.hasImage.value" class="scanner-card" elevation="1" border>
      <v-card-text class="pa-5 pa-md-8">
        <div class="upload-well mb-6">
          <v-icon icon="mdi-nutrition" color="primary" size="50" class="mb-3" />
          <h2 class="text-h6 font-weight-bold mb-2">Add a label photo</h2>
          <p class="text-body-2 text-medium-emphasis mb-5">JPEG, PNG, WebP, or any image format your browser supports.</p>
          <ScannerImagePicker @selected="scanner.selectImage" />
        </div>
        <ScannerCaptureGuidance />
      </v-card-text>
    </v-card>

    <template v-else>
      <v-card class="scanner-card mb-5" elevation="1" border>
        <v-card-title class="d-flex align-center flex-wrap ga-2 px-5 pt-5 px-md-7 pt-md-7">
          <div>
            <div class="step-kicker">Step 1</div>
            <h2 class="text-h6 font-weight-bold">Choose the nutrition panel</h2>
          </div>
          <v-spacer />
          <v-btn variant="text" color="error" prepend-icon="mdi-delete-outline" @click="scanner.removeImage">
            Remove
          </v-btn>
        </v-card-title>

        <v-card-text class="pa-5 pa-md-7">
          <template v-if="scanner.stage.value === 'cropping' && scanner.originalUrl.value">
            <p class="text-body-2 text-medium-emphasis mb-4">
              Drag the corners around the nutrition facts. Rotate the photo if needed, then confirm the crop.
            </p>
            <ScannerCropper
              :src="scanner.originalUrl.value"
              :initial-coordinates="scanner.cropCoordinates.value"
              @confirm="scanner.confirmCrop"
              @error="scanner.reportError"
            />
          </template>

          <template v-else-if="scanner.croppedUrl.value">
            <v-row align="center">
              <v-col cols="12" sm="5">
                <v-img :src="scanner.croppedUrl.value" max-height="320" contain rounded="lg" class="crop-preview" />
              </v-col>
              <v-col cols="12" sm="7">
                <v-alert type="success" variant="tonal" density="comfortable" class="mb-4">
                  Crop saved. The original photo is still available if you need to adjust it.
                </v-alert>
                <div class="d-flex flex-wrap ga-2">
                  <v-btn variant="outlined" color="primary" prepend-icon="mdi-crop" @click="scanner.editCrop">
                    Adjust crop
                  </v-btn>
                  <ScannerImagePicker @selected="scanner.selectImage" />
                </div>
              </v-col>
            </v-row>
          </template>
        </v-card-text>
      </v-card>

      <v-card v-if="scanner.croppedBlob.value" class="scanner-card mb-5" elevation="1" border>
        <v-card-title class="px-5 pt-5 px-md-7 pt-md-7">
          <div class="step-kicker">Step 2</div>
          <h2 class="text-h6 font-weight-bold">Check image quality</h2>
        </v-card-title>
        <v-card-text class="pa-5 pa-md-7">
          <ScannerQualityWarnings
            :warnings="scanner.quality.warnings.value"
            :metrics="scanner.quality.metrics.value"
            :loading="scanner.quality.isAnalyzing.value"
            :error="scanner.quality.error.value"
          />
          <p class="text-caption text-medium-emphasis mt-3 mb-0">These checks are advisory and never block OCR.</p>
        </v-card-text>
      </v-card>

      <v-card v-if="scanner.croppedBlob.value" class="scanner-card mb-5" elevation="1" border>
        <v-card-title class="px-5 pt-5 px-md-7 pt-md-7">
          <div class="step-kicker">Step 3</div>
          <h2 class="text-h6 font-weight-bold">Recognize label text</h2>
        </v-card-title>
        <v-card-text class="pa-5 pa-md-7">
          <v-alert type="info" variant="tonal" density="comfortable" class="mb-4">
            The first scan downloads the English OCR model and may take longer. Image processing remains browser-side.
          </v-alert>
          <div v-if="scanner.stage.value === 'recognizing'" aria-live="polite">
            <div class="d-flex align-center justify-space-between text-body-2 mb-2">
              <span>{{ progressLabel() }}</span>
              <span v-if="scanner.progress.value.progress !== undefined">
                {{ Math.round(scanner.progress.value.progress * 100) }}%
              </span>
            </div>
            <v-progress-linear
              color="primary"
              rounded
              height="8"
              :indeterminate="scanner.progress.value.progress === undefined"
              :model-value="(scanner.progress.value.progress ?? 0) * 100"
            />
          </div>
          <v-btn
            v-else
            color="primary"
            size="large"
            rounded="lg"
            prepend-icon="mdi-text-recognition"
            :disabled="!scanner.canRecognize.value"
            @click="scanner.recognize"
          >
            {{ scanner.result.value ? 'Run OCR again' : 'Start OCR' }}
          </v-btn>
        </v-card-text>
      </v-card>

      <v-card
        v-if="scanner.result.value && scanner.originalUrl.value && scanner.croppedUrl.value"
        class="scanner-card"
        elevation="1"
        border
      >
        <v-card-title class="px-5 pt-5 px-md-7 pt-md-7">
          <div class="step-kicker">Step 4 · Debug output</div>
          <h2 class="text-h6 font-weight-bold">OCR text and bounding boxes</h2>
        </v-card-title>
        <v-card-text class="pa-5 pa-md-7">
          <ScannerOcrDebug
            :original-url="scanner.originalUrl.value"
            :cropped-url="scanner.croppedUrl.value"
            :result="scanner.result.value"
          />
        </v-card-text>
      </v-card>
    </template>
  </v-container>
</template>

<style scoped>
.hero-copy {
  max-width: 680px;
}

.upload-well {
  background: linear-gradient(145deg, #f4faf7, #f9f6ed);
  border: 1px dashed #85aa9f;
  border-radius: 18px;
  padding: 42px 24px;
  text-align: center;
}

.crop-preview {
  background: #edf0ec;
}

@media (max-width: 599px) {
  .upload-well {
    padding: 30px 16px;
  }
}
</style>
