<script setup lang="ts">
import { imageToPane, paneToImage, type InspectionView, type Point, type Size } from './inspection-geometry'
import type { Effect } from './recipe'

type Bulge = Extract<Effect, { kind: 'bulge' }>
const props = defineProps<{ points: Bulge[]; selectedId: string | null; view: InspectionView; pane: Size; image: Size }>()
const emit = defineEmits<{ select: [id: string]; change: [id: string, x: number, y: number]; delete: [id: string]; gestureBegin: []; gestureEnd: [] }>()
let dragging: number | null = null
function center(point: Bulge): Point { return imageToPane(props.view, { x: point.x * (props.image.width - 1), y: point.y * (props.image.height - 1) }, props.pane) }
function normalized(event: PointerEvent): Point {
  const stage = (event.currentTarget as HTMLElement).closest('.preview-stage')
  const bounds = stage?.getBoundingClientRect()
  const panePoint = { x: event.clientX - (bounds?.left ?? 0), y: event.clientY - (bounds?.top ?? 0) }
  const imagePoint = paneToImage(props.view, panePoint, props.pane)
  return { x: Math.max(0, Math.min(1, imagePoint.x / Math.max(1, props.image.width - 1))), y: Math.max(0, Math.min(1, imagePoint.y / Math.max(1, props.image.height - 1))) }
}
function pointerDown(event: PointerEvent, id: string): void {
  if (event.button !== 0) return
  event.stopPropagation()
  emit('select', id)
  emit('gestureBegin')
  dragging = event.pointerId
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}
function pointerMove(event: PointerEvent, id: string): void {
  if (dragging !== event.pointerId) return
  event.stopPropagation()
  const point = normalized(event)
  emit('change', id, point.x, point.y)
}
function pointerEnd(event: PointerEvent): void {
  if (dragging !== event.pointerId) return
  event.stopPropagation()
  dragging = null
  emit('gestureEnd')
}
function keydown(event: KeyboardEvent, point: Bulge): void {
  if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); emit('delete', point.id); return }
  const step = event.shiftKey ? 0.1 : 0.01
  const delta = event.key === 'ArrowLeft' ? [-step, 0] : event.key === 'ArrowRight' ? [step, 0] : event.key === 'ArrowUp' ? [0, -step] : event.key === 'ArrowDown' ? [0, step] : null
  if (!delta) return
  event.preventDefault()
  event.stopPropagation()
  emit('change', point.id, Math.max(0, Math.min(1, point.x + delta[0]!)), Math.max(0, Math.min(1, point.y + delta[1]!)))
}
</script>

<template>
  <div class="bulge-overlay" aria-label="Distortion points">
    <div v-for="(point, index) in points" :key="point.id" class="bulge-point" :style="{ left: `${center(point).x}px`, top: `${center(point).y}px` }">
      <div class="bulge-radius" :style="{ width: `${point.radius * Math.min(image.width, image.height) * view.scale * 2}px`, height: `${point.radius * Math.min(image.width, image.height) * view.scale * 2}px` }"></div>
      <button type="button" class="bulge-handle" :class="{ selected: selectedId === point.id }" :aria-label="`Distortion point ${index + 1}, ${point.strength >= 0 ? 'bulge' : 'pinch'}`" :aria-pressed="selectedId === point.id" @click.stop="emit('select', point.id)" @pointerdown="pointerDown($event, point.id)" @pointermove="pointerMove($event, point.id)" @pointerup="pointerEnd" @pointercancel="pointerEnd" @lostpointercapture="pointerEnd" @keydown="keydown($event, point)">{{ index + 1 }}</button>
    </div>
  </div>
</template>
