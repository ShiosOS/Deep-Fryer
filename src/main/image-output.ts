import { dialog, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { basename } from 'node:path'
import { exportImageInput, outputFormats, type ExportResult } from '../shared/output'
import { writeImageExclusive } from './image-files'

export function registerImageOutput(editor: BrowserWindow, checkSender: (event: IpcMainInvokeEvent) => void, setExporting: (active: boolean) => void): void {
  ipcMain.removeHandler('image:export')
  ipcMain.handle('image:export', async (event, value: unknown): Promise<ExportResult> => {
    checkSender(event)
    const input = exportImageInput.parse(value)
    setExporting(true)
    try {
      const format = outputFormats[input.format]
      const safeName = basename(input.suggestedName).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
      const result = await dialog.showSaveDialog(editor, {
        title: `Export ${format.label} as a new file`, defaultPath: safeName,
        properties: ['dontAddToRecent'], filters: [{ name: `${format.label} image`, extensions: [format.extension] }]
      })
      if (result.canceled || result.filePath === undefined) return { kind: 'cancelled' }
      const extension = input.format === 'jpeg' ? /\.jpe?g$/i : new RegExp(`\\.${format.extension}$`, 'i')
      const path = extension.test(result.filePath) ? result.filePath : `${result.filePath}.${format.extension}`
      await writeImageExclusive(path, input.bytes, input.format)
      return { kind: 'saved', name: basename(path) }
    } finally {
      setExporting(false)
    }
  })
}
