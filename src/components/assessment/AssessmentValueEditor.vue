<script setup lang="ts">
import type { AssessmentDraft } from '@/services/nutrition/assessNutrition'
import { nutrientLabel } from '@/services/nutrition/assessNutrition'
import type { NutritionExtraction } from '@/services/nutrition/parseNutrition'

const draft = defineModel<AssessmentDraft>({ required: true })
defineProps<{ extraction: NutritionExtraction | null }>()
defineEmits<{ reset: []; close: [] }>()
const bases = [
  { title: 'Choose the column these amounts refer to', value: 'unknown' },
  { title: 'Per serving', value: 'serving' }, { title: 'Per 100 g', value: '100g' }, { title: 'Per 100 mL', value: '100ml' },
]
const units = ['g', 'mg', 'mcg', 'μg', 'kcal', 'kJ', '%', 'IU', 'mcg RE', 'mcg RAE', 'mcg DFE', 'mg NE', 'mg AT', 'mg α-TE']
function amountError(value: string): string {
  if (!value.trim() || /^(?:less than\s+|[<>]\s*)\d+(?:\.\d+)?$/i.test(value.trim())) return ''
  return /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim()) && Number.isFinite(Number(value)) ? '' : 'Enter a nonnegative amount or leave blank.'
}
</script>

<template>
  <section class="assessment-section value-editor" aria-labelledby="edit-heading">
    <div class="section-heading">
      <h2 id="edit-heading">Check label values</h2>
      <v-btn variant="text" size="small" @click="$emit('close')">Done</v-btn>
    </div>
    <p class="text-body-2 text-medium-emphasis mb-5">Compare with your photo. Changes update the results below. Leave unreadable amounts blank.</p>
    <v-select v-model="draft.basis" :items="bases" label="Nutrition column" variant="outlined" :hint="draft.basis === 'unknown' ? 'Choose a basis to enable assessments.' : 'Enter nutrient amounts for this column, regardless of the portion selected below.'" persistent-hint class="mb-4" />
    <div class="editor-serving-fields">
      <v-text-field v-model="draft.servingSize" label="Serving size" placeholder="e.g. 1/2 cup (30 g)" variant="outlined" hint="Include g or mL to enable portion conversions." persistent-hint />
      <v-text-field v-model="draft.servingsPerContainer" label="Servings per container" placeholder="e.g. 4" inputmode="decimal" variant="outlined" />
    </div>
    <div class="editor-readings">
      <div v-for="reading in draft.readings" :key="reading.key" class="editor-reading">
        <div class="editor-reading-label">
          <label :for="`reading-${reading.key}`">{{ nutrientLabel(reading.name) }}</label>
          <span v-if="extraction?.evidence[reading.key]" class="text-caption text-medium-emphasis">Read: {{ reading.original ?? 'unavailable' }}</span>
        </div>
        <v-text-field :id="`reading-${reading.key}`" v-model="reading.amount" :aria-label="`${nutrientLabel(reading.name)} amount`" :error-messages="amountError(reading.amount)" placeholder="Not read" variant="outlined" density="compact" hide-details="auto" />
        <v-combobox v-model="reading.unit" :items="units" :aria-label="`${nutrientLabel(reading.name)} unit`" variant="outlined" density="compact" hide-details :return-object="false" />
      </div>
    </div>
    <div class="d-flex flex-wrap ga-2 mt-5">
      <v-btn v-if="extraction" variant="text" prepend-icon="mdi-restore" @click="$emit('reset')">Restore scanned values</v-btn>
      <v-spacer />
      <v-btn color="primary" @click="$emit('close')">Done</v-btn>
    </div>
  </section>
</template>
