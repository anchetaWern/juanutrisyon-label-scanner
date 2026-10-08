<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import Cropper from 'cropperjs'
import 'cropperjs/dist/cropper.css'
import { canvasToBlob } from '@/utils/image'
import { normalizeCropCoordinates, type ConfirmedCrop, type CropCoordinates } from '@/composables/useImageCrop'
import type { PerspectiveGeometry } from '@/services/image/perspective'
import ScannerPerspectiveEditor from './ScannerPerspectiveEditor.vue'

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
const ready = ref(false)
const perspectiveSource = shallowRef<HTMLCanvasElement | null>(null)
const perspectiveUrl = ref<string | null>(null)
const lastCoordinates = ref<CropCoordinates | null>(props.initialCoordinates ?? null)
let cropper: Cropper | null = null
let generation = 0

function clearPerspective(): void {
  if (perspectiveUrl.value) URL.revokeObjectURL(perspectiveUrl.value)
  perspectiveUrl.value = null
  if (perspectiveSource.value) { perspectiveSource.value.width = 1; perspectiveSource.value.height = 1 }
  perspectiveSource.value = null
}

function destroyCropper(): void {
  cropper?.destroy()
  cropper = null
}

async function createCropper(restorePerspective = false): Promise<void> {
  const current = ++generation
  ready.value = false
  destroyCropper()
  await nextTick()
  if (!imageElement.value || current !== generation) return

  cropper = new Cropper(imageElement.value, {
    viewMode: 1,
    dragMode: 'move',
    autoCropArea: 1,
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
      if (!cropper || current !== generation) return
      ready.value = true
      if (lastCoordinates.value) {
        cropper.rotateTo(lastCoordinates.value.rotate)
        cropper.setData(lastCoordinates.value)
      }
      if (restorePerspective && lastCoordinates.value?.perspective) void enterPerspective()
    },
  })
}

function rotate(degrees: number): void {
  if (!ready.value || isConfirming.value) return
  cropper?.rotate(degrees)
  if (lastCoordinates.value) delete lastCoordinates.value.perspective
}

function reset(): void {
  if (!ready.value || isConfirming.value) return
  cropper?.reset()
  lastCoordinates.value = null
}

function captureRectangle() {
  if (!cropper) throw new Error('The crop is not ready.')
  const data = cropper.getData(true)
  const coordinates = normalizeCropCoordinates(data)
  const old = lastCoordinates.value
  const sameRectangle = old && ['x', 'y', 'width', 'height', 'rotate', 'scaleX', 'scaleY'].every((key) => old[key as keyof CropCoordinates] === coordinates[key as keyof CropCoordinates])
  if (sameRectangle && old.perspective) coordinates.perspective = old.perspective
  // Render the same rounded rectangle that is retained for reopening.
  cropper.setData(data)
  const canvas = cropper.getCroppedCanvas({ maxWidth: 2400, maxHeight: 2400, imageSmoothingEnabled: true, imageSmoothingQuality: 'high', fillColor: '#ffffff' })
  if (!canvas) throw new Error('The crop could not be rendered.')
  lastCoordinates.value = coordinates
  return canvas
}

async function enterPerspective(): Promise<void> {
  if (!ready.value || isConfirming.value) return
  isConfirming.value = true
  const current = generation
  try {
    const canvas = captureRectangle()
    cropper?.disable()
    const blob = await canvasToBlob(canvas, 'image/png')
    if (current !== generation) return
    clearPerspective()
    perspectiveSource.value = canvas
    perspectiveUrl.value = URL.createObjectURL(blob)
  } catch (cause) { if (current === generation) emit('error', cause instanceof Error ? cause.message : 'The crop could not be prepared.') }
  finally { if (current === generation) { isConfirming.value = false; cropper?.enable() } }
}

function confirmPerspective(blob: Blob, perspective: PerspectiveGeometry): void {
  if (!lastCoordinates.value) return
  emit('confirm', { blob, coordinates: { ...lastCoordinates.value, perspective } })
}

function backToRectangle(): void {
  clearPerspective()
  void createCropper()
}

async function confirmCrop(): Promise<void> {
  if (!cropper || !ready.value || isConfirming.value) return
  isConfirming.value = true
  const current = generation
  try {
    const canvas = captureRectangle()
    cropper?.disable()
    const blob = await canvasToBlob(canvas, 'image/png')
    if (current !== generation) return
    const coordinates = { ...lastCoordinates.value! }
    delete coordinates.perspective
    emit('confirm', { blob, coordinates })
  } catch (error) {
    if (current === generation) emit('error', error instanceof Error ? error.message : 'The selected area could not be cropped.')
  } finally {
    if (current === generation) { isConfirming.value = false; cropper?.enable() }
  }
}

watch(() => props.src, () => { clearPerspective(); lastCoordinates.value = props.initialCoordinates ?? null; isConfirming.value = false; void createCropper(true) })
onMounted(() => createCropper(true))
onBeforeUnmount(() => { generation++; destroyCropper(); clearPerspective() })
</script>

<template>
  <div>
    <ScannerPerspectiveEditor
      v-if="perspectiveSource && perspectiveUrl" :source="perspectiveSource" :src="perspectiveUrl"
      :initial-geometry="lastCoordinates?.perspective" @confirm="confirmPerspective" @cancel="backToRectangle"
    />
    <div v-show="!perspectiveSource" class="crop-stage">
      <img ref="imageElement" :src="src" alt="Selected nutrition label ready to crop" />
    </div>
    <div v-if="!perspectiveSource" class="crop-toolbar mt-4">
      <v-btn-group divided variant="outlined" color="primary" density="comfortable">
        <v-btn icon="mdi-rotate-left" aria-label="Rotate left" :disabled="!ready || isConfirming" @click="rotate(-90)" />
        <v-btn icon="mdi-rotate-right" aria-label="Rotate right" :disabled="!ready || isConfirming" @click="rotate(90)" />
        <v-btn icon="mdi-restore" aria-label="Reset crop" :disabled="!ready || isConfirming" @click="reset" />
      </v-btn-group>
      <v-btn variant="outlined" color="primary" prepend-icon="mdi-perspective-less" :disabled="!ready || isConfirming" @click="enterPerspective">Straighten tilted panel</v-btn>
      <v-btn
        color="primary"
        prepend-icon="mdi-crop"
        rounded="lg"
        :loading="isConfirming"
        :disabled="!ready || isConfirming"
        @click="confirmCrop"
      >
        Use this crop
      </v-btn>
    </div>
    <p v-if="!perspectiveSource" class="text-caption text-medium-emphasis mt-3">Include the serving details and bottom row with a little space around the panel. If the sides look tilted, straighten the panel before scanning.</p>
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
