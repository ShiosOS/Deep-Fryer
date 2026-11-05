import { computed, onUnmounted, ref, shallowRef, watch, type Ref } from 'vue'
import type { EditableDocument, ProjectTarget, RecoveryOffer } from '../../shared/documents'
import type { OpenImage } from '../../shared/image'
import type { Preset } from '../../shared/preset'
import { newEdit, snapshotEdit, type EditState } from '../../shared/edit'

export type FileOperation = 'opening' | 'exporting'
type Notice = { kind: 'info' | 'success' | 'error'; text: string }
type ProjectBaseline = { kind: 'unsaved' } | { kind: 'saved'; document: EditableDocument; target: ProjectTarget | null }
type DocumentOwner = {
  busy: Readonly<Ref<boolean>>
  fileBusy: Readonly<Ref<boolean>>
  source: () => OpenImage | null
  edit: () => EditState
  ready: () => boolean
  finishGesture: () => void
  cancelPreparation: () => void
  setOperation: (operation: FileOperation | 'idle') => void
  finishOperation: () => void
  report: (notice: Notice) => void
  publish: (source: OpenImage, edit: EditState, confirm: () => Promise<boolean>) => Promise<boolean>
  applyPreset: (preset: Preset) => void
}

function snapshotDocument(document: EditableDocument): EditableDocument {
  return { source: { ...document.source, bytes: new Uint8Array(document.source.bytes) }, edit: snapshotEdit(document.edit) }
}

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : 'Something went wrong. Try again.'
}

export function useDocumentFiles(owner: DocumentOwner) {
  const recoveryOffer = ref<RecoveryOffer>(null)
  const recoveryStatus = ref('Checking for interrupted work…')
  const baseline = shallowRef<ProjectBaseline>({ kind: 'unsaved' })
  const target = computed(() => baseline.value.kind === 'saved' ? baseline.value.target : null)
  const activity = ref<'idle' | 'file-action' | 'saving-project'>('idle')
  const savingProject = computed(() => activity.value === 'saving-project')
  const closing = ref(false)
  const recoveryState = ref<'checking' | 'ready' | 'failed'>('checking')
  const locked = computed(() => activity.value !== 'idle' || closing.value || recoveryState.value === 'checking')
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
    return source ? snapshotDocument({ source: { name: source.name, mime: source.mime, bytes: source.bytes }, edit: owner.edit() }) : null
  }
  async function replaceBaseline(next: ProjectBaseline): Promise<void> {
    const previous = target.value
    baseline.value = next
    if (previous && previous.id !== target.value?.id) await window.documentBridge.releaseProjectTarget(previous.id)
  }
  async function saveCurrent(suggestedName?: string): Promise<boolean> {
    owner.finishGesture()
    const document = current()
    if (!document) return true
    const previousActivity = activity.value
    activity.value = 'saving-project'
    try {
      const destination = target.value
      const result = destination && suggestedName === undefined
        ? await window.documentBridge.saveProject({ document, target: destination.id })
        : await window.documentBridge.saveProjectAs({ document, suggestedName: suggestedName ?? `${document.source.name.replace(/\.[^.]+$/, '')}.deepfryer` })
      if (result.kind !== 'saved') {
        if (result.kind === 'cancelled') owner.report({ kind: 'info', text: 'Project save canceled. Your current edit is unchanged.' })
        else if (result.kind === 'conflict') {
          const reasons = { changed: 'changed outside Deep Fryer', missing: 'moved or deleted', readonly: 'read-only or not writable', stale: 'no longer authorized in this session', unsafe: 'a link or no longer a regular file' }
          owner.report({ kind: 'error', text: `The project is ${reasons[result.reason]}. Reopen it or use Save project as… to make a separate copy. Your edit is unchanged.` })
        } else owner.report({ kind: 'error', text: result.message })
        return false
      }
      await replaceBaseline({ kind: 'saved', document, target: result.target })
      owner.report({ kind: 'success', text: `Saved ${result.target.name}.` })
      return true
    } finally { activity.value = previousActivity }
  }
  async function confirmLeaving(): Promise<boolean> {
    owner.finishGesture()
    if (!dirty.value) return true
    const choice = await window.documentBridge.confirmUnsaved()
    if (choice === 'cancel') return false
    if (choice === 'discard') return true
    return saveCurrent()
  }
  async function run(operation: FileOperation | 'saving-project', action: () => Promise<void>, allowRecovery = false, allowProcessing = false): Promise<void> {
    if (locked.value || owner.fileBusy.value || owner.busy.value && !allowProcessing || recoveryOffer.value && !allowRecovery) return
    cancelCheckpoint()
    try { owner.finishGesture() } catch (error) { owner.report({ kind: 'error', text: describeError(error) }); return }
    activity.value = operation === 'saving-project' ? operation : 'file-action'
    owner.setOperation(operation === 'saving-project' ? 'idle' : operation)
    try { await action() } catch (error) { owner.report({ kind: 'error', text: describeError(error) }) }
    finally {
      if (operation !== 'saving-project') owner.finishOperation()
      activity.value = 'idle'
      scheduleCheckpoint()
    }
  }
  async function load(provider: () => Promise<OpenImage | null>): Promise<void> {
    await run('opening', async () => {
      const source = await provider()
      if (source && await owner.publish(source, newEdit(), confirmLeaving)) await replaceBaseline({ kind: 'unsaved' })
    })
  }
  function scheduleCheckpoint(): void {
    cancelCheckpoint()
    if (locked.value || recoveryState.value !== 'ready' || !owner.ready() || recoveryOffer.value) return
    checkpointTimer = setTimeout(() => {
      checkpointTimer = null
      if (locked.value || recoveryState.value !== 'ready' || recoveryOffer.value || !owner.ready()) return
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
      const candidate = await window.documentBridge.openProject()
      if (!candidate) return
      let adopted = false
      try {
        const { document, target } = candidate
        const snapshot = snapshotDocument(document)
        if (await owner.publish(document.source, document.edit, confirmLeaving)) {
          adopted = true
          await replaceBaseline({ kind: 'saved', document: snapshot, target })
        }
      } finally {
        if (!adopted && candidate.target) await window.documentBridge.releaseProjectTarget(candidate.target.id)
      }
    })
  }
  async function saveProject(suggestedName?: string): Promise<void> {
    if (!owner.source()) return
    await run('saving-project', async () => {
      await saveCurrent(suggestedName)
    }, false, true)
  }
  async function loadPreset(): Promise<void> {
    if (!owner.source()) return
    await run('opening', async () => {
      const candidate = await window.documentBridge.openPreset()
      if (candidate) owner.applyPreset(candidate)
    })
  }
  async function savePreset(suggestedName: string): Promise<void> {
    if (!owner.source()) return
    await run('exporting', async () => {
      const document = current()
      if (!document) return
      const result = await window.documentBridge.savePreset({ preset: document.edit.preset, suggestedName })
      if (result.kind === 'saved') owner.report({ kind: 'success', text: `Saved ${result.name}. This preset contains settings and its saved seed, without the source image.` })
      else owner.report({ kind: 'info', text: 'Preset save canceled. No file was saved.' })
    }, false, true)
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
      if (await owner.publish(document.source, document.edit, async () => true)) {
        await replaceBaseline({ kind: 'unsaved' })
        recoveryOffer.value = null
        scheduleCheckpoint()
      }
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
      if (activity.value !== 'idle' || recoveryState.value !== 'checking' && owner.fileBusy.value) {
        await new Promise<void>((resolve) => {
          const stop = watch(() => activity.value !== 'idle' || owner.fileBusy.value, (busy) => { if (!busy) { stop(); resolve() } })
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
  return { dirty, target, locked, savingProject, load, recoveryOffer, recoveryStatus, scheduleCheckpoint, cancelCheckpoint, checkRecovery, restoreRecovery, discardRecovery,
    openImage: () => load(() => window.imageBridge.openImage()), pasteImage: () => load(() => window.imageBridge.pasteImage()),
    openProject, saveProject, loadPreset, savePreset, drop }
}
