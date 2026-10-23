import { clipboard, dialog, ipcMain, nativeImage, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { basename } from 'node:path'
import { z } from 'zod'
import { editableDocumentSchema } from '../shared/documents'
import { validateDimensions, type OpenImage } from '../shared/image'
import { recipeSchema } from '../shared/recipe'
import { encodePreset, encodeProject, readPreset, readProject, writeDocumentExclusive } from './document-files'
import { inspectImage, readImage } from './image-files'
import { RecoveryStore } from './recovery'

export function validateSource(source: OpenImage): void {
  if (inspectImage(source.bytes) !== source.mime) throw new Error('The embedded image has the wrong format.')
  const image = nativeImage.createFromBuffer(Buffer.from(source.bytes))
  if (image.isEmpty()) throw new Error('The embedded image cannot be decoded. Your current edit is unchanged.')
  const size = image.getSize()
  validateDimensions(size.width, size.height)
}

export function registerDocumentActions(editor: BrowserWindow, checkSender: (event: IpcMainInvokeEvent) => void, recovery: RecoveryStore): void {
  let openingFile = false
  function register(name: string, action: (...args: unknown[]) => Promise<unknown>, fileAction = true): void {
    ipcMain.removeHandler(name)
    ipcMain.handle(name, async (event, ...args: unknown[]) => {
      checkSender(event)
      if (fileAction && openingFile) throw new Error('Finish the current document action first.')
      if (fileAction) openingFile = true
      try { return await action(...args) } finally { if (fileAction) openingFile = false }
    })
  }
  async function openPath(title: string, name: string, extensions: string[]): Promise<string | null> {
    const result = await dialog.showOpenDialog(editor, { title, properties: ['openFile', 'dontAddToRecent'], filters: [{ name, extensions }] })
    return result.canceled ? null : result.filePaths[0] ?? null
  }
  async function save(text: string, suggestedName: string, extension: string, label: string) {
    const safeName = basename(suggestedName).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    const result = await dialog.showSaveDialog(editor, {
      title: `Save ${label} as a new file`, defaultPath: safeName,
      properties: ['dontAddToRecent'], filters: [{ name: label, extensions: [extension] }]
    })
    if (result.canceled || !result.filePath) return { kind: 'cancelled' }
    const path = result.filePath.toLowerCase().endsWith(`.${extension}`) ? result.filePath : `${result.filePath}.${extension}`
    await writeDocumentExclusive(path, text)
    return { kind: 'saved', name: basename(path) }
  }
  register('document:open-project', async () => {
    const path = await openPath('Open a portable project', 'Deep Fryer project', ['deepfryer'])
    if (!path) return null
    const document = await readProject(path)
    validateSource(document.source)
    return document
  })
  register('document:save-project', async (input) => {
    const document = editableDocumentSchema.parse(input)
    validateSource(document.source)
    return save(encodeProject(document), `${document.source.name.replace(/\.[^.]+$/, '')}.deepfryer`, 'deepfryer', 'project')
  })
  register('document:open-preset', async () => {
    const path = await openPath('Load a recipe preset', 'Deep Fryer recipe', ['fryrecipe'])
    return path ? readPreset(path) : null
  })
  register('document:save-preset', async (input, imageName) => {
    const recipe = recipeSchema.parse(input)
    const name = z.string().min(1).max(1024).parse(imageName)
    return save(encodePreset(recipe), `${name.replace(/\.[^.]+$/, '')}.fryrecipe`, 'fryrecipe', 'recipe preset')
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
  const offer = recovery.initialize()
  register('recovery:offer', async () => offer, false)
  register('recovery:restore', async () => recovery.restore())
  register('recovery:discard', async () => recovery.discard())
  register('recovery:checkpoint', async (input) => recovery.checkpoint(editableDocumentSchema.parse(input)), false)
}
