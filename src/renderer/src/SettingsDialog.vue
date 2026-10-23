<script setup lang="ts">
import { ref } from 'vue'
import { pinkPalettes, type Appearance } from '../../shared/appearance'
import Modal from './Modal.vue'
const props = defineProps<{ settings: Appearance; mode: 'light' | 'dark'; saving: boolean; notice: string }>()
const emit = defineEmits<{ save: [settings: Appearance, reset?: boolean] }>()
const modal = ref<InstanceType<typeof Modal> | null>(null)
function changeMode(mode: Appearance['mode']): void { emit('save', { ...props.settings, mode }) }
function select(selected: 'pink' | 'custom'): void {
  emit('save', { ...props.settings, palettes: { ...props.settings.palettes, [props.mode]: { ...props.settings.palettes[props.mode], selected } } })
}
function color(key: 'accent' | 'canvas' | 'panel', event: Event): void {
  if (!(event.target instanceof HTMLInputElement)) return
  const palette = props.settings.palettes[props.mode]
  emit('save', { ...props.settings, palettes: { ...props.settings.palettes, [props.mode]: { ...palette, custom: { ...palette.custom, [key]: event.target.value } } } })
}
function resetTheme(): void {
  emit('save', { ...props.settings, palettes: { ...props.settings.palettes, [props.mode]: { selected: 'pink', custom: { ...pinkPalettes[props.mode] } } } })
}
defineExpose({ open: () => modal.value?.open() })
</script>
<template>
  <Modal ref="modal" title="Settings">
    <div class="modal-content">
      <section class="settings-section"><h3>Appearance</h3><div class="segmented"><button v-for="value in (['light', 'dark', 'system'] as const)" :key="value" type="button" :aria-pressed="settings.mode === value" :disabled="saving" @click="changeMode(value)">{{ value[0]?.toUpperCase() }}{{ value.slice(1) }}</button></div><p>{{ settings.mode === 'system' ? `Follows your computer. Currently ${mode}.` : 'Choose System to follow your computer.' }}</p></section>
      <section class="settings-section"><h3>Theme</h3><div class="segmented"><button type="button" :aria-pressed="settings.palettes[mode].selected === 'pink'" :disabled="saving" @click="select('pink')"><span class="theme-swatch"></span>Pastel pink</button><button type="button" :aria-pressed="settings.palettes[mode].selected === 'custom'" :disabled="saving" @click="select('custom')">Custom colors</button></div>
        <div v-if="settings.palettes[mode].selected === 'custom'" class="color-fields"><label v-for="field in (['accent', 'canvas', 'panel'] as const)" :key="field" class="color-field">{{ field === 'panel' ? 'Panels' : field[0]?.toUpperCase() + field.slice(1) }}<span><code>{{ settings.palettes[mode].custom[field].toUpperCase() }}</code><input type="color" :aria-label="`${field === 'panel' ? 'Panels' : field[0]?.toUpperCase() + field.slice(1)} color`" :value="settings.palettes[mode].custom[field]" :disabled="saving" @change="color(field, $event)"></span></label></div><p>Set different colors for each appearance.</p>
      </section>
      <p v-if="notice" class="control-error" role="alert">{{ notice }}</p><button v-if="notice" type="button" :disabled="saving" @click="emit('save', settings, true)">Reset saved settings</button>
      <div class="modal-actions"><button type="button" :disabled="saving" @click="resetTheme">Reset this theme</button><button class="primary" type="button" :disabled="saving" @click="modal?.close()">Done</button></div>
    </div>
  </Modal>
</template>
