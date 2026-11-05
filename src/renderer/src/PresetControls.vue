<script setup lang="ts">
import { computed, onUnmounted, ref, shallowRef, watch } from 'vue'
import { renderPresetFrame } from './render-preset-frame'
import { isNeutralEffect, type Preset } from '../../shared/preset'
import { snapshotPreset } from './preset-history'
import { fryAmounts, namedLooks, namedPreset, parameterKey, randomizePreset, randomParameters, scaleFry, type NamedLook } from './preset-looks'

const props = defineProps<{ preset: Preset; bitmap: ImageBitmap; disabled: boolean; restoreVersion: number }>()
const emit = defineEmits<{ change: [preset: Preset]; gestureBegin: []; gestureEnd: []; loadPreset: []; savePreset: []; previewStatus: [state: { kind: 'building' | 'ready' | 'error'; message: string }] }>()
const look = ref<NamedLook | ''>('')
const amount = ref(100)
const baseline = shallowRef(snapshotPreset(props.preset))
const locks = ref(new Set<string>())
const dialog = ref<HTMLDialogElement | null>(null)
const menu = ref<HTMLDetailsElement | null>(null)
const gallery = ref<HTMLDetailsElement | null>(null)
function presetFile(action: 'load' | 'save'): void {
  if (menu.value) { menu.value.open = false; menu.value.querySelector<HTMLElement>('summary')?.focus() }
  if (action === 'load') emit('loadPreset')
  else emit('savePreset')
}
const candidates = shallowRef<Array<{ preset: Preset; amount: number; thumbnail: string }>>([])
const selectedAmount = ref(60)
const comparisonStatus = ref('')
const comparisonBusy = ref(false)
const neutral = computed(() => props.preset.effects.every(isNeutralEffect))
let published = ''
let comparisonGeneration = 0
let comparisonCancellation: AbortController | null = null
type LookPreview = { name: NamedLook; thumbnail: string }
type LookPreviewState = { kind: 'building' | 'ready' | 'error'; items: LookPreview[]; message: string }
const previews = shallowRef<LookPreviewState>({ kind: 'building', items: [], message: 'Building look previews…' })
watch(previews, (state) => emit('previewStatus', { kind: state.kind, message: state.message }), { immediate: true })
let lookCancellation = new AbortController()
async function buildLookPreviews(seed: number, cancellation: AbortController): Promise<void> {
  try {
    const scale = Math.min(1, 160 / Math.max(props.bitmap.width, props.bitmap.height))
    const surface = document.createElement('canvas')
    surface.width = Math.max(1, Math.round(props.bitmap.width * scale))
    surface.height = Math.max(1, Math.round(props.bitmap.height * scale))
    const context = surface.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('Look previews are unavailable.')
    context.drawImage(props.bitmap, 0, 0, surface.width, surface.height)
    const source = context.getImageData(0, 0, surface.width, surface.height)
    for (const name of namedLooks) {
      const pixels = await renderPresetFrame(source, namedPreset(name, seed), cancellation.signal)
      if (cancellation.signal.aborted) return
      context.putImageData(pixels, 0, 0)
      previews.value = { ...previews.value, items: [...previews.value.items, { name, thumbnail: surface.toDataURL('image/png') }] }
    }
    previews.value = { ...previews.value, kind: 'ready', message: 'Draft previews of your image.' }
  } catch (error) {
    if (!cancellation.signal.aborted) previews.value = { ...previews.value, kind: 'error', message: error instanceof Error ? error.message : 'Look previews could not be created.' }
  }
}
watch(() => props.preset.seed, (seed) => {
  lookCancellation.abort()
  lookCancellation = new AbortController()
  previews.value = { kind: 'building', items: [], message: 'Building look previews…' }
  void buildLookPreviews(seed, lookCancellation)
}, { immediate: true })


function publish(preset: Preset): void {
  published = JSON.stringify(preset)
  emit('change', preset)
}
watch(() => props.preset, (preset) => {
  if (JSON.stringify(preset) === published) { published = ''; return }
  baseline.value = snapshotPreset(preset)
  amount.value = 100
  look.value = ''
})
watch(() => props.restoreVersion, () => { baseline.value = snapshotPreset(props.preset); amount.value = 100 })

function applyLook(selected: NamedLook): void {
  look.value = selected
  const preset = namedPreset(selected, props.preset.seed)
  baseline.value = snapshotPreset(preset)
  amount.value = 100
  publish(preset)
  if (gallery.value) { gallery.value.open = false; gallery.value.querySelector<HTMLElement>('summary')?.focus() }
}
function changeAmount(event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  amount.value = target.valueAsNumber
  look.value = ''
  publish(scaleFry(baseline.value, amount.value))
}
function toggleLock(key: string): void {
  if (locks.value.has(key)) locks.value.delete(key)
  else locks.value.add(key)
}
function randomize(): void {
  look.value = ''
  let seed = crypto.getRandomValues(new Uint32Array(1))[0]!
  if (seed === props.preset.seed) seed = (seed + 1) >>> 0
  const preset = randomizePreset(props.preset, locks.value, seed)
  baseline.value = snapshotPreset(preset)
  amount.value = 100
  publish(preset)
}
function closeComparison(): void {
  comparisonGeneration += 1
  comparisonCancellation?.abort()
  comparisonCancellation = null
  comparisonBusy.value = false
  candidates.value = []
  dialog.value?.close()
}
async function compare(): Promise<void> {
  const generation = ++comparisonGeneration
  const cancellation = new AbortController()
  comparisonCancellation = cancellation
  const startingPreset = snapshotPreset(props.preset)
  candidates.value = []
  comparisonStatus.value = 'Building five draft previews…'
  comparisonBusy.value = true
  selectedAmount.value = 60
  dialog.value?.showModal()
  try {
    const scale = Math.min(1, 240 / Math.max(props.bitmap.width, props.bitmap.height))
    const surface = document.createElement('canvas')
    surface.width = Math.max(1, Math.round(props.bitmap.width * scale))
    surface.height = Math.max(1, Math.round(props.bitmap.height * scale))
    const context = surface.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('Draft previews are unavailable. Close this panel and try again.')
    context.drawImage(props.bitmap, 0, 0, surface.width, surface.height)
    const source = context.getImageData(0, 0, surface.width, surface.height)
    const results = []
    for (const amount of fryAmounts) {
      const preset = scaleFry(startingPreset, amount)
      const pixels = await renderPresetFrame(source, preset, cancellation.signal)
      if (generation !== comparisonGeneration) return
      context.putImageData(pixels, 0, 0)
      results.push({ preset, amount, thumbnail: surface.toDataURL('image/png') })
    }
    candidates.value = results
    comparisonStatus.value = 'Draft previews share one preset and noise pattern. Applying a level renders the full image.'
  } catch (error) {
    if (generation === comparisonGeneration) comparisonStatus.value = error instanceof Error ? error.message : 'Draft previews could not be created.'
  } finally {
    if (generation === comparisonGeneration) comparisonBusy.value = false
  }
}
function applyCandidate(): void {
  const candidate = candidates.value.find((item) => item.amount === selectedAmount.value)
  if (!candidate) return
  look.value = ''
  baseline.value = snapshotPreset(candidate.preset)
  amount.value = 100
  publish(candidate.preset)
  closeComparison()
}
onUnmounted(() => { lookCancellation.abort(); comparisonGeneration += 1; comparisonCancellation?.abort() })
</script>

<template>
  <section class="preset-looks" aria-label="Presets">
    <div class="controls-heading"><span class="eyebrow">Preset</span></div>
    <details ref="gallery" class="look-gallery" open>
      <summary>Choose a look <span>{{ look || 'Current settings' }}</span></summary>
      <p class="look-status" aria-hidden="true">Draft previews of your image</p>
      <div class="look-grid" :aria-busy="previews.kind === 'building'">
        <button v-for="name in namedLooks" :key="name" type="button" :disabled="disabled" :aria-pressed="look === name" @click="applyLook(name)">
          <img v-if="previews.items.find(item => item.name === name)" :src="previews.items.find(item => item.name === name)?.thumbnail" alt="">
          <span v-else class="look-placeholder" aria-hidden="true"></span><span>{{ name }}</span>
        </button>
      </div>
    </details>
    <details ref="menu" class="preset-menu"><summary role="button">Preset actions</summary><div class="menu-items"><button type="button" :disabled="disabled" @click="presetFile('load')">Load preset</button><button type="button" :disabled="disabled" @click="presetFile('save')">Save preset as…</button></div></details>
    <label class="fry-amount">Fry level <span class="amount-value" aria-hidden="true">{{ amount }}%</span><input type="range" aria-label="Fry level" min="0" max="100" :value="amount" :disabled="disabled" @pointerdown="emit('gestureBegin')" @pointerup="emit('gestureEnd')" @pointercancel="emit('gestureEnd')" @change="emit('gestureEnd')" @input="changeAmount"><span class="fry-endpoints"><span>Original</span><span>Full preset</span></span></label>
    <div class="fry-buttons"><button type="button" :disabled="disabled || neutral" @click="compare"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M12 4v16m-5-8h2m6 0h2"/></svg>Compare 5</button><button type="button" :disabled="disabled" @click="randomize"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h3c4 0 8 12 12 12h3m-4-4 4 4-4 4M3 18h3c2 0 4-3 5-5m3-5c1-1 2-2 4-2h3m-4-4 4 4-4 4"/></svg>Randomize</button></div>
    <details class="random-locks"><summary>Randomization locks</summary><template v-for="(effect, index) in preset.effects" :key="effect.id"><label v-for="parameter in randomParameters(effect)" :key="parameter.key"><input type="checkbox" :aria-label="`Lock ${parameter.label} ${index + 1}`" :checked="locks.has(parameterKey(effect, parameter.key))" :disabled="disabled" @change="toggleLock(parameterKey(effect, parameter.key))">Lock {{ parameter.label }} <small>Effect {{ index + 1 }}</small></label></template></details>

  </section>
  <dialog ref="dialog" class="variation-dialog" aria-labelledby="variation-title" @cancel.prevent="closeComparison">
    <h2 id="variation-title">Choose a fry level</h2>
    <p role="status">{{ comparisonStatus }}</p>
    <fieldset :disabled="comparisonBusy"><legend>Five levels from the current preset</legend><div class="variation-grid"><label v-for="candidate in candidates" :key="candidate.amount" class="variation-choice"><img :src="candidate.thumbnail" :alt="`Draft at ${candidate.amount}% fry level`"><span><input v-model="selectedAmount" type="radio" name="variation" :value="candidate.amount">{{ candidate.amount }}% fry</span></label></div></fieldset>
    <div class="variation-actions"><button type="button" @click="closeComparison">Cancel</button><button type="button" :disabled="comparisonBusy || candidates.length !== 5" @click="applyCandidate">Apply selected level</button></div>
  </dialog>
</template>
