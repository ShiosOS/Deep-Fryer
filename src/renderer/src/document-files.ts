import { onUnmounted, ref, type Ref } from 'vue'
import type { EditableDocument, RecoveryOffer } from '../../shared/documents'
import type { OpenImage } from '../../shared/image'
import { newRecipe, type Recipe } from '../../shared/recipe'

export type FileOperation = 'opening' | 'exporting'
type Notice = { kind: 'info' | 'success' | 'error'; text: string }
type DocumentOwner = {
  busy: Readonly<Ref<boolean>>
  source: () => OpenImage | null
  recipe: () => Recipe
  ready: () => boolean
  gestureActive: () => boolean
  setOperation: (operation: FileOperation | 'idle') => void
  finishOperation: () => void
  report: (notice: Notice) => void
  publish: (source: OpenImage, recipe: Recipe) => Promise<void>
  applyRecipe: (recipe: Recipe) => void
}

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : 'Something went wrong. Try again.'
}

export function useDocumentFiles(owner: DocumentOwner) {
  const recoveryOffer = ref<RecoveryOffer>(null)
  const recoveryStatus = ref('Recovery saves completed edits locally for up to seven days after an interruption.')
  let checkpointTimer: ReturnType<typeof setTimeout> | null = null

  function cancelCheckpoint(): void {
    if (checkpointTimer) clearTimeout(checkpointTimer)
    checkpointTimer = null
  }
  function current(): EditableDocument | null {
    const source = owner.source()
    return source ? { source: { name: source.name, mime: source.mime, bytes: source.bytes }, recipe: owner.recipe() } : null
  }
  async function run(operation: FileOperation, action: () => Promise<void>, allowRecovery = false): Promise<void> {
    if (owner.busy.value || recoveryOffer.value && !allowRecovery) return
    cancelCheckpoint()
    owner.setOperation(operation)
    try { await action() } catch (error) { owner.report({ kind: 'error', text: describeError(error) }) }
    finally { owner.finishOperation(); scheduleCheckpoint() }
  }
  async function load(provider: () => Promise<OpenImage | null>): Promise<void> {
    await run('opening', async () => {
      const source = await provider()
      if (source) { await owner.publish(source, newRecipe()); scheduleCheckpoint() }
    })
  }
  function scheduleCheckpoint(): void {
    cancelCheckpoint()
    if (!owner.ready() || owner.gestureActive() || recoveryOffer.value) return
    checkpointTimer = setTimeout(() => {
      checkpointTimer = null
      if (!owner.ready() || owner.gestureActive()) return
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
      await owner.publish(document.source, document.recipe)
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
    let candidate: Recipe | null = null
    await run('opening', async () => {
      candidate = await window.documentBridge.openPreset()
    })
    if (candidate) owner.applyRecipe(candidate)
  }
  async function savePreset(): Promise<void> {
    if (!owner.ready()) return
    await run('exporting', async () => {
      const document = current()
      if (!document) return
      const result = await window.documentBridge.savePreset(document.recipe, document.source.name)
      if (result.kind === 'saved') owner.report({ kind: 'success', text: `Saved ${result.name}. This preset contains settings and its saved seed, without the source image.` })
    })
  }
  async function checkRecovery(): Promise<void> {
    try { recoveryOffer.value = await window.documentBridge.recoveryOffer() }
    catch (error) { recoveryStatus.value = `Recovery could not be checked. ${describeError(error)}` }
  }
  async function restoreRecovery(): Promise<void> {
    await run('opening', async () => {
      const document = await window.documentBridge.restoreRecovery()
      await owner.publish(document.source, document.recipe)
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
