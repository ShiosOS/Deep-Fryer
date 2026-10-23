import { onUnmounted, ref, type Ref } from 'vue'
import type { EditableDocument, RecoveryOffer } from '../../shared/documents'
import type { OpenImage } from '../../shared/image'
import { newPreset, type Preset } from '../../shared/preset'

export type FileOperation = 'opening' | 'exporting'
type Notice = { kind: 'info' | 'success' | 'error'; text: string }
type DocumentOwner = {
  busy: Readonly<Ref<boolean>>
  source: () => OpenImage | null
  preset: () => Preset
  ready: () => boolean
  gestureActive: () => boolean
  setOperation: (operation: FileOperation | 'idle') => void
  finishOperation: () => void
  report: (notice: Notice) => void
  publish: (source: OpenImage, preset: Preset) => Promise<void>
  applyPreset: (preset: Preset) => void
}

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : 'Something went wrong. Try again.'
}

export function useDocumentFiles(owner: DocumentOwner) {
  const recoveryOffer = ref<RecoveryOffer>(null)
  const recoveryStatus = ref('Checking for interrupted work…')
  let recoveryState: 'checking' | 'ready' | 'failed' = 'checking'
  let checkpointTimer: ReturnType<typeof setTimeout> | null = null

  function cancelCheckpoint(): void {
    if (checkpointTimer) clearTimeout(checkpointTimer)
    checkpointTimer = null
  }
  function current(): EditableDocument | null {
    const source = owner.source()
    return source ? { source: { name: source.name, mime: source.mime, bytes: source.bytes }, preset: owner.preset() } : null
  }
  async function run(operation: FileOperation, action: () => Promise<void>, allowRecovery = false): Promise<void> {
    if (recoveryState === 'checking' || owner.busy.value || recoveryOffer.value && !allowRecovery) return
    cancelCheckpoint()
    owner.setOperation(operation)
    try { await action() } catch (error) { owner.report({ kind: 'error', text: describeError(error) }) }
    finally { owner.finishOperation(); scheduleCheckpoint() }
  }
  async function load(provider: () => Promise<OpenImage | null>): Promise<void> {
    await run('opening', async () => {
      const source = await provider()
      if (source) { await owner.publish(source, newPreset()); scheduleCheckpoint() }
    })
  }
  function scheduleCheckpoint(): void {
    cancelCheckpoint()
    if (recoveryState !== 'ready' || !owner.ready() || owner.gestureActive() || recoveryOffer.value) return
    checkpointTimer = setTimeout(() => {
      checkpointTimer = null
      if (recoveryState !== 'ready' || recoveryOffer.value || !owner.ready() || owner.gestureActive()) return
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
      await owner.publish(document.source, document.preset)
      scheduleCheckpoint()
    })
  }
  async function saveProject(): Promise<void> {
    if (!owner.ready()) return
    await run('exporting', async () => {
      const document = current()
      if (!document) return
      const result = await window.documentBridge.saveProject(document)
      if (result.kind === 'saved') owner.report({ kind: 'success', text: `Saved ${result.name}. Move this project anywhere to continue editing.` })
    })
  }
  async function loadPreset(): Promise<void> {
    if (!owner.source()) return
    let candidate: Preset | null = null
    await run('opening', async () => {
      candidate = await window.documentBridge.openPreset()
    })
    if (candidate) owner.applyPreset(candidate)
  }
  async function savePreset(): Promise<void> {
    if (!owner.ready()) return
    await run('exporting', async () => {
      const document = current()
      if (!document) return
      const result = await window.documentBridge.savePreset(document.preset, document.source.name)
      if (result.kind === 'saved') owner.report({ kind: 'success', text: `Saved ${result.name}. This preset contains settings and its saved seed, without the source image.` })
    })
  }
  async function checkRecovery(): Promise<void> {
    owner.setOperation('opening')
    try {
      recoveryOffer.value = await window.documentBridge.recoveryOffer()
      recoveryState = 'ready'
      recoveryStatus.value = 'Recovery saves completed edits locally for up to seven days after an interruption.'
    } catch (error) {
      recoveryState = 'failed'
      recoveryStatus.value = `Recovery could not be checked. Automatic recovery is disabled for this session to preserve existing copies. ${describeError(error)}`
    } finally { owner.finishOperation() }
  }
  async function restoreRecovery(): Promise<void> {
    await run('opening', async () => {
      const document = await window.documentBridge.restoreRecovery()
      await owner.publish(document.source, document.preset)
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
  onUnmounted(cancelCheckpoint)
  return { recoveryOffer, recoveryStatus, scheduleCheckpoint, cancelCheckpoint, checkRecovery, restoreRecovery, discardRecovery,
    openImage: () => load(() => window.imageBridge.openImage()), pasteImage: () => load(() => window.imageBridge.pasteImage()),
    openProject, saveProject, loadPreset, savePreset, drop }
}
