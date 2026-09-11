<script setup lang="ts">
import type { NutritionExtraction } from '@/services/nutrition/parseNutrition'

defineProps<{ extraction: NutritionExtraction }>()
defineEmits<{ copy: [value: string, successMessage: string] }>()
</script>

<template>
  <section class="mb-6" aria-labelledby="nutrition-result-heading">
    <div class="d-flex flex-wrap align-center justify-space-between ga-2 mb-3">
      <h3 id="nutrition-result-heading" class="text-subtitle-1 font-weight-bold">Nutrition JSON · review required</h3>
      <v-btn variant="outlined" prepend-icon="mdi-code-json" @click="$emit('copy', JSON.stringify(extraction.data, null, 2), 'Nutrition JSON copied')">
        Copy nutrition JSON
      </v-btn>
    </div>
    <v-alert type="warning" variant="tonal" density="compact" class="mb-3">
      Experimental extraction. Compare every value with the image before using it. Null means missing or ambiguous, not zero.
      Raw OCR is unchanged; diagnostics include the matched source lines and review warnings.
    </v-alert>
    <pre class="nutrition-json" aria-label="Extracted nutrition JSON">{{ JSON.stringify(extraction.data, null, 2) }}</pre>
    <details v-if="extraction.issues.length" class="mt-3">
      <summary>{{ extraction.issues.length }} extraction warnings</summary>
      <ul class="pl-5 mt-2">
        <li v-for="(issue, index) in extraction.issues" :key="index" class="text-body-2 mb-1">
          <strong>{{ issue.field }}</strong>: {{ issue.message }}
        </li>
      </ul>
    </details>
  </section>
</template>

<style scoped>
.nutrition-json {
  background: #f3f5f4;
  border: 1px solid #dce4df;
  border-radius: 8px;
  padding: 16px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 480px;
  overflow: auto;
  font-size: 13px;
}
summary { cursor: pointer; }
</style>
