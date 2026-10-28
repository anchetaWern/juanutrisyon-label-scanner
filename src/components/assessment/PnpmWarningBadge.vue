<script setup lang="ts">
// Matches the food app's PnpmWarningBadge.vue.
import { computed } from 'vue'
const props = defineProps<{ type: string }>()
const label = computed(() => ({ 'total-fat': 'TOTAL FAT', 'saturated-fat': 'SATURATED FAT', sugar: 'SUGAR', sodium: 'SODIUM' })[props.type as 'total-fat' | 'saturated-fat' | 'sugar' | 'sodium'])
</script>

<template>
  <div class="pnpm-warning-badge" role="img" :aria-label="`High in ${label.toLowerCase()} based on the Philippine Nutrient Profile Model threshold`">
    <span>HIGH IN</span><strong>{{ label }}</strong>
  </div>
</template>
