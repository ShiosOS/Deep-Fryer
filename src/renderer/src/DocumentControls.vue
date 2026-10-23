<script setup lang="ts">
import type { RecoveryOffer } from '../../shared/documents'
import { ref, watchEffect } from 'vue'
const props = defineProps<{ busy: boolean; hasImage: boolean; ready: boolean; recoveryStatus: string; recoveryOffer: RecoveryOffer }>()
defineEmits<{ openImage: []; openProject: []; saveProject: []; pasteImage: []; restoreRecovery: []; discardRecovery: [] }>()
const dialog = ref<HTMLDialogElement | null>(null)
const menu = ref<HTMLDetailsElement | null>(null)
watchEffect(() => { if (props.recoveryOffer && dialog.value && !dialog.value.open) dialog.value.showModal() })
</script>

<template>
  <details ref="menu" class="file-menu">
    <summary role="button" aria-label="File" data-dialog-fallback>File</summary>
    <div class="menu-items">
      <div @click="menu && (menu.open = false)">
        <button class="open-button" type="button" :disabled="busy" @click="$emit('openImage')">Open image<kbd>Ctrl O</kbd></button>
        <button type="button" :disabled="busy" @click="$emit('pasteImage')">Paste image</button>
        <button type="button" :disabled="busy" @click="$emit('openProject')">Open project</button>
        <button type="button" :disabled="busy || !hasImage || !ready" @click="$emit('saveProject')">Save project as…</button>
      </div>
      <p class="recovery-status" role="note">{{ recoveryStatus }}</p>
    </div>
  </details>
  <Teleport to="body">
      <dialog v-if="recoveryOffer" ref="dialog" class="recovery-dialog" role="alertdialog" aria-labelledby="recovery-title" @cancel.prevent>
        <h2 id="recovery-title">Restore interrupted work?</h2><p>A valid recovery copy of <strong>{{ recoveryOffer.name }}</strong> was saved at {{ new Date(recoveryOffer.savedAt).toLocaleString() }}.</p><p>Restore resumes editing from that checkpoint. Discard permanently removes both local recovery copies.</p><p class="recovery-location">{{ recoveryOffer.directory }}</p><div class="document-buttons"><button type="button" :disabled="busy" @click="$emit('restoreRecovery')">Restore work</button><button type="button" :disabled="busy" @click="$emit('discardRecovery')">Discard recovery</button></div>
      </dialog>
  </Teleport>
</template>
