import { computed, onUnmounted, ref, shallowRef, watch, type Ref } from 'vue'
import type { EditableDocument, RecoveryOffer } from '../../shared/documents'
import type { OpenImage } from '../../shared/image'
import type { Preset } from '../../shared/preset'
import { newEdit, snapshotEdit, type EditState } from '../../shared/edit'

export type FileOperation = 'opening' | 'exporting'
type Notice = { kind: 'info' | 'success' | 'error'; text: string }
type ProjectBaseline = { kind: 'unsaved' } | { kind: 'saved'; document: EditableDocument }
type DocumentOwner = {
  busy: Readonly<Ref<boolean>>
  fileBusy: Readonly<Ref<boolean>>
  source: () => OpenImage | null
  edit: () => EditState
  ready: () => boolean
  gestureActive: () => boolean
  finishGesture: () => void
  cancelPreparation: () => void
  setOperation: (operation: FileOperation | 'idle') => void
  finishOperation: () => void
  report: (notice: Notice) => void
  publish: (source: OpenImage, edit: EditState, confirm: () => Promise<boolean>) => Promise<boolean>
  applyPreset: (preset: Preset) => void
}

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : 'Something went wrong. Try again.'
}

export function useDocumentFiles(owner: DocumentOwner) {
  const recoveryOffer = ref<RecoveryOffer>(null)
  const recoveryStatus = ref('Checking for interrupted work…')
  const baseline = shallowRef<ProjectBaseline>({ kind: 'unsaved' })
  const active = ref(false)
  const closing = ref(false)
  const recoveryState = ref<'checking' | 'ready' | 'failed'>('checking')
  const locked = computed(() => active.value || closing.value || recoveryState.value === 'checking')
  const sourceMatchesBaseline = computed(() => {
    const source = owner.source()
    if (!source || baseline.value.kind === 'unsaved') return false
    const saved = baseline.value.document.source
    return source.name === saved.name && source.mime === saved.mime && source.bytes.length === saved.bytes.length &&
      source.bytes.every((byte, index) => byte === saved.bytes[index])
  })
  const dirty = computed(() => {
    if (!owner.source()) return false
    return baseline.value.kind === 'unsaved' || !sourceMatchesBaseline.value ||
      JSON.stringify(owner.edit()) !== JSON.stringify(baseline.value.document.edit)
  })
  let checkpointTimer: ReturnType<typeof setTimeout> | null = null

  function cancelCheckpoint(): void {
    if (checkpointTimer) clearTimeout(checkpointTimer)
    checkpointTimer = null
  }
  function current(): EditableDocument | null {
    const source = owner.source()
    return source ? { source: { name: source.name, mime: source.mime, bytes: source.bytes }, edit: owner.edit() } : null
  }
  function saved(document: EditableDocument): void {
    baseline.value = { kind: 'saved', document: {
      source: { ...document.source, bytes: new Uint8Array(document.source.bytes) }, edit: snapshotEdit(document.edit)
    } }
  }
  async function saveCurrent(suggestedName: string): Promise<boolean> {
    owner.finishGesture()
    const document = current()
    if (!document) return true
    const result = await window.documentBridge.saveProject({ document, suggestedName })
    if (result.kind !== 'saved') {
      owner.report({ kind: 'info', text: 'Project save canceled. Your current edit is unchanged.' })
      return false
    }
    saved(document)
    owner.report({ kind: 'success', text: `Saved ${result.name}. Move this project anywhere to continue editing.` })
    return true
  }
  async function confirmLeaving(): Promise<boolean> {
    owner.finishGesture()
    if (!dirty.value) return true
    const choice = await window.documentBridge.confirmUnsaved()
    if (choice === 'cancel') return false
    if (choice === 'discard') return true
    const name = owner.source()?.name.replace(/\.[^.]+$/, '') || 'Untitled'
    return saveCurrent(`${name}.deepfryer`)
  }
  async function run(operation: FileOperation, action: () => Promise<void>, allowRecovery = false): Promise<void> {
    if (locked.value || owner.busy.value || recoveryOffer.value && !allowRecovery) return
    cancelCheckpoint()
    owner.finishGesture()
    active.value = true
    owner.setOperation(operation)
    try { await action() } catch (error) { owner.report({ kind: 'error', text: describeError(error) }) }
    finally { owner.finishOperation(); active.value = false; scheduleCheckpoint() }
  }
  async function load(provider: () => Promise<OpenImage | null>): Promise<void> {
    await run('opening', async () => {
      const source = await provider()
      if (source && await owner.publish(source, newEdit(), confirmLeaving)) baseline.value = { kind: 'unsaved' }
    })
  }
  function scheduleCheckpoint(): void {
    cancelCheckpoint()
    if (locked.value || recoveryState.value !== 'ready' || !owner.ready() || owner.gestureActive() || recoveryOffer.value) return
    checkpointTimer = setTimeout(() => {
      checkpointTimer = null
      if (locked.value || recoveryState.value !== 'ready' || recoveryOffer.value || !owner.ready() || owner.gestureActive()) return
      const document = current()
      if (!document) return
      void window.documentBridge.checkpoint(document).then(() => {
        recoveryStatus.value = 'Recovery saved. Clean exit or Discard removes local recovery copies.'
      }).catch((error: unknown) => {
        recoveryStatus.value = `Recovery could not be saved. ${describeError(error)}`
      })
    }, 900)
  }
  async function openProject(): Promise<void> {
    await run('opening', async () => {
      const document = await window.documentBridge.openProject()
      if (!document) return
      if (await owner.publish(document.source, document.edit, confirmLeaving)) saved(document)
    })
  }
  async function saveProject(suggestedName: string): Promise<void> {
    if (!owner.ready()) return
    await run('exporting', async () => {
      await saveCurrent(suggestedName)
    })
  }
  async function loadPreset(): Promise<void> {
    if (!owner.source()) return
    await run('opening', async () => {
      const candidate = await window.documentBridge.openPreset()
      if (candidate) owner.applyPreset(candidate)
    })
  }
  async function savePreset(suggestedName: string): Promise<void> {
    if (!owner.ready()) return
    await run('exporting', async () => {
      const document = current()
      if (!document) return
      const result = await window.documentBridge.savePreset({ preset: document.edit.preset, suggestedName })
      if (result.kind === 'saved') owner.report({ kind: 'success', text: `Saved ${result.name}. This preset contains settings and its saved seed, without the source image.` })
      else owner.report({ kind: 'info', text: 'Preset save canceled. No file was saved.' })
    })
  }
  async function checkRecovery(): Promise<void> {
    owner.setOperation('opening')
    try {
      recoveryOffer.value = await window.documentBridge.recoveryOffer()
      recoveryState.value = 'ready'
      recoveryStatus.value = 'Recovery saves completed edits locally for up to seven days after an interruption.'
    } catch (error) {
      recoveryState.value = 'failed'
      recoveryStatus.value = `Recovery could not be checked. Automatic recovery is disabled for this session to preserve existing copies. ${describeError(error)}`
    } finally { owner.finishOperation() }
  }
  async function restoreRecovery(): Promise<void> {
    await run('opening', async () => {
      const document = await window.documentBridge.restoreRecovery()
      await owner.publish(document.source, document.edit, async () => true)
      baseline.value = { kind: 'unsaved' }
      recoveryOffer.value = null
      scheduleCheckpoint()
    }, true)
  }
  async function discardRecovery(): Promise<void> {
    await run('opening', async () => {
      await window.documentBridge.discardRecovery()
      recoveryOffer.value = null
      recoveryStatus.value = 'Recovery discarded. Both saved generations were removed.'
    }, true)
  }
  async function drop(event: DragEvent): Promise<void> {
    event.preventDefault()
    const files = Array.from(event.dataTransfer?.files ?? [])
    if (files.length !== 1) {
      owner.report({ kind: 'error', text: 'Drop exactly one PNG or JPEG file. Web addresses are not supported.' })
      return
    }
    await load(() => window.imageBridge.dropImages(files))
  }
  async function close(request: string): Promise<void> {
    if (closing.value) return
    closing.value = true
    cancelCheckpoint()
    owner.cancelPreparation()
    try {
      if (active.value || recoveryState.value !== 'checking' && owner.fileBusy.value) {
        await new Promise<void>((resolve) => {
          const stop = watch(() => active.value || owner.fileBusy.value, (busy) => { if (!busy) { stop(); resolve() } })
        })
      }
      const accepted = await confirmLeaving()
      const decision = !accepted ? 'cancel' : recoveryState.value !== 'ready' || recoveryOffer.value ? 'preserve-recovery' : 'close'
      await window.documentBridge.replyToClose({ request, decision })
      if (accepted) return
    } catch (error) {
      owner.report({ kind: 'error', text: describeError(error) })
      await window.documentBridge.replyToClose({ request, decision: 'cancel' })
    }
    closing.value = false
    scheduleCheckpoint()
  }
  const stopClose = window.documentBridge.onCloseRequested((request) => { void close(request) })
  onUnmounted(() => { cancelCheckpoint(); stopClose() })
  return { dirty, locked, load, recoveryOffer, recoveryStatus, scheduleCheckpoint, cancelCheckpoint, checkRecovery, restoreRecovery, discardRecovery,
    openImage: () => load(() => window.imageBridge.openImage()), pasteImage: () => load(() => window.imageBridge.pasteImage()),
    openProject, saveProject, loadPreset, savePreset, drop }
}
