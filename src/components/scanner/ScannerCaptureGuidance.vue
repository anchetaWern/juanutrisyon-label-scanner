<script setup lang="ts">
const tips = [
  'Fill the frame with the nutrition label.',
  'Avoid glare.',
  'Keep the label as flat as possible.',
  'Hold the phone steady.',
  'Make sure the text is readable.',
]
</script>

<template>
  <v-card variant="tonal" color="primary" rounded="xl">
    <v-card-text>
      <div class="d-flex align-start ga-3">
        <v-icon icon="mdi-lightbulb-outline" class="mt-1" />
        <div>
          <div class="font-weight-bold mb-2">For a clearer scan</div>
          <ul class="guidance-list text-body-2">
            <li v-for="tip in tips" :key="tip">{{ tip }}</li>
          </ul>
        </div>
      </div>
    </v-card-text>
  </v-card>
</template>

<style scoped>
.guidance-list {
  display: grid;
  gap: 4px;
  margin: 0;
  padding-left: 20px;
}
</style>
