<script setup lang="ts">
import { computed, ref } from 'vue'
import type { assessNutrition } from '@/services/nutrition/assessNutrition'
import type { ReferenceSet, HighlightGroup } from '@/services/nutrition/calculations'
import { nutrientLabel } from '@/services/nutrition/assessNutrition'
import PnpmWarningBadge from './PnpmWarningBadge.vue'

const props = defineProps<{ assessment: ReturnType<typeof assessNutrition>; references: ReferenceSet | null }>()
const detailsOpen = ref(false)
const highlightHelp = ref(false)
const format = (value: number | null, digits = 2) => value === null ? 'Unavailable' : new Intl.NumberFormat('en-PH', { maximumFractionDigits: digits }).format(value)
const groups = computed(() => ['Energy', 'Macronutrients', 'Vitamins', 'Minerals', 'Other nutrients'].map((name) => ({
  name, rows: props.assessment.rows.filter((row) => row.group === name),
})).filter((group) => group.rows.length))
const warningTitle = computed(() => {
  const { highWarnings, unknownWarnings } = props.assessment
  if (highWarnings.length) return `This food exceeds ${highWarnings.length} warning ${highWarnings.length === 1 ? 'threshold' : 'thresholds'}.`
  if (unknownWarnings.length === 4) return 'Assessment unavailable due to incomplete nutrient data.'
  return unknownWarnings.length ? 'No warning detected from available data.' : 'No warning thresholds exceeded.'
})
const highlightGroups = computed(() => [
  { key: 'notable', title: 'Notable nutrients', icon: 'mdi-check-circle-outline', group: props.assessment.highlights?.notable },
  { key: 'monitor', title: 'Nutrients to monitor', icon: 'mdi-alert-circle-outline', group: props.assessment.highlights?.monitor },
])
function emptyHighlight(group?: HighlightGroup) {
  return group && group.evaluatedCount > 0 ? 'No assessed nutrients reach 20% of the daily reference for this portion.'
    : 'There is not enough complete, compatible nutrient and reference data to assess this portion.'
}
function amountText(row: ReturnType<typeof assessNutrition>['rows'][number]) {
  if (row.value !== null) return `${format(row.value)} ${row.node.unit}`
  if (!row.amount) return 'Not read'
  if (props.assessment.factor === 1) return `${row.amount} ${row.unit}`
  return 'Unavailable for this portion'
}
</script>

<template>
  <section class="assessment-section" aria-labelledby="calories-heading" data-testid="macro-summary">
    <div class="calorie-heading">
      <div><h2 id="calories-heading">{{ format(assessment.calories) }} <span v-if="assessment.calories !== null">kcal</span></h2><p class="text-body-2 text-medium-emphasis">{{ assessment.portionTitle }}</p></div>
      <div v-if="assessment.macros.find(m => m.key === 'fat')?.kcal !== null" class="text-body-2 text-medium-emphasis">Calories from fat: {{ format(assessment.macros.find(m => m.key === 'fat')?.kcal ?? null) }} kcal</div>
    </div>
    <div v-if="assessment.macroEnergy && assessment.macroEnergy > 0" class="macro-bar" role="img" aria-label="Estimated calorie contributions from carbohydrate, fat, and protein">
      <div v-for="macro in assessment.macros.filter(m => (m.percentage ?? 0) > 0)" :key="macro.key" :class="`macro-segment macro-${macro.key}`" :style="{ flexGrow: macro.percentage ?? 0 }">
        <span v-if="(macro.percentage ?? 0) >= 12">{{ format(macro.percentage, 0) }}%</span>
      </div>
    </div>
    <div class="macro-legend">
      <div v-for="macro in assessment.macros" :key="macro.key" class="macro-legend-item">
        <span :class="`macro-swatch macro-${macro.key}`" aria-hidden="true"></span>
        <div><strong>{{ macro.label }}</strong><div>{{ format(macro.amount) }}<template v-if="macro.amount !== null"> g</template><span v-if="macro.percentage !== null"> ({{ format(macro.percentage, 1) }}% of macro calories)</span></div></div>
      </div>
    </div>
    <p class="section-note">{{ assessment.macroEnergy === null ? 'A complete calorie breakdown needs carbohydrate, fat, and protein amounts.' : assessment.macroEnergy === 0 ? 'The available macros contribute zero estimated calories.' : `Estimated macro energy: ${format(assessment.macroEnergy)} kcal, using 4 kcal/g for carbs and protein and 9 kcal/g for fat. This may differ from declared label calories.` }}</p>
  </section>

  <section class="assessment-section pnpm-section" aria-labelledby="pnpm-heading" data-testid="pnpm-summary">
    <div class="section-heading"><h2 id="pnpm-heading">PNPM assessment</h2><v-btn icon="mdi-information-outline" variant="text" size="small" aria-label="How PNPM warnings are calculated" @click="detailsOpen = true" /></div>
    <p class="assessment-summary">{{ warningTitle }}</p>
    <p class="text-body-2 text-medium-emphasis mt-2">{{ assessment.unknownWarnings.length ? `${assessment.unknownWarnings.length} of 4 warnings could not be assessed. Check missing values and the nutrition column.` : 'Review the fat, saturated-fat, sugar, and sodium results for this product.' }}</p>
    <div v-if="assessment.highWarnings.length" class="pnpm-badges">
      <PnpmWarningBadge v-for="warning in assessment.highWarnings" :key="warning.nutrient" :type="warning.nutrient" />
    </div>
    <p class="section-note">Based on Philippine Nutrient Profile Model (PNPM) warning thresholds. This is an educational assessment, not an official package warning label.</p>
  </section>

  <section aria-labelledby="highlights-heading">
    <div class="section-heading"><h2 id="highlights-heading">Nutrition highlights</h2><v-btn icon="mdi-help-circle-outline" variant="text" size="small" aria-label="How nutrition highlights are selected" @click="highlightHelp = true" /></div>
    <p class="text-body-2 text-medium-emphasis mb-4">{{ assessment.portionTitle }} · % of daily reference amount</p>
    <div class="highlight-grid">
      <section v-for="item in highlightGroups" :key="item.key" :class="`assessment-section highlight-section highlight-${item.key}`">
        <h3><v-icon :icon="item.icon" size="23" class="mr-2" />{{ item.title }}</h3>
        <div v-for="nutrient in item.group?.items ?? []" :key="nutrient.name" class="highlight-item">
          <div><strong>{{ nutrientLabel(nutrient.name) }}</strong><span>{{ format(nutrient.amount) }} {{ nutrient.unit }}</span><span>{{ format(nutrient.percentage, 1) }}%</span></div>
          <v-progress-linear :model-value="Math.min(nutrient.percentage, 100)" :color="item.key === 'notable' ? 'success' : 'warning'" height="7" rounded aria-hidden="true" />
        </div>
        <p v-if="!item.group?.items.length" class="text-body-2 text-medium-emphasis mt-3">{{ emptyHighlight(item.group) }}</p>
        <p class="section-note">At least 20% of the daily reference for this portion.<template v-if="item.key === 'monitor'"> A contribution does not mean a daily limit is exceeded.</template></p>
      </section>
    </div>
  </section>

  <section class="assessment-section" aria-labelledby="nutrients-heading" data-testid="nutrient-breakdown">
    <h2 id="nutrients-heading">All nutrients</h2>
    <p class="text-body-2 text-medium-emphasis mt-2 mb-4">Daily references are for a male aged 19. Individual needs may vary.</p>
    <div class="nutrient-table-head" aria-hidden="true"><span>Nutrient</span><span>Amount</span><span>Daily reference</span></div>
    <div v-for="group in groups" :key="group.name" class="nutrient-group">
      <h3>{{ group.name }}</h3>
      <div v-for="row in group.rows" :key="row.key" class="nutrient-row">
        <div><span>{{ row.label }}</span><span v-if="row.edited" class="edited-label">Edited</span><span v-if="row.value === null && row.amount" class="nutrient-unavailable">{{ row.unit === '%' ? 'Printed label percentage' : 'Exact amount not assessed' }}</span></div>
        <span>{{ amountText(row) }}</span>
        <div><span>{{ row.percentage === null ? '—' : `${format(row.percentage, 1)}%` }}</span><v-progress-linear v-if="row.percentage !== null" :model-value="Math.min(row.percentage, 100)" :color="['sodium', 'saturated fat', 'sugar'].includes(row.name) ? 'warning' : 'primary'" height="5" rounded class="mt-1" aria-hidden="true" /></div>
      </div>
    </div>
    <p class="section-note">“Not read” means missing or unreadable, not zero. Printed label percentages use the package’s own references and are not converted into nutrient amounts.</p>
  </section>

  <section class="assessment-section source-notes" aria-labelledby="source-heading">
    <h2 id="source-heading">Source &amp; notes</h2>
    <p class="text-body-2 mt-3">Values come from your label photo and any corrections you make. Compare readings with the package before relying on the assessment.</p>
    <p class="text-body-2 mt-3">Daily percentages use Juan Nutrisyon’s combined PDRI, stored FDA, and fixed references for a male aged 19; they are not the package’s printed %DV.</p>
    <p v-if="references" class="section-note">{{ references.cached ? 'Cached references' : 'References loaded' }}: {{ new Date(references.fetchedAt).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila' }) }}. <a href="https://api.juanutrisyon.info/api/consolidated-recommended-daily-nutrient-intake?gender=male&amp;age=19" target="_blank" rel="noopener noreferrer">View daily references</a>.</p>
  </section>

  <v-dialog v-model="detailsOpen" max-width="580">
    <v-card title="PNPM assessment">
      <v-card-text>
        <p class="text-body-2 mb-5">Energy and nutrient amounts must refer to the same nutrition column. These ratios stay the same when a portion is scaled.</p>
        <div v-for="warning in assessment.warnings" :key="warning.nutrient" class="warning-detail">
          <strong>{{ warning.label }}</strong>
          <p>{{ warning.status === 'unknown' ? warning.reason : `${format(warning.value ?? null)} ${warning.unit}; threshold ≥${warning.threshold} ${warning.unit}. ${warning.status === 'high' ? 'High' : 'Not high'}.` }}</p>
        </div>
        <p class="section-note">Fat and saturated fat contribute 9 kcal/g; total sugar contributes 4 kcal/g. Sodium is assessed as mg per kcal. Declared label energy is used for these ratios.</p>
      </v-card-text>
      <v-card-actions><v-spacer /><v-btn @click="detailsOpen = false">Close</v-btn></v-card-actions>
    </v-card>
  </v-dialog>
  <v-dialog v-model="highlightHelp" max-width="560">
    <v-card title="Nutrition highlights">
      <v-card-text>
        <p>Highlights list selected nutrients contributing at least 20% of the daily reference for the displayed portion. They do not assess the food’s overall healthfulness.</p>
        <p class="mt-4">Only complete amounts with compatible units and nutrient forms are assessed. Sugar highlights remain unavailable until the reference’s sugar definition can be verified. PNPM sugar warnings are assessed separately.</p>
      </v-card-text>
      <v-card-actions><v-spacer /><v-btn @click="highlightHelp = false">Close</v-btn></v-card-actions>
    </v-card>
  </v-dialog>
</template>
