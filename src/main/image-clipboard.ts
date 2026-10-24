import { clipboard, ClipboardItem, ipcMain, nativeImage, type IpcMainInvokeEvent } from 'electron'
import { copyImageInput, type CopyImageResult } from '../shared/clipboard'
import { validateDimensions } from '../shared/image'
import { MAX_EXPORT_BYTES } from '../shared/output'
import { inspectImage } from './image-files'

export function registerImageClipboard(checkSender: (event: IpcMainInvokeEvent) => void, setFileAction: (active: boolean) => void): void {
  ipcMain.removeHandler('image:copy')
  ipcMain.handle('image:copy', async (event, value: unknown): Promise<CopyImageResult> => {
    checkSender(event)
    const { bytes } = copyImageInput.parse(value)
    if (inspectImage(bytes, MAX_EXPORT_BYTES) !== 'image/png') throw new Error('Copy image requires a PNG image.')
    const image = nativeImage.createFromBuffer(Buffer.from(bytes))
    if (image.isEmpty()) throw new Error('The copied image cannot be decoded. Try again.')
    const size = image.getSize()
    validateDimensions(size.width, size.height)
    setFileAction(true)
    try {
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(bytes)], { type: 'image/png' }) })])
      return { kind: 'copied' }
    } finally { setFileAction(false) }
  })
}
