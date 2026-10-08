<script setup lang="ts">
import { ref } from 'vue'
defineProps<{ disabled?: boolean }>()

const emit = defineEmits<{
  selected: [file: File]
}>()

const cameraInput = ref<HTMLInputElement | null>(null)
const uploadInput = ref<HTMLInputElement | null>(null)

function handleSelection(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) emit('selected', file)
  input.value = ''
}
</script>

<template>
  <div class="picker-actions">
    <input
      ref="cameraInput"
      class="visually-hidden"
      type="file"
      accept="image/*"
      capture="environment"
      :disabled="disabled"
      aria-label="Take a nutrition label photo"
      @change="handleSelection"
    />
    <input
      ref="uploadInput"
      class="visually-hidden"
      type="file"
      accept="image/*"
      :disabled="disabled"
      aria-label="Upload a nutrition label image"
      @change="handleSelection"
    />

    <v-btn
      color="primary"
      size="large"
      prepend-icon="mdi-camera"
      rounded="lg"
      :disabled="disabled"
      @click="cameraInput?.click()"
    >
      Take photo
    </v-btn>
    <v-btn
      color="primary"
      variant="outlined"
      size="large"
      prepend-icon="mdi-image-plus"
      rounded="lg"
      :disabled="disabled"
      @click="uploadInput?.click()"
    >
      Upload image
    </v-btn>
  </div>
</template>

<style scoped>
.picker-actions {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.visually-hidden {
  height: 1px;
  margin: -1px;
  overflow: hidden;
  padding: 0;
  position: absolute;
  width: 1px;
  clip: rect(0, 0, 0, 0);
}

@media (max-width: 480px) {
  .picker-actions {
    grid-template-columns: 1fr;
  }
}
</style>
