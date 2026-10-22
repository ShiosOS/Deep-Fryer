<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef } from 'vue'
import { validateDimensions, type OpenImage } from '../../shared/image'

type ImageDocument = Readonly<OpenImage & { bitmap: ImageBitmap }>
type Operation = { kind: 'idle' } | { kind: 'opening' } | { kind: 'exporting' }
type Notice = { kind: 'info' | 'success' | 'error'; text: string }

const document = shallowRef<ImageDocument | null>(null)
const operation = ref<Operation>({ kind: 'idle' })
const notice = ref<Notice>({ kind: 'info', text: 'Open an image to preview and export it.' })
const canvas = ref<HTMLCanvasElement | null>(null)
const busy = computed(() => operation.value.kind !== 'idle')
const dimensions = computed(() => document.value ? `${document.value.bitmap.width.toLocaleString()} × ${document.value.bitmap.height.toLocaleString()}` : 'No image yet')
const fileSize = computed(() => {
  const size = document.value?.bytes.byteLength ?? 0
  return size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`
})

function describeError(error: unknown): string {
  return error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : 'Something went wrong. Try again.'
}

async function openImage(): Promise<void> {
  if (busy.value) return
  operation.value = { kind: 'opening' }
  let candidate: ImageBitmap | null = null
  try {
    const source = await window.imageBridge.openImage()
    if (source === null) return
    candidate = await createImageBitmap(new Blob([new Uint8Array(source.bytes).buffer], { type: source.mime }), { imageOrientation: 'from-image' })
    validateDimensions(candidate.width, candidate.height)
    const context = canvas.value?.getContext('2d')
    if (!context || !canvas.value) throw new Error('The image preview is unavailable. Reopen the app and try again.')
    const previous = document.value
    canvas.value.width = candidate.width
    canvas.value.height = candidate.height
    context.drawImage(candidate, 0, 0)
    document.value = { ...source, bitmap: candidate }
    candidate = null
    previous?.bitmap.close()
    notice.value = { kind: 'success', text: `${source.name} is ready. Your original stays untouched.` }
  } catch (error) {
    notice.value = { kind: 'error', text: describeError(error) }
  } finally {
    candidate?.close()
    operation.value = { kind: 'idle' }
  }
}

async function exportPng(): Promise<void> {
  if (busy.value || document.value === null || canvas.value === null) return
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

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
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

        <div class="sidebar-bottom"><div class="original-note"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z" /><path d="m8 12 3 3 5-6" /></svg><span>Your original is safe.<small>Exports always use a new file.</small></span></div><span class="edition">DEEP FRYER / VERSION 0.1</span></div>
      </aside>

      <main class="main-area">
        <div class="preview-toolbar"><div><span class="preview-label">Preview</span><span class="original-badge">ORIGINAL</span></div><span class="preview-scale">{{ document ? 'Fit to view' : 'No image loaded' }}</span></div>
        <section class="preview-stage" :class="{ 'has-image': document }" aria-label="Image preview">
          <canvas ref="canvas" v-show="document" aria-label="Full resolution image canvas"></canvas>
          <div class="empty-state" v-if="!document">
            <div class="empty-art" aria-hidden="true"><svg viewBox="0 0 100 100"><rect x="18" y="21" width="64" height="58" rx="8" /><circle cx="63" cy="40" r="7" /><path d="m20 67 20-22 21 23 10-10 10 10" /></svg><span class="spark spark-one">✧</span><span class="spark spark-two">+</span></div>
            <span class="eyebrow">IMAGE PREVIEW</span><h2>Open your first image.</h2><p>Your image appears here at its original orientation.<br>Export it as a new PNG when you're ready.</p><button class="text-button" :disabled="busy" @click="openImage">Choose an image <span aria-hidden="true">↗</span></button>
          </div>
          <span class="canvas-caption" v-if="document">{{ dimensions }} px <span>·</span> Full resolution</span>
        </section>
        <footer class="export-bar"><div class="notice" :class="notice.kind" role="status" aria-live="polite"><span class="notice-dot"></span><span>{{ notice.text }}</span></div><button class="button export-button" :disabled="busy || !document" @click="exportPng" aria-keyshortcuts="Control+Shift+S Meta+Shift+S"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M4 15v5h16v-5" /></svg><span>{{ operation.kind === 'exporting' ? 'Exporting…' : 'Export PNG' }}</span><kbd>Ctrl ⇧ S</kbd></button></footer>
      </main>
    </div>
  </div>
</template>
