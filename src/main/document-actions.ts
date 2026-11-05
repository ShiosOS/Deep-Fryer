import { clipboard, dialog, ipcMain, nativeImage, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { basename } from 'node:path'
import { z } from 'zod'
import { editableDocumentSchema, projectTargetIdSchema, savePresetInput, saveProjectInput, saveProjectAsInput } from '../shared/documents'
import { validateDimensions, type OpenImage } from '../shared/image'
import { encodePreset, readPreset, writeDocumentExclusive } from './document-files'
import { ProjectTargets } from './project-targets'
import { inspectImage, readImage } from './image-files'
import { RecoveryStore } from './recovery'
import { legacyPresetExtension } from './legacy-document-codec'

export function validateSource(source: OpenImage): void {
  if (inspectImage(source.bytes) !== source.mime) throw new Error('The embedded image has the wrong format.')
  const image = nativeImage.createFromBuffer(Buffer.from(source.bytes))
  if (image.isEmpty()) throw new Error('The embedded image cannot be decoded. Your current edit is unchanged.')
  const size = image.getSize()
  validateDimensions(size.width, size.height)
}

export function registerDocumentActions(editor: BrowserWindow, checkSender: (event: IpcMainInvokeEvent) => void, recovery: RecoveryStore, setFileAction: (active: boolean) => void): void {
  const targets = new ProjectTargets()
  editor.once('closed', () => targets.clear())
  function register(name: string, action: (...args: unknown[]) => Promise<unknown>, fileAction = true): void {
    ipcMain.removeHandler(name)
    ipcMain.handle(name, async (event, ...args: unknown[]) => {
      checkSender(event)
      if (fileAction) setFileAction(true)
      try { return await action(...args) } finally { if (fileAction) setFileAction(false) }
    })
  }
  async function openPath(title: string, name: string, extensions: string[]): Promise<string | null> {
    const result = await dialog.showOpenDialog(editor, { title, properties: ['openFile', 'dontAddToRecent'], filters: [{ name, extensions }] })
    return result.canceled ? null : result.filePaths[0] ?? null
  }
  async function savePath(suggestedName: string, extension: string, label: string): Promise<string | null> {
    const safeName = basename(suggestedName).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    const result = await dialog.showSaveDialog(editor, {
      title: `Save ${label} as a new file`, defaultPath: safeName,
      properties: ['dontAddToRecent'], filters: [{ name: label, extensions: [extension] }]
    })
    if (result.canceled || !result.filePath) return null
    return result.filePath.toLowerCase().endsWith(`.${extension}`) ? result.filePath : `${result.filePath}.${extension}`
  }
  register('document:confirm-unsaved', async () => {
    const { response } = await dialog.showMessageBox(editor, {
      type: 'warning', title: 'Unsaved project', message: 'Save your editable work before leaving this image?',
      detail: 'An exported or copied image does not keep your editable settings.',
      buttons: ['Save project', 'Discard', 'Cancel'], defaultId: 0, cancelId: 2, noLink: true
    })
    return response === 0 ? 'save' : response === 1 ? 'discard' : 'cancel'
  })
  register('document:open-project', async () => {
    const path = await openPath('Open a portable project', 'Deep Fryer project', ['deepfryer'])
    if (!path) return null
    return targets.openProject(path, (document) => validateSource(document.source))
  })
  register('document:save-project', async (input) => {
    const { document, target } = saveProjectInput.parse(input)
    validateSource(document.source)
    return targets.save(target, document)
  })
  register('document:save-project-as', async (input) => {
    const { document, suggestedName } = saveProjectAsInput.parse(input)
    validateSource(document.source)
    const path = await savePath(suggestedName.replace(/\.deepfryer$/i, '') + '.deepfryer', 'deepfryer', 'project')
    return path ? targets.saveAs(path, document) : { kind: 'cancelled' }
  })
  register('document:release-project-target', async (input) => { targets.release(projectTargetIdSchema.parse(input)) })
  register('document:open-preset', async () => {
    const path = await openPath('Load a preset', 'Deep Fryer preset', ['frypreset', legacyPresetExtension])
    return path ? readPreset(path) : null
  })
  register('document:save-preset', async (input) => {
    const { preset, suggestedName } = savePresetInput.parse(input)
    const path = await savePath(suggestedName.replace(/\.frypreset$/i, '') + '.frypreset', 'frypreset', 'preset')
    if (!path) return { kind: 'cancelled' }
    await writeDocumentExclusive(path, encodePreset(preset))
    return { kind: 'saved', name: basename(path) }
  })
  register('image:paste', async () => {
    for (const item of await clipboard.read()) {
      for (const mime of ['image/png', 'image/jpeg'] satisfies Array<'image/png' | 'image/jpeg'>) {
        if (!item.types.includes(mime)) continue
        const blob = await item.getType(mime)
        const bytes = new Uint8Array(await blob.arrayBuffer())
        const format = inspectImage(bytes)
        const source = { name: `Clipboard image.${format === 'image/png' ? 'png' : 'jpg'}`, mime: format, bytes }
        validateSource(source)
        return source
      }
    }
    throw new Error('The clipboard does not contain a PNG or JPEG image. Copy an image and try again.')
  })
  register('image:drop', async (input) => {
    const paths = z.array(z.string().min(1).max(32768)).length(1, 'Drop exactly one PNG or JPEG file.').parse(input)
    const path = paths[0]
    if (!path) throw new Error('Drop exactly one PNG or JPEG file.')
    return readImage(path)
  })
  register('recovery:offer', async () => recovery.initialize(), false)
  register('recovery:restore', async () => recovery.restore())
  register('recovery:discard', async () => recovery.discard())
  register('recovery:checkpoint', async (input) => recovery.checkpoint(editableDocumentSchema.parse(input)), false)
}
