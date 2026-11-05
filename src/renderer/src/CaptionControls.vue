<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { compositionSchema, DEFAULT_CAPTION_SIZE, MAX_CAPTION_UNITS, type Composition } from '../../shared/composition'

const props = defineProps<{ composition: Composition; disabled: boolean; renderError: string }>()
const emit = defineEmits<{ change: [composition: Composition]; gestureBegin: []; gestureEnd: []; opened: []; error: [message: string] }>()
const top = ref('')
const bottom = ref('')
const size = ref(DEFAULT_CAPTION_SIZE)
const composing = ref(false)
const error = ref('')
const expanded = ref(false)
const hasText = computed(() => !!(top.value || bottom.value))
let published = ''
watch(() => JSON.stringify(props.composition), serialized => {
  if (serialized === published) { published = ''; return }
  top.value = props.composition.captions?.top ?? ''
  bottom.value = props.composition.captions?.bottom ?? ''
  size.value = props.composition.captions?.size ?? DEFAULT_CAPTION_SIZE
  error.value = ''
  if (props.composition.captions) expanded.value = true
}, { immediate: true, flush: 'sync' })

function publishDraft(): boolean {
  const result = compositionSchema.safeParse({ captions: { kind: 'top-bottom-v1', font: 'anton-regular-v1', top: top.value, bottom: bottom.value, size: size.value } })
  if (!result.success) {
    error.value = result.error.issues[0]?.message ?? 'Check the caption text.'
    return false
  }
  error.value = ''
  published = JSON.stringify(result.data)
  emit('change', result.data)
  return true
}
function finish(): void {
  if (composing.value) throw new Error('Finish composing the caption before saving or leaving. Your draft is still here.')
  if (!publishDraft()) throw new Error(error.value)
}
function input(anchor: 'top' | 'bottom', event: Event): void {
  if (!(event.target instanceof HTMLTextAreaElement)) return
  if (anchor === 'top') top.value = event.target.value
  else bottom.value = event.target.value
  if (!composing.value) publishDraft()
}
function end(): void {
  try { finish(); emit('gestureEnd') } catch (cause) { emit('error', cause instanceof Error ? cause.message : 'Check the caption text.') }
}
function clear(): void {
  top.value = ''; bottom.value = ''; size.value = DEFAULT_CAPTION_SIZE
  finish()
  emit('gestureEnd')
}
function toggle(event: Event): void {
  if (!(event.target instanceof HTMLDetailsElement)) return
  expanded.value = event.target.open
  if (expanded.value) emit('opened')
}
defineExpose({ finish })
</script>

<template>
  <details class="caption-controls" :open="expanded" @toggle="toggle">
    <summary>Captions<span v-if="composition.captions" class="caption-present" aria-label="Captions added">2</span></summary>
    <div class="caption-fields">
      <label>Top<textarea aria-label="Top caption" :value="top" :maxlength="MAX_CAPTION_UNITS" rows="2" placeholder="Add a top caption" :disabled="disabled" spellcheck="false" @focus="$emit('gestureBegin')" @blur="end" @input="input('top', $event)" @compositionstart="composing = true" @compositionend="composing = false; input('top', $event)" /></label>
      <label>Bottom<textarea aria-label="Bottom caption" :value="bottom" :maxlength="MAX_CAPTION_UNITS" rows="2" placeholder="Add a bottom caption" :disabled="disabled" spellcheck="false" @focus="$emit('gestureBegin')" @blur="end" @input="input('bottom', $event)" @compositionstart="composing = true" @compositionend="composing = false; input('bottom', $event)" /></label>
      <p v-if="error || renderError" class="control-error" role="alert">{{ error || renderError }}</p>
      <div class="caption-options"><details><summary>Text size</summary><label class="caption-size">{{ Math.round(size * 100) }}%<input v-model.number="size" aria-label="Caption size" type="range" min="0.04" max="0.16" step="0.01" :disabled="disabled || !hasText" @pointerdown="$emit('gestureBegin')" @keydown="$emit('gestureBegin')" @input="finish" @change="end" /></label><p>Fits up to three lines per caption.</p></details><button type="button" :disabled="disabled || !hasText" @click="clear">Clear</button></div>
    </div>
  </details>
</template>

<style scoped>
.caption-controls { border-bottom: 1px solid var(--line); padding-bottom: 16px; margin-bottom: 20px; }
.caption-controls > summary { font-size: 13px; font-weight: 600; }
.caption-present { float: right; font-size: 0; width: 6px; height: 6px; margin: 6px 2px; background: var(--control); border-radius: 50%; }
.caption-fields { padding-top: 14px; }
.caption-fields > label { display: block; font-size: 12px; margin-bottom: 10px; }
textarea { display: block; width: 100%; min-height: 52px; resize: vertical; margin-top: 5px; padding: 8px 10px; font: inherit; line-height: 1.4; background: var(--paper); color: var(--text); border: 1px solid var(--line); border-radius: 8px; }
textarea::placeholder { color: var(--muted); }
.caption-options { display: flex; gap: 10px; align-items: flex-start; justify-content: space-between; }
.caption-options details { flex: 1; padding-top: 6px; min-width: 0; }
.caption-options summary { font-size: 12px; color: var(--muted); }
.caption-options button { padding: 5px 10px; }
.caption-size { display: block; margin-top: 10px; font-size: 12px; }
.caption-options p { margin: 4px 0 0; font-size: 11px; }
</style>
