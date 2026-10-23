<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { effectOptions, moveEffect, newEffect, recipeSchema, replaceEffect, type Effect, type EffectKind, type Recipe } from '../../shared/recipe'

const props = defineProps<{ recipe: Recipe; disabled: boolean; restoreVersion: number; selectedPointId: string | null }>()
const emit = defineEmits<{ change: [recipe: Recipe]; gestureBegin: []; gestureEnd: []; selectPoint: [id: string] }>()
const drafts = reactive<Record<string, string>>({})
const panelError = ref('')
watch(() => props.restoreVersion, () => { for (const key of Object.keys(drafts)) delete drafts[key]; panelError.value = '' })
function beginInput(event: Event): void {
  const target = event.target
  if (target instanceof HTMLInputElement && (target.type === 'number' || target.type === 'range' || target.type === 'color')) emit('gestureBegin')
}
function endInput(event: Event): void {
  const target = event.target
  if (event.type.startsWith('pointer') && (!(target instanceof HTMLInputElement) || target.type !== 'range')) return
  if (target instanceof HTMLInputElement && (target.type === 'number' || target.type === 'range' || target.type === 'color')) {
    emit('gestureEnd')
    for (const key of Object.keys(drafts)) delete drafts[key]
  }
}
function accept(next: Recipe): void {
  const parsed = recipeSchema.safeParse(next)
  if (parsed.success) { panelError.value = ''; emit('change', parsed.data) }
  else panelError.value = parsed.error.issues[0]?.message ?? 'Check the effect settings.'
}

function label(kind: EffectKind): string { return effectOptions.find((item) => item.kind === kind)?.label ?? kind }
function pointNumber(id: string): number { return props.recipe.effects.filter((effect) => effect.kind === 'bulge').findIndex((effect) => effect.id === id) + 1 }
function limits(kind: EffectKind): { min: number; max: number } {
  const option = effectOptions.find((item) => item.kind === kind)
  return { min: option?.min ?? 0, max: option?.max ?? 100 }
}
function raw(effect: Effect, key: string, value: number): string { return drafts[`${effect.id}:${key}`] ?? String(value) }
function invalid(effect: Effect, key: string, value: number, min: number, max: number): boolean {
  const text = raw(effect, key, value)
  const number = Number(text)
  return text.trim() === '' || !Number.isInteger(number) || number < min || number > max
}
function changeNumber(effect: Effect, key: 'value' | 'mix' | 'quality' | 'passes' | 'x' | 'y' | 'radius' | 'strength', event: Event, min: number, max: number): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  drafts[`${effect.id}:${key}`] = target.value
  const value = Number(target.value)
  if (target.value.trim() === '' || !Number.isInteger(value) || value < min || value > max) return
  const next = replaceEffect(props.recipe, { ...effect, [key]: effect.kind === 'bulge' && (key === 'x' || key === 'y' || key === 'radius') ? value / 100 : value })
  accept(next)
}
function changeBackground(effect: Extract<Effect, { kind: 'jpeg' }>, event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  const next = replaceEffect(props.recipe, { ...effect, background: target.value })
  accept(next)
}
function changeEnabled(effect: Effect, event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  const next = replaceEffect(props.recipe, { ...effect, enabled: target.checked })
  accept(next)
}
function add(kind: EffectKind): void {
  accept({ ...props.recipe, effects: [...props.recipe.effects, newEffect(kind)] })
}
function duplicate(effect: Effect): void {
  const index = props.recipe.effects.findIndex((item) => item.id === effect.id)
  const effects = [...props.recipe.effects]
  effects.splice(index + 1, 0, { ...effect, id: crypto.randomUUID() })
  accept({ ...props.recipe, effects })
}
function remove(id: string): void { emit('change', { ...props.recipe, effects: props.recipe.effects.filter((effect) => effect.id !== id) }) }
function selectEffect(event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLSelectElement) || !target.value) return
  const option = effectOptions.find((item) => item.kind === target.value)
  if (option) add(option.kind)
  target.value = ''
}
function changeSeed(event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  const seed = Number(target.value)
  if (Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff) emit('change', { ...props.recipe, seed })
}
function resetColor(): void {
  for (const key of Object.keys(drafts)) delete drafts[key]
  emit('change', { ...props.recipe, effects: props.recipe.effects.map((effect) => {
    switch (effect.kind) {
      case 'brightness': return { ...effect, value: 0 }
      case 'contrast': case 'saturation': return { ...effect, value: 100 }
      case 'levels': return { ...effect, value: 256 }
      default: return effect
    }
  }) })
}
</script>

<template>
  <section class="effects-panel" aria-label="Effects" @focusin="beginInput" @focusout="endInput" @pointerdown="beginInput" @pointerup="endInput" @pointercancel="endInput" @change.capture="endInput">
    <div class="controls-heading"><span class="eyebrow">EFFECTS · TOP TO BOTTOM</span><button type="button" class="reset-button" :disabled="disabled" @click="resetColor">Reset color</button></div>
    <div v-for="(effect, index) in recipe.effects" :key="effect.id" class="effect-card" :class="{ 'selected-point-card': effect.kind === 'bulge' && selectedPointId === effect.id }" :data-effect-id="effect.id" :data-effect-kind="effect.kind">
      <div class="effect-heading">
        <label class="effect-enabled"><input type="checkbox" :checked="effect.enabled" :disabled="disabled" :aria-label="`Enable ${label(effect.kind)} ${index + 1}`" @change="changeEnabled(effect, $event)"><span>{{ label(effect.kind) }}</span></label>
        <div class="effect-actions"><button type="button" :aria-label="`Move ${label(effect.kind)} up`" :disabled="disabled || index === 0" @click="emit('change', moveEffect(recipe, effect.id, -1))">↑</button><button type="button" :aria-label="`Move ${label(effect.kind)} down`" :disabled="disabled || index === recipe.effects.length - 1" @click="emit('change', moveEffect(recipe, effect.id, 1))">↓</button><button type="button" :aria-label="`Duplicate ${label(effect.kind)}`" :disabled="disabled" @click="duplicate(effect)">⧉</button><button type="button" :aria-label="`Remove ${label(effect.kind)}`" :disabled="disabled" @click="remove(effect.id)">×</button></div>
      </div>
      <div v-if="effect.kind !== 'jpeg' && effect.kind !== 'bulge'" class="color-control">
        <label :for="`${effect.id}-value`">{{ label(effect.kind) }}</label>
        <div class="color-inputs"><input :id="`${effect.id}-value`" type="range" :aria-label="`${label(effect.kind)} slider`" :min="limits(effect.kind).min" :max="limits(effect.kind).max" :value="effect.value" :disabled="disabled" @input="changeNumber(effect, 'value', $event, limits(effect.kind).min, limits(effect.kind).max)"><input type="number" :aria-label="`${label(effect.kind)} value`" :min="limits(effect.kind).min" :max="limits(effect.kind).max" :value="raw(effect, 'value', effect.value)" :aria-invalid="invalid(effect, 'value', effect.value, limits(effect.kind).min, limits(effect.kind).max)" :disabled="disabled" @input="changeNumber(effect, 'value', $event, limits(effect.kind).min, limits(effect.kind).max)"></div>
      </div>
      <template v-else-if="effect.kind === 'jpeg'">
        <div class="color-control"><label>JPEG quality</label><div class="color-inputs"><input type="range" aria-label="JPEG quality slider" min="1" max="100" :value="effect.quality" :disabled="disabled" @input="changeNumber(effect, 'quality', $event, 1, 100)"><input type="number" aria-label="JPEG quality value" min="1" max="100" :value="raw(effect, 'quality', effect.quality)" :aria-invalid="invalid(effect, 'quality', effect.quality, 1, 100)" :disabled="disabled" @input="changeNumber(effect, 'quality', $event, 1, 100)"></div></div>
        <div class="color-control"><label>JPEG passes</label><div class="color-inputs"><input type="range" aria-label="JPEG passes slider" min="0" max="8" :value="effect.passes" :disabled="disabled" @input="changeNumber(effect, 'passes', $event, 0, 8)"><input type="number" aria-label="JPEG passes value" min="0" max="8" :value="raw(effect, 'passes', effect.passes)" :aria-invalid="invalid(effect, 'passes', effect.passes, 0, 8)" :disabled="disabled" @input="changeNumber(effect, 'passes', $event, 0, 8)"></div></div>
        <label class="background-control">JPEG background <input type="color" aria-label="JPEG background" :value="effect.background" :disabled="disabled" @input="changeBackground(effect, $event)"></label>
        <p class="jpeg-note">JPEG flattens transparency against this color when passes are above zero.</p>
      </template>
      <template v-else>
        <button type="button" class="point-select" :aria-label="`Select distortion point ${pointNumber(effect.id)}`" :aria-pressed="selectedPointId === effect.id" @click="emit('selectPoint', effect.id)">Point {{ pointNumber(effect.id) }} · Select on image</button>
        <p class="jpeg-note">{{ effect.strength >= 0 ? 'Bulge' : 'Pinch' }} · center and radius use image percentages.</p>
        <div v-for="field in (['x', 'y', 'radius', 'strength'] as const)" :key="field" class="color-control">
          <label :for="`${effect.id}-${field}`">{{ field === 'x' ? 'X position %' : field === 'y' ? 'Y position %' : field === 'radius' ? 'Radius %' : 'Strength' }}</label>
          <div class="color-inputs">
            <input :id="`${effect.id}-${field}`" type="range" :aria-label="`Bulge ${field} slider`" :min="field === 'strength' ? -100 : field === 'radius' ? 1 : 0" max="100" :value="field === 'strength' ? effect.strength : Math.round(effect[field] * 100)" :disabled="disabled" @input="changeNumber(effect, field, $event, field === 'strength' ? -100 : field === 'radius' ? 1 : 0, 100)">
            <input type="number" :aria-label="`Bulge ${field} value`" :min="field === 'strength' ? -100 : field === 'radius' ? 1 : 0" max="100" :value="raw(effect, field, field === 'strength' ? effect.strength : Math.round(effect[field] * 100))" :disabled="disabled" @input="changeNumber(effect, field, $event, field === 'strength' ? -100 : field === 'radius' ? 1 : 0, 100)" @keydown.enter="($event.target as HTMLInputElement).blur()">
          </div>
        </div>
      </template>
      <div class="color-control mix-control"><label>Mix</label><div class="color-inputs"><input type="range" :aria-label="`${label(effect.kind)} mix slider`" min="0" max="100" :value="effect.mix" :disabled="disabled" @input="changeNumber(effect, 'mix', $event, 0, 100)"><input type="number" :aria-label="`${label(effect.kind)} mix value`" min="0" max="100" :value="raw(effect, 'mix', effect.mix)" :aria-invalid="invalid(effect, 'mix', effect.mix, 0, 100)" :disabled="disabled" @input="changeNumber(effect, 'mix', $event, 0, 100)"></div></div>
    </div>
    <div class="add-effect"><label for="effect-kind">Add effect</label><select id="effect-kind" :disabled="disabled" @change="selectEffect"><option value="">Choose an effect…</option><option v-for="option in effectOptions" :key="option.kind" :value="option.kind">{{ option.label }}</option></select></div>
    <label class="seed-control">Noise pattern <input type="number" aria-label="Noise pattern" min="0" max="4294967295" :value="recipe.seed" :disabled="disabled" @change="changeSeed"></label>
    <p v-if="panelError" class="control-error" role="alert">{{ panelError }}</p>
  </section>
</template>
