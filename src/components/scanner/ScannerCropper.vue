<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Cropper from 'cropperjs'
import 'cropperjs/dist/cropper.css'
import { canvasToBlob } from '@/utils/image'
import { normalizeCropCoordinates, type ConfirmedCrop, type CropCoordinates } from '@/composables/useImageCrop'

const props = defineProps<{
  src: string
  initialCoordinates?: CropCoordinates | null
}>()

const emit = defineEmits<{
  confirm: [crop: ConfirmedCrop]
  error: [message: string]
}>()

const imageElement = ref<HTMLImageElement | null>(null)
const isConfirming = ref(false)
let cropper: Cropper | null = null

function destroyCropper(): void {
  cropper?.destroy()
  cropper = null
}

async function createCropper(): Promise<void> {
  destroyCropper()
  await nextTick()
  if (!imageElement.value) return

  cropper = new Cropper(imageElement.value, {
    viewMode: 1,
    dragMode: 'move',
    autoCropArea: 0.86,
    responsive: true,
    restore: false,
    background: false,
    guides: true,
    center: true,
    movable: true,
    rotatable: true,
    scalable: false,
    zoomable: true,
    ready() {
      if (!props.initialCoordinates || !cropper) return
      cropper.rotateTo(props.initialCoordinates.rotate)
      cropper.setData(props.initialCoordinates)
    },
  })
}

function rotate(degrees: number): void {
  cropper?.rotate(degrees)
}

function reset(): void {
  cropper?.reset()
}

async function confirmCrop(): Promise<void> {
  if (!cropper) return
  isConfirming.value = true
  try {
    const data = cropper.getData(true)
    const canvas = cropper.getCroppedCanvas({
      maxWidth: 2400,
      maxHeight: 2400,
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'high',
      fillColor: '#ffffff',
    })
    if (!canvas) throw new Error('The crop could not be rendered.')
    const blob = await canvasToBlob(canvas)
    emit('confirm', {
      blob,
      coordinates: normalizeCropCoordinates({
        x: data.x,
        y: data.y,
        width: data.width,
        height: data.height,
        rotate: data.rotate,
        scaleX: data.scaleX,
        scaleY: data.scaleY,
      }),
    })
  } catch (error) {
    emit('error', error instanceof Error ? error.message : 'The selected area could not be cropped.')
  } finally {
    isConfirming.value = false
  }
}

watch(() => props.src, createCropper)
onMounted(createCropper)
onBeforeUnmount(destroyCropper)
</script>

<template>
  <div>
    <div class="crop-stage">
      <img ref="imageElement" :src="src" alt="Selected nutrition label ready to crop" />
    </div>
    <div class="crop-toolbar mt-4">
      <v-btn-group divided variant="outlined" color="primary" density="comfortable">
        <v-btn icon="mdi-rotate-left" aria-label="Rotate left" @click="rotate(-90)" />
        <v-btn icon="mdi-rotate-right" aria-label="Rotate right" @click="rotate(90)" />
        <v-btn icon="mdi-restore" aria-label="Reset crop" @click="reset" />
      </v-btn-group>
      <v-btn
        color="primary"
        prepend-icon="mdi-crop"
        rounded="lg"
        :loading="isConfirming"
        @click="confirmCrop"
      >
        Use this crop
      </v-btn>
    </div>
  </div>
</template>

<style scoped>
.crop-stage {
  background: #17201d;
  border-radius: 14px;
  height: min(58vh, 560px);
  min-height: 340px;
  overflow: hidden;
}

.crop-stage img {
  display: block;
  max-width: 100%;
}

.crop-toolbar {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  justify-content: space-between;
}

@media (max-width: 480px) {
  .crop-stage {
    height: 52vh;
    min-height: 300px;
  }
}
</style>
