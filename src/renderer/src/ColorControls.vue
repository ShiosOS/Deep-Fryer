<script setup lang="ts">
import { ref, watch } from 'vue'
import { colorControls, neutralColorSettings, parseColorSetting, type ColorKey, type ColorSettings } from './color'

const props = defineProps<{ settings: ColorSettings; disabled: boolean }>()
const emit = defineEmits<{ change: [settings: ColorSettings] }>()
const drafts = ref<Record<ColorKey, string>>({
  brightness: String(props.settings.brightness),
  contrast: String(props.settings.contrast),
  saturation: String(props.settings.saturation),
  levels: String(props.settings.levels)
})
const invalid = ref<ColorKey | null>(null)

watch(() => props.settings, (settings) => {
  for (const control of colorControls) drafts.value[control.key] = String(settings[control.key])
  invalid.value = null
})

function change(key: ColorKey, event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  drafts.value[key] = target.value
  const next = parseColorSetting(props.settings, key, target.value)
  invalid.value = next ? null : key
  if (next) emit('change', next)
}

function reset(): void {
  for (const control of colorControls) drafts.value[control.key] = String(neutralColorSettings[control.key])
  invalid.value = null
  emit('change', neutralColorSettings)
}
</script>

<template>
  <section class="color-controls" aria-label="Color controls">
    <div class="controls-heading"><span class="eyebrow">COLOR</span><button type="button" class="reset-button" :disabled="disabled" @click="reset">Reset color</button></div>
    <div v-for="control in colorControls" :key="control.key" class="color-control">
      <label :for="`${control.key}-range`">{{ control.label }}</label>
      <div class="color-inputs">
        <input :id="`${control.key}-range`" :aria-label="`${control.label} slider`" type="range" :min="control.min" :max="control.max" step="1" :value="settings[control.key]" :disabled="disabled" @input="change(control.key, $event)">
        <input :aria-label="`${control.label} value`" type="number" :min="control.min" :max="control.max" step="1" :value="drafts[control.key]" :disabled="disabled" :aria-invalid="invalid === control.key" @input="change(control.key, $event)">
      </div>
    </div>
    <p v-if="invalid" class="control-error" role="alert">Enter a whole number within the allowed range.</p>
  </section>
</template>
