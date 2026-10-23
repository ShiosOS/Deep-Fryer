<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, shallowRef, watch } from 'vue'
import type { OpenImage } from '../../shared/image'
import { outputFormats, outputOptionsSchema, type OutputOptions } from '../../shared/output'
import type { Preset } from '../../shared/preset'
import Modal from './Modal.vue'
import { saveNameSchema } from '../../shared/documents'
import { freezeOutput, type OutputResponse, type PreparedOutput } from './output'

const props = defineProps<{ source: (OpenImage & { bitmap: ImageBitmap }) | null; preset: Preset; disabled: boolean }>()
const emit = defineEmits<{ notice: [notice: { kind: 'info' | 'success' | 'error'; text: string }]; saveStarted: []; saveFinished: [] }>()
type Inspection = { kind: 'empty' } | { kind: 'preparing'; key: string } | { kind: 'ready' | 'stale'; key: string; output: PreparedOutput }
const inspection = shallowRef<Inspection>({ kind: 'empty' })
const format = ref<OutputOptions['format']>('png')
const width = ref<number | string>('1')
const height = ref<number | string>('1')
const quality = ref<number | string>('85')
const background = ref('#ffffff')
const saving = ref(false)
const exportDialog = ref<InstanceType<typeof Modal> | null>(null)
const exportName = ref('')
const saveNotice = ref('')
const validName = computed(() => saveNameSchema.safeParse(exportName.value).success)
const dialog = ref<HTMLDialogElement | null>(null)
const inspectionCanvas = ref<HTMLCanvasElement | null>(null)
const sourceVersion = ref(0)
let preparation: Worker | null = null
let cancelPreparation: (() => void) | null = null

const parsedOptions = computed(() => outputOptionsSchema.safeParse({
  format: format.value, width: Number(width.value), height: Number(height.value),
  quality: Number(quality.value), background: background.value
}))
const validationError = computed(() => {
  if (String(width.value).trim() === '' || String(height.value).trim() === '' || format.value !== 'png' && String(quality.value).trim() === '') return 'Enter whole output dimensions and quality.'
  return parsedOptions.value.success ? '' : 'Use whole dimensions from 1 to 16,384, at most 24 million pixels, and quality from 1 to 100.'
})
const currentKey = computed(() => JSON.stringify([sourceVersion.value, props.preset, format.value, width.value, height.value, quality.value, background.value]))
const busy = computed(() => saving.value || inspection.value.kind === 'preparing')
const exportLabel = computed(() => `Export ${outputFormats[format.value].label}`)
const inspectionText = computed(() => {
  switch (inspection.value.kind) {
    case 'empty': return 'Prepare the encoded output to inspect it before saving.'
    case 'preparing': return inspection.value.key === currentKey.value ? 'Preparing the frozen output…' : 'Preparing an earlier snapshot. Current edits need a new inspection.'
    case 'ready': return 'Current output. Saving writes the exact bytes inspected here.'
    case 'stale': return 'Out of date. The image, preset, or output settings changed. Inspect again before saving this output.'
  }
})

watch(() => props.source, (source) => {
  sourceVersion.value += 1
  if (source) { width.value = String(source.bitmap.width); height.value = String(source.bitmap.height); exportName.value = `${source.name.replace(/\.[^.]+$/, '')}-fried` }
  invalidate()
}, { flush: 'sync', immediate: true })
watch(currentKey, invalidate, { flush: 'sync' })

function invalidate(): void {
  const current = inspection.value
  if (current.kind === 'ready') inspection.value = { ...current, kind: 'stale' }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : 'The output could not be saved. Try again.'
}

async function prepare(): Promise<PreparedOutput> {
  if (!props.source || !parsedOptions.value.success || validationError.value) throw new Error(validationError.value || 'Open an image first.')
  const key = currentKey.value
  if (inspection.value.kind === 'ready' && inspection.value.key === key) return inspection.value.output
  const job = freezeOutput(props.source, props.preset, parsedOptions.value.data)
  inspection.value = { kind: 'preparing', key }
  try {
    const worker = new Worker(new URL('./output-worker.ts', import.meta.url), { type: 'module' })
    preparation = worker
    const output = await new Promise<PreparedOutput>((resolve, reject) => {
      cancelPreparation = () => reject(new Error('Output preparation canceled. No file was saved.'))
      worker.onerror = () => reject(new Error('Output preparation stopped. Try smaller dimensions or reopen the image.'))
      worker.onmessage = (event: MessageEvent<OutputResponse>) => {
        if (event.data.kind === 'failed') reject(new Error(event.data.message))
        else resolve(event.data.output)
      }
      worker.postMessage(job, [job.source.bytes.buffer])
    })
    inspection.value = { kind: key === currentKey.value ? 'ready' : 'stale', key, output }
    await paintInspection(output)
    return output
  } catch (error) {
    inspection.value = { kind: 'empty' }
    throw error
  } finally {
    preparation?.terminate()
    preparation = null
    cancelPreparation = null
  }
}

async function paintInspection(output: PreparedOutput): Promise<void> {
  await nextTick()
  const canvas = inspectionCanvas.value
  if (!canvas) return
  canvas.width = output.options.width
  canvas.height = output.options.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('The final output inspection is unavailable. Try again.')
  context.putImageData(new ImageData(output.pixels, output.options.width, output.options.height), 0, 0)
}

async function inspect(): Promise<void> {
  if (busy.value || props.disabled) return
  if (dialog.value && !dialog.value.open) dialog.value.showModal()
  try { await paintInspection(await prepare()) }
  catch (error) { saveNotice.value = describeError(error); emit('notice', { kind: 'error', text: saveNotice.value }) }
}

async function save(output: PreparedOutput): Promise<void> {
  saving.value = true
  emit('saveStarted')
  try {
    const descriptor = outputFormats[output.options.format]
    const suggestedName = `${exportName.value.trim().replace(/\.(png|jpe?g|webp)$/i, '')}.${descriptor.extension}`
    const result = await window.imageBridge.exportImage({ bytes: output.bytes, format: output.options.format, suggestedName })
    saveNotice.value = result.kind === 'saved' ? `Saved ${result.name}.` : 'Export canceled. No file was saved.'
    emit('notice', result.kind === 'saved'
      ? { kind: 'success', text: `Saved ${result.name}. Your original stays untouched.` }
      : { kind: 'info', text: 'Export canceled. No file was saved.' })
  } catch (error) { saveNotice.value = describeError(error); emit('notice', { kind: 'error', text: saveNotice.value }) }
  finally { saving.value = false; emit('saveFinished') }
}

async function exportCurrent(): Promise<void> {
  if (busy.value || props.disabled || !props.source || !validName.value) return
  try { await save(await prepare()) }
  catch (error) { saveNotice.value = describeError(error); emit('notice', { kind: 'error', text: saveNotice.value }) }
}

function saveInspection(): void {
  if (inspection.value.kind === 'ready' && inspection.value.key === currentKey.value && !busy.value && validName.value) void save(inspection.value.output)
}

onUnmounted(() => { cancelPreparation?.(); preparation?.terminate() })
defineExpose({ open: () => exportDialog.value?.open(), exportLabel, busy })
</script>

<template>
  <Modal ref="exportDialog" title="Export image">
  <section class="output-panel modal-content" aria-label="Output settings">
    <label class="name-field">File name<input v-model="exportName" aria-label="Export file name" maxlength="200"></label>

    <label>Format<select v-model="format" aria-label="Output format" :disabled="disabled"><option value="png">PNG</option><option value="jpeg">JPEG</option><option value="webp">WebP</option></select></label>
    <div class="output-dimensions"><label>Width<input v-model="width" aria-label="Output width" type="number" min="1" max="16384" step="1" :disabled="disabled"></label><label>Height<input v-model="height" aria-label="Output height" type="number" min="1" max="16384" step="1" :disabled="disabled"></label></div>
    <label v-if="format !== 'png'">Quality<input v-model="quality" aria-label="Output quality" type="number" min="1" max="100" step="1" :disabled="disabled"></label>
    <label v-if="format === 'jpeg'">Transparency background<input v-model="background" aria-label="JPEG output background" type="color" :disabled="disabled"></label>
    <p>{{ format === 'jpeg' ? 'JPEG replaces transparency with this background.' : format === 'webp' ? 'WebP keeps transparency and uses lossy color compression.' : 'PNG keeps transparency and stores pixels losslessly.' }}</p>
    <p>Resize first, then apply effects on the output pixel grid. Noise, sharpening and JPEG blocks follow the chosen output size.</p>
    <p v-if="validationError" class="control-error" role="alert">{{ validationError }}</p>
    <button type="button" :disabled="disabled || busy || !!validationError" @click="inspect">Inspect final output</button>
    <button v-if="inspection.kind === 'preparing'" type="button" @click="cancelPreparation?.()">Cancel output preparation</button>
    <p class="save-notice" aria-live="polite">{{ saveNotice }}</p>
    <div class="modal-actions"><button type="button" @click="exportDialog?.close()">Close export</button><button type="button" class="primary" :disabled="disabled || busy || !!validationError || !validName" @click="exportCurrent">Save image…</button></div>
  </section>
  </Modal>
  <dialog ref="dialog" class="output-dialog" aria-label="Final output inspection">
    <div class="output-dialog-heading"><h2>Final output inspection</h2><button type="button" @click="dialog?.close()">Close inspection</button></div>
    <p class="output-inspection-state" :class="{ stale: inspection.kind === 'stale' }">{{ inspectionText }}</p>
    <p v-if="inspection.kind === 'ready' || inspection.kind === 'stale'">{{ inspection.output.options.width }} × {{ inspection.output.options.height }} px · {{ outputFormats[inspection.output.options.format].label }} · 100% · One output pixel per CSS pixel. Scroll to inspect details.</p>
    <div class="output-inspection-viewport"><canvas v-show="inspection.kind === 'ready' || inspection.kind === 'stale'" ref="inspectionCanvas" aria-label="Decoded final output at 100 percent"></canvas></div>
    <p class="save-notice" aria-live="polite">{{ saveNotice }}</p><div class="output-dialog-actions"><button v-if="inspection.kind === 'preparing'" type="button" @click="cancelPreparation?.()">Cancel output preparation</button><button type="button" :disabled="busy || disabled || !!validationError" @click="inspect">Inspect current settings</button><button type="button" :disabled="inspection.kind !== 'ready' || busy || !validName" @click="saveInspection">Save inspected snapshot</button></div>
  </dialog>
</template>
