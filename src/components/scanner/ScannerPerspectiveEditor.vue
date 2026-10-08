<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { renderPerspective, suggestPanel } from '@/services/image/geometryClient'
import { distance, PERSPECTIVE_VERSION, validateQuad, type PerspectiveGeometry, type Point, type Quad } from '@/services/image/perspective'

const props = defineProps<{ source: HTMLCanvasElement; src: string; initialGeometry?: PerspectiveGeometry }>()
const emit = defineEmits<{ confirm: [blob: Blob, geometry: PerspectiveGeometry]; cancel: [] }>()
const stage = ref<HTMLDivElement | null>(null)
const labels = ['Top left', 'Top right', 'Bottom right', 'Bottom left']
const fullFrame = (): Quad => [{ x: 0, y: 0 }, { x: props.source.width - 1, y: 0 },
  { x: props.source.width - 1, y: props.source.height - 1 }, { x: 0, y: props.source.height - 1 }]
const restored = props.initialGeometry?.sourceSize.width === props.source.width && props.initialGeometry?.sourceSize.height === props.source.height
  ? props.initialGeometry : undefined
const corners = ref<Quad>(restored ? restored.corners.map((p) => ({ x: p.x, y: p.y })) as Quad : fullFrame())
const selection = ref<PerspectiveGeometry['selection']>(restored?.selection ?? 'manual')
const suggestionScore = ref<number | null>(restored?.suggestionScore ?? null)
const previewUrl = ref<string | null>(null)
const busy = ref<'detect' | 'preview' | 'confirm' | null>(null)
const message = ref('Place the four corners just outside the printed panel, including the serving information and bottom row.')
const error = ref<string | null>(null)
const invalid = computed(() => validateQuad(corners.value, props.source.width, props.source.height))
const stretched = computed(() => {
  const widths = [distance(corners.value[0], corners.value[1]), distance(corners.value[3], corners.value[2])]
  const heights = [distance(corners.value[0], corners.value[3]), distance(corners.value[1], corners.value[2])]
  return Math.max(...widths) / Math.min(...widths) > 1.8 || Math.max(...heights) / Math.min(...heights) > 1.8
})
let controller: AbortController | null = null
let dragging: { index: number; pointerId: number } | null = null

function clearPreview(): void {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
  previewUrl.value = null
}
function changed(): void {
  clearPreview()
  error.value = null
  if (selection.value === 'suggested') selection.value = 'adjusted-suggestion'
}
function moveCorner(index: number, point: Point): void {
  if (busy.value) return
  corners.value[index] = { x: Math.max(0, Math.min(props.source.width - 1, point.x)), y: Math.max(0, Math.min(props.source.height - 1, point.y)) }
  changed()
}
function pointerDown(event: PointerEvent, index: number): void {
  if (busy.value || (event.pointerType === 'mouse' && event.button !== 0)) return
  event.preventDefault()
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  dragging = { index, pointerId: event.pointerId }
}
function pointerMove(event: PointerEvent): void {
  if (!dragging || event.pointerId !== dragging.pointerId || !stage.value) return
  const rect = stage.value.getBoundingClientRect()
  moveCorner(dragging.index, { x: (event.clientX - rect.left) / rect.width * (props.source.width - 1),
    y: (event.clientY - rect.top) / rect.height * (props.source.height - 1) })
}
function keyboardMove(event: KeyboardEvent, index: number): void {
  const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
  const direction = directions[event.key]
  if (!direction) return
  event.preventDefault()
  const step = event.shiftKey ? 10 : 1
  moveCorner(index, { x: corners.value[index]!.x + direction[0] * step, y: corners.value[index]!.y + direction[1] * step })
}
async function task(kind: 'detect' | 'preview' | 'confirm'): Promise<void> {
  if (busy.value || (kind !== 'detect' && invalid.value) || (kind === 'confirm' && !previewUrl.value)) return
  busy.value = kind; error.value = null
  controller = new AbortController()
  const signal = controller.signal
  try {
    if (kind === 'detect') {
      const suggestion = await suggestPanel(props.source, signal)
      if (signal.aborted) return
      if (suggestion) {
        corners.value = suggestion.corners; selection.value = 'suggested'; suggestionScore.value = suggestion.score
        clearPreview()
        message.value = 'Edges suggested. Check all four corners: package borders can look like a label. Adjust them before previewing.'
      } else message.value = 'No clear four-sided border was found. Place the corners manually around one nutrition panel.'
    } else {
      // Copy plain points: Vue reactive proxies cannot be posted to a worker.
      const points = corners.value.map((p) => ({ x: p.x, y: p.y })) as Quad
      const rendered = await renderPerspective(props.source, points, kind === 'preview' ? 960 : 2400, signal)
      if (signal.aborted) return
      if (kind === 'preview') { clearPreview(); previewUrl.value = URL.createObjectURL(rendered.blob) }
      else emit('confirm', rendered.blob, { version: PERSPECTIVE_VERSION, coordinateSpace: 'rendered-rectangular-crop',
        sourceSize: { width: props.source.width, height: props.source.height }, corners: points,
        outputSize: { width: rendered.width, height: rendered.height }, outputToSource: rendered.matrix,
        selection: selection.value, suggestionScore: suggestionScore.value })
    }
  } catch (cause) {
    if (!signal.aborted) error.value = cause instanceof Error ? cause.message : 'The image could not be processed.'
  } finally { if (!signal.aborted) busy.value = null }
}
function reset(): void { if (busy.value) return; corners.value = fullFrame(); selection.value = 'manual'; suggestionScore.value = null; changed() }
function cancel(): void { controller?.abort(); emit('cancel') }
onBeforeUnmount(() => { controller?.abort(); clearPreview() })
</script>

<template>
  <div class="perspective-editor">
    <p class="text-body-2 mb-3" aria-live="polite">{{ message }}</p>
    <div class="d-flex flex-wrap ga-2 mb-4">
      <v-btn variant="outlined" :disabled="Boolean(busy)" :loading="busy === 'detect'" @click="task('detect')">Suggest panel edges</v-btn>
      <v-btn variant="text" :disabled="Boolean(busy)" @click="reset">Reset corners</v-btn>
      <v-btn variant="text" @click="cancel">Back to rectangle</v-btn>
    </div>
    <div class="corner-workspace">
      <div ref="stage" class="corner-stage" :style="{ width: `${440 * source.width / source.height}px` }">
        <img :src="src" alt="Panel before straightening; adjust the four numbered corners" draggable="false" />
        <svg class="corner-overlay" :viewBox="`0 0 ${source.width - 1} ${source.height - 1}`" preserveAspectRatio="none" aria-hidden="true">
          <polygon :points="corners.map((p) => `${p.x},${p.y}`).join(' ')" :class="{ invalid: Boolean(invalid) }" />
        </svg>
        <button
          v-for="(point, index) in corners" :key="index" type="button" class="corner-handle"
          :aria-label="`${labels[index]} corner. Use arrow keys to move; Shift for ten pixels.`"
          :style="{ left: `${point.x / Math.max(1, source.width - 1) * 100}%`, top: `${point.y / Math.max(1, source.height - 1) * 100}%` }"
          :disabled="Boolean(busy)" @pointerdown="pointerDown($event, index)" @pointermove="pointerMove"
          @pointerup="dragging = null" @pointercancel="dragging = null" @lostpointercapture="dragging = null" @keydown="keyboardMove($event, index)"
        >
          {{ index + 1 }}
        </button>
      </div>
    </div>
    <p class="text-caption text-medium-emphasis mt-3">Drag the numbered handles. Keyboard: arrow keys; hold Shift for larger steps.</p>
    <v-alert v-if="invalid" type="warning" variant="tonal" density="compact" class="my-3" :text="invalid" />
    <v-alert v-if="stretched && !invalid" type="warning" variant="tonal" density="compact" class="my-3">
      This angle stretches part of the label considerably. A more front-facing photo will preserve small text better.
    </v-alert>
    <v-alert v-if="error" type="error" variant="tonal" density="compact" class="my-3" :text="error" />
    <div v-if="previewUrl" class="straightened-preview my-4">
      <h3 class="text-subtitle-1 font-weight-bold mb-2">Straightened preview</h3>
      <img :src="previewUrl" alt="Straightened nutrition panel preview" />
      <p class="text-body-2 mt-2">Check that every row and both value columns are visible. Curved packaging may still look bent.</p>
    </div>
    <div class="d-flex flex-wrap ga-2 mt-4">
      <v-btn variant="outlined" color="primary" :disabled="Boolean(invalid || busy)" :loading="busy === 'preview'" @click="task('preview')">Preview straightened label</v-btn>
      <v-btn color="primary" :disabled="!previewUrl || Boolean(invalid || busy)" :loading="busy === 'confirm'" @click="task('confirm')">Use straightened crop</v-btn>
    </div>
    <p v-if="busy" class="text-body-2 mt-2" role="status">{{ busy === 'detect' ? 'Looking for panel edges…' : 'Straightening the selected panel…' }}</p>
  </div>
</template>

<style scoped>
.corner-workspace { background: #17201d; border-radius: 14px; padding: 26px; display: flex; justify-content: center; }
.corner-stage { position: relative; max-width: 100%; line-height: 0; }
.corner-stage img { width: 100%; display: block; user-select: none; }
.corner-overlay { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.corner-overlay polygon { fill: rgb(48 212 165 / 10%); stroke: #40e4b2; stroke-width: 3px; vector-effect: non-scaling-stroke; }
.corner-overlay polygon.invalid { fill: rgb(255 90 80 / 15%); stroke: #ff746e; }
.corner-handle { position: absolute; transform: translate(-50%, -50%); width: 44px; height: 44px; border-radius: 50%; background: #f9fff9; color: #064b3c; border: 3px solid #0b6b56; font-weight: 800; line-height: 1; cursor: grab; touch-action: none; }
.corner-handle:focus-visible { outline: 4px solid #ffbf47; outline-offset: 3px; }
.corner-handle:active { cursor: grabbing; }
.corner-handle:disabled { opacity: .65; }
.straightened-preview img { display: block; max-width: 100%; max-height: 520px; margin: auto; }
</style>
