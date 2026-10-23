<script setup lang="ts">
import { nextTick, ref } from 'vue'
defineProps<{ title: string }>()
const emit = defineEmits<{ closed: [] }>()
const dialog = ref<HTMLDialogElement | null>(null)
let opener: HTMLElement | null = null
function open(): void {
  if (dialog.value?.open) return
  opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
  dialog.value?.showModal()
}
function close(): void { dialog.value?.close() }
async function closed(): Promise<void> {
  emit('closed')
  await nextTick()
  if (opener?.isConnected && opener.getClientRects().length) opener.focus()
  else document.querySelector<HTMLElement>('[data-dialog-fallback]')?.focus()
}
defineExpose({ open, close })
</script>
<template>
  <dialog ref="dialog" class="modal" :aria-label="title" @cancel.prevent="close" @close="closed">
    <div class="modal-heading"><h2>{{ title }}</h2><button type="button" :aria-label="`Close ${title.toLowerCase()}`" @click="close">×</button></div>
    <slot />
  </dialog>
</template>
