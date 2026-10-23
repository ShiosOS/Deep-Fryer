<script setup lang="ts">
import { computed, onUnmounted, ref, shallowRef, watch } from 'vue'
import { renderRecipeFrame } from './render-recipe-frame'
import { isNeutralEffect, type Recipe } from '../../shared/recipe'
import { snapshotRecipe } from './recipe-history'
import { fryAmounts, namedLooks, namedRecipe, parameterKey, randomizeRecipe, randomParameters, scaleFry, type NamedLook } from './recipe-looks'

const props = defineProps<{ recipe: Recipe; bitmap: ImageBitmap; disabled: boolean; restoreVersion: number }>()
const emit = defineEmits<{ change: [recipe: Recipe]; gestureBegin: []; gestureEnd: [] }>()
const look = ref<NamedLook>('Crispy color')
const amount = ref(100)
const baseline = shallowRef(snapshotRecipe(props.recipe))
const locks = ref(new Set<string>())
const dialog = ref<HTMLDialogElement | null>(null)
const candidates = shallowRef<Array<{ recipe: Recipe; amount: number; thumbnail: string }>>([])
const selectedAmount = ref(60)
const comparisonStatus = ref('')
const comparisonBusy = ref(false)
const neutral = computed(() => props.recipe.effects.every(isNeutralEffect))
let published = ''
let comparisonGeneration = 0
let comparisonCancellation: AbortController | null = null

function publish(recipe: Recipe): void {
  published = JSON.stringify(recipe)
  emit('change', recipe)
}
watch(() => props.recipe, (recipe) => {
  if (JSON.stringify(recipe) === published) { published = ''; return }
  baseline.value = snapshotRecipe(recipe)
  amount.value = 100
})
watch(() => props.restoreVersion, () => { baseline.value = snapshotRecipe(props.recipe); amount.value = 100 })

function applyLook(): void {
  const recipe = namedRecipe(look.value, props.recipe.seed)
  baseline.value = snapshotRecipe(recipe)
  amount.value = 100
  publish(recipe)
}
function changeAmount(event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  amount.value = target.valueAsNumber
  publish(scaleFry(baseline.value, amount.value))
}
function toggleLock(key: string): void {
  if (locks.value.has(key)) locks.value.delete(key)
  else locks.value.add(key)
}
function randomize(): void {
  let seed = crypto.getRandomValues(new Uint32Array(1))[0]!
  if (seed === props.recipe.seed) seed = (seed + 1) >>> 0
  const recipe = randomizeRecipe(props.recipe, locks.value, seed)
  baseline.value = snapshotRecipe(recipe)
  amount.value = 100
  publish(recipe)
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
  const startingRecipe = snapshotRecipe(props.recipe)
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
      const recipe = scaleFry(startingRecipe, amount)
      const pixels = await renderRecipeFrame(source, recipe, cancellation.signal)
      if (generation !== comparisonGeneration) return
      context.putImageData(pixels, 0, 0)
      results.push({ recipe, amount, thumbnail: surface.toDataURL('image/png') })
    }
    candidates.value = results
    comparisonStatus.value = 'Draft previews share one recipe and noise pattern. Applying a level renders the full image.'
  } catch (error) {
    if (generation === comparisonGeneration) comparisonStatus.value = error instanceof Error ? error.message : 'Draft previews could not be created.'
  } finally {
    if (generation === comparisonGeneration) comparisonBusy.value = false
  }
}
function applyCandidate(): void {
  const candidate = candidates.value.find((item) => item.amount === selectedAmount.value)
  if (!candidate) return
  baseline.value = snapshotRecipe(candidate.recipe)
  amount.value = 100
  publish(candidate.recipe)
  closeComparison()
}
onUnmounted(() => { comparisonGeneration += 1; comparisonCancellation?.abort() })
</script>

<template>
  <section class="recipe-looks" aria-label="Recipe looks">
    <div class="controls-heading"><span class="eyebrow">START WITH A LOOK</span></div>
    <label class="look-choice">Named look <select v-model="look" :disabled="disabled"><option v-for="name in namedLooks" :key="name">{{ name }}</option></select></label>
    <button type="button" :disabled="disabled" @click="applyLook">Apply named look</button>
    <label class="fry-amount">Fry amount <span class="amount-value" aria-hidden="true">{{ amount }}%</span><input type="range" aria-label="Fry amount" min="0" max="100" :value="amount" :disabled="disabled" @pointerdown="emit('gestureBegin')" @pointerup="emit('gestureEnd')" @pointercancel="emit('gestureEnd')" @change="emit('gestureEnd')" @input="changeAmount"></label>
    <button type="button" :disabled="disabled || neutral" @click="compare">Compare five levels</button>
    <details class="random-locks"><summary>Randomization locks</summary><template v-for="(effect, index) in recipe.effects" :key="effect.id"><label v-for="parameter in randomParameters(effect)" :key="parameter.key"><input type="checkbox" :aria-label="`Lock ${parameter.label} ${index + 1}`" :checked="locks.has(parameterKey(effect, parameter.key))" :disabled="disabled" @change="toggleLock(parameterKey(effect, parameter.key))">Lock {{ parameter.label }} <small>Effect {{ index + 1 }}</small></label></template></details>
    <button type="button" :disabled="disabled" @click="randomize">Randomize unlocked settings</button>
    <p class="jpeg-note">Locks keep selected values. Randomize creates a new saved noise pattern; point positions and effect order stay fixed.</p>
  </section>
  <dialog ref="dialog" class="variation-dialog" aria-labelledby="variation-title" @cancel.prevent="closeComparison">
    <h2 id="variation-title">Choose a fry level</h2>
    <p role="status">{{ comparisonStatus }}</p>
    <fieldset :disabled="comparisonBusy"><legend>Five levels from the current recipe</legend><div class="variation-grid"><label v-for="candidate in candidates" :key="candidate.amount" class="variation-choice"><img :src="candidate.thumbnail" :alt="`Draft at ${candidate.amount}% fry amount`"><span><input v-model="selectedAmount" type="radio" name="variation" :value="candidate.amount">{{ candidate.amount }}% fry</span></label></div></fieldset>
    <div class="variation-actions"><button type="button" @click="closeComparison">Cancel</button><button type="button" :disabled="comparisonBusy || candidates.length !== 5" @click="applyCandidate">Apply selected level</button></div>
  </dialog>
</template>
