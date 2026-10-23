<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef } from 'vue'
import { validateDimensions, type OpenImage } from '../../shared/image'
import EffectsPanel from './EffectsPanel.vue'
import { isNeutralEffect, newRecipe, recipeSchema, type Recipe } from './recipe'
import type { WorkerRequest, WorkerResponse } from './effects-worker'
import { actualSize, fitView, imageOrigin, pan, resizeView, zoom, type InspectionView, type Point, type Size } from './inspection-geometry'

type ImageDocument = Readonly<OpenImage & { bitmap: ImageBitmap }>
type Operation = { kind: 'idle' } | { kind: 'opening' } | { kind: 'processing' } | { kind: 'exporting' }
type Notice = { kind: 'info' | 'success' | 'error'; text: string }

const document = shallowRef<ImageDocument | null>(null)
const operation = ref<Operation>({ kind: 'idle' })
const notice = ref<Notice>({ kind: 'info', text: 'Open an image to preview and export it.' })
const canvas = ref<HTMLCanvasElement | null>(null)
const originalCanvas = ref<HTMLCanvasElement | null>(null)
const stage = ref<HTMLElement | null>(null)
const pane = ref<Size>({ width: 0, height: 0 })
const view = ref<InspectionView | null>(null)
const showing = ref<'edited' | 'original'>('edited')
const recipe = ref<Recipe>(newRecipe())
const readyRevision = ref(0)
const imageVersion = ref(0)
let renderRevision = 0
let renderTimer: ReturnType<typeof setTimeout> | null = null
let hasPreview = false
const worker = new Worker(new URL('./effects-worker.ts', import.meta.url), { type: 'module' })
const busy = computed(() => operation.value.kind !== 'idle')
const controlsBusy = computed(() => operation.value.kind === 'opening' || operation.value.kind === 'exporting')
const colorNeutral = computed(() => recipe.value.effects.every(isNeutralEffect))
const dimensions = computed(() => document.value ? `${document.value.bitmap.width.toLocaleString()} × ${document.value.bitmap.height.toLocaleString()}` : 'No image yet')
const fileSize = computed(() => {
  const size = document.value?.bytes.byteLength ?? 0
  return size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`
})
const imageSize = computed<Size | null>(() => document.value ? { width: document.value.bitmap.width, height: document.value.bitmap.height } : null)
const imageStyle = computed(() => {
  if (!view.value || !imageSize.value) return {}
  const origin = imageOrigin(view.value, pane.value)
  return {
    width: `${imageSize.value.width}px`, height: `${imageSize.value.height}px`,
    transform: `translate(${origin.x}px, ${origin.y}px) scale(${view.value.scale})`
  }
})
const zoomLabel = computed(() => view.value ? `${Math.round(view.value.scale * 100)}%` : 'No image loaded')

let drag: { pointerId: number; position: Point } | null = null
let resizeObserver: ResizeObserver | null = null

function measurePane(): void {
  if (!stage.value) return
  const size = { width: stage.value.clientWidth, height: stage.value.clientHeight }
  if (size.width <= 0 || size.height <= 0) return
  pane.value = size
  if (view.value && imageSize.value) view.value = resizeView(view.value, imageSize.value, size)
}

function zoomAt(direction: 1 | -1, anchor: Point = { x: pane.value.width / 2, y: pane.value.height / 2 }): void {
  if (view.value && imageSize.value) view.value = zoom(view.value, direction, anchor, imageSize.value, pane.value)
}

function fit(): void {
  if (imageSize.value && pane.value.width > 0 && pane.value.height > 0) view.value = fitView(imageSize.value, pane.value)
}

function oneToOne(): void {
  if (view.value && imageSize.value) view.value = actualSize(view.value, imageSize.value, pane.value)
}

function pointerPosition(event: MouseEvent): Point {
  const bounds = stage.value?.getBoundingClientRect()
  return { x: event.clientX - (bounds?.left ?? 0), y: event.clientY - (bounds?.top ?? 0) }
}

function pointerDown(event: PointerEvent): void {
  if (!document.value || event.button !== 0 || !stage.value) return
  stage.value.focus()
  drag = { pointerId: event.pointerId, position: { x: event.clientX, y: event.clientY } }
  stage.value.setPointerCapture(event.pointerId)
}

function pointerMove(event: PointerEvent): void {
  if (!drag || drag.pointerId !== event.pointerId || !view.value || !imageSize.value) return
  const position = { x: event.clientX, y: event.clientY }
  view.value = pan(view.value, { x: position.x - drag.position.x, y: position.y - drag.position.y }, imageSize.value, pane.value)
  drag.position = position
}

function endDrag(): void {
  drag = null
}

function stageKeydown(event: KeyboardEvent): void {
  if (!view.value || !imageSize.value || event.ctrlKey || event.metaKey || event.altKey) return
  switch (event.key) {
    case '+': case '=': zoomAt(1); break
    case '-': case '_': zoomAt(-1); break
    case '0': fit(); break
    case '1': oneToOne(); break
    case 'ArrowLeft': view.value = pan(view.value, { x: 40, y: 0 }, imageSize.value, pane.value); break
    case 'ArrowRight': view.value = pan(view.value, { x: -40, y: 0 }, imageSize.value, pane.value); break
    case 'ArrowUp': view.value = pan(view.value, { x: 0, y: 40 }, imageSize.value, pane.value); break
    case 'ArrowDown': view.value = pan(view.value, { x: 0, y: -40 }, imageSize.value, pane.value); break
    default: return
  }
  event.preventDefault()
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : 'Something went wrong. Try again.'
}

async function openImage(): Promise<void> {
  if (busy.value) return
  operation.value = { kind: 'opening' }
  let candidate: ImageBitmap | null = null
  const previous = document.value
  const previousReadyRevision = readyRevision.value
  let previousFrame: ImageData | null = null
  let publishing = false
  try {
    const source = await window.imageBridge.openImage()
    if (source === null) return
    candidate = await createImageBitmap(new Blob([new Uint8Array(source.bytes).buffer], { type: source.mime }), { imageOrientation: 'from-image' })
    validateDimensions(candidate.width, candidate.height)
    const context = canvas.value?.getContext('2d')
    const originalContext = originalCanvas.value?.getContext('2d')
    if (!context || !canvas.value || !originalContext || !originalCanvas.value) throw new Error('The image preview is unavailable. Reopen the app and try again.')
    const prepared = window.document.createElement('canvas')
    prepared.width = candidate.width
    prepared.height = candidate.height
    const preparedContext = prepared.getContext('2d', { willReadFrequently: true })
    if (!preparedContext) throw new Error('The image preview is unavailable. Reopen the app and try again.')
    preparedContext.drawImage(candidate, 0, 0)
    const pixels = preparedContext.getImageData(0, 0, candidate.width, candidate.height)
    const workerPixels = new Uint8ClampedArray(pixels.data)
    const previewScale = Math.min(1, 1200 / Math.max(candidate.width, candidate.height))
    const candidateHasPreview = candidate.width * candidate.height > 2_000_000
    let preview: Extract<WorkerRequest, { kind: 'source' }>['preview'] = null
    if (candidateHasPreview) {
      const surface = window.document.createElement('canvas')
      surface.width = Math.max(1, Math.round(candidate.width * previewScale))
      surface.height = Math.max(1, Math.round(candidate.height * previewScale))
      const draftContext = surface.getContext('2d', { willReadFrequently: true })
      if (!draftContext) throw new Error('The image preview is unavailable. Reopen the app and try again.')
      draftContext.drawImage(candidate, 0, 0, surface.width, surface.height)
      preview = { width: surface.width, height: surface.height, pixels: draftContext.getImageData(0, 0, surface.width, surface.height).data }
    }
    const candidateDocument = { ...source, bitmap: candidate }
    const candidateRecipe = newRecipe()
    const candidateView = fitView({ width: candidate.width, height: candidate.height }, pane.value)
    if (previous) previousFrame = context.getImageData(0, 0, canvas.value.width, canvas.value.height)
    const request: WorkerRequest = { kind: 'source', sourceId: imageVersion.value + 1, width: candidate.width, height: candidate.height, pixels: workerPixels, preview }
    publishing = true
    readyRevision.value = -1
    originalCanvas.value.width = candidate.width
    originalCanvas.value.height = candidate.height
    originalContext.putImageData(pixels, 0, 0)
    canvas.value.width = candidate.width
    canvas.value.height = candidate.height
    context.putImageData(pixels, 0, 0)
    worker.postMessage(request, preview ? [workerPixels.buffer, preview.pixels.buffer] : [workerPixels.buffer])
    document.value = candidateDocument
    recipe.value = candidateRecipe
    renderRevision += 1
    readyRevision.value = renderRevision
    if (renderTimer) clearTimeout(renderTimer)
    hasPreview = candidateHasPreview
    showing.value = 'edited'
    endDrag()
    view.value = candidateView
    imageVersion.value += 1
    candidate = null
    previous?.bitmap.close()
    notice.value = { kind: 'success', text: `${source.name} is ready. Your original stays untouched.` }
  } catch (error) {
    if (publishing && previous && previousFrame && canvas.value && originalCanvas.value) {
      try {
        originalCanvas.value.width = previous.bitmap.width
        originalCanvas.value.height = previous.bitmap.height
        const originalContext = originalCanvas.value.getContext('2d')
        if (!originalContext) throw new Error('The original image preview could not be restored.')
        originalContext.drawImage(previous.bitmap, 0, 0)
        canvas.value.width = previousFrame.width
        canvas.value.height = previousFrame.height
        const context = canvas.value.getContext('2d')
        if (!context) throw new Error('The current image preview could not be restored.')
        context.putImageData(previousFrame, 0, 0)
        readyRevision.value = previousReadyRevision
      } catch {
        notice.value = { kind: 'error', text: 'The new image could not be opened and the preview could not be restored. Reopen your previous image to continue.' }
        return
      }
    }
    notice.value = { kind: 'error', text: describeError(error) }
  } finally {
    candidate?.close()
    operation.value = { kind: 'idle' }
  }
}

function changeRecipe(settings: Recipe): void {
  const source = document.value
  if (!source || controlsBusy.value) return
  const accepted = recipeSchema.parse(settings)
  const revision = ++renderRevision
  recipe.value = accepted
  operation.value = { kind: 'processing' }
  notice.value = { kind: 'info', text: 'Processing effects…' }
  if (renderTimer) clearTimeout(renderTimer)
  if (hasPreview) {
    const previewRequest: WorkerRequest = { kind: 'render', sourceId: imageVersion.value, revision, recipe: accepted, quality: 'preview' }
    worker.postMessage(previewRequest)
  }
  renderTimer = setTimeout(() => {
    if (revision !== renderRevision || document.value !== source) return
    const request: WorkerRequest = { kind: 'render', sourceId: imageVersion.value, revision, recipe: accepted, quality: 'full' }
    worker.postMessage(request)
  }, 100)
}

worker.onmessage = (event: MessageEvent<WorkerResponse>): void => {
  const result = event.data
  if (result.sourceId !== imageVersion.value || result.revision !== renderRevision || !document.value) return
  if (result.kind === 'failed') {
    if (result.quality === 'preview') return
    notice.value = { kind: 'error', text: result.message }
    operation.value = { kind: 'idle' }
    return
  }
  if (result.quality === 'preview' && readyRevision.value === result.revision) return
  const editedCanvas = canvas.value
  const context = editedCanvas?.getContext('2d')
  if (!context || !editedCanvas) {
    notice.value = { kind: 'error', text: 'The image preview is unavailable. Reopen the app and try again.' }
    operation.value = { kind: 'idle' }
    return
  }
  const frame = new ImageData(result.pixels, result.width, result.height)
  if (result.quality === 'preview') {
    const surface = window.document.createElement('canvas')
    surface.width = result.width
    surface.height = result.height
    surface.getContext('2d')?.putImageData(frame, 0, 0)
    context.clearRect(0, 0, editedCanvas.width, editedCanvas.height)
    context.drawImage(surface, 0, 0, editedCanvas.width, editedCanvas.height)
    return
  }
  context.putImageData(frame, 0, 0)
  readyRevision.value = result.revision
  operation.value = { kind: 'idle' }
  const textured = recipe.value.effects.some((effect) => effect.enabled && effect.mix > 0 && ((effect.kind === 'sharpen' || effect.kind === 'noise') && effect.value > 0 || effect.kind === 'jpeg' && effect.passes > 0))
  notice.value = { kind: 'success', text: textured ? 'Effects are ready to export.' : 'Color changes are ready to export.' }
}

worker.onerror = (): void => {
  notice.value = { kind: 'error', text: 'Image processing stopped. Reopen the image and try again.' }
  operation.value = { kind: 'idle' }
}

async function exportPng(): Promise<void> {
  if (busy.value || readyRevision.value !== renderRevision || document.value === null || canvas.value === null) return
  operation.value = { kind: 'exporting' }
  try {
    const source = document.value
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.value?.toBlob((result) => result ? resolve(result) : reject(new Error('The PNG could not be created. Try again.')), 'image/png')
    })
    const name = `${source.name.replace(/\.[^.]+$/, '')}-deep-fried.png`
    const result = await window.imageBridge.exportPng(new Uint8Array(await blob.arrayBuffer()), name)
    if (result.kind === 'saved') notice.value = { kind: 'success', text: `Saved ${result.name}. Your original stays untouched.` }
  } catch (error) {
    notice.value = { kind: 'error', text: describeError(error) }
  } finally {
    operation.value = { kind: 'idle' }
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return
  if (event.key.toLowerCase() === 'o' && !event.shiftKey) {
    event.preventDefault()
    void openImage()
  } else if (event.key.toLowerCase() === 's' && event.shiftKey) {
    event.preventDefault()
    void exportPng()
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('blur', endDrag)
  resizeObserver = new ResizeObserver(measurePane)
  if (stage.value) resizeObserver.observe(stage.value)
  measurePane()
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('blur', endDrag)
  resizeObserver?.disconnect()
  if (renderTimer) clearTimeout(renderTimer)
  worker.terminate()
  document.value?.bitmap.close()
})
</script>

<template>
  <div class="editor">
    <header class="app-header">
      <div class="brand"><span class="brand-mark" aria-hidden="true">✳</span><span>deep fryer<span class="brand-dot">.</span></span><span class="version">DESKTOP</span></div>
      <span class="local-label"><span class="status-dot"></span> Local files. All yours.</span>
    </header>

    <div class="workspace">
      <aside class="sidebar">
        <div class="sidebar-heading"><span class="eyebrow">YOUR WORKSPACE</span><span class="step">01</span></div>
        <h1>Open. Preview.<br>Export.</h1>
        <p class="intro">Choose a PNG or JPEG.<br>Export a full resolution PNG.</p>
        <button class="button open-button" :disabled="busy" @click="openImage" aria-keyshortcuts="Control+O Meta+O">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h6l2 2h10v10H3zM3 7V5h7l2 2" /></svg>
          <span>{{ operation.kind === 'opening' ? 'Opening…' : 'Open image' }}</span><kbd>Ctrl O</kbd>
        </button>
        <p class="format-note">PNG or JPEG · Up to 64 MiB</p>

        <section class="image-details" aria-label="Image details">
          <span class="eyebrow">CURRENT IMAGE</span>
          <div class="file-heading"><span class="file-icon" aria-hidden="true">▧</span><div><strong class="filename">{{ document?.name ?? 'No image selected' }}</strong><span>{{ document ? (document.mime === 'image/png' ? 'PNG image' : 'JPEG image') : 'Waiting for an image' }}</span></div></div>
          <dl v-if="document"><div><dt>Dimensions</dt><dd>{{ dimensions }} px</dd></div><div><dt>Source size</dt><dd>{{ fileSize }}</dd></div><div><dt>Export format</dt><dd>PNG</dd></div></dl>
        </section>

        <EffectsPanel v-if="document" :key="imageVersion" :recipe="recipe" :disabled="controlsBusy" @change="changeRecipe" />

        <div class="sidebar-bottom"><div class="original-note"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z" /><path d="m8 12 3 3 5-6" /></svg><span>Your original is safe.<small>Exports always use a new file.</small></span></div><span class="edition">DEEP FRYER / VERSION 0.1</span></div>
      </aside>

      <main class="main-area">
        <div class="preview-toolbar"><div><span class="preview-label">Preview</span><span v-if="document" class="original-badge">{{ showing === 'original' ? 'ORIGINAL' : operation.kind === 'processing' ? 'PROCESSING' : colorNeutral ? 'UNCHANGED' : 'EDITED' }}</span></div><div v-if="document" class="inspection-controls" aria-label="Image inspection controls"><button type="button" @click="fit">Fit</button><button type="button" @click="oneToOne">100%</button><button type="button" aria-label="Zoom out" @click="zoomAt(-1)">−</button><span class="preview-scale">{{ zoomLabel }}</span><button type="button" aria-label="Zoom in" @click="zoomAt(1)">+</button><span class="inspection-divider"></span><button type="button" :aria-pressed="showing === 'original'" @click="showing = 'original'">Original</button><button type="button" :aria-pressed="showing === 'edited'" @click="showing = 'edited'">Edited</button></div><span v-else class="preview-scale">No image loaded</span></div>
        <section ref="stage" class="preview-stage" :class="{ 'has-image': document }" aria-label="Image preview" :tabindex="document ? 0 : -1" @keydown="stageKeydown" @pointerdown="pointerDown" @pointermove="pointerMove" @pointerup="endDrag" @pointercancel="endDrag" @lostpointercapture="endDrag" @dblclick="zoomAt($event.shiftKey ? -1 : 1, pointerPosition($event))">
          <div class="image-plane" v-show="document" :style="imageStyle"><canvas ref="canvas" v-show="showing === 'edited'" aria-label="Edited full resolution image canvas"></canvas><canvas ref="originalCanvas" v-show="showing === 'original'" aria-label="Original full resolution image canvas"></canvas></div>
          <div class="empty-state" v-if="!document">
            <div class="empty-art" aria-hidden="true"><svg viewBox="0 0 100 100"><rect x="18" y="21" width="64" height="58" rx="8" /><circle cx="63" cy="40" r="7" /><path d="m20 67 20-22 21 23 10-10 10 10" /></svg><span class="spark spark-one">✧</span><span class="spark spark-two">+</span></div>
            <span class="eyebrow">IMAGE PREVIEW</span><h2>Open your first image.</h2><p>Your image appears here at its original orientation.<br>Export it as a new PNG when you're ready.</p><button class="text-button" :disabled="busy" @click="openImage">Choose an image <span aria-hidden="true">↗</span></button>
          </div>
          <span class="canvas-caption" v-if="document">{{ dimensions }} px <span>·</span> Full resolution</span>
        </section>
        <footer class="export-bar"><div class="notice" :class="notice.kind" role="status" aria-live="polite"><span class="notice-dot"></span><span>{{ notice.text }}</span></div><button class="button export-button" :disabled="busy || !document || readyRevision !== renderRevision" @click="exportPng" aria-keyshortcuts="Control+Shift+S Meta+Shift+S"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-4-4 4 4-4-4M4 15v5h16v-5" /></svg><span>{{ operation.kind === 'exporting' ? 'Exporting…' : 'Export PNG' }}</span><kbd>Ctrl ⇧ S</kbd></button></footer>
      </main>
    </div>
  </div>
</template>
