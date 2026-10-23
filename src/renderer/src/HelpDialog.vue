<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref } from 'vue'
import Modal from './Modal.vue'
import { effectOptions, type EffectKind } from '../../shared/preset'
import { effectHelp, helpImage } from './help-content'
import contrastGif from './assets/help/contrast-demo.gif'
const modal = ref<InstanceType<typeof Modal> | null>(null)
const tabs = ['Quick start', 'Effects', 'Layering', 'Points', 'Saving & export'] as const
const tab = ref(0)
const selectedEffect = ref<EffectKind>('contrast')
const help = computed(() => effectHelp[selectedEffect.value])
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
const paused = ref(reduced.matches)
const motionChanged = () => { if (reduced.matches) paused.value = true }
reduced.addEventListener('change', motionChanged)
onUnmounted(() => reduced.removeEventListener('change', motionChanged))
async function tabKey(event: KeyboardEvent): Promise<void> {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  tab.value = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (tab.value + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
  await nextTick()
  document.getElementById(`help-tab-${tab.value}`)?.focus()
}
defineExpose({ open: () => { paused.value = reduced.matches; modal.value?.open() } })
</script>
<template>
  <Modal ref="modal" title="Help" class="help-dialog">
    <div class="help-tabs" role="tablist" aria-label="Help topics" @keydown="tabKey"><button v-for="(title, index) in tabs" :id="`help-tab-${index}`" :key="title" role="tab" :aria-selected="tab === index" aria-controls="help-panel" :tabindex="tab === index ? 0 : -1" @click="tab = index">{{ title }}</button></div>
    <section id="help-panel" class="help-body" role="tabpanel" :aria-labelledby="`help-tab-${tab}`" tabindex="0">
      <template v-if="tab === 0">
        <h3>Edit an image</h3><p class="lead">Open a picture, adjust its effects, and save the result.</p>
        <img class="guide-shot" :src="helpImage('editor')" alt="Deep Fryer editor with the compact preset and effects inspector on the left, a large image canvas, and Help, Settings and Export in the header">
        <ol class="steps"><li><strong>Open an image.</strong>Use File → Open image, paste a copied image, or drop one PNG or JPEG here.</li><li><strong>Pick a preset.</strong>Choose a built-in preset or load your own from Preset actions.</li><li><strong>Adjust the fry.</strong>Fry level scales the current preset toward neutral. Open an effect to change its settings.</li><li><strong>Export your image.</strong>Choose a format, dimensions and name. Save a project to keep editing later.</li></ol>
        <div class="tip">Undo restores the previous edit. Original shows the source without changing your settings. Compare 5 offers five draft fry levels. Randomization locks keep chosen parameters fixed.</div>
        <details class="tech-detail"><summary>Keyboard shortcuts</summary><p>Ctrl or Command + O opens an image. Ctrl or Command + S saves a project. Add Shift to export. Ctrl or Command + Z undoes an edit; Shift + Z redoes it. Focus the canvas and use + / − to zoom, 0 to fit, 1 for actual size, and arrow keys to pan.</p></details>
      </template>
      <template v-else-if="tab === 1">
        <label for="help-effect" class="sr-only">Choose an effect</label><select id="help-effect" v-model="selectedEffect" class="effect-select"><option v-for="effect in effectOptions" :key="effect.kind" :value="effect.kind">{{ effect.label }}</option></select>
        <h3>{{ help.name }}</h3><p class="lead">{{ help.short }}</p><p>{{ help.use }}</p>
        <div class="example-pair"><figure><img :src="helpImage('original')" alt="Before the effect"><figcaption>Before</figcaption></figure><figure><img :src="helpImage(selectedEffect)" :alt="`After ${help.name}, rendered by Deep Fryer`"><figcaption>After {{ help.name }}</figcaption></figure></div>
        <template v-if="selectedEffect === 'contrast'"><img class="demo-gif" :src="paused ? helpImage('contrast-poster') : contrastGif" :alt="paused ? 'Static contrast comparison at 1x, 2x and 5x' : 'Animation of the same image at 1x, 2x and 5x contrast'"><button type="button" class="demo-toggle" @click="paused = !paused">{{ paused ? 'Play animation' : 'Pause animation' }}</button></template>
        <details class="tech-detail"><summary>Technical detail</summary><p>{{ help.technical }}</p></details>
        <details class="tech-detail"><summary>What does Effect strength do?</summary><p>Effect strength blends this effect with the image just before it. At 0%, it is hidden. At 100%, its full result is used. It is separate from intensity, quality or bulge amount. Disabling an effect bypasses it without losing its settings.</p></details>
      </template>
      <template v-else-if="tab === 2">
        <h3>Effect order</h3><p class="lead">Each effect changes the result of the effect above it.</p><p>JPEG damage followed by Sharpen emphasizes compression blocks. Sharpen followed by JPEG damage compresses the sharpened edges.</p>
        <div class="example-pair"><figure><img :src="helpImage('jpeg-sharpen')" alt="JPEG damage followed by Sharpen"><figcaption>JPEG damage, then Sharpen</figcaption></figure><figure><img :src="helpImage('sharpen-jpeg')" alt="Sharpen followed by JPEG damage"><figcaption>Sharpen, then JPEG damage</figcaption></figure></div>
        <div class="tip">Open More controls on an effect to move it up or down, duplicate it, or remove it. Its settings move with it.</div><details class="tech-detail"><summary>Technical detail</summary><p>The output of one effect becomes the input to the next. Effect strength blends against that effect's input. Reordering can change colors, texture, transparency and distortion. Noise uses each effect's saved identity, so moving it keeps its pattern stable.</p></details>
      </template>
      <template v-else-if="tab === 3">
        <h3>Adjust a bulge or pinch</h3><p class="lead">A point marks the center of the distortion. Its radius controls the affected area.</p><img class="guide-shot" :src="helpImage('points')" alt="Actual editor showing a selected distortion center and its radius on the image">
        <div class="point-key"><p><strong>X position</strong>0% is the left edge; 100% is the right edge.</p><p><strong>Y position</strong>0% is the top edge; 100% is the bottom edge.</p><p><strong>Radius</strong>A percentage of the shorter image side. Zoom does not change the saved radius.</p><p><strong>Bulge / pinch amount</strong>Positive values bulge outward. Negative values pinch inward. Zero leaves the area unchanged.</p></div>
        <div class="tip">Drag the numbered center to move a point. Focus its handle and use arrow keys for small moves, Shift + arrows for larger moves, or Delete to remove it. Effect strength blends the warp separately.</div>
        <details class="tech-detail"><summary>Technical detail</summary><p>Points are relative to the image and scale with export dimensions. Overlapping points apply in effect order. Radius fades to no displacement at its edge. Sampling respects transparency.</p></details>
      </template>
      <template v-else>
        <h3>Choose what to save</h3><p class="lead">Save a project to keep editing. Save a preset to reuse effects. Export an image to share the result.</p>
        <div class="file-choices"><div><strong>Project</strong><p>A .deepfryer file keeps the original image, ordered effects and noise seed.</p></div><div><strong>Preset</strong><p>A .frypreset file keeps effects, relative points and seed without the image.</p></div><div><strong>Exported image</strong><p>A finished PNG, JPEG or WebP. Each save dialog has its own editable name.</p></div></div>
        <p><strong>PNG</strong> preserves transparency and adds no lossy compression. <strong>JPEG</strong> replaces transparency with your chosen background. <strong>WebP</strong> supports transparency with lossy compression.</p><p>Export resizes the source first, then applies effects at that size. Inspect final output shows the finished image at actual size. Save inspected snapshot saves the version shown. Renaming does not change its pixels. Changing the image, effects or output settings requires a new inspection.</p>
        <div class="tip">Save as… opens a native file chooser. Existing files stay protected, even if the chooser offers to replace one. Choose a new destination. Canceling does not save a file.</div>
        <details class="tech-detail"><summary>Projects and recovery</summary><p>Current projects and presets use version 2. Earlier v1 files open with their original parameter meaning. Older applications refuse v2 files. Recovery keeps two completed edits locally for up to seven days after an interruption. A clean exit or Discard removes recovery copies. Appearance settings are saved separately and never enter Undo or projects.</p></details>
      </template>
    </section>
  </Modal>
</template>
