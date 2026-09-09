<script setup lang="ts">
import type { ImageQualityMetrics, ImageQualityWarning } from '@/composables/useImageQuality'

defineProps<{
  warnings: ImageQualityWarning[]
  metrics: ImageQualityMetrics | null
  loading?: boolean
  error?: string | null
}>()
</script>

<template>
  <div aria-live="polite">
    <v-skeleton-loader v-if="loading" type="list-item-two-line" />
    <v-alert v-else-if="error" type="warning" variant="tonal" density="comfortable" :text="error" />
    <v-alert
      v-else-if="warnings.length === 0 && metrics"
      type="success"
      variant="tonal"
      density="comfortable"
      title="Image quality looks usable"
      text="You can continue even if the label is not perfect."
    />
    <div v-else class="d-grid ga-2">
      <v-alert
        v-for="warning in warnings"
        :key="warning.code"
        type="warning"
        variant="tonal"
        density="comfortable"
        :title="warning.title"
        :text="warning.message"
      />
    </div>
    <div v-if="metrics" class="text-caption text-medium-emphasis mt-2">
      {{ metrics.width }} × {{ metrics.height }} px · brightness {{ Math.round(metrics.meanLuminance) }}/255 ·
      sharpness {{ Math.round(metrics.laplacianVariance) }}
    </div>
  </div>
</template>
