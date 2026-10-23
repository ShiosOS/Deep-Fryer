<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef } from 'vue'
import { validateDimensions, type OpenImage } from '../../shared/image'
import EffectsPanel from './EffectsPanel.vue'
import PresetControls from './PresetControls.vue'
import ExportDialog from './ExportDialog.vue'
import SettingsDialog from './SettingsDialog.vue'
import SaveNameDialog from './SaveNameDialog.vue'
import HelpDialog from './HelpDialog.vue'
import { useAppearance } from './appearance'
import appIcon from './assets/minimal-app-icon.svg'
import BulgeOverlay from './BulgeOverlay.vue'
import DocumentControls from './DocumentControls.vue'
import { useDocumentFiles } from './document-files'
import { renderPresetFrame } from './render-preset-frame'
import { isNeutralEffect, newEffect, newPreset, presetSchema, replaceEffect, type Preset } from '../../shared/preset'
import { snapshotPreset, usePresetHistory } from './preset-history'
import type { WorkerRequest, WorkerResponse } from './effects-worker'
import { actualSize, fitView, imageOrigin, paneToImage, pan, resizeView, zoom, type InspectionView, type Point, type Size } from './inspection-geometry'

type ImageDocument = Readonly<OpenImage & { bitmap: ImageBitmap }>
type Operation = { kind: 'idle' } | { kind: 'opening' } | { kind: 'processing' } | { kind: 'exporting' }
type Notice = { kind: 'info' | 'success' | 'error'; text: string }
const appearance = useAppearance()
const settingsDialog = ref<InstanceType<typeof SettingsDialog> | null>(null)
const nameDialog = ref<InstanceType<typeof SaveNameDialog> | null>(null)
const helpDialog = ref<InstanceType<typeof HelpDialog> | null>(null)

const document = shallowRef<ImageDocument | null>(null)
const operation = ref<Operation>({ kind: 'idle' })
const notice = ref<Notice>({ kind: 'info', text: 'Open an image to preview and export it.' })
const canvas = ref<HTMLCanvasElement | null>(null)
const originalCanvas = ref<HTMLCanvasElement | null>(null)
const stage = ref<HTMLElement | null>(null)
const outputPanel = ref<InstanceType<typeof ExportDialog> | null>(null)
const pane = ref<Size>({ width: 0, height: 0 })
const view = ref<InspectionView | null>(null)
const showing = ref<'edited' | 'original'>('edited')
const history = usePresetHistory(newPreset())
const { preset } = history
const restoreVersion = ref(0)
const placingPoint = ref(false)
const selectedPointId = ref<string | null>(null)
const gestureActive = ref(false)
const bulgePoints = computed(() => preset.value.effects.filter((effect) => effect.kind === 'bulge'))
const readyRevision = ref(0)
const imageVersion = ref(0)
let renderRevision = 0
let renderTimer: ReturnType<typeof setTimeout> | null = null
let hasPreview = false
let confirmedFrame: ImageData | null = null
const worker = new Worker(new URL('./effects-worker.ts', import.meta.url), { type: 'module' })
const busy = computed(() => operation.value.kind !== 'idle')
const controlsBusy = computed(() => operation.value.kind === 'opening' || operation.value.kind === 'exporting')
const presetNeutral = computed(() => preset.value.effects.every(isNeutralEffect))
const dimensions = computed(() => document.value ? `${document.value.bitmap.width.toLocaleString()} × ${document.value.bitmap.height.toLocaleString()}` : 'No image yet')
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
  if (placingPoint.value && view.value && imageSize.value) {
    const relative = pointerPosition(event)
    const point = paneToImage(view.value, relative, pane.value)
    if (point.x >= 0 && point.x <= imageSize.value.width && point.y >= 0 && point.y <= imageSize.value.height) {
      const effect = { ...newEffect('bulge'), x: Math.max(0, Math.min(1, point.x / Math.max(1, imageSize.value.width - 1))), y: Math.max(0, Math.min(1, point.y / Math.max(1, imageSize.value.height - 1))) }
      if (!changePreset({ ...preset.value, effects: [...preset.value.effects, effect] })) return
      selectedPointId.value = effect.id
      placingPoint.value = false
    }
    return
  }
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

async function publishImage(source: OpenImage, savedPreset: Preset): Promise<void> {
  let candidate: ImageBitmap | null = null
  const previous = document.value
  const previousReadyRevision = readyRevision.value
  let previousFrame: ImageData | null = null
  let publishing = false
  try {
    candidate = await createImageBitmap(new Blob([new Uint8Array(source.bytes).buffer], { type: source.mime }), { imageOrientation: 'from-image' })
    validateDimensions(candidate.width, candidate.height)
    const context = canvas.value?.getContext('2d', { willReadFrequently: true })
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
    const candidatePreset = presetSchema.parse(savedPreset)
    const editedPixels = await renderPresetFrame(pixels, candidatePreset)
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
    context.putImageData(editedPixels, 0, 0)
    worker.postMessage(request, preview ? [workerPixels.buffer, preview.pixels.buffer] : [workerPixels.buffer])
    document.value = candidateDocument
    history.reset(candidatePreset)
    confirmedFrame = editedPixels
    gestureActive.value = false
    selectedPointId.value = null
    placingPoint.value = false
    restoreVersion.value += 1
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
        throw new Error(notice.value.text)
      }
    }
    throw error
  } finally {
    candidate?.close()
  }
}

const files = useDocumentFiles({
  busy, source: () => document.value, preset: () => snapshotPreset(preset.value),
  ready: () => document.value !== null && readyRevision.value === renderRevision,
  gestureActive: () => gestureActive.value,
  setOperation: (kind) => { operation.value = { kind } },
  finishOperation: () => { if (operation.value.kind === 'opening' || operation.value.kind === 'exporting') operation.value = { kind: 'idle' } },
  report: (message) => { notice.value = message }, publish: publishImage,
  applyPreset: (settings) => { changePreset(settings); restoreVersion.value += 1 }
})
const { openImage } = files

function beginGesture(): void { gestureActive.value = true; files.cancelCheckpoint(); history.begin() }
function endGesture(): void { history.end(); gestureActive.value = false; files.scheduleCheckpoint() }

function changePreset(settings: Preset): boolean {
  const source = document.value
  if (!source || controlsBusy.value) return false
  const parsed = presetSchema.safeParse(settings)
  if (!parsed.success) {
    notice.value = { kind: 'error', text: parsed.error.issues[0]?.message ?? 'Check the effect settings.' }
    return false
  }
  if (!history.change(parsed.data)) return false
  scheduleRender(source)
  return true
}

function scheduleRender(source: ImageDocument): void {
  files.cancelCheckpoint()
  const revision = ++renderRevision
  const accepted = snapshotPreset(preset.value)
  operation.value = { kind: 'processing' }
  notice.value = { kind: 'info', text: 'Processing effects…' }
  if (renderTimer) clearTimeout(renderTimer)
  if (hasPreview) {
    const previewRequest: WorkerRequest = { kind: 'render', sourceId: imageVersion.value, revision, preset: accepted, quality: 'preview' }
    worker.postMessage(previewRequest)
  }
  renderTimer = setTimeout(() => {
    if (revision !== renderRevision || document.value !== source) return
    const request: WorkerRequest = { kind: 'render', sourceId: imageVersion.value, revision, preset: accepted, quality: 'full' }
    worker.postMessage(request)
  }, 100)
}

function movePoint(id: string, x: number, y: number): void {
  const effect = bulgePoints.value.find((item) => item.id === id)
  if (!effect) return
  changePreset(replaceEffect(preset.value, { ...effect, x, y }))
}

function deletePoint(id: string): void {
  changePreset({ ...preset.value, effects: preset.value.effects.filter((effect) => effect.id !== id) })
  if (selectedPointId.value === id) selectedPointId.value = null
}

function restoreFromHistory(direction: 'undo' | 'redo'): void {
  if (controlsBusy.value) return
  history.end()
  if (!(direction === 'undo' ? history.undo() : history.redo())) return
  restoreVersion.value += 1
  if (document.value) scheduleRender(document.value)
}

function cancelPending(): void {
  if (!document.value || !confirmedFrame || readyRevision.value === renderRevision) return
  renderRevision += 1
  if (renderTimer) { clearTimeout(renderTimer); renderTimer = null }
  history.rollback()
  restoreVersion.value += 1
  const context = canvas.value?.getContext('2d')
  if (!context) {
    notice.value = { kind: 'error', text: 'The confirmed image could not be restored. Reopen your image to continue.' }
    operation.value = { kind: 'idle' }
    return
  }
  context.putImageData(confirmedFrame, 0, 0)
  readyRevision.value = renderRevision
  operation.value = { kind: 'idle' }
  notice.value = { kind: 'info', text: 'Pending changes canceled. Last confirmed image restored.' }
  gestureActive.value = false
  files.scheduleCheckpoint()
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
  confirmedFrame = frame
  history.confirm()
  readyRevision.value = result.revision
  files.scheduleCheckpoint()
  operation.value = { kind: 'idle' }
  const textured = preset.value.effects.some((effect) => effect.enabled && effect.mix > 0 && ((effect.kind === 'sharpen' || effect.kind === 'noise') && effect.value > 0 || effect.kind === 'jpeg' && effect.passes > 0 || effect.kind === 'bulge' && effect.strength !== 0))
  notice.value = { kind: 'success', text: textured ? 'Effects are ready to export.' : 'Color changes are ready to export.' }
}

worker.onerror = (): void => {
  notice.value = { kind: 'error', text: 'Image processing stopped. Reopen the image and try again.' }
  operation.value = { kind: 'idle' }
}

function exportOutput(): void {
  if (busy.value || readyRevision.value !== renderRevision) return
  outputPanel.value?.open()
}

function openSaveName(kind: 'project' | 'preset'): void {
  if (!document.value || busy.value || readyRevision.value !== renderRevision) return
  void nameDialog.value?.open(kind, document.value.name)
}
function saveNamed(kind: 'project' | 'preset', name: string): void {
  if (kind === 'project') void files.saveProject(name)
  else void files.savePreset(name)
}

function onKeydown(event: KeyboardEvent): void {
  if (window.document.querySelector('dialog[open]')) return
  if (event.key === 'Escape') {
    for (const menu of window.document.querySelectorAll<HTMLDetailsElement>('.file-menu[open], .preset-menu[open]')) {
      menu.open = false
      menu.querySelector<HTMLElement>('summary')?.focus()
    }
    placingPoint.value = false
    return
  }
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return
  if (event.key.toLowerCase() === 'o' && !event.shiftKey) {
    event.preventDefault()
    void openImage()
  } else if (event.key.toLowerCase() === 'v') {
    const target = event.target
    if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select'))) return
    event.preventDefault()
    void files.pasteImage()
  } else if (event.key.toLowerCase() === 's' && !event.shiftKey) {
    event.preventDefault()
    openSaveName('project')
  } else if (event.key.toLowerCase() === 's' && event.shiftKey) {
    event.preventDefault()
    exportOutput()
  } else if (event.key.toLowerCase() === 'z' || event.key.toLowerCase() === 'y') {
    const target = event.target
    if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select'))) return
    event.preventDefault()
    restoreFromHistory(event.key.toLowerCase() === 'y' || event.shiftKey ? 'redo' : 'undo')
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('blur', endDrag)
  resizeObserver = new ResizeObserver(measurePane)
  if (stage.value) resizeObserver.observe(stage.value)
  measurePane()
  void appearance.load().then(() => files.checkRecovery())
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
  <div class="editor" :class="{ 'appearance-loading': !appearance.loaded.value }" @dragover.prevent @drop="files.drop">
    <header class="app-header">
      <svg class="app-mark" viewBox="0 0 64 64" role="img" aria-label="Deep Fryer"><g transform="rotate(-11 32 24)"><rect x="20" y="7" width="25" height="30" rx="4" fill="currentColor"/><circle cx="27" cy="15" r="2.2" fill="var(--panel)"/><path d="M24 29l6-8 5 5 4-4 3 8Z" fill="var(--panel)"/></g><path d="M10 35h44v9c0 9-6 14-15 14H25c-9 0-15-5-15-14Z" fill="currentColor"/><path d="M15 40c6-4 10 4 16 0s10 4 18 0" stroke="var(--panel)" stroke-width="3.5" fill="none" stroke-linecap="round"/></svg>
      <span class="filename" :title="document?.name"><span class="file-dot" aria-hidden="true"></span>{{ document?.name ?? 'Untitled' }}</span>
      <div class="header-actions">
        <button type="button" class="icon-button" aria-label="Undo" title="Undo" :disabled="!history.canUndo.value || controlsBusy" aria-keyshortcuts="Control+Z Meta+Z" @click="restoreFromHistory('undo')"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5 3 10l5 5M3 10h10a7 7 0 0 1 0 14" transform="translate(1 -3)"/></svg></button>
        <button type="button" class="icon-button" aria-label="Redo" title="Redo" :disabled="!history.canRedo.value || controlsBusy" aria-keyshortcuts="Control+Shift+Z Control+Y Meta+Shift+Z" @click="restoreFromHistory('redo')"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m16 5 5 5-5 5m5-5H11a7 7 0 0 0 0 14" transform="translate(-1 -3)"/></svg></button>
        <span class="header-divider" aria-hidden="true"></span>
        <button type="button" class="icon-button" aria-label="Help" title="Help" @click="helpDialog?.open()"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4m0 3h.01"/></svg></button>
        <button type="button" class="icon-button" aria-label="Settings" :title="appearance.notice.value ? 'Settings need attention' : 'Settings'" @click="settingsDialog?.open()"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 3-.6 2.3-2 .9-2.1-.7-2 3.4 1.6 1.7v2.3l-1.6 1.7 2 3.4 2.2-.6 1.9 1 .6 2.2h4l.6-2.3 2-.9 2.1.6 2-3.4-1.6-1.7v-2.3l1.6-1.7-2-3.4-2.2.7-1.9-1L14 3Z"/><circle cx="12" cy="12" r="3"/></svg><span v-if="appearance.notice.value" class="settings-attention" aria-hidden="true"></span></button>
        <DocumentControls :busy="busy" :has-image="document !== null" :ready="readyRevision === renderRevision" :recovery-status="files.recoveryStatus.value" :recovery-offer="files.recoveryOffer.value" @open-image="openImage" @open-project="files.openProject" @save-project="openSaveName('project')" @paste-image="files.pasteImage" @restore-recovery="files.restoreRecovery" @discard-recovery="files.discardRecovery" />
        <button type="button" class="primary export-button" :disabled="busy || !document || readyRevision !== renderRevision" aria-keyshortcuts="Control+Shift+S Meta+Shift+S" @click="exportOutput">Export<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3m-4 4 4-4 4 4M4 14v6h16v-6"/></svg></button>
      </div>
    </header>
    <div class="workspace">
      <aside class="sidebar" aria-label="Image controls">
        <PresetControls v-if="document" :key="imageVersion" :preset="preset" :bitmap="document.bitmap" :restore-version="restoreVersion" :disabled="controlsBusy" @change="changePreset" @gesture-begin="beginGesture" @gesture-end="endGesture" @load-preset="files.loadPreset" @save-preset="openSaveName('preset')" />
        <p v-else class="inspector-empty">Open an image to choose a preset and adjust its effects.</p>
        <EffectsPanel v-if="document" :key="imageVersion" :preset="preset" :restore-version="restoreVersion" :selected-point-id="selectedPointId" :disabled="controlsBusy" @change="changePreset" @gesture-begin="beginGesture" @gesture-end="endGesture" @select-point="selectedPointId = $event; showing = 'edited'" />
        <div class="notice" :class="notice.kind" role="status" aria-live="polite">{{ notice.text }}</div>
        <button v-if="document && readyRevision !== renderRevision" type="button" @click="cancelPending">Cancel pending changes</button>
      </aside>
      <main class="main-area">
        <div class="preview-toolbar">
          <div class="comparison-controls"><button type="button" :disabled="!document" :aria-pressed="showing === 'original'" @click="showing = 'original'">Original</button><button type="button" :disabled="!document" :aria-pressed="showing === 'edited'" @click="showing = 'edited'">Edited</button><span class="original-badge">{{ !document ? 'Preview' : operation.kind === 'processing' ? 'Processing' : presetNeutral ? 'Unchanged' : 'Edited' }}</span></div>
          <div class="inspection-controls" aria-label="Image inspection controls"><button type="button" :aria-pressed="placingPoint" :disabled="!document || controlsBusy" @click="placingPoint = !placingPoint; showing = 'edited'">{{ placingPoint ? 'Click image…' : 'Place point' }}</button><button type="button" :disabled="!document" @click="fit">Fit</button><button type="button" :disabled="!document" @click="oneToOne">100%</button><button type="button" :disabled="!document" aria-label="Zoom out" @click="zoomAt(-1)">−</button><span class="preview-scale">{{ zoomLabel }}</span><button type="button" :disabled="!document" aria-label="Zoom in" @click="zoomAt(1)">+</button></div>
        </div>
        <section ref="stage" class="preview-stage" :class="{ 'has-image': document }" aria-label="Image preview" :tabindex="document ? 0 : -1" @keydown="stageKeydown" @pointerdown="pointerDown" @pointermove="pointerMove" @pointerup="endDrag" @pointercancel="endDrag" @lostpointercapture="endDrag" @dblclick="zoomAt($event.shiftKey ? -1 : 1, pointerPosition($event))">
          <div class="image-plane" v-show="document" :style="imageStyle"><canvas ref="canvas" v-show="showing === 'edited'" aria-label="Edited full resolution image canvas"></canvas><canvas ref="originalCanvas" v-show="showing === 'original'" aria-label="Original full resolution image canvas"></canvas></div>
          <BulgeOverlay v-if="document && view && imageSize && showing === 'edited'" :points="bulgePoints" :selected-id="selectedPointId" :view="view" :pane="pane" :image="imageSize" @select="selectedPointId = $event" @change="movePoint" @delete="deletePoint" @gesture-begin="beginGesture" @gesture-end="endGesture" />
          <div class="empty-state" v-if="!document"><img :src="appIcon" alt=""><h1>Open your first image.</h1><p>Choose a PNG or JPEG, paste an image, or drop a file here.</p><button class="primary" :disabled="busy" @click="openImage">Choose an image</button></div>
          <span class="canvas-caption" v-if="document">{{ dimensions }} px</span>
        </section>
      </main>
    </div>
    <ExportDialog ref="outputPanel" :source="document" :preset="preset" :disabled="controlsBusy" @notice="notice = $event" @save-started="files.cancelCheckpoint" @save-finished="files.scheduleCheckpoint" />
    <SettingsDialog ref="settingsDialog" :settings="appearance.settings.value" :mode="appearance.mode.value" :notice="appearance.notice.value" :saving="appearance.saving.value" @save="appearance.save" />
    <SaveNameDialog ref="nameDialog" @save="saveNamed" />
    <HelpDialog ref="helpDialog" />
  </div>
</template>
