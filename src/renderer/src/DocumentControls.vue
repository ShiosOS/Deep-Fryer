<script setup lang="ts">
import type { RecoveryOffer } from '../../shared/documents'
import { ref, watchEffect } from 'vue'
const props = defineProps<{ busy: boolean; hasImage: boolean; ready: boolean; recoveryStatus: string; recoveryOffer: RecoveryOffer }>()
defineEmits<{ openProject: []; saveProject: []; loadPreset: []; savePreset: []; pasteImage: []; restoreRecovery: []; discardRecovery: [] }>()
const dialog = ref<HTMLDialogElement | null>(null)
watchEffect(() => { if (props.recoveryOffer && dialog.value && !dialog.value.open) dialog.value.showModal() })
</script>

<template>
  <section class="document-controls" aria-label="Projects and recipes">
    <div class="document-buttons"><button type="button" :disabled="busy" @click="$emit('openProject')">Open project</button><button type="button" :disabled="busy" @click="$emit('pasteImage')">Paste image</button><button type="button" :disabled="busy || !hasImage || !ready" @click="$emit('saveProject')">Save project as…</button><button type="button" :disabled="busy || !hasImage" @click="$emit('loadPreset')">Load recipe</button><button type="button" :disabled="busy || !hasImage || !ready" @click="$emit('savePreset')">Save recipe as…</button></div>
    <p class="recovery-status" role="note">{{ recoveryStatus }}</p>
    <details><summary>About projects and recovery</summary><p>Projects embed your original image. Recipes store settings, relative points and their saved seed. Loading a recipe replaces the current seed.</p><p>Recovery keeps two completed edits in the app's local user data folder, in recovery. A clean exit or Discard removes them. Interrupted work expires after seven days.</p></details>
  </section>
  <Teleport to="body">
      <dialog v-if="recoveryOffer" ref="dialog" class="recovery-dialog" role="alertdialog" aria-labelledby="recovery-title" @cancel.prevent>
        <h2 id="recovery-title">Restore interrupted work?</h2><p>A valid recovery copy of <strong>{{ recoveryOffer.name }}</strong> was saved at {{ new Date(recoveryOffer.savedAt).toLocaleString() }}.</p><p>Restore resumes editing from that checkpoint. Discard permanently removes both local recovery copies.</p><p class="recovery-location">{{ recoveryOffer.directory }}</p><div class="document-buttons"><button type="button" :disabled="busy" @click="$emit('restoreRecovery')">Restore work</button><button type="button" :disabled="busy" @click="$emit('discardRecovery')">Discard recovery</button></div>
      </dialog>
  </Teleport>
</template>
