<script setup lang="ts">
import { computed, nextTick, reactive, ref } from 'vue'
import { saveNameSchema } from '../../shared/documents'
import Modal from './Modal.vue'
const emit = defineEmits<{ save: [kind: 'project' | 'preset', name: string] }>()
const modal = ref<InstanceType<typeof Modal> | null>(null)
const input = ref<HTMLInputElement | null>(null)
const kind = ref<'project' | 'preset'>('project')
const names = reactive({ project: '', preset: '' })
const parsed = computed(() => saveNameSchema.safeParse(names[kind.value]))
async function open(target: 'project' | 'preset', sourceName: string): Promise<void> {
  kind.value = target
  if (!names[target]) names[target] = sourceName.replace(/\.[^.]+$/, '')
  await nextTick()
  modal.value?.open()
  input.value?.focus()
  input.value?.select()
}
function save(): void {
  if (!parsed.value.success) return
  modal.value?.close()
  emit('save', kind.value, parsed.value.data)
}
defineExpose({ open })
</script>
<template>
  <Modal ref="modal" :title="kind === 'project' ? 'Save project as' : 'Save preset as'">
    <form class="modal-content" @submit.prevent="save">
      <label class="name-field">{{ kind === 'project' ? 'Project name' : 'Preset name' }}<input ref="input" v-model="names[kind]" :aria-label="kind === 'project' ? 'Project name' : 'Preset name'" maxlength="200" required></label>
      <p>{{ kind === 'project' ? 'Keeps your original image and editable effects.' : 'Keeps effect settings so you can use them on another image.' }}</p>
      <p v-if="!parsed.success && names[kind]" class="control-error">Use a file name without path separators or reserved characters.</p>
      <div class="modal-actions"><button type="button" @click="modal?.close()">Cancel</button><button type="submit" class="primary" :disabled="!parsed.success">Save as…</button></div>
    </form>
  </Modal>
</template>
